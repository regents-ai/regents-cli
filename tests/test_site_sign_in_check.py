"""`regents auth status` and each site's doctor check a sign-in through the site itself: they send
the site its read-only identity probe (`agents whoami`), signed with this machine's key, and read
what the site says of the agent. Nothing goes to the sign-in server, which answers only a site
presenting its own key. A site that refuses the sign-in gets the agent to sign in again; a site
that fails the check is reported like any other failed check; and an answer without the agent's
facts is one regents can't read.
"""

from __future__ import annotations

import base64
import contextlib
import io
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

from regents_cli import app, doctor, siwa
from regents_cli.errors import EXIT_AUTH, EXIT_UNREACHABLE
from regents_cli.http import Request
from regents_cli.platforms import Platform, identity_probe, pinned_platforms

KEY = "0x" + "00" * 31 + "05"
ADDRESS: str = Account.from_key(KEY).address.lower()
SITES = sorted({platform.site for platform in pinned_platforms()})
#: Techtree's own doctor checks this machine instead.
DOCTORED = [site for site in SITES if site != "techtree"]
LISTED = "https://www.8004scan.io/agents/base/7"
AGENTS: list[dict[str, Any]] = [
    {"registry_listing": None, "human_backed": False, "same_person_agent_count": None},
    {"registry_listing": LISTED, "human_backed": True, "same_person_agent_count": 1},
    {"registry_listing": LISTED, "human_backed": True, "same_person_agent_count": 3},
]


def signed_in(folder: Path, monkeypatch: pytest.MonkeyPatch, site: str) -> None:
    """This machine's key, signed in to `site` until 2999."""
    home = folder / "agent"
    home.mkdir(mode=0o700)
    (home / "key.json").write_text(json.dumps({"address": ADDRESS, "private_key": KEY}))
    (home / "key.json").chmod(0o600)
    monkeypatch.setenv("SIWA_AGENT_HOME", str(home))
    monkeypatch.setenv("SIWA_BROKER", "https://sign-in.example")
    (home / "receipts").mkdir(mode=0o700)
    receipt = {
        "address": ADDRESS,
        "audience": site,
        "receipt": "receipt-1",
        "receipt_expires_at": "2999-01-01T00:00:00Z",
        "key_id": ADDRESS,
    }
    (home / "receipts" / f"{site}.json").write_text(json.dumps(receipt))
    (home / "receipts" / f"{site}.json").chmod(0o600)


def stand_in(
    site: str, answered: httpx.Response, monkeypatch: pytest.MonkeyPatch
) -> list[tuple[str, str, dict[str, str]]]:
    """A site that answers its identity probe with `answered`, and no sign-in server at all."""
    asked: list[tuple[str, str, dict[str, str]]] = []

    def request(method: str, url: str, *, headers: dict[str, str], **_: Any) -> httpx.Response:
        asked.append((method, url, headers))
        return answered

    def post(url: str, **_: Any) -> httpx.Response:
        raise AssertionError(f"nothing goes to the sign-in server, but {url} was asked")

    monkeypatch.setattr(httpx, "request", request)
    monkeypatch.setattr(httpx, "post", post)
    return asked


def whoami(site: str, agent: dict[str, Any]) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "data": {
                "authenticated": True,
                "agent": {"wallet": ADDRESS, **agent},
                "audience": site,
                "pairing": None,
                "status": "not_paired",
                "allowed": ["Read public pages."],
                "next_step": "Ask your person to pair you.",
            }
        },
    )


def signed_by_this_key(site: str, headers: dict[str, str]) -> bool:
    """Whether `headers` are this sign-in's, made for the site's probe, and signed by the key."""
    _, probe = identity_probe(site)
    rules = siwa.contract()
    names = {c["name"] for c in rules["components"]} | {rules["signature_input_header"]}
    unsigned = {name: value for name, value in headers.items() if name in names}
    _, message = siwa.rebuild(Request(probe.method, probe.path), unsigned)
    signature = base64.b64decode(headers[rules["signature_header"]].split(":")[1])
    signer = Account.recover_message(encode_defunct(text=message), signature=signature)
    return str(signer).lower() == ADDRESS


def regents(args: list[str], exit_code: int = 0) -> dict[str, Any]:
    shown = io.StringIO()
    with contextlib.redirect_stdout(shown), contextlib.redirect_stderr(io.StringIO()):
        assert app.main([*args, "--json"]) == exit_code, shown.getvalue()
    answer: dict[str, Any] = json.loads(shown.getvalue())
    return answer


def platform_of(site: str) -> Platform:
    return identity_probe(site)[0]


def refusal(status: int, code: str) -> httpx.Response:
    return httpx.Response(
        status, json={"error": {"code": code, "message": "No.", "hint": "Try again."}}
    )


@pytest.mark.parametrize("agent", AGENTS)
def test_auth_status_reads_the_agent_from_the_site(
    agent: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    site = "keyfleet"
    platform, probe = identity_probe(site)
    monkeypatch.setenv(platform.env_var, f"https://{site}.example")
    signed_in(tmp_path, monkeypatch, site)
    asked = stand_in(site, whoami(site, agent), monkeypatch)

    told = regents(["auth", "status", "--site", site])

    [(method, url, headers)] = asked
    assert (method, url) == ("GET", f"https://{site}.example{probe.path}")
    assert signed_by_this_key(site, headers)
    assert {k: told[k] for k in agent} == agent
    assert told["pairing_status"]["site"] == site
    assert told["pairing_status"]["agent"] == {"wallet": ADDRESS, **agent}


@pytest.mark.parametrize("site", DOCTORED)
def test_the_doctor_checks_the_sign_in_at_the_address_it_checks(
    site: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    platform, probe = identity_probe(site)
    signed_in(tmp_path, monkeypatch, site)
    asked = stand_in(site, whoami(site, AGENTS[2]), monkeypatch)

    told = regents([platform.name, "doctor", "--base-url", "http://127.0.0.1:4000"])

    [row] = [c for c in told["checks"] if c["check"] == doctor.SIGN_IN]
    [headers] = [
        h
        for method, url, h in asked
        if (method, url) == ("GET", f"http://127.0.0.1:4000{probe.path}")
    ]
    assert signed_by_this_key(site, headers)
    assert row == {
        "check": doctor.SIGN_IN,
        "ok": True,
        "code": "accepted",
        "detail": f"127.0.0.1:4000 accepts {ADDRESS} until 2999-01-01T00:00:00Z; it is listed in "
        f"the agent registry at {LISTED}, and a person verified with World ID stands behind it, "
        "and behind 3 agents in all, this one included.",
    }


def test_the_doctor_says_what_is_optional(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    signed_in(tmp_path, monkeypatch, "keyfleet")
    stand_in("keyfleet", whoami("keyfleet", AGENTS[0]), monkeypatch)

    _, detail = doctor.sign_in_good("https://keyfleet.ai", platform_of("keyfleet"), 5_000)

    assert detail == (
        f"keyfleet.ai accepts {ADDRESS} until 2999-01-01T00:00:00Z; it is not listed in the agent "
        "registry (optional: regents auth register), and no person verified with World ID "
        "stands behind it (optional: regents auth accept-world-id)."
    )


@pytest.mark.parametrize(
    ("answered", "exit_code"),
    [
        (refusal(401, "signature_rejected"), EXIT_AUTH),
        (refusal(503, "unavailable"), EXIT_UNREACHABLE),
    ],
)
def test_the_sign_in_check_fails_with_the_sites_code(
    answered: httpx.Response,
    exit_code: int,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    signed_in(tmp_path, monkeypatch, "patchbay")
    stand_in("patchbay", answered, monkeypatch)

    row = doctor.check(
        doctor.SIGN_IN,
        lambda: doctor.sign_in_good("https://patchbay.help", platform_of("patchbay"), 5_000),
    )

    code = answered.json()["error"]["code"]
    assert (row["ok"], row["code"], row["exit_code"]) == (False, code, exit_code)


def test_only_a_refused_sign_in_gets_the_agent_to_sign_in_again() -> None:
    platform = platform_of("keyfleet")
    refused, outage = (
        {"check": doctor.SIGN_IN, "ok": False, "code": code, "exit_code": exit, "detail": "No."}
        for code, exit in (("signature_rejected", EXIT_AUTH), ("unavailable", EXIT_UNREACHABLE))
    )
    again = ["regents", "keyfleet", "doctor"]

    said = doctor.repairs(platform, platform.base_url, [refused], "1 of 4", again)
    reported = doctor.repairs(platform, platform.base_url, [outage], "1 of 4", again)

    assert [step.kind for step in said] == ["run", "run"]
    assert said[0].command == f"regents auth login --site {platform.site}"
    assert [step.kind for step in reported] == ["run", "run", "patchbay"]
    assert "sign-in: unavailable: No." in (reported[-1].command or "")


@pytest.mark.parametrize("missing", ["registry_listing", "human_backed", "same_person_agent_count"])
def test_an_answer_without_the_agents_facts_is_unreadable(
    missing: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    signed_in(tmp_path, monkeypatch, "regents")
    agent = {k: v for k, v in AGENTS[1].items() if k != missing}
    stand_in("regents", whoami("regents", agent), monkeypatch)

    row = doctor.check(
        doctor.SIGN_IN,
        lambda: doctor.sign_in_good("https://regents.sh", platform_of("regents"), 5_000),
    )

    assert (row["ok"], row["code"]) == (False, "invalid_response")
