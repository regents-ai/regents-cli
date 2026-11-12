"""`regents auth login`, run whole against a stand-in sign-in server, for any message the server
issues: the agent's key signs exactly the message issued for its own address and the site asked
for, the nonce and message go back unchanged, and the receipt is kept for that site only. With
--phase prepare and send, the message printed is the one issued and the signature sent is the
person's own, as given.
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
from regents_cli.platforms import pinned_platforms

SITES = sorted({platform.site for platform in pinned_platforms()})
KEY = "0x" + "00" * 31 + "01"
ADDRESS = Account.from_key(KEY).address.lower()
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
