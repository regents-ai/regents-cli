"""Prevent mismatched signed bytes, reused request proof, and proof sent to another origin."""

from __future__ import annotations

import base64
import hashlib
from unittest.mock import Mock

import httpx
import pytest

from regents_cli import siwa
from regents_cli.http import Request
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.publication.transport import (
    APPROVED_ENDPOINT,
    MAX_REQUEST_BYTES,
    HttpsPublicationTransport,
)


def test_signed_bytes_stay_immutable_and_retries_get_fresh_proof(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Whitespace and number spelling must survive: a JSON decode/encode changes these bytes.
    body = b'{ "proof": {"amount":1e-8}, "signature":"unchanged-ed25519-proof" }\n'
    receipt = siwa.Receipt("0x" + "1" * 40, "techtree", "test-only", "2099-01-01T00:00:00Z", "test")
    calls: list[Request] = []
    sent: list[httpx.Request] = []

    def proof(request: Request, received: siwa.Receipt) -> dict[str, str]:
        assert received is receipt
        calls.append(request)
        return siwa.unsigned(
            request,
            receipt=receipt.receipt,
            wallet_address=receipt.address,
            chain_id=8453,
            key_id=receipt.key_id,
            created=1_800_000_000,
            expires=1_800_000_090,
            nonce=f"test-{len(calls)}",
        )[0]

    def answer(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={"accepted": True})

    current = Mock(return_value=receipt)
    monkeypatch.setattr(siwa, "current", current)
    monkeypatch.setattr(siwa, "sign", proof)
    transport = HttpsPublicationTransport(httpx.Client(transport=httpx.MockTransport(answer)))
    for _ in range(2):
        transport.submit(
            endpoint=APPROVED_ENDPOINT,
            body=body,
            contributor_address=None,
            skill_name=None,
            skill_github_url=None,
        )
    assert current.call_count == 2
    assert all(call.args[0] == "techtree" for call in current.call_args_list)
    assert all(request.content == body for request in calls)
    assert all(request.content == body for request in sent)
    assert all(request.target == "/api/v1/publications" for request in calls)
    digest = "sha-256=:" + base64.b64encode(hashlib.sha256(body).digest()).decode() + ":"
    assert all(request.headers["content-digest"] == digest for request in sent)
    assert sent[0].headers["x-siwa-signature-input"] != sent[1].headers["x-siwa-signature-input"]


def test_unapproved_destination_and_oversized_body_stop_before_authentication(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    current = Mock(side_effect=AssertionError("must not access credentials"))
    monkeypatch.setattr(siwa, "current", current)
    transport = HttpsPublicationTransport()
    for endpoint, body in [
        ("https://other.example/api/v1/publications", b"{}"),
        (APPROVED_ENDPOINT + "?copy=1", b"{}"),
        (APPROVED_ENDPOINT + "/", b"{}"),
        (APPROVED_ENDPOINT, b" " * (MAX_REQUEST_BYTES + 1)),
    ]:
        with pytest.raises(ValidationError):
            transport.submit(
                endpoint=endpoint,
                body=body,
                contributor_address=None,
                skill_name=None,
                skill_github_url=None,
            )
    current.assert_not_called()
