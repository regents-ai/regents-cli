"""`--phase send` sends exactly the request `--phase prepare` printed, and refuses one changed
since, or prepared under another signing contract, instead of rebuilding or re-signing it: a
person approves the message they sign, and anything else would send what they never approved."""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import pytest

from regents_cli import app, runner, siwa
from regents_cli.http import Request

SIGNATURE = "0x" + "ab" * 65


@pytest.fixture
def signed_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> list[Request]:
    """An agent home signed in to regents, and the requests sent instead of reaching the site."""
    home = tmp_path / "agent"
    (home / "receipts").mkdir(parents=True, mode=0o700)
    home.chmod(0o700)
    address = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
    files: dict[str, Any] = {
        "key.json": {"address": address, "private_key": "0x" + "00" * 31 + "01"}
    }
    for site in ("regents", "patchbay"):
        files[f"receipts/{site}.json"] = {
            "address": address,
            "audience": site,
            "receipt": "fixed-receipt",
            "receipt_expires_at": "2999-01-01T00:00:00Z",
            "key_id": address,
        }
    for name, content in files.items():
        (home / name).write_text(json.dumps(content), "utf-8")
        (home / name).chmod(0o600)
    monkeypatch.setenv("SIWA_AGENT_HOME", str(home))
    sent: list[Request] = []

    def send(base: str, request: Request, timeout_ms: int) -> Any:
        sent.append(request)
        return {}

    monkeypatch.setattr(runner, "send", send)
    return sent


ME = ["protocol", "agents", "me"]
FREE_FIX = ["patchbay", "assist", "free"]


def run(
    monkeypatch: pytest.MonkeyPatch, phase: str, stdin: str = "", command: list[str] = ME
) -> tuple[int, str, str]:
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin))
    out, err = io.StringIO(), io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    monkeypatch.setattr("sys.stderr", err)
    code = app.main([*command, "--phase", phase, "--json"])
    return code, out.getvalue(), err.getvalue()


def prepare(
    monkeypatch: pytest.MonkeyPatch, contract: str, stdin: str = "", command: list[str] = ME
) -> dict[str, Any]:
    monkeypatch.setattr(siwa, "contract_id", lambda: contract)
    code, out, err = run(monkeypatch, "prepare", stdin, command)
    assert code == 0, err
    prepared: dict[str, Any] = json.loads(out)
    assert prepared["contract"] == contract
    return prepared


def test_send_keeps_the_prepared_request(
    signed_in: list[Request], monkeypatch: pytest.MonkeyPatch
) -> None:
    prepared = prepare(monkeypatch, "a" * 64)
    piped = json.dumps({"request": prepared, "signature": SIGNATURE})
    code, _, err = run(monkeypatch, "send", piped)
    assert code == 0, err
    [request] = signed_in
    assert request.target == prepared["path"]
    assert {k: v for k, v in request.headers.items() if k in prepared["headers"]} == prepared[
        "headers"
    ]


def test_send_refuses_another_contract(
    signed_in: list[Request], monkeypatch: pytest.MonkeyPatch
) -> None:
    prepared = prepare(monkeypatch, "a" * 64)
    monkeypatch.setattr(siwa, "contract_id", lambda: "b" * 64)
    piped = json.dumps({"request": prepared, "signature": SIGNATURE})
    code, out, err = run(monkeypatch, "send", piped)
    assert code == 2
    assert "another signing contract" in out + err
    assert signed_in == []


def test_send_refuses_a_changed_body(
    signed_in: list[Request], monkeypatch: pytest.MonkeyPatch
) -> None:
    args = {"goal": "a", "site_url": "https://example.com", "sign_in": "none"}
    prepared = prepare(monkeypatch, "a" * 64, json.dumps({"args": args}), FREE_FIX)
    changed = prepared["body"].replace('"goal":"a"', '"goal":"b"')
    assert len(changed) == len(prepared["body"]) and changed != prepared["body"]
    piped = json.dumps({"request": {**prepared, "body": changed}, "signature": SIGNATURE})
    code, out, err = run(monkeypatch, "send", piped, FREE_FIX)
    assert code == 2
    assert "not the ones regents prepared" in out + err
    assert signed_in == []
