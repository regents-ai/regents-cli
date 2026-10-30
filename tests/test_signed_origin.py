"""A signed request is good for a short while wherever it lands, so `regents` signs only for an
address the sign-in server lists for the site. Pointed anywhere else, by --base-url or the
site's <PLATFORM>_BASE_URL, it signs nothing, prints nothing to sign and sends nothing."""

from __future__ import annotations

import io
import json

import pytest

from regents_cli import app
from regents_cli.errors import EXIT_AUTH
from regents_cli.http import Request
from tests.test_prepared import SIGNATURE, signed_in  # noqa: F401

ELSEWHERE = "https://copy.example"


@pytest.mark.parametrize("phase", [None, "prepare", "send"])
def test_a_signed_command_for_an_unlisted_address_signs_and_sends_nothing(
    phase: str | None,
    signed_in: list[Request],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = {"origin": ELSEWHERE, "method": "GET", "path": "/api/agents/me"}
    piped = json.dumps({"request": request, "signature": SIGNATURE})
    monkeypatch.setattr("sys.stdin", io.StringIO(piped if phase == "send" else ""))
    out, err = io.StringIO(), io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    monkeypatch.setattr("sys.stderr", err)
    argv = ["protocol", "agents", "status", "--base-url", ELSEWHERE, "--json"]
    code = app.main([*argv, *(["--phase", phase] if phase else [])])
    assert code == EXIT_AUTH
    assert json.loads(out.getvalue() or err.getvalue())["error"]["code"] == "address_not_listed"
    assert signed_in == []


def test_the_site_variable_is_held_to_the_same_list(
    signed_in: list[Request],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("sys.stdout", io.StringIO())
    monkeypatch.setattr("sys.stderr", io.StringIO())
    monkeypatch.setenv("PROTOCOL_BASE_URL", "https://regents.sh")
    assert app.main(["protocol", "agents", "status", "--json"]) == 0
    monkeypatch.setenv("PROTOCOL_BASE_URL", ELSEWHERE)
    assert app.main(["protocol", "agents", "status", "--json"]) == EXIT_AUTH
    assert len(signed_in) == 1
