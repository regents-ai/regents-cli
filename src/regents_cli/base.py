"""Sending one transaction on Base from the agent key on this machine.

The transaction comes whole from the server that built it; this signs it with the agent key,
prices it at the latest block, and hands it to a Base node once. The agent's wallet pays the
gas. `SIWA_BASE_RPC` names the node, shared with the SIWA agent client.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from regents_cli import siwa
from regents_cli.errors import EXIT_UNREACHABLE, CommandError

BASE_RPC = "https://mainnet.base.org"


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
    except (httpx.HTTPError, ValueError):
        raise CommandError(
            "base_unreachable",
            f"The Base node {address} could not be reached, or did not answer in time.",
            exit_code=EXIT_UNREACHABLE,
        ) from None
    if isinstance(body, dict) and "result" in body:
        return body["result"]
    error = body.get("error") if isinstance(body, dict) else None
    said = error.get("message") if isinstance(error, dict) else None
    raise CommandError(
        "base_refused",
        f"The Base node refused {method}: {said or f'answer {response.status_code}'}.",
    )


def send(key: siwa.Key, step: dict[str, Any], timeout_ms: int) -> str:
    """Sign `step` (from, to, data, value, chainId) with `key`, send it once, answer its hash."""
    sender = step["from"]
    fields = {"from": sender, "to": step["to"], "data": step["data"], "value": step["value"]}
    try:
        gas = int(call("eth_estimateGas", [fields], timeout_ms), 16) * 6 // 5
        tip = int(call("eth_maxPriorityFeePerGas", [], timeout_ms), 16)
        latest = call("eth_getBlockByNumber", ["latest", False], timeout_ms)
        transaction = {
            "chainId": hex(step["chainId"]),
            "nonce": call("eth_getTransactionCount", [sender, "pending"], timeout_ms),
            "to": step["to"],
            "data": step["data"],
            "value": step["value"],
            "gas": hex(gas),
            "maxFeePerGas": hex(int(latest["baseFeePerGas"], 16) * 2 + tip),
            "maxPriorityFeePerGas": hex(tip),
        }
        sent: str = call(
            "eth_sendRawTransaction", [siwa.sign_transaction(key, transaction)], timeout_ms
        )
    except CommandError as error:
        if error.code != "base_refused":
            raise
        raise CommandError(
            error.code,
            error.message,
            hint=f"{sender} sends this transaction and pays its gas, so it needs a little ETH "
            "on Base.",
        ) from None
    return sent
