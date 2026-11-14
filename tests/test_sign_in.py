"""`regents auth login`, run whole against a stand-in sign-in server, for any message the server
issues: the agent's key signs exactly the message issued for its own address and the site asked
for, the nonce and message go back unchanged, and the receipt is kept for that site only. With
--phase prepare and send, the message printed is the one issued and the signature sent is the
person's own, as given. `regents auth status` asks for a new sign-in only where one has run out
that this machine's key cannot renew.
"""

from __future__ import annotations

import contextlib
import io
import json
import tempfile
from pathlib import Path
from typing import Any

import httpx
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from hypothesis import given, settings
from hypothesis import strategies as st

from regents_cli import app
from regents_cli.http import base_address
from regents_cli.platforms import pinned_platforms

SITES = sorted({platform.site for platform in pinned_platforms()})
KEY = "0x" + "00" * 31 + "01"
ADDRESS = Account.from_key(KEY).address.lower()
OTHER_WALLET = "0x" + "c0ffee" * 6 + "c0fe"
RAN_OUT = "2020-01-01T00:00:00Z"
RENEWED_UNTIL = "2999-01-01T00:00:00Z"
MESSAGES = st.text(st.characters(blacklist_categories=["Cs"]), min_size=1)
NONCES = st.text(st.sampled_from("abcdef0123456789"), min_size=8, max_size=32)


def stand_in(
    issued: dict[str, str], receipt: str, monkeypatch: pytest.MonkeyPatch
) -> list[tuple[str, dict[str, Any]]]:
    """A sign-in server that issues `issued` and answers any verify with `receipt`."""
    asked: list[tuple[str, dict[str, Any]]] = []

    def post(url: str, *, json: dict[str, Any], **_: Any) -> httpx.Response:
        asked.append((url, json))
        if url.endswith("/wallet/nonce"):
            return httpx.Response(200, json={"data": issued})
        return httpx.Response(
            200,
            json={
                "data": {
                    "walletAddress": json["wallet_address"],
                    "receipt": receipt,
                    "receiptExpiresAt": "2999-01-01T00:00:00Z",
                    "keyId": json["wallet_address"],
                }
            },
        )

    monkeypatch.setattr(httpx, "post", post)
    return asked


def regents(args: list[str], stdin: str = "") -> dict[str, Any]:
    shown = io.StringIO()
    with (
        pytest.MonkeyPatch.context() as patch,
        contextlib.redirect_stdout(shown),
        contextlib.redirect_stderr(io.StringIO()),
    ):
        patch.setattr("sys.stdin", io.StringIO(stdin))
        assert app.main([*args, "--json"]) == 0, shown.getvalue()
    answer: dict[str, Any] = json.loads(shown.getvalue())
    return answer


def agent_home(folder: Path, monkeypatch: pytest.MonkeyPatch, with_key: bool) -> Path:
    home = folder / "agent"
    home.mkdir(mode=0o700, exist_ok=True)
    if with_key:
        (home / "key.json").write_text(json.dumps({"address": ADDRESS, "private_key": KEY}))
        (home / "key.json").chmod(0o600)
    monkeypatch.setenv("SIWA_AGENT_HOME", str(home))
    monkeypatch.setenv("SIWA_BROKER", "https://sign-in.example")
    return home


@given(site=st.sampled_from(SITES), message=MESSAGES, nonce=NONCES)
@settings(deadline=None, max_examples=40)
def test_the_key_signs_the_message_issued_for_it(site: str, message: str, nonce: str) -> None:
    with tempfile.TemporaryDirectory() as folder, pytest.MonkeyPatch.context() as monkeypatch:
        home = agent_home(Path(folder), monkeypatch, with_key=True)
        asked = stand_in({"nonce": nonce, "message": message}, "receipt-1", monkeypatch)

        told = regents(["auth", "login", "--site", site])

        [(nonce_url, nonce_body), (verify_url, verify_body)] = asked
        assert nonce_url == "https://sign-in.example/api/shared/siwa/wallet/nonce"
        assert (nonce_body["wallet_address"], nonce_body["audience"]) == (ADDRESS, site)
        assert verify_url == "https://sign-in.example/api/shared/siwa/wallet/verify"
        assert (verify_body["nonce"], verify_body["message"], verify_body["audience"]) == (
            nonce,
            message,
            site,
        )
        signer = Account.recover_message(
            encode_defunct(text=message), signature=verify_body["signature"]
        )
        assert signer.lower() == ADDRESS
        assert (told["site"], told["wallet_address"]) == (site, ADDRESS)
        assert sorted(path.name for path in (home / "receipts").iterdir()) == [f"{site}.json"]
        assert json.loads((home / "receipts" / f"{site}.json").read_text())["receipt"] == (
            "receipt-1"
        )


@given(
    site=st.sampled_from(SITES),
    message=MESSAGES,
    nonce=NONCES,
    signature=st.binary(min_size=65, max_size=65).map(lambda raw: "0x" + raw.hex()),
)
@settings(deadline=None, max_examples=40)
def test_a_person_signs_the_issued_message_with_their_own_wallet(
    site: str, message: str, nonce: str, signature: str
) -> None:
    wallet = "0x" + "C0FFEE" * 6 + "C0FE"
    with tempfile.TemporaryDirectory() as folder, pytest.MonkeyPatch.context() as monkeypatch:
        home = agent_home(Path(folder), monkeypatch, with_key=False)
        asked = stand_in({"nonce": nonce, "message": message}, "receipt-2", monkeypatch)

        ready = regents(
            ["auth", "login", "--site", site, "--phase", "prepare", "--wallet-address", wallet]
        )
        assert (ready["nonce"], ready["message"]) == (nonce, message)
        ready.pop("next_steps")
        regents(
            ["auth", "login", "--site", site, "--phase", "send"],
            json.dumps({**ready, "signature": signature}),
        )

        [(_, nonce_body), (_, verify_body)] = asked
        assert nonce_body["wallet_address"] == wallet
        assert {k: verify_body[k] for k in ("wallet_address", "nonce", "message", "signature")} == {
            "wallet_address": wallet.lower(),
            "nonce": nonce,
            "message": message,
            "signature": signature,
        }
        assert not (home / "key.json").exists()


@pytest.mark.parametrize(
    "verified",
    [
        {},
        {"data": {"walletAddress": ADDRESS, "receiptExpiresAt": "2999-01-01T00:00:00Z"}},
        {"data": {"walletAddress": ADDRESS, "receipt": "r", "receiptExpiresAt": 0, "keyId": "k"}},
        {
            "data": {
                "walletAddress": ADDRESS,
                "receipt": "r",
                "receiptExpiresAt": "soon",
                "keyId": "k",
            }
        },
    ],
)
def test_a_receipt_regents_cannot_read_is_never_kept(
    verified: dict[str, Any], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A kept receipt that can't be read back breaks every later command for the site, until
    the person logs out; one that can't be read is refused before it is kept."""
    home = agent_home(tmp_path, monkeypatch, with_key=True)

    def post(url: str, **_: Any) -> httpx.Response:
        issued = {"nonce": "abcdef0123", "message": "Sign in"}
        return httpx.Response(200, json={"data": issued} if url.endswith("/nonce") else verified)

    monkeypatch.setattr(httpx, "post", post)
    shown = io.StringIO()
    with contextlib.redirect_stdout(shown), contextlib.redirect_stderr(io.StringIO()):
        failed = app.main(["auth", "login", "--site", "patchbay", "--json"])
    assert failed != 0
    assert json.loads(shown.getvalue())["error"]["code"] == "invalid_response"
    assert not list(home.glob("receipts/*.json"))


def ran_out(home: Path, site: str, address: str) -> None:
    """A sign-in to `site` that `address` made, kept as login keeps it, which has run out."""
    folder = home / "receipts"
    folder.mkdir(mode=0o700, exist_ok=True)
    kept = folder / f"{site}.json"
    kept.write_text(
        json.dumps(
            {
                "address": address,
                "audience": site,
                "receipt": f"old-{site}",
                "receipt_expires_at": RAN_OUT,
                "key_id": address,
            }
        )
    )
    kept.chmod(0o600)


def renewing(monkeypatch: pytest.MonkeyPatch) -> None:
    """A sign-in server that signs this machine's key in again, accepts the requests it signs and
    lists each site at its own address, and sites whose identity probe answers paired."""
    listed = [
        {"audience": p.site, "origin": base_address(None, p.env_var, p.base_url)}
        for p in pinned_platforms()
    ]

    def post(url: str, *, json: dict[str, Any], **_: Any) -> httpx.Response:
        if url.endswith("/wallet/nonce"):
            return httpx.Response(200, json={"data": {"nonce": "abcdef0123", "message": "Sign in"}})
        if url.endswith("/wallet/verify"):
            renewed = {
                "walletAddress": json["wallet_address"],
                "receipt": "renewed",
                "receiptExpiresAt": RENEWED_UNTIL,
                "keyId": json["wallet_address"],
            }
            return httpx.Response(200, json={"data": renewed})
        assert url.endswith("/http-verify"), url
        told = {"agentRegistration": None, "agentBook": None}
        return httpx.Response(200, json={"code": "http_envelope_valid", "data": told})

    def get(url: str, **_: Any) -> httpx.Response:
        assert url.endswith("/audiences"), url
        return httpx.Response(200, json={"data": {"audiences": listed}})

    def request(method: str, url: str, **_: Any) -> httpx.Response:
        assert (method, url.rsplit("/api/", 1)[1]) == ("GET", "agents/v1/whoami"), url
        return httpx.Response(200, json={"data": {"pairing": {"account_id": "acct_1"}}})

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(httpx, "get", get)
    monkeypatch.setattr(httpx, "request", request)


def test_status_asks_for_no_sign_in_this_machine_renews(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Told to sign in again, an agent stops and asks its person, when its next signed command
    would renew the sign-in by itself (field report on 1.10.28). Status renews the site it reads
    through and shows it fresh, shows another that ran out renews, and asks for no sign-in."""
    home = agent_home(tmp_path, monkeypatch, with_key=True)
    ran_out(home, "regents", ADDRESS)
    ran_out(home, "patchbay", ADDRESS)
    renewing(monkeypatch)

    told = regents(["auth", "status"])

    shown = {
        row["site"]: (row["signed_in_until"], row["fresh"], row["renews"])
        for row in told["sign_ins"]
    }
    assert shown == {"regents": (RENEWED_UNTIL, True, True), "patchbay": (RAN_OUT, False, True)}
    assert [step["kind"] for step in told["next_steps"]] == ["done"]


@pytest.mark.parametrize(("with_key", "made_by"), [(True, OTHER_WALLET), (False, ADDRESS)])
def test_status_asks_to_sign_in_where_nothing_here_renews(
    with_key: bool, made_by: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A sign-in another wallet made, or one with no key left on this machine, is never renewed:
    without the step, the agent's next signed command for the site fails on it."""
    home = agent_home(tmp_path, monkeypatch, with_key=with_key)
    ran_out(home, "keyfleet", made_by)

    told = regents(["auth", "status"])

    [row] = told["sign_ins"]
    assert (row["fresh"], row["renews"]) == (False, False)
    assert [step.get("command") for step in told["next_steps"]] == [
        "regents auth login --site keyfleet"
    ]
