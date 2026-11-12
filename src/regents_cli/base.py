"""Sending one transaction on Base from the agent key on this machine.

`priced` prices a transaction at the latest block, with the most it can cost: its value, its gas
and Base's fee for writing it to Ethereum. The caller shows it, `signed` signs exactly that and
checks the signed bytes say the same, and `broadcast` hands them to a Base node once. The agent's
wallet pays, so `signed` first checks it holds that most. `SIWA_BASE_RPC` names the node, shared
with the SIWA agent client. A node's own words never reach the screen, and of its address only the
host does: the rest can carry a key.
"""

from __future__ import annotations

import os
import re
from typing import Any
from urllib.parse import urlsplit

import httpx
from eth_account import Account
from eth_account.typed_transactions.typed_transaction import TypedTransaction
from eth_keys.constants import SECPK1_N
from eth_utils.crypto import keccak
from hexbytes import HexBytes

from regents_cli import passkey, siwa
from regents_cli.errors import EXIT_AUTH, EXIT_UNREACHABLE, CommandError
from regents_cli.next_steps import Step, human

BASE_RPC = "https://mainnet.base.org"
CHAIN_ID = 8453
#: What it means when the node refuses each call.
REFUSED = {
    "eth_chainId": "The Base node would not say which chain it is on",
    "eth_getBalance": "The Base node would not say how much the wallet holds",
}
#: Base's contract that prices writing a transaction to Ethereum.
GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F"
#: The most a Base transaction adds to its data when written out unsigned, in bytes.
UNSIGNED_OVERHEAD = 167
#: A number as a node writes it, and a 32-byte answer of a contract call.
QUANTITY = re.compile(r"0x(0|[1-9a-fA-F][0-9a-fA-F]*)")
WORD = re.compile(r"0x[0-9a-fA-F]{64}")
#: A signed EIP-1559 transaction as the key helper writes one.
SIGNED = re.compile(r"0x02(?:[0-9a-f]{2})+")


def rpc_address() -> str:
    return os.environ.get("SIWA_BASE_RPC", BASE_RPC).strip()


def rpc_host() -> str:
    """The node's host, the one part of its address ever printed: never its user, password, path
    or query."""
    try:
        return urlsplit(rpc_address()).hostname or "named by SIWA_BASE_RPC"
    except ValueError:
        return "named by SIWA_BASE_RPC"


def call(method: str, params: list[Any], timeout_ms: int) -> Any:
    """The node's `result` for one JSON-RPC call. An answer other than 2xx is the node or a
    gateway in front of it failing, whatever its body says."""
    try:
        response = httpx.post(
            rpc_address(),
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
            timeout=timeout_ms / 1000,
            follow_redirects=False,
        )
        if not response.is_success:
            raise unreachable()
        body = response.json()
    except httpx.InvalidURL:
        raise CommandError(
            "base_address_unreadable",
            "SIWA_BASE_RPC does not hold a web address regents can call, so nothing was sent.",
            next_steps=[
                human(f"Your person fixes SIWA_BASE_RPC to name a Base node, such as {BASE_RPC}.")
            ],
        ) from None
    except (httpx.HTTPError, ValueError, RecursionError):
        raise unreachable() from None
    if isinstance(body, dict) and "result" in body:
        return body["result"]
    raise CommandError(
        "base_refused",
        REFUSED.get(method, f"The Base node {rpc_host()} would not price this transaction")
        + ", so nothing was sent.",
        next_steps=[another_node()],
    )


def unreachable() -> CommandError:
    return CommandError(
        "base_unreachable",
        f"The Base node {rpc_host()} could not be reached, or did not answer in time.",
        exit_code=EXIT_UNREACHABLE,
        next_steps=[another_node()],
    )


def nonce(address: str, timeout_ms: int) -> int:
    """The nonce of `address`'s next transaction: its count at the latest block. A sender that
    waits for each transaction to land counts on from it, never reading Base's pending count."""
    return number(call("eth_getTransactionCount", [address, "latest"], timeout_ms))


def on_base(timeout_ms: int) -> None:
    """Refuse, before anything is signed, a node that is not on Base."""
    chain = number(call("eth_chainId", [], timeout_ms))
    if chain != CHAIN_ID:
        raise CommandError(
            "base_wrong_chain",
            f"The node {rpc_host()} is on chain {chain}, not Base ({CHAIN_ID}). Nothing was "
            "signed or sent.",
            next_steps=[human("Your person names a Base node with SIWA_BASE_RPC.")],
        )


def balance(address: str, timeout_ms: int) -> int:
    """What `address` holds on Base at the latest block, in wei."""
    return number(call("eth_getBalance", [address, "latest"], timeout_ms))


def needs_eth(address: str, holds: int, needs: int, count: int = 1) -> CommandError:
    """`address` holds less than the `needs` wei that the next `count` transactions can take."""
    what, unsent = (
        ("this transaction", "It was not signed or sent.")
        if count == 1
        else (f"these {count} transactions", "None of them was signed or sent.")
    )
    return CommandError(
        "base_needs_eth",
        f"{address} holds {eth(holds)} ETH on Base, and {what} can take up to {eth(needs)} ETH "
        f"with gas. {unsent}",
        next_steps=[
            human(
                f"Your person sends at least {eth(needs - holds)} ETH on Base to {address}, then "
                "run this again."
            )
        ],
    )


def priced(step: dict[str, Any], nonce: int, timeout_ms: int) -> tuple[dict[str, str], int]:
    """`step` (from, to, data, value, chainId) with `nonce`, priced at the latest block, as the 0x
    fields the key signs, and the most it can take from its sender in wei."""
    sender = step["from"]
    fields = {"from": sender, "to": step["to"], "data": step["data"], "value": step["value"]}
    try:
        estimate = call("eth_estimateGas", [fields], timeout_ms)
    except CommandError as error:
        if error.code != "base_refused":
            raise
        raise CommandError(
            "transaction_would_fail",
            "The Base node says this transaction would fail on the chain as it is now, so "
            "nothing was sent.",
        ) from None
    gas = number(estimate) * 6 // 5
    tip = number(call("eth_maxPriorityFeePerGas", [], timeout_ms))
    latest = call("eth_getBlockByNumber", ["latest", False], timeout_ms)
    base_fee = number(latest.get("baseFeePerGas") if isinstance(latest, dict) else None)
    fee = base_fee * 2 + tip
    size = len(step["data"]) // 2 - 1 + UNSIGNED_OVERHEAD
    upper_bound = keccak(text="getL1FeeUpperBound(uint256)")[:4].hex() + f"{size:064x}"
    oracle = {"to": GAS_PRICE_ORACLE, "data": "0x" + upper_bound}
    written = call("eth_call", [oracle, "latest"], timeout_ms)
    if not (isinstance(written, str) and WORD.fullmatch(written)):
        raise unreadable()
    transaction = {
        "chainId": hex(step["chainId"]),
        "nonce": hex(nonce),
        "to": step["to"],
        "data": step["data"],
        "value": step["value"],
        "gas": hex(gas),
        "maxFeePerGas": hex(fee),
        "maxPriorityFeePerGas": hex(tip),
    }
    return transaction, gas * fee + int(written, 16) + int(step["value"], 16)


def number(answer: Any) -> int:
    """A number the node answered, written as JSON-RPC writes one."""
    if not (isinstance(answer, str) and QUANTITY.fullmatch(answer)):
        raise unreadable()
    return int(answer, 16)


def unreadable() -> CommandError:
    return CommandError(
        "base_answer_unreadable",
        f"The Base node {rpc_host()} answered in a way regents cannot read, so nothing was sent.",
        next_steps=[another_node()],
    )


def another_node() -> Step:
    return human(
        f"Run this again in a minute. If it happens again, your person names another Base node "
        f"than {rpc_host()} with SIWA_BASE_RPC."
    )


def eth(wei: int) -> str:
    """Wei as ETH, every digit kept: 1500000000000000 is 0.0015."""
    whole, part = divmod(wei, 10**18)
    return f"{whole}.{part:018d}".rstrip("0").rstrip(".")


def signed(
    key: siwa.Key, transaction: dict[str, str], needs: int, timeout_ms: int
) -> tuple[str, str]:
    """`transaction` signed by `key`, checked to be exactly that, and its hash. `needs` is the
    most it can take from the wallet, in wei, which must hold it."""
    holds = balance(key.address, timeout_ms)
    if holds < needs:
        raise needs_eth(key.address, holds, needs)
    raw = siwa.sign_transaction(key, transaction)
    if not signs(raw, key.address, transaction):
        raise CommandError(
            "signed_transaction_differs",
            f"The key helper signed something other than the transaction shown for {key.address}, "
            "so it was not sent.",
            exit_code=EXIT_AUTH,
            next_steps=[
                human(
                    "Your person stops the key helper (the process running regents_cli.passkey "
                    "or siwa_agent key-helper) or restarts this Mac. Then run this again."
                )
            ],
        )
    return raw, "0x" + keccak(hexstr=raw).hex()


def broadcast(raw: str, timeout_ms: int) -> bool:
    """Hand the signed `raw` to the node once; whether it confirmed taking it. A refusal is no
    proof it was not taken ("already known" means the node has it), so only a receipt tells."""
    try:
        call("eth_sendRawTransaction", [raw], timeout_ms)
    except CommandError:
        return False
    return True


def signs(raw: Any, address: str, transaction: dict[str, str]) -> bool:
    """Whether `raw` is, byte for byte, `transaction` as the one kind of transaction the agent key
    signs (EIP-1559, with no access list), signed by `address` in the one form Base accepts."""
    if not (isinstance(raw, str) and SIGNED.fullmatch(raw)):
        return False
    try:
        y_parity, r, s = TypedTransaction.from_bytes(HexBytes(raw)).vrs()
        shown = {**passkey.dynamic_fee(transaction), "v": y_parity, "r": r, "s": s}
        return (
            y_parity in (0, 1)
            and 0 < s <= SECPK1_N // 2
            and TypedTransaction.from_dict(shown).encode() == HexBytes(raw)
            and Account.recover_transaction(raw).lower() == address.lower()
        )
    except Exception:
        # Bytes the helper wrote can fail to read in many ways; each means it signed something
        # other than what was shown.
        return False
