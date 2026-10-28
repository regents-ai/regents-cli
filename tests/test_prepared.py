"""`--phase send` sends exactly the request `--phase prepare` printed, and refuses one changed
since, or prepared under another signing contract, instead of rebuilding or re-signing it: a
person approves the message they sign, and anything else would send what they never approved."""

from __future__ import annotations

import io
import json
import shlex
from pathlib import Path
from typing import Any

import click
import httpx
import pytest

from regents_cli import app, runner, siwa
from regents_cli.http import Request
from tests.techtree.run_log import Terminal

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

    def respond(base: str, request: Request, timeout_ms: int) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={})

    monkeypatch.setattr(runner, "respond", respond)
    return sent


CHECK_IN = ["protocol", "agents", "status"]
FREE_FIX = ["patchbay", "assist", "free"]


def run(
    monkeypatch: pytest.MonkeyPatch, phase: str, stdin: str = "", command: list[str] = CHECK_IN
) -> tuple[int, str, str]:
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin))
    out, err = io.StringIO(), io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    monkeypatch.setattr("sys.stderr", err)
    code = app.main([*command, "--phase", phase, "--json"])
    return code, out.getvalue(), err.getvalue()


def prepare(
    monkeypatch: pytest.MonkeyPatch, contract: str, stdin: str = "", command: list[str] = CHECK_IN
) -> dict[str, Any]:
    monkeypatch.setattr(siwa, "contract_id", lambda: contract)
    code, out, err = run(monkeypatch, "prepare", stdin, command)
    assert code == 0, err
    prepared: dict[str, Any] = json.loads(out)
    assert prepared["contract"] == contract
    # The one next step sends this request back: the answer less its next_steps.
    [step] = prepared.pop("next_steps")
    printf, _, piped, pipe, *sent = shlex.split(step["command"])
    assert (printf, pipe) == ("printf", "|")
    assert json.loads(piped) == {"request": prepared, "signature": "<signature of message>"}
    assert sent == ["regents", *command, "--phase", "send", "--json"]
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


def test_typed_stdin_keeps_arrays_and_integers_in_both_phases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Do not stringify typed JSON, or accept booleans as integers when sending a proof."""
    from dataclasses import replace

    from regents_cli.errors import UsageError
    from regents_cli.platforms import StdinField, pinned_platforms

    platform = next(p for p in pinned_platforms() if p.name == "patchbay")
    command = replace(
        platform.commands[0],
        method="POST",
        body=None,
        arguments=(),
        flags=(),
        stdin_fields=(
            StdinField("items", "array", True, "The selected items."),
            StdinField("limit", "integer", True, "The result limit."),
        ),
    )
    request = runner.request_for(command, {})
    good = '{"items":["one","two"],"limit":2}'
    monkeypatch.setattr("sys.stdin", io.StringIO(good))
    built = runner.with_stdin_fields(command, request, 1000)
    assert built.content == good.encode()
    assert runner.prepared_body(command, request, good) == json.loads(good)
    for value in (True, 2.5, "2", None):
        wrong = json.dumps({"items": ["one"], "limit": value}, separators=(",", ":"))
        monkeypatch.setattr("sys.stdin", io.StringIO(wrong))
        with pytest.raises(UsageError, match="limit must be an integer"):
            runner.with_stdin_fields(command, request, 1000)
        with pytest.raises(UsageError, match="limit must be an integer"):
            runner.prepared_body(command, request, wrong)
    with pytest.raises(UsageError, match="limit is required"):
        runner.prepared_body(command, request, '{"items":[]}')


def test_at_a_terminal_agents_pair_asks_for_the_code_without_showing_it(
    signed_in: list[Request], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A person pairing by hand types the code where nothing echoes it: it reaches the request
    and never the screen or the answer."""
    terminal = Terminal("regents-cli test\nclaude_code\n")
    monkeypatch.setattr("sys.stdin", terminal)
    monkeypatch.setattr(click.termui, "hidden_prompt_func", lambda _text: "PAIR-CODE-1234")
    out, err = io.StringIO(), io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    monkeypatch.setattr("sys.stderr", err)
    assert app.main(["protocol", "agents", "pair", "--json"]) == 0
    assert signed_in[0].body == {
        "code": "PAIR-CODE-1234",
        "name": "regents-cli test",
        "harness": "claude_code",
    }
    assert "PAIR-CODE-1234" not in out.getvalue() + err.getvalue()
