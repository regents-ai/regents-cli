"""A body of no bytes is signed and sent as no body.

On the wire the two are one request. A site that received no bytes refuses a content digest
(401 `http_body_binding_missing`), so an empty file or an empty tool body once failed to sign in.
"""

import httpx
import pytest

from regents_cli import siwa
from regents_cli.http import Request, respond


def signed(raw: bytes | None) -> tuple[dict[str, str], str]:
    return siwa.unsigned(
        Request("POST", "/api/v1/agent/things", raw_content=raw),
        authority="site.example",
        receipt="receipt",
        wallet_address="0x" + "1" * 40,
        chain_id=8453,
        key_id="key",
        created=1,
        expires=2,
        nonce="nonce",
    )


def test_no_bytes_sign_as_no_body_and_bytes_sign_their_digest() -> None:
    component = siwa.contract()["body"]["component"]
    assert signed(b"") == signed(None)
    assert component not in signed(b"")[0]
    assert component in signed(b"{}")[0]


def test_no_bytes_are_sent_as_no_body(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(answer)
    monkeypatch.setattr(
        httpx,
        "request",
        lambda method, url, **rest: httpx.Client(transport=transport).request(
            method, url, **{k: v for k, v in rest.items() if k != "follow_redirects"}
        ),
    )
    respond("https://site.example", Request("POST", "/x", raw_content=b""), 1000)
    assert sent[0].content == b""
    assert "content-type" not in sent[0].headers
