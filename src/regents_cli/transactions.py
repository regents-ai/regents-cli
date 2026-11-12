"""Sending a site's transactions with the agent key on this machine (`--send`).

A command whose description says it `sends` answers `{chain_id, transactions}`: Base
transactions the site built for the agent's own wallet, in the order to send them. With --send,
the agent key signs and sends each in turn and waits for it to land before the next, so their
nonces follow from the first one read at the latest block. One the chain's own state makes
certain to fail (its `blocked` reason) is never sent; that stops all of them, before any is sent.
So does a node that is not on Base, or a wallet that cannot cover all of them as far as they can
be priced before the first is sent. Once one is handed to the node, only its receipt says what
happened to it: until one is read, it has not landed, and nothing offers to send it again.
"""

from __future__ import annotations

import contextlib
import json
import re
import time
from dataclasses import replace
from typing import Any

from regents_cli import base, output, siwa
from regents_cli.errors import EXIT_AUTH, EXIT_CANCELLED, EXIT_UNREACHABLE, CommandError
from regents_cli.next_steps import Step, done, human, person_first

#: A transaction as a site answers it for --send, value in wei as decimal text.
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}")
DATA = re.compile(r"0x(?:[0-9a-fA-F]{2})*")
WEI = re.compile(r"0|[1-9][0-9]{0,77}")
#: How long a sent transaction may take to land on Base (a block every 0.2 seconds).
LANDING_WAIT_SECONDS = 60
LANDING_POLL_SECONDS = 0.5
EXPLORER = "https://basescan.org/tx/"


def holder(answer: dict[str, Any]) -> dict[str, Any]:
    """The part of a site's answer that holds its `transactions`: the answer, or its `data`."""
    data = answer.get("data")
    return answer if "transactions" in answer else data if isinstance(data, dict) else {}


def blocked(transaction: dict[str, Any]) -> bool:
    """Whether the site says the chain's own state makes `transaction` certain to fail: a
    `blocked` reason that says something."""
    reason = transaction.get("blocked")
    return isinstance(reason, str) and reason.strip() != ""


def listed(answer: dict[str, Any]) -> list[dict[str, Any]]:
    """The answer's transactions, at the top or in `data`, in order; [] when it lists none."""
    held = holder(answer)
    found = held.get("transactions")
    if not (isinstance(found, list) and found):
        return []
    if not all(map(readable, found)):
        raise unreadable()
    if held.get("chain_id") != base.CHAIN_ID:
        raise CommandError(
            "not_on_base",
            f"The site's transactions are for chain {held.get('chain_id')!r}, and regents "
            f"sends only on Base ({base.CHAIN_ID}). Nothing was sent.",
        )
    return found


def readable(transaction: Any) -> bool:
    return (
        isinstance(transaction, dict)
        and isinstance(transaction.get("name"), str)
        and isinstance(transaction.get("to"), str)
        and ADDRESS.fullmatch(transaction["to"]) is not None
        and isinstance(transaction.get("data"), str)
        and DATA.fullmatch(transaction["data"]) is not None
        and isinstance(transaction.get("value"), str)
        and WEI.fullmatch(transaction["value"]) is not None
        and (transaction.get("blocked") is None or isinstance(transaction["blocked"], str))
    )


def unreadable() -> CommandError:
    return CommandError(
        "transactions_unreadable",
        "The site's transactions are not in the shape regents signs ({name, to, data, value, "
        "blocked}, value in wei), so nothing was sent.",
    )


def send(
    found: list[dict[str, Any]], fresh: Step, as_json: bool, timeout_ms: int
) -> dict[str, Any]:
    """Sign and send each of `found` in order with the agent key, each after the one before it
    lands. `fresh` is the step that builds them afresh from the chain. Answers what was sent and
    how each landed; a failure on the way carries what was sent before it."""
    key = siwa.load_key()
    if key is None:
        raise CommandError(
            "no_agent_key",
            "There is no agent key on this machine, so nothing was sent.",
            exit_code=EXIT_AUTH,
        )
    if key.signer is not None:
        raise CommandError(
            "signer_cannot_send",
            "This machine's agent key signs through a command, which signs messages and not "
            "transactions. Send them from that wallet instead: leave out --send.",
            exit_code=EXIT_AUTH,
        )
    base.on_base(timeout_ms)
    sent: list[dict[str, Any]] = []
    nonce = base.nonce(key.address, timeout_ms)
    steps = [
        {
            "from": key.address,
            "to": transaction["to"],
            "data": transaction["data"],
            "value": hex(int(transaction["value"])),
            "chainId": base.CHAIN_ID,
        }
        for transaction in found
    ]
    try:
        covers(key.address, steps, nonce, timeout_ms)
    except CommandError as error:
        raise with_sent(error, sent, fresh) from None
    for transaction, step in zip(found, steps, strict=True):
        name = transaction["name"]
        # Each stage the transaction reaches decides how an interrupt ends: before it is signed
        # nothing of it was sent; once signed it may be on its way, so only its receipt tells.
        tx_hash: str | None = None
        status: bool | None = None
        try:
            try:
                signing, needs = base.priced(step, nonce, timeout_ms)
                show(transaction, signing, needs, key.address, as_json)
                raw, tx_hash = base.signed(key, signing, needs, timeout_ms)
            except CommandError as error:
                raise with_sent(error, sent, fresh) from None
            handing_over(name, tx_hash, look_up(tx_hash), as_json)
            taken = base.broadcast(raw, timeout_ms)
            status = landed(tx_hash, timeout_ms)
            sent.append(record(transaction, tx_hash, status))
            if status is None:
                raise not_landed(
                    (
                        f"{name} was sent as {tx_hash}, and it"
                        if taken
                        else f"The Base node did not confirm taking {name} ({tx_hash}), and it"
                    )
                    + f" is not on Base after {LANDING_WAIT_SECONDS} seconds of looking, so the "
                    "ones after it were not sent.",
                    tx_hash,
                    sent,
                    EXIT_UNREACHABLE,
                )
            if status is False:
                failed = CommandError(
                    "transaction_failed",
                    f"{name} landed on Base but failed ({tx_hash}), so the ones after it were not "
                    "sent. The chain may have changed after the site built it.",
                )
                raise with_sent(failed, sent, fresh)
        except KeyboardInterrupt:
            if tx_hash is not None and not (sent and sent[-1]["tx_hash"] == tx_hash):
                sent.append(record(transaction, tx_hash, status))
            if tx_hash is None or sent[-1]["landed"] != "not yet":
                if not sent:
                    raise
                cancelled = CommandError(
                    "cancelled",
                    "The command was interrupted, and nothing more was sent.",
                    exit_code=EXIT_CANCELLED,
                )
                raise with_sent(cancelled, sent, fresh) from None
            raise not_landed(
                f"The command was interrupted once {name} ({tx_hash}) was signed, so it may still "
                "land on Base. The ones after it were not sent.",
                tx_hash,
                sent,
                EXIT_CANCELLED,
            ) from None
        nonce += 1
    return {"wallet_address": key.address, "chain_id": base.CHAIN_ID, "sent": sent}


def handing_over(name: str, tx_hash: str, then: Step, as_json: bool) -> None:
    """The hash of a signed transaction and where to look it up, shown before it is handed to
    the node, so a run that ends any way at all leaves both behind; with --json on stderr, as the
    signing review is."""
    if as_json:
        sending = {"name": name, "tx_hash": tx_hash, "next_step": then.as_json()}
        output.stderr.out(json.dumps({"sending": sending}), highlight=False)
        return
    exact = ["  " + text for text in (then.command, then.url) if text is not None]
    output.show(output.verbatim("\n".join([f"Sending {name}: {tx_hash}", then.say, *exact])))


def look_up(tx_hash: str) -> Step:
    """A transaction handed to the node whose receipt is not read yet: only looking it up says
    whether it landed, and running the command again would send it again."""
    return human(
        "Look it up before running this again: running it now sends the transactions again.",
        url=EXPLORER + tx_hash,
    )


def record(transaction: dict[str, Any], tx_hash: str, status: bool | None) -> dict[str, Any]:
    """One transaction handed to the node, as `sent` lists it."""
    return {
        "name": transaction["name"],
        "value_eth": base.eth(int(transaction["value"])),
        "tx_hash": tx_hash,
        "landed": {True: "succeeded", False: "failed", None: "not yet"}[status],
    }


def not_landed(
    message: str, tx_hash: str, sent: list[dict[str, Any]], exit_code: int
) -> CommandError:
    """A transaction handed to the node whose receipt was not read."""
    return CommandError(
        "transaction_not_landed",
        message,
        exit_code=exit_code,
        next_steps=[look_up(tx_hash)],
        sent=sent,
    )


def covers(address: str, steps: list[dict[str, Any]], nonce: int, timeout_ms: int) -> None:
    """Before the first is sent: `address` holds every transaction's value, and the gas of each
    the node can price now. One that needs an earlier one on the chain first, such as a stake
    after its approve, would fail now, so until its turn only its value counts."""
    holds = base.balance(address, timeout_ms)
    values = sum(int(step["value"], 16) for step in steps)
    if holds < values:
        raise base.needs_eth(address, holds, values, len(steps))
    total = 0
    for offset, step in enumerate(steps):
        try:
            total += base.priced(step, nonce + offset, timeout_ms)[1]
        except CommandError as error:
            if offset == 0 or error.code != "transaction_would_fail":
                raise
            total += int(step["value"], 16)
    if holds < total:
        raise base.needs_eth(address, holds, total, len(steps))


def with_sent(error: CommandError, sent: list[dict[str, Any]], fresh: Step) -> CommandError:
    """`error`, after `sent` were handed to the node. Its next steps are what a person must do
    first, then the command again, building what is left from the chain as it is now; one the
    chain refused (would fail) is built afresh the same way."""
    if not sent and error.code != "transaction_would_fail":
        return error
    first = person_first(error)
    names = ", ".join(t["name"] for t in sent if t["landed"] == "succeeded")
    message, again = error.message, fresh
    if names:
        message += f" Before it, {names} landed on Base."
        again = replace(
            fresh, say=f"{names} landed already. {fresh.say} It builds only what is left."
        )
    fields = {**error.fields, "sent": sent} if sent else error.fields
    return CommandError(
        error.code,
        message,
        exit_code=error.exit_code,
        next_steps=[*first, again],
        review=error.review,
        **fields,
    )


def landed(tx_hash: str, timeout_ms: int) -> bool | None:
    """Whether the transaction succeeded on Base, read at the latest block; None when it has not
    landed in time. A receipt the node does not give, refuses or gives unreadably says nothing
    about the transaction, so the node is asked again until then."""
    deadline = time.monotonic() + LANDING_WAIT_SECONDS
    while True:
        with contextlib.suppress(CommandError):
            receipt = base.call("eth_getTransactionReceipt", [tx_hash], timeout_ms)
            if isinstance(receipt, dict):
                return base.number(receipt.get("status")) == 1
        if time.monotonic() >= deadline:
            return None
        time.sleep(LANDING_POLL_SECONDS)


def show(
    transaction: dict[str, Any], signed: dict[str, str], needs: int, sender: str, as_json: bool
) -> None:
    """What the agent key is about to sign, before it signs; with --json on stderr, so stdout
    keeps one answer."""
    if as_json:
        signing = {
            "name": transaction["name"],
            "most_it_costs": base.eth(needs),
            "transaction": signed,
        }
        output.stderr.out(json.dumps({"signing": signing}), highlight=False)
        return
    value = int(signed["value"], 16)
    output.show(
        output.review(
            [
                f"{sender}, the agent key on this machine, signs and sends {transaction['name']} "
                f"on Base (chain {base.CHAIN_ID}) to {signed['to']}.",
                f"Amount: {base.eth(value)} ETH. Gas: at most {base.eth(needs - value)} ETH, "
                f"paid by {sender}.",
                "Signed exactly as:",
                *(f"  {field}: {item}" for field, item in signed.items()),
            ]
        )
    )


def finished(answer: dict[str, Any]) -> list[Step]:
    count = len(answer["sent"])
    return [
        done(
            f"Sent {count} transaction{'s' if count > 1 else ''} from "
            f"{answer['wallet_address']}, and each landed on Base; nothing more to send."
        )
    ]
