"""A local stand-in for the run log, and a run installed in a throwaway home to publish.

The stand-in answers through `httpx.MockTransport`, so no test opens a socket. Its network key
is a fixed test key whose public half is pinned exactly the way a release pins the real one.
"""

from __future__ import annotations

import io
import shutil
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

import httpx
import pytest
from pydantic import BaseModel

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object, sha256_digest_bytes
from regents_cli.techtree.commands import publish as publish_module
from regents_cli.techtree.commands import withdraw as withdraw_module
from regents_cli.techtree.crypto import (
    load_private_key,
    public_key_bytes,
    public_key_to_base64,
    sign_digest,
)
from regents_cli.techtree.models.base import ObjectEnvelope, PublicKeyRef
from regents_cli.techtree.publication.models import (
    PublicationCheck,
    PublicationReceiptPayload,
    PublicationSubmission,
    WithdrawalReceiptPayload,
    WithdrawalRequest,
)
from regents_cli.techtree.publication.transport import HttpsPublicationTransport
from regents_cli.techtree.release.models import PinnedNetworkKey, PublicationCoordinates

RUN: Final = Path(__file__).parent / "fixtures" / "run"
RUN_ID: Final = "run_a7e29f6a7b9c487eadeb1d288030b02e"
BUNDLE_DIGEST: Final = "sha256:9cf19b51904c1f27c0e89e34805a62c1d3f01555545da0ccf9e54207f7dfe030"
SKILL_NAME: Final = "hello-world-v1"

PINNED_ENDPOINT: Final = "https://run-log.techtree.example/api/v1/publications"
PUBLIC_LOG_URL: Final = "https://run-log.techtree.example/runs"
ENTRY_URL: Final = f"{PUBLIC_LOG_URL}/sha256:{'7' * 64}"
LOG_SEQUENCE: Final = 7

NETWORK_PRIVATE_KEY: Final = load_private_key(bytes(range(32)))
_NETWORK_PUBLIC: Final = NETWORK_PRIVATE_KEY.public_key()
NETWORK_KEY: Final = PinnedNetworkKey(
    algorithm="ed25519",
    key_id=sha256_digest_bytes(public_key_bytes(NETWORK_PRIVATE_KEY)),
    public_key=public_key_to_base64(_NETWORK_PUBLIC),
)
CARRIED_KEY: Final = PublicKeyRef(
    algorithm="ed25519", key_id=NETWORK_KEY.key_id, public_key=NETWORK_KEY.public_key
)
COORDINATES: Final = PublicationCoordinates(
    submission_endpoint=PINNED_ENDPOINT, public_log_url=PUBLIC_LOG_URL, network_key=NETWORK_KEY
)
IMPOSTOR_PRIVATE_KEY: Final = load_private_key(bytes(range(100, 132)))

_ACCEPTED_AT: Final = datetime(2026, 8, 27, 9, 0, tzinfo=UTC)
_WITHDRAWN_AT: Final = datetime(2026, 8, 28, 9, 0, tzinfo=UTC)


def network_signed[T: BaseModel](payload: T) -> ObjectEnvelope[T]:
    """Countersigned by the stand-in's network key, as the real log countersigns."""
    digest = digest_object(payload)
    return ObjectEnvelope[T](
        payload=payload,
        payload_digest=digest,
        signature=sign_digest(NETWORK_PRIVATE_KEY, digest, key_id=NETWORK_KEY.key_id),
    )


def receipt_for(
    run_id: str, bundle_digest: str, *, entry_url: str = ENTRY_URL
) -> PublicationReceiptPayload:
    return PublicationReceiptPayload(
        schema_version="techtree.publication-receipt.v1alpha1",
        id="publication_" + "1" * 32,
        run_id=run_id,
        log_sequence=LOG_SEQUENCE,
        bundle_digest=bundle_digest,
        accepted_at=_ACCEPTED_AT,
        checks=[PublicationCheck(id="bundle.verified", passed=True, detail="verified")],
        entry_url=entry_url,
        public_key=CARRIED_KEY,
    )


def withdrawal_receipt_for(
    bundle_digest: str, *, entry_url: str = ENTRY_URL
) -> WithdrawalReceiptPayload:
    return WithdrawalReceiptPayload(
        schema_version="techtree.publication-withdrawal-receipt.v1alpha1",
        bundle_digest=bundle_digest,
        entry_url=entry_url,
        withdrawn_at=_WITHDRAWN_AT,
        public_key=CARRIED_KEY,
    )


def accept_publication(request: httpx.Request) -> bytes:
    submission = PublicationSubmission.model_validate_json(request.content)
    return canonical_json_bytes(
        network_signed(receipt_for(submission.run_id, submission.bundle_digest))
    )


def accept_withdrawal(request: httpx.Request) -> bytes:
    withdrawal = ObjectEnvelope[WithdrawalRequest].model_validate_json(request.content)
    return canonical_json_bytes(
        network_signed(withdrawal_receipt_for(withdrawal.payload.bundle_digest))
    )


class RunLog:
    """Records every request the commands make and answers as it is told to."""

    def __init__(self, answer: Callable[[httpx.Request], bytes]) -> None:
        self.requests: list[httpx.Request] = []
        self._answer = answer

    def transport(self) -> HttpsPublicationTransport:
        return HttpsPublicationTransport(httpx.Client(transport=httpx.MockTransport(self._handle)))

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(
            200, content=self._answer(request), headers={"content-type": "application/json"}
        )


def install(monkeypatch: pytest.MonkeyPatch, home: Path, log: RunLog) -> None:
    """Point the commands at a throwaway home, the stand-in's key and its transport."""
    monkeypatch.setenv("HOME", str(home))
    for module in (publish_module, withdraw_module):
        monkeypatch.setattr(module, "packaged_publication_coordinates", lambda: COORDINATES)
        monkeypatch.setattr(module, "HttpsPublicationTransport", log.transport)


def install_run(home: Path) -> Path:
    """The fixture run's proof and draft, installed as a run in this home."""
    run_dir = home / ".regents" / "techtree" / "runs" / RUN_ID
    shutil.copytree(RUN, run_dir)
    return run_dir


class Terminal(io.StringIO):
    """A stream that says it is a terminal, so the commands ask instead of refusing."""

    def isatty(self) -> bool:
        return True


def at_a_terminal(monkeypatch: pytest.MonkeyPatch, typed: str) -> tuple[Terminal, Terminal]:
    """Put a person with these answers at the keyboard; returns (stdin, stdout)."""
    stdin, stdout = Terminal(typed), Terminal()
    monkeypatch.setattr(sys, "stdin", stdin)
    monkeypatch.setattr(sys, "stdout", stdout)
    return stdin, stdout
