"""`regents <site> doctor`: what follows a failed check. A site that fails its own checks is
searched for on patchbay.help, then reported there; checks run against another address are
never reported as the site's problem (the first-run walk, 27 Oct). No sign-in yet is not a
failure, since only signed commands need one; an expired sign-in or a failing site still is."""

from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
from typing import Any

import pytest

from regents_cli import app
from regents_cli import doctor as doctor_module
from regents_cli.doctor import repairs
from regents_cli.errors import CommandError
from regents_cli.platforms import pinned_platforms

KEYFLEET = next(p for p in pinned_platforms() if p.name == "keyfleet")
FAILED = [{"check": "site answers", "ok": False, "detail": "unreachable: No answer."}]
AGAIN = ["regents", "keyfleet", "doctor"]


def test_a_failing_site_is_searched_for_before_it_is_reported() -> None:
    again, search, post = repairs(KEYFLEET, KEYFLEET.base_url, FAILED, "1 of 3", AGAIN)
    assert again.command == "regents keyfleet doctor"
    assert search.command == "regents patchbay threads search --origin keyfleet.ai"
    assert post.kind == "patchbay"


def test_checks_against_another_address_are_not_posted_against_the_site() -> None:
    again, person = repairs(KEYFLEET, "http://127.0.0.1:9", FAILED, "1 of 3", AGAIN)
    assert again.kind == "run" and person.kind == "human"
    assert "http://127.0.0.1:9" in person.say


def doctor(monkeypatch: pytest.MonkeyPatch, home: Path, site_fails: bool) -> tuple[int, Any]:
    """`regents keyfleet doctor --json` with the site's answers stood in and `home` as the
    sign-in folder."""

    def site(base: str, timeout_ms: int) -> str:
        if site_fails:
            raise CommandError("unreachable", f"{base} could not be reached.")
        return f"{base} answered 200."

    monkeypatch.setenv("SIWA_AGENT_HOME", str(home))
    monkeypatch.delenv(KEYFLEET.env_var, raising=False)
    monkeypatch.setattr(doctor_module, "site_answers", site)
    monkeypatch.setattr(doctor_module, "read_answers", lambda *_: "answered.")
    shown = io.StringIO()
    with contextlib.redirect_stdout(shown), contextlib.redirect_stderr(shown):
        code = app.main(["keyfleet", "doctor", "--json"])
    return code, json.loads(shown.getvalue())


def test_no_sign_in_yet_is_not_a_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    code, told = doctor(monkeypatch, tmp_path, site_fails=False)
    assert code == 0
    sign_in = next(c for c in told["checks"] if c["check"] == "sign-in")
    assert sign_in["ok"]
    assert told["next_steps"][-1]["command"] == "regents auth login --site keyfleet"


def test_an_expired_sign_in_still_fails(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    receipts = tmp_path / "receipts"
    receipts.mkdir(mode=0o700)
    (receipts / "keyfleet.json").write_text(
        json.dumps(
            {
                "address": "0x" + "11" * 20,
                "audience": "keyfleet",
                "receipt": "old",
                "receipt_expires_at": "2000-01-01T00:00:00Z",
                "key_id": "old",
            }
        )
    )
    (receipts / "keyfleet.json").chmod(0o600)
    code, _ = doctor(monkeypatch, tmp_path, site_fails=False)
    assert code == 1


def test_a_site_that_fails_still_fails_without_a_sign_in(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    code, _ = doctor(monkeypatch, tmp_path, site_fails=True)
    assert code == 1
