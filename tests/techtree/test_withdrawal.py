"""A withdrawal's answer is the pinned log's word or it is nothing; and nothing goes without a yes.

The costly failures: a forged receipt from whoever answered the request is recorded as the
log's word, or a request leaves the machine that nobody agreed to send.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from regents_cli.app import main
from regents_cli.techtree import paths
from regents_cli.techtree.canonical import canonical_json_bytes, digest_object
from regents_cli.techtree.crypto import sign_digest
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.identity.store import IdentityStore
from regents_cli.techtree.models.base import ObjectEnvelope
from regents_cli.techtree.publication.models import WithdrawalReceiptPayload, WithdrawalRequest
from tests.techtree.run_log import (
    IMPOSTOR_PRIVATE_KEY,
    NETWORK_KEY,
    RunLog,
    accept_withdrawal,
    at_a_terminal,
    install,
    network_signed,
    withdrawal_receipt_for,
)

BUNDLE_DIGEST = "sha256:" + "7" * 64
WITHDRAW = ["techtree", "withdraw", BUNDLE_DIGEST]
APPROVED = [*WITHDRAW, "--yes", "--reviewed-on", "host-agent", "--json"]


def signing_machine(monkeypatch: pytest.MonkeyPatch, home: Path, log: RunLog) -> None:
    """A machine with its own identity, pointed at the stand-in."""
    install(monkeypatch, home, log)
    IdentityService(IdentityStore(paths.home())).ensure()


def refusal(capsys: pytest.CaptureFixture[str]) -> dict[str, object]:
    error = json.loads(capsys.readouterr().out)["error"]
    assert error["code"] == "publication_receipt_invalid"
    details = error["details"]
    assert isinstance(details, dict)
    return details


def test_an_answer_signed_by_another_key_is_refused(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    def answer(request: httpx.Request) -> bytes:
        asked = ObjectEnvelope[WithdrawalRequest].model_validate_json(request.content)
        payload = withdrawal_receipt_for(asked.payload.bundle_digest)
        digest = digest_object(payload)
        return canonical_json_bytes(
            ObjectEnvelope[WithdrawalReceiptPayload](
                payload=payload,
                payload_digest=digest,
                signature=sign_digest(IMPOSTOR_PRIVATE_KEY, digest, key_id=NETWORK_KEY.key_id),
            )
        )

    log = RunLog(answer)
    signing_machine(monkeypatch, tmp_path / "home", log)

    assert main(APPROVED) == 1

    assert refusal(capsys)["check"] == "receipt.signature"
    assert len(log.requests) == 1


def test_an_answer_pointing_off_the_pinned_log_is_refused(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    def answer(request: httpx.Request) -> bytes:
        asked = ObjectEnvelope[WithdrawalRequest].model_validate_json(request.content)
        receipt = withdrawal_receipt_for(
            asked.payload.bundle_digest, entry_url="https://elsewhere.example/runs/x"
        )
        return canonical_json_bytes(network_signed(receipt))

    log = RunLog(answer)
    signing_machine(monkeypatch, tmp_path / "home", log)

    assert main(APPROVED) == 1

    assert refusal(capsys)["check"] == "receipt.entry_url"


def test_saying_no_at_the_prompt_sends_nothing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    log = RunLog(accept_withdrawal)
    signing_machine(monkeypatch, tmp_path / "home", log)
    _, stdout = at_a_terminal(monkeypatch, "n\n")

    assert main(WITHDRAW) == 1

    assert "Withdraw this entry from the public log?" in stdout.getvalue()
    assert log.requests == []
