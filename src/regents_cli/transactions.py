"""Sending a site's transactions with the agent key on this machine (`--send`).

A command whose description says it `sends` answers `{chain_id, transactions}`: Base
transactions the site built for the agent's own wallet, in the order to send them. With --send,
the agent key signs and sends each in turn and waits for it to land before the next, so their
nonces follow from the first one read at the latest block. One the chain's own state makes
certain to fail (its `blocked` reason) is never sent; that stops all of them, before any is sent.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

from regents_cli import base, output, siwa
from regents_cli.errors import EXIT_AUTH, EXIT_UNREACHABLE, CommandError
from regents_cli.next_steps import Step, done, human

#: A transaction as a site answers it for --send, value in wei as decimal text.
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}")
DATA = re.compile(r"0x(?:[0-9a-fA-F]{2})*")
WEI = re.compile(r"0|[1-9][0-9]{0,77}")
#: How long a sent transaction may take to land on Base (a block every 0.2 seconds).
LANDING_WAIT_SECONDS = 60
LANDING_POLL_SECONDS = 0.5
EXPLORER = "https://basescan.org/tx/"


def listed(answer: dict[str, Any]) -> list[dict[str, Any]]:
    """The answer's transactions, in order; [] when it lists none."""
    found = answer.get("transactions")
    if not (isinstance(found, list) and found):
        return []
    if not all(map(readable, found)):
        raise unreadable()
    if answer.get("chain_id") != base.CHAIN_ID:
        raise CommandError(
            "not_on_base",
            f"The site's transactions are for chain {answer.get('chain_id')!r}, and regents "
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
    found: list[dict[str, Any]], again: Step, as_json: bool, timeout_ms: int
) -> dict[str, Any]:
    """Sign and send each of `found` in order with the agent key, each after the one before it
    lands. `again` is the step that builds them afresh. Answers what was sent and how each
    landed; a failure on the way carries what was sent before it."""
    key = siwa.load_key()
    if key is None or key.signer is not None:
        raise CommandError(
            "signer_cannot_send",
            "This machine's agent key signs through a command, which signs messages and not "
            "transactions. Send them from that wallet instead: leave out --send.",
            exit_code=EXIT_AUTH,
        )
    sent: list[dict[str, Any]] = []
    nonce = base.nonce(key.address, timeout_ms)
    for transaction in found:
        step = {
            "from": key.address,
            "to": transaction["to"],
            "data": transaction["data"],
            "value": hex(int(transaction["value"])),
            "chainId": base.CHAIN_ID,
        }
        try:
            signed, needs = base.priced(step, nonce, timeout_ms)
            show(transaction, signed, needs, key.address, as_json)
            tx_hash = base.send(key, signed, needs, timeout_ms)
        except CommandError as error:
            raise with_sent(error, sent) from None
        status = landed(tx_hash, timeout_ms)
        sent.append(
            {
                "name": transaction["name"],
                "tx_hash": tx_hash,
                "landed": {True: "succeeded", False: "failed", None: "not yet"}[status],
            }
        )
        if status is None:
            raise CommandError(
                "transaction_not_landed",
                f"{transaction['name']} was sent as {tx_hash} but is not on Base after "
                f"{LANDING_WAIT_SECONDS} seconds, so the ones after it were not sent.",
                exit_code=EXIT_UNREACHABLE,
                next_steps=[
                    human(
                        "Look it up before running this again: running it now sends the "
                        "transactions again.",
                        url=EXPLORER + tx_hash,
                    )
                ],
                sent=sent,
            )
        if status is False:
            raise CommandError(
                "transaction_failed",
                f"{transaction['name']} landed on Base but failed ({tx_hash}), so the ones after "
                "it were not sent. The chain changed after the site built it.",
                next_steps=[again],
                sent=sent,
            )
        nonce += 1
    return {"wallet_address": key.address, "chain_id": base.CHAIN_ID, "sent": sent}


def with_sent(error: CommandError, sent: list[dict[str, Any]]) -> CommandError:
    """`error`, saying which transactions were sent and landed before it."""
    if not sent:
        return error
    names = ", ".join(t["name"] for t in sent)
    return CommandError(
        error.code,
        f"{error.message} Sent and landed before it: {names}.",
        exit_code=error.exit_code,
        next_steps=error.next_steps,
        review=error.review,
        **error.fields,
        sent=sent,
    )


def landed(tx_hash: str, timeout_ms: int) -> bool | None:
    """Whether the transaction succeeded on Base, read at the latest block; None when it has not
    landed in time. A node that does not answer a check is asked again until then."""
    deadline = time.monotonic() + LANDING_WAIT_SECONDS
    while True:
        try:
            receipt = base.call("eth_getTransactionReceipt", [tx_hash], timeout_ms)
        except CommandError as error:
            if error.code != "base_unreachable":
                raise
            receipt = None
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
