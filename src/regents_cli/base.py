"""Sending one transaction on Base from the agent key on this machine.

`priced` prices a transaction at the latest block; the caller shows it, and `send` signs exactly
that and hands it to a Base node once. The agent's wallet pays the gas, so `send` first checks it
holds enough for the most the transaction can cost. `SIWA_BASE_RPC` names the node, shared with
the SIWA agent client. A node's own words never reach the screen.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from eth_utils.crypto import keccak

from regents_cli import siwa
from regents_cli.errors import EXIT_UNREACHABLE, CommandError
from regents_cli.next_steps import human

BASE_RPC = "https://mainnet.base.org"
#: What it means when the node refuses each call.
REFUSED = {
    "eth_estimateGas": "The Base node says this transaction would fail",
    "eth_sendRawTransaction": "The Base node refused the signed transaction",
}


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
    )


def priced(step: dict[str, Any], timeout_ms: int) -> dict[str, str]:
    """`step` (from, to, data, value, chainId) priced at the latest block, as the 0x fields the
    key signs."""
    sender = step["from"]
    fields = {"from": sender, "to": step["to"], "data": step["data"], "value": step["value"]}
    estimate = call("eth_estimateGas", [fields], timeout_ms)
    tip = call("eth_maxPriorityFeePerGas", [], timeout_ms)
    latest = call("eth_getBlockByNumber", ["latest", False], timeout_ms)
    nonce = call("eth_getTransactionCount", [sender, "pending"], timeout_ms)
    try:
        gas, fee = int(estimate, 16) * 6 // 5, int(tip, 16)
        return {
            "chainId": hex(step["chainId"]),
            "nonce": hex(int(nonce, 16)),
            "to": step["to"],
            "data": step["data"],
            "value": step["value"],
            "gas": hex(gas),
            "maxFeePerGas": hex(int(latest["baseFeePerGas"], 16) * 2 + fee),
            "maxPriorityFeePerGas": hex(fee),
        }
    except (KeyError, TypeError, ValueError):
        raise unreadable() from None


def unreadable() -> CommandError:
    return CommandError(
        "base_answer_unreadable",
        f"The Base node {rpc_address()} answered in a way regents cannot read, so nothing was "
        "sent.",
    )


def most_it_costs(transaction: dict[str, str]) -> int:
    """The most `transaction` can take from its sender, in wei: its value and all its gas."""
    gas, fee, value = (int(transaction[f], 16) for f in ("gas", "maxFeePerGas", "value"))
    return gas * fee + value


def eth(wei: int) -> str:
    """Wei as ETH, every digit kept: 1500000000000000 is 0.0015."""
    whole, part = divmod(wei, 10**18)
    return f"{whole}.{part:018d}".rstrip("0").rstrip(".")


def send(key: siwa.Key, transaction: dict[str, str], timeout_ms: int) -> str:
    """Sign exactly `transaction` with `key`, send it once, answer its hash.

    When the node does not confirm the send, the transaction may still be on its way: the error
    carries its hash as `tx_hash`, so the caller can check it rather than send a second one."""
    needs = most_it_costs(transaction)
    try:
        holds = int(call("eth_getBalance", [key.address, "latest"], timeout_ms), 16)
    except (TypeError, ValueError):
        raise unreadable() from None
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
