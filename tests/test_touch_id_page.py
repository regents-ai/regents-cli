"""`regents auth login` on a Mac with no agent key yet, run whole in headless Chromium with a
virtual Touch ID: the new key is locked on the page `regents` serves, the file keeps only the
locked key, and the agent signs in with it. With the helper stopped, the next sign-in opens the
key again on the page and signs with the same key. Each page comes with its own nonce and the
policy that lets only that page's style and script run, and the browser refuses nothing.
"""

from __future__ import annotations

import contextlib
import io
import json
import queue
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from playwright.sync_api import Page, expect, sync_playwright

from regents_cli import app, browser, passkey

pytestmark = pytest.mark.skipif(
    sys.platform != "darwin", reason="regents locks the agent key with Touch ID only on a Mac"
)

SITE = "regents"
ISSUED = {"nonce": "0123456789abcdef", "message": "Sign in to Regents with this agent key."}


def sign_in(asked: list[dict[str, Any]]) -> dict[str, Any]:
    """`regents auth login --site regents --json`, against a stand-in sign-in server."""

    def post(url: str, *, json: dict[str, Any], **_: Any) -> httpx.Response:
        if url.endswith("/wallet/nonce"):
            return httpx.Response(200, json={"data": ISSUED})
        asked.append(json)
        return httpx.Response(
            200,
            json={
                "data": {
                    "walletAddress": json["wallet_address"],
                    "receipt": "receipt-1",
                    "receiptExpiresAt": "2999-01-01T00:00:00Z",
                    "keyId": json["wallet_address"],
                }
            },
        )

    shown = io.StringIO()
    with (
        pytest.MonkeyPatch.context() as patch,
        contextlib.redirect_stdout(shown),
        contextlib.redirect_stderr(io.StringIO()),
    ):
        patch.setattr(httpx, "post", post)
        assert app.main(["auth", "login", "--site", SITE, "--json"]) == 0, shown.getvalue()
    answer: dict[str, Any] = json.loads(shown.getvalue())
    return answer


def confirm(page: Page, offered: queue.Queue[str]) -> str:
    """Open the page `regents` offers, confirm with Touch ID, and return the page's nonce once
    its policy header is checked against it."""
    response = page.goto(offered.get(timeout=10))
    assert response is not None
    nonces: set[str] = set(re.findall(r'nonce="([^"]+)"', response.text()))
    assert len(nonces) == 1
    (nonce,) = nonces
    assert response.headers["content-security-policy"] == passkey.PASSKEY_POLICY.format(nonce=nonce)
    page.get_by_role("button", name="Use Touch ID").click()
    expect(page.locator("#done")).to_have_text("You can safely close this page")
    return nonce


def stop_helper(home: Path) -> None:
    """Stop the helper keeping this test's key, as a restart of the Mac would."""
    if not (home / "key.json").is_file():
        return
    path = passkey._helper_socket(json.loads((home / "key.json").read_text())["address"])
    passkey._ask_helper(path, {"op": "stop"})
    # The helper answers before it stops listening; wait until it has gone.
    deadline = time.monotonic() + 5
    while passkey._ask_helper(path, {"op": "address"}) is not None:
        assert time.monotonic() < deadline, f"the helper at {path} did not stop"
        time.sleep(0.1)


def signer(signed: dict[str, Any]) -> str:
    recovered: str = Account.recover_message(
        encode_defunct(text=ISSUED["message"]), signature=signed["signature"]
    )
    return recovered.lower()


def test_a_new_key_is_locked_on_the_page_and_opens_again_on_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "agent"
    monkeypatch.setenv("SIWA_AGENT_HOME", str(home))
    monkeypatch.setenv("SIWA_BROKER", "https://sign-in.example")
    offered: queue.Queue[str] = queue.Queue()
    monkeypatch.setattr(browser, "offer", lambda _ask, url: offered.put(url))
    # A page that never answers ends the wait soon, so a failure is seen in seconds.
    monkeypatch.setattr(passkey, "PASSKEY_WAIT_SECONDS", 15)
    asked: list[dict[str, Any]] = []
    with sync_playwright() as playwright, ThreadPoolExecutor(1) as waiting:
        chromium = playwright.chromium.launch()
        page = chromium.new_page()
        refused: list[str] = []
        page.on(
            "console",
            lambda message: (
                refused.append(message.text) if "Content Security Policy" in message.text else None
            ),
        )
        touch_id = page.context.new_cdp_session(page)
        touch_id.send("WebAuthn.enable")
        touch_id.send(
            "WebAuthn.addVirtualAuthenticator",
            {
                "options": {
                    "protocol": "ctap2",
                    "transport": "internal",
                    "hasResidentKey": True,
                    "hasUserVerification": True,
                    "isUserVerified": True,
                    "automaticPresenceSimulation": True,
                    "hasPrf": True,
                }
            },
        )
        try:
            first = waiting.submit(sign_in, asked)
            first_nonce = confirm(page, offered)
            created = first.result(timeout=30)
            stop_helper(home)
            again = waiting.submit(sign_in, asked)
            second_nonce = confirm(page, offered)
            signed_in_again = again.result(timeout=30)
        finally:
            stop_helper(home)
            chromium.close()

    stored = json.loads((home / "key.json").read_text())
    assert set(stored) == {"address", "locked"}
    assert set(stored["locked"]) == {"credential_id", "iv", "box"}
    assert created["key_created"] == str(home / "key.json")
    assert "key_created" not in signed_in_again
    assert created["wallet_address"] == signed_in_again["wallet_address"] == stored["address"]
    assert [signer(signed) for signed in asked] == [stored["address"], stored["address"]]
    assert offered.empty()
    assert first_nonce != second_nonce
    assert refused == []
