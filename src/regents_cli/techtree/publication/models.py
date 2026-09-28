"""What crosses the wire: the submission, the log's receipts, and a withdrawal request.

The contributor address is none of these. It travels in the `x-techtree-contributor-address`
header, beside the submission and never inside it, because the run log serves a stored
submission back at a public address. It is kept nowhere on this machine.
"""

from __future__ import annotations

from typing import Literal, Self

from pydantic import Field, model_validator

from regents_cli.techtree.models.base import (
    Base64String,
    Digest,
    NonEmptyString,
    ProtocolModel,
    PublicKeyRef,
    UtcDateTime,
)


class PublicationSubmission(ProtocolModel):
    """Everything one publication sends: the proof directory, file by file, and nothing else.

    No digest and no size travel beside a file: both would be the submitter's own arithmetic
    over the submitter's own bytes. Every digest the receiving side works with comes from the
    bundle's own signed manifest, which is inside `files` under `bundle.json`.
    """

    schema_version: Literal["techtree.publication-submission.v1alpha1"]
    run_id: NonEmptyString
    bundle_digest: Digest
    files: dict[NonEmptyString, Base64String]

    @model_validator(mode="after")
    def _check_the_files_are_a_bundle(self) -> Self:
        if not self.files:
            raise ValueError("a publication submits at least one file")
        return self


class PublicationCheck(ProtocolModel):
    """One check the network ran on a submission, and how it came out."""

    id: NonEmptyString
    passed: bool
    detail: NonEmptyString


class PublicationReceiptPayload(ProtocolModel):
    """What the network countersigns when it accepts one submission."""

    schema_version: Literal["techtree.publication-receipt.v1alpha1"]
    id: NonEmptyString
    run_id: NonEmptyString
    log_sequence: int = Field(ge=0)
    bundle_digest: Digest
    accepted_at: UtcDateTime
    checks: list[PublicationCheck]
    entry_url: NonEmptyString
    public_key: PublicKeyRef

    @model_validator(mode="after")
    def _check_the_receipt_reports_its_own_checks(self) -> Self:
        if not self.checks:
            raise ValueError("a publication receipt names the checks that ran")
        identifiers = [check.id for check in self.checks]
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("a publication receipt reports each check once")
        return self

    @property
    def failed_checks(self) -> list[PublicationCheck]:
        return [check for check in self.checks if not check.passed]


class WithdrawalRequest(ProtocolModel):
    """The participant asking that one published entry be marked withdrawn.

    No reason field: nothing a submitter writes appears on the site. No public key: the
    network verifies the signature against the key inside the bundle it already accepted.
    """

    schema_version: Literal["techtree.publication-withdrawal.v1alpha1"]
    bundle_digest: Digest
    requested_at: UtcDateTime


class WithdrawalReceiptPayload(ProtocolModel):
    """The network's countersigned record that an entry is marked withdrawn, not deleted."""

    schema_version: Literal["techtree.publication-withdrawal-receipt.v1alpha1"]
    bundle_digest: Digest
    entry_url: NonEmptyString
    withdrawn_at: UtcDateTime
    public_key: PublicKeyRef
