"""`regents doctor` run whole against stand-ins for every site and the sign-in server. An agent
that is stuck reads which checks failed and of what kind, and runs the first next step: a wrong
kind, or a first step that is not the smallest fix, sends it the wrong way. The doctor changes
nothing on any site, contacts only the sites it was asked about, signs only the sign-in check and
the pairing read, and never opens a key locked behind Touch ID."""

from __future__ import annotations

import contextlib
import io
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
import pytest

from regents_cli import app, passkey
from regents_cli.agent_hosts import INSTALL, MCP_PATH
from regents_cli.http import base_address
from regents_cli.platforms import pinned_platforms
from tests.signed_agent import ADDRESS, RECEIPT, sign_in, signer_of

SITES = pinned_platforms()
PRIVATE_KEY = "00" * 31 + "01"
WHOAMI = "/api/agents/v1/whoami"
#: The site that serves no hosted MCP, as regents.sh does live.
NO_MCP = "regents.sh"
PAIRING = {"id": "pairing_1", "paired_at": "2026-11-01T00:00:00Z"}


@dataclass
class Stand:
    """Every pinned site and the sign-in server, answering as they do live, and each request
    they received."""

    #: The regents-cli release each site names in its /capabilities.json.
    named: str = "1.0.0"
    #: Hosts that cannot be reached.
    down: set[str] = field(default_factory=set)
    #: What each site's whoami says of the pairing.
    pairing: dict[str, str] | None = field(default_factory=lambda: dict(PAIRING))
    status: str = "paired"
    #: Paths that answer with a refusal: their status and error code.
    refusals: dict[str, tuple[int, str]] = field(default_factory=dict)
    #: (method, host, path) of every request.
    sent: list[tuple[str, str, str]] = field(default_factory=list)
    #: Who signed each whoami a site received.
    whoami_signers: list[str] = field(default_factory=list)

    def request(
        self, method: str, url: str, *, content: bytes | None, headers: dict[str, str], **_: Any
    ) -> httpx.Response:
        parts = urlsplit(url)
        self.sent.append((method, parts.netloc, parts.path))
        if parts.netloc in self.down:
            raise httpx.ConnectError("refused")
        if parts.path in self.refusals:
            status, code = self.refusals[parts.path]
            return httpx.Response(status, json={"error": {"code": code, "message": "Refused."}})
        if parts.path == "/":
            return httpx.Response(200, text="<!doctype html>")
        if parts.path == "/capabilities.json":
            return httpx.Response(200, json={"cli": {"release": self.named}})
        if parts.path == MCP_PATH and parts.netloc == NO_MCP:
            return httpx.Response(404, json={"error": {"code": "not_found", "message": "No."}})
        if parts.path == MCP_PATH:
            refused = {"code": "method_not_allowed", "message": "POST only."}
            return httpx.Response(405, json={"error": refused})
        if parts.path == WHOAMI:
            base = f"{parts.scheme}://{parts.netloc}"
            # The release-and-command header goes beside the signature, not under it.
            proof = {k: v for k, v in headers.items() if k != "x-regent-client"}
            self.whoami_signers.append(signer_of(method, parts.path, content, proof, base))
            data = {"pairing": self.pairing, "status": self.status}
            return httpx.Response(200, json={"data": data})
        return httpx.Response(200, json={"data": []})

    def get(self, url: str, **_: Any) -> httpx.Response:
        self.sent.append(("GET", urlsplit(url).netloc, urlsplit(url).path))
        listed = [
            {"audience": p.site, "origin": base_address(None, p.env_var, p.base_url)} for p in SITES
        ]
        return httpx.Response(200, json={"data": {"audiences": listed}})

    def post(self, url: str, **_: Any) -> httpx.Response:
        self.sent.append(("POST", urlsplit(url).netloc, urlsplit(url).path))
        assert url.endswith("/api/shared/siwa/http-verify"), url
        told = {"agentRegistration": None, "agentBook": None}
        return httpx.Response(200, json={"code": "http_envelope_valid", "data": told})

    def hosts(self) -> set[str]:
        return {host for _, host, _ in self.sent}


@pytest.fixture
def stand(monkeypatch: pytest.MonkeyPatch) -> Stand:
    for platform in SITES:
        monkeypatch.delenv(platform.env_var, raising=False)
    monkeypatch.delenv("SIWA_BROKER", raising=False)
    stand = Stand()
    monkeypatch.setattr(httpx, "request", stand.request)
    monkeypatch.setattr(httpx, "get", stand.get)
    monkeypatch.setattr(httpx, "post", stand.post)
    return stand


@pytest.fixture
def no_agent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SIWA_AGENT_HOME", str(tmp_path / "agent"))


def signed_in(folder: Path, monkeypatch: pytest.MonkeyPatch, sites: list[str]) -> Path:
    """The test agent's key, signed in to each of `sites`; the agent home."""
    sign_in(folder, monkeypatch, sites[0])
    home = folder / "agent"
    kept = json.loads((home / "receipts" / f"{sites[0]}.json").read_text())
    for site in sites[1:]:
        receipt(home, site, {**kept, "audience": site})
    return home


def receipt(home: Path, site: str, content: dict[str, str]) -> None:
    path = home / "receipts" / f"{site}.json"
    path.write_text(json.dumps(content))
    path.chmod(0o600)


def doctor(*args: str) -> tuple[int, dict[str, Any], str]:
    """The exit code, the answer (the error's fields when it failed) with its next steps, and the
    output as printed."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        code = app.main(["doctor", *args, "--json"])
    answered = json.loads(out.getvalue())
    found = answered.get("error", answered)
    return code, {**found, "next_steps": answered["next_steps"]}, out.getvalue()


def rows(found: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    """Every check's row by (site, check), this machine's under "machine"."""
    machine = {("machine", row["check"]): row for row in found["machine"]}
    return machine | {
        (report["site"], row["check"]): row for report in found["sites"] for row in report["checks"]
    }


def failed(found: dict[str, Any]) -> dict[tuple[str, str], tuple[str, str]]:
    """Each failed check's (code, kind)."""
    return {key: (row["code"], row["kind"]) for key, row in rows(found).items() if not row["ok"]}


def test_everything_holds(stand: Stand, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Signed in and paired everywhere: every check holds, the one step is done, each site's
    pairing read is signed by the agent's own key, and nothing but the sign-in check is posted."""
    signed_in(tmp_path, monkeypatch, [p.site for p in SITES])

    code, found, printed = doctor()

    assert failed(found) == {}
    assert code == 0
    assert [report["site"] for report in found["sites"]] == [p.site for p in SITES]
    assert all(row["kind"] is None for row in rows(found).values())
    assert {
        site: row["code"] for (site, check), row in rows(found).items() if check == "pairing"
    } == {p.site: "paired" for p in SITES}
    assert rows(found)[("regents", "hosted MCP")]["code"] == "none"
    assert rows(found)[("machine", "agent key")]["code"] == "on_file"
    assert [step["kind"] for step in found["next_steps"]] == ["done"]
    assert stand.whoami_signers == [ADDRESS] * len(SITES)
    posted = {path for method, _, path in stand.sent if method != "GET"}
    assert posted == {"/api/shared/siwa/http-verify"}
    assert PRIVATE_KEY not in printed and RECEIPT not in printed


def test_an_unreachable_site_is_a_network_failure(stand: Stand, no_agent: None) -> None:
    stand.down = {"keyfleet.ai"}

    code, found, _ = doctor()

    assert code == 1 and found["code"] == "doctor_found_problems"
    assert {kind for _, kind in failed(found).values()} == {"network"}
    assert {site for site, _ in failed(found)} == {"keyfleet"}
    again, search, post = found["next_steps"]
    assert (again["kind"], again["command"]) == ("run", "regents doctor --json")
    assert search["command"].endswith("--origin keyfleet.ai")
    assert post["kind"] == "patchbay"


def test_an_expired_sign_in_asks_to_sign_in_again(
    stand: Stand, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A sign-in another wallet made has run out, and nothing on this machine renews it."""
    home = signed_in(tmp_path, monkeypatch, ["keyfleet"])
    kept = json.loads((home / "receipts" / "keyfleet.json").read_text())
    other = "0x" + "12" * 20
    ran_out = {
        **kept,
        "address": other,
        "key_id": other,
        "receipt_expires_at": "2020-01-01T00:00:00Z",
    }
    receipt(home, "keyfleet", ran_out)

    code, found, _ = doctor("--site", "keyfleet")

    assert code == 1
    assert failed(found) == {("keyfleet", "sign-in"): ("sign_in_expired", "sign_in")}
    assert ("keyfleet", "pairing") not in rows(found)
    assert [step["command"] for step in found["next_steps"]] == [
        "regents auth login --site keyfleet",
        "regents doctor --site keyfleet --json",
    ]
    assert stand.whoami_signers == []


@pytest.mark.parametrize(
    ("pairing", "status", "code", "first"),
    [
        (None, "not_paired", "agent_not_paired", "regents keyfleet agents pair"),
        (PAIRING, "person_not_here", "person_not_here", None),
    ],
)
def test_signed_in_but_not_paired(
    pairing: dict[str, str] | None,
    status: str,
    code: str,
    first: str | None,
    stand: Stand,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The person pairs on the site the agent called; a paired agent whose person has not signed
    in there yet only needs them to sign in once."""
    signed_in(tmp_path, monkeypatch, ["keyfleet"])
    stand.pairing, stand.status = pairing, status

    exit_code, found, _ = doctor("--site", "keyfleet")

    assert exit_code == 1
    assert failed(found) == {("keyfleet", "pairing"): (code, "pairing")}
    person, *rest = found["next_steps"]
    assert (person["kind"], person["url"]) == ("human", "https://keyfleet.ai/")
    assert [step.get("command") for step in rest] == [
        *([first] if first else []),
        "regents doctor --site keyfleet --json",
    ]
    assert stand.whoami_signers == [ADDRESS]


@pytest.mark.parametrize("paired", [True, False])
def test_an_older_regents_is_told_to_update_first(
    paired: bool, stand: Stand, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Updating comes before any other step, whether or not anything failed, and once however
    many sites name a newer release."""
    signed_in(tmp_path, monkeypatch, ["keyfleet"])
    stand.named = "99.0.0"
    stand.pairing, stand.status = (PAIRING, "paired") if paired else (None, "not_paired")

    code, found, _ = doctor()

    assert code == (0 if paired else 1)
    behind = {row["code"] for key, row in rows(found).items() if key[1] == "regents version"}
    assert behind == {"update_available"}
    update, following, *_ = found["next_steps"]
    assert update["kind"] == "human" and "uv tool upgrade regents-cli" in update["say"]
    assert sum("uv tool upgrade" in step["say"] for step in found["next_steps"]) == 1
    assert following["kind"] == ("done" if paired else "human")


def test_site_narrows_which_sites_are_contacted(stand: Stand, no_agent: None) -> None:
    code, found, _ = doctor("--site", "keyfleet", "--site", "regents")

    assert code == 0
    assert [report["site"] for report in found["sites"]] == ["keyfleet", "regents"]
    assert stand.hosts() == {"keyfleet.ai", "regents.sh"}


def test_missing_optional_parts_are_for_this_machine(
    stand: Stand, no_agent: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Without the mcp extra neither regents mcp nor regents browser can run."""
    monkeypatch.setitem(sys.modules, "mcp", None)

    code, found, _ = doctor("--site", "keyfleet")

    assert code == 1
    assert failed(found) == {
        ("machine", "regents mcp"): ("installation_incomplete", "machine"),
        ("machine", "regents browser"): ("installation_incomplete", "machine"),
    }
    install, again = found["next_steps"]
    assert install["kind"] == "human" and INSTALL in install["say"]
    assert again["command"] == "regents doctor --site keyfleet --json"


@pytest.mark.parametrize(
    ("status", "code", "kind", "first"),
    [
        (403, "agent_refused", "permission", "human"),
        (404, "operation_unknown", "address", "human"),
        (500, "internal_error", "site", "run"),
    ],
)
def test_a_refused_read_is_told_apart_by_its_status(
    status: int, code: str, kind: str, first: str, stand: Stand, no_agent: None
) -> None:
    stand.refusals = {"/api/v1/fleets": (status, code)}

    exit_code, found, _ = doctor("--site", "keyfleet")

    assert exit_code == 1
    assert failed(found) == {("keyfleet", "fleets list"): (code, kind)}
    assert found["next_steps"][0]["kind"] == first


def test_a_locked_key_is_never_opened(
    stand: Stand, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With no helper holding the key unlocked, signing would open a Touch ID page: the
    sign-ins are left unchecked and nothing is signed."""

    def touch_id(*_: Any) -> None:
        raise AssertionError("asked for Touch ID")

    home = signed_in(tmp_path, monkeypatch, ["keyfleet"])
    locked = {"credential_id": "credential", "iv": "00", "box": "00"}
    (home / "key.json").write_text(json.dumps({"address": ADDRESS, "locked": locked}))
    monkeypatch.setattr(passkey, "_helper_socket", lambda _: f"/tmp/no-helper-{id(home)}/h.sock")
    monkeypatch.setattr(passkey, "_passkey_secret", touch_id)

    code, found, _ = doctor("--site", "keyfleet")

    assert code == 0
    assert rows(found)[("machine", "agent key")]["code"] == "locked"
    assert rows(found)[("keyfleet", "sign-in")]["code"] == "unchecked"
    assert ("keyfleet", "pairing") not in rows(found)
    assert {method for method, _, _ in stand.sent} == {"GET"}
    assert stand.whoami_signers == []
    assert [step.get("command") for step in found["next_steps"]] == [None, "regents auth status"]
