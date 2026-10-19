"""Sending one transaction on Base from the agent key on this machine.

`priced` prices a transaction at the latest block, with the most it can cost: its value, its gas
and Base's fee for writing it to Ethereum. The caller shows it, and `send` signs exactly that,
checks the signed bytes say the same, and hands them to a Base node once. The agent's wallet pays,
so `send` first checks it holds that most. `SIWA_BASE_RPC` names the node, shared with the SIWA
agent client. A node's own words never reach the screen.
"""

from __future__ import annotations

import os
import re
from typing import Any

import httpx
from eth_account import Account
from eth_account.typed_transactions.typed_transaction import TypedTransaction
from eth_utils.crypto import keccak
from hexbytes import HexBytes

from regents_cli import siwa
from regents_cli.errors import EXIT_AUTH, EXIT_UNREACHABLE, CommandError
from regents_cli.next_steps import Step, human

BASE_RPC = "https://mainnet.base.org"
#: What it means when the node refuses each call.
REFUSED = {
    "eth_estimateGas": "The Base node says this transaction would fail",
    "eth_getBalance": "The Base node would not say how much the wallet holds",
    "eth_sendRawTransaction": "The Base node refused the signed transaction",
}
#: Base's contract that prices writing a transaction to Ethereum.
GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F"
#: The most a Base transaction adds to its data when written out unsigned, in bytes.
UNSIGNED_OVERHEAD = 167
#: A number as a node writes it, and a 32-byte answer of a contract call.
QUANTITY = re.compile(r"0x(0|[1-9a-fA-F][0-9a-fA-F]*)")
WORD = re.compile(r"0x[0-9a-fA-F]{64}")


def rpc_address() -> str:
    return os.environ.get("SIWA_BASE_RPC", BASE_RPC).strip()


def call(method: str, params: list[Any], timeout_ms: int) -> Any:
    address = rpc_address()
    try:
        response = httpx.post(
            address,
            json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
            timeout=timeout_ms / 1000,
            follow_redirects=False,
        )
        body = response.json()
    except (httpx.HTTPError, ValueError, RecursionError):
        raise CommandError(
            "base_unreachable",
            f"The Base node {address} could not be reached, or did not answer in time.",
            exit_code=EXIT_UNREACHABLE,
        ) from None
    if isinstance(body, dict) and "result" in body:
        return body["result"]
    raise CommandError(
        "base_refused",
        REFUSED.get(method, f"The Base node {address} would not price this transaction")
        + ", so nothing was sent.",
        next_steps=[another_node()],
    )


def priced(step: dict[str, Any], timeout_ms: int) -> tuple[dict[str, str], int]:
    """`step` (from, to, data, value, chainId) priced at the latest block, as the 0x fields the
    key signs, and the most it can take from its sender in wei."""
    sender = step["from"]
    fields = {"from": sender, "to": step["to"], "data": step["data"], "value": step["value"]}
    gas = number(call("eth_estimateGas", [fields], timeout_ms)) * 6 // 5
    tip = number(call("eth_maxPriorityFeePerGas", [], timeout_ms))
    latest = call("eth_getBlockByNumber", ["latest", False], timeout_ms)
    base_fee = number(latest.get("baseFeePerGas") if isinstance(latest, dict) else None)
    nonce = number(call("eth_getTransactionCount", [sender, "pending"], timeout_ms))
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
        f"The Base node {rpc_address()} answered in a way regents cannot read, so nothing was "
        "sent.",
        next_steps=[another_node()],
    )


def another_node() -> Step:
    return human(
        f"Run this again in a minute. If it happens again, your person names another Base node "
        f"than {rpc_address()} with SIWA_BASE_RPC."
    )


def eth(wei: int) -> str:
    """Wei as ETH, every digit kept: 1500000000000000 is 0.0015."""
    whole, part = divmod(wei, 10**18)
    return f"{whole}.{part:018d}".rstrip("0").rstrip(".")


def send(key: siwa.Key, transaction: dict[str, str], needs: int, timeout_ms: int) -> str:
    """Sign exactly `transaction` with `key`, send it once, answer its hash. `needs` is the most
    it can take from the wallet, in wei.

    When the node does not confirm the send, the transaction may still be on its way: the error
    carries its hash as `tx_hash`, so the caller can check it rather than send a second one."""
    holds = number(call("eth_getBalance", [key.address, "latest"], timeout_ms))
    if holds < needs:
        raise CommandError(
            "base_needs_eth",
            f"{key.address} holds {eth(holds)} ETH on Base, and this transaction can take up to "
            f"{eth(needs)} ETH with its gas. Nothing was signed or sent.",
            next_steps=[
                human(
                    f"Your person sends at least {eth(needs - holds)} ETH on Base to "
                    f"{key.address}, then run this again."
                )
            ],
        )
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
    tx_hash = "0x" + keccak(hexstr=raw).hex()
    try:
        call("eth_sendRawTransaction", [raw], timeout_ms)
    except CommandError as error:
        if error.code != "base_unreachable":
            raise
        raise CommandError(
            "base_send_unclear",
            f"The Base node {rpc_address()} did not confirm the send, so the transaction may be "
            f"on its way: {tx_hash}.",
            exit_code=EXIT_UNREACHABLE,
            tx_hash=tx_hash,
        ) from None
    return tx_hash


def signs(raw: Any, address: str, transaction: dict[str, str]) -> bool:
    """Whether `raw` is `transaction` signed by `address`, and nothing else."""
    try:
        return as_signed(raw) == (address.lower(), transaction)
    except Exception:
        # Bytes the helper wrote can fail to read in many ways; each means it signed something
        # other than what was shown.
        return False


def as_signed(raw: str) -> tuple[str, dict[str, str]]:
    """Who signed `raw`, and the transaction it holds, in the fields `priced` gives."""
    signed = TypedTransaction.from_bytes(HexBytes(raw)).as_dict()
    return Account.recover_transaction(raw).lower(), {
        "chainId": hex(signed["chainId"]),
        "nonce": hex(signed["nonce"]),
        "to": "0x" + bytes(signed["to"]).hex(),
        "data": "0x" + bytes(signed["data"]).hex(),
        "value": hex(signed["value"]),
        "gas": hex(signed["gas"]),
        "maxFeePerGas": hex(signed["maxFeePerGas"]),
        "maxPriorityFeePerGas": hex(signed["maxPriorityFeePerGas"]),
    }
