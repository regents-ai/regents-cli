"""A test agent signed in to ash-template, and the check that a request a site received was
signed by that agent's key over exactly the method, path and bytes received."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any, Final

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

from regents_cli import siwa
from regents_cli.http import Request

ADDRESS: Final = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
RECEIPT: Final = "test-receipt"


def sign_in(folder: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """An agent home in `folder` with a fixed test key, signed in to ash-template."""
    home = folder / "agent"
    (home / "receipts").mkdir(parents=True, mode=0o700)
    home.chmod(0o700)
    files = {
        "key.json": {"address": ADDRESS, "private_key": "0x" + "00" * 31 + "01"},
        "receipts/ash-template.json": {
            "address": ADDRESS,
            "audience": "ash-template",
            "receipt": RECEIPT,
            "receipt_expires_at": "2999-01-01T00:00:00Z",
            "key_id": ADDRESS,
        },
    }
    for name, content in files.items():
        (home / name).write_text(json.dumps(content), "utf-8")
        (home / name).chmod(0o600)
    monkeypatch.setenv("SIWA_AGENT_HOME", str(home))


def signer_of(method: str, target: str, body: bytes | None, headers: dict[str, Any]) -> str:
    """The address whose key signed the request exactly as the site received it."""
    proof = {
        name.lower(): value
        for name, value in headers.items()
        if (name.lower().startswith("x-") or name.lower() == "content-digest")
        and name.lower() != "x-siwa-signature"
    }
    _, message = siwa.rebuild(Request(method, target, raw_content=body or None), proof)
    signature = headers["x-siwa-signature"].split("=:", 1)[1].rstrip(":")
    recovered = Account.recover_message(
        encode_defunct(text=message), signature=base64.b64decode(signature)
    )
    return str(recovered).lower()
