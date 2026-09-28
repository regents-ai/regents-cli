"""The public half of the local identity, and the shape of a verification verdict.

The private half has no model: it is raw bytes on disk and a key object in memory, and giving
it a document shape would be the first step towards it appearing in one.
"""

from __future__ import annotations

from typing import Final, Literal, Self

from pydantic import model_validator

from regents_cli.techtree.models.base import (
    Base64String,
    NonEmptyString,
    ProtocolModel,
    UtcDateTime,
)

#: `warning` is a claim that holds more weakly than it wanted to, never a relaxed failure.
type VerificationStatus = Literal["passed", "failed", "warning"]

LOCAL_IDENTITY_INVALID: Final = "local_identity_invalid"
SIGNATURE_VERIFICATION_FAILED: Final = "signature_verification_failed"


class ExecutorIdentity(ProtocolModel):
    """The public half of one participant-controlled local signing key."""

    kind: Literal["local_ed25519"]
    key_id: NonEmptyString
    algorithm: Literal["ed25519"]
    public_key: Base64String
    created_at: UtcDateTime


class VerificationMessage(ProtocolModel):
    """One named check and what it found; `code` is what a failure reports under."""

    id: NonEmptyString
    status: VerificationStatus
    code: NonEmptyString
    detail: NonEmptyString


class VerificationResult(ProtocolModel):
    """Every check a verification ran, and whether the thing verified."""

    verified: bool
    messages: list[VerificationMessage]

    @property
    def failures(self) -> list[VerificationMessage]:
        return [message for message in self.messages if message.status == "failed"]

    @property
    def warnings(self) -> list[VerificationMessage]:
        return [message for message in self.messages if message.status == "warning"]

    @model_validator(mode="after")
    def _check_the_verdict_is_the_one_the_checks_support(self) -> Self:
        if self.verified and self.failures:
            raise ValueError("a verification that reports success cannot carry a failed check")
        if not self.verified and not self.failures:
            raise ValueError("a verification that reports failure must name the check that failed")
        if not self.messages:
            raise ValueError("a verification result records the checks it ran")
        return self
