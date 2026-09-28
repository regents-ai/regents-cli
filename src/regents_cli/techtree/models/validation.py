"""Taskset locking and mechanical validation.

The receipt carries no identifier, timestamp, duration, path or raw log, so the publisher's
receipt and a participant's recomputed one compare by equality. Everything it refuses to carry
lives in the local `ValidationExecutionRecord`.
"""

from __future__ import annotations

from typing import Final, Literal, Self

from pydantic import Field, model_validator

from regents_cli.techtree.models.base import (
    ArtifactRef,
    Digest,
    NonEmptyString,
    ProtocolModel,
    StateModel,
    UtcDateTime,
)
from regents_cli.techtree.models.campaign import TasksetRef

#: Every check a receipt must report on; one silently omitted is unreadable, not weaker.
REQUIRED_VALIDATION_CHECKS: Final[tuple[str, ...]] = (
    "upstream_gold",
    "upstream_setup",
    "membership_repeatability",
    "task_hash_uniqueness",
    "committed_membership_match",
    "expected_task_count",
)

_DISPLAY_ID_HEX_LENGTH: Final = 24


class TasksetLock(ProtocolModel):
    """What a taskset reference resolved to, pinned."""

    schema_version: Literal["techtree.taskset-lock.v1alpha1"]
    taskset_ref: TasksetRef
    engine_digest: Digest
    resolved_package_digest: Digest
    ordered_task_hashes: list[Digest]
    membership_digest: Digest
    task_count: int = Field(ge=1)

    @model_validator(mode="after")
    def _check_task_list(self) -> Self:
        if len(self.ordered_task_hashes) != self.task_count:
            raise ValueError(
                f"lock records {len(self.ordered_task_hashes)} task hashes but a task_count "
                f"of {self.task_count}"
            )
        if len(set(self.ordered_task_hashes)) != len(self.ordered_task_hashes):
            raise ValueError("locked task hashes must be unique")
        return self


class ValidationCheck(ProtocolModel):
    """One mechanical check and what it found."""

    id: NonEmptyString
    status: Literal["passed", "failed", "warning", "not_run"]
    detail: NonEmptyString


class UpstreamValidationSummary(ProtocolModel):
    """What the upstream validator reported, in aggregate."""

    mode: Literal["all", "gold", "setup"]
    total: int = Field(ge=0)
    recorded: int = Field(ge=0)
    valid: int = Field(ge=0)
    invalid: int = Field(ge=0)
    error: int = Field(ge=0)
    timeout: int = Field(ge=0)
    missing: int = Field(ge=0)
    valid_rate: float | None = Field(default=None, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _check_counts_add_up(self) -> Self:
        counted = self.valid + self.invalid + self.error + self.timeout + self.missing
        if counted != self.total:
            raise ValueError(f"summary accounts for {counted} tasks but reports {self.total}")
        if self.recorded > self.total:
            raise ValueError("recorded cannot exceed total")
        return self


class ValidationMethod(ProtocolModel):
    """How the validation was performed, in reproducible terms."""

    kind: Literal["verifiers_validate"]
    mode: Literal["all"]
    runtime: Literal["subprocess"]
    validator_revision: NonEmptyString


class ValidationTaskOutcome(ProtocolModel):
    """One validator verdict for one task."""

    valid: bool
    reason: NonEmptyString


class ValidationEvidenceTask(ProtocolModel):
    """The normalized per-task record the validator produced."""

    position: int = Field(ge=0)
    task_hash: Digest
    gold: ValidationTaskOutcome
    setup: ValidationTaskOutcome


class ValidationEvidenceSummary(ProtocolModel):
    """Aggregate counts over the normalized task records."""

    total: int = Field(ge=0)
    valid: int = Field(ge=0)
    invalid: int = Field(ge=0)
    error: int = Field(ge=0)
    timeout: int = Field(ge=0)
    missing: int = Field(ge=0)

    @model_validator(mode="after")
    def _check_counts_add_up(self) -> Self:
        counted = self.valid + self.invalid + self.error + self.timeout + self.missing
        if counted != self.total:
            raise ValueError(f"evidence accounts for {counted} tasks but reports {self.total}")
        return self


class ValidationEvidence(ProtocolModel):
    """Deterministic normalized validator output: the part two honest parties must agree on."""

    schema_version: Literal["techtree.validation-evidence.v1alpha1"]
    taskset_lock_digest: Digest
    method: ValidationMethod
    tasks: list[ValidationEvidenceTask]
    summary: ValidationEvidenceSummary

    @model_validator(mode="after")
    def _check_tasks_are_a_dense_ordered_run(self) -> Self:
        positions = [task.position for task in self.tasks]
        if positions != list(range(len(self.tasks))):
            raise ValueError("evidence tasks must be sorted by position and cover 0..n-1")
        hashes = [task.task_hash for task in self.tasks]
        if len(set(hashes)) != len(hashes):
            raise ValueError("evidence task hashes must be unique")
        if self.summary.total != len(self.tasks):
            raise ValueError(
                f"evidence lists {len(self.tasks)} tasks but its summary reports "
                f"{self.summary.total}"
            )
        return self


class TasksetValidationReceipt(ProtocolModel):
    """Is this taskset mechanically valid and internally consistent?"""

    schema_version: Literal["techtree.taskset-validation.v1alpha1"]
    taskset_lock_digest: Digest
    engine_digest: Digest
    method: ValidationMethod
    status: Literal["valid", "invalid", "errored"]
    upstream_summary: UpstreamValidationSummary
    checks: list[ValidationCheck]
    normalized_evidence: ArtifactRef | None

    @model_validator(mode="after")
    def _check_required_checks_are_reported(self) -> Self:
        reported = [check.id for check in self.checks]
        if len(set(reported)) != len(reported):
            raise ValueError("a receipt reports each check exactly once")
        missing = [name for name in REQUIRED_VALIDATION_CHECKS if name not in reported]
        if missing:
            raise ValueError("receipt is missing required checks: " + ", ".join(missing))
        if self.status == "valid" and any(check.status == "failed" for check in self.checks):
            raise ValueError("a receipt with a failed check is not valid")
        return self


class ValidationExecutionRecord(StateModel):
    """Local operational provenance for one validation execution; never in the Campaign graph."""

    schema_version: Literal["techtree.validation-execution.v1alpha1"]
    id: NonEmptyString
    receipt_digest: Digest
    started_at: UtcDateTime
    finished_at: UtcDateTime
    command: list[NonEmptyString]
    command_digest: Digest
    host_platform: NonEmptyString
    worker_pid: int | None
    raw_artifacts: list[ArtifactRef]

    @model_validator(mode="after")
    def _check_execution_window(self) -> Self:
        if self.finished_at < self.started_at:
            raise ValueError("finished_at cannot precede started_at")
        if not self.command:
            raise ValueError("a validation execution records the command it ran")
        return self


def validation_display_id(receipt_digest: Digest) -> str:
    """The human-facing identifier derived from a receipt digest; for display, never stored."""
    _, _, hexadecimal = receipt_digest.partition(":")
    return f"validation_{hexadecimal[:_DISPLAY_ID_HEX_LENGTH]}"
