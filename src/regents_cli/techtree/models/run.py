"""Run requests, phases, events, and local state.

`RunRequestV2` is immutable: what was asked for. `RunState` is rewritten as the worker makes
progress, and keeping the two apart stops a heartbeat update from altering the request.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal, Self

from pydantic import Field, model_validator

from regents_cli.techtree.models.base import (
    Digest,
    JsonValue,
    NonEmptyString,
    ProtocolModel,
    StateModel,
    UtcDateTime,
)
from regents_cli.techtree.models.campaign import ProgramRef, PublicContext

#: The executor that produced a run and its receipts; the two documents spell it identically.
type ExecutorKind = Literal["verifiers"]


class RunPhase(StrEnum):
    """Where a run currently is."""

    CREATED = "created"
    VALIDATING_TASKSET = "validating_taskset"
    RUNNING_VARIANTS = "running_variants"
    BUILDING_RECEIPTS = "building_receipts"
    VERIFYING_COMPARISON = "verifying_comparison"
    BUILDING_REPORT = "building_report"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCEL_REQUESTED = "cancel_requested"
    CANCELLED = "cancelled"


class PublicRunState(StrEnum):
    """Where a run is, in the five words a caller outside Techtree is told."""

    PREPARED = "prepared"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


type AcknowledgementMethod = Literal["explicit_cli_review", "host_agent_confirmation"]


class PolicyAcknowledgement(ProtocolModel):
    """That a specific rights policy was accepted, how, and when."""

    data_policy_digest: Digest
    method: AcknowledgementMethod
    acknowledged_at: UtcDateTime


class RunRequestV2(ProtocolModel):
    """What was asked for, fixed at the moment the run was created."""

    schema_version: Literal["techtree.run-request.v2"]
    run_id: NonEmptyString
    draft_id: NonEmptyString
    draft_digest: Digest
    campaign_spec_digest: Digest
    program_ref: ProgramRef | None
    public_context: PublicContext | None
    data_policy_digest: Digest
    outcome_contract_digest: Digest | None
    execution_plan_digest: Digest
    taskset_lock_digest: Digest | None
    baseline_manifest_digest: Digest
    candidate_manifest_digest: Digest
    policy_acknowledgement: PolicyAcknowledgement
    executor_kind: ExecutorKind
    created_at: UtcDateTime

    @model_validator(mode="after")
    def _check_acknowledged_policy_is_the_one_being_run(self) -> Self:
        if self.policy_acknowledgement.data_policy_digest != self.data_policy_digest:
            raise ValueError("the acknowledged DataPolicy is not the one this run executes under")
        if self.baseline_manifest_digest == self.candidate_manifest_digest:
            raise ValueError("a run compares two different manifests")
        return self


class RunEvent(ProtocolModel):
    """One appended record of something that happened to a run."""

    sequence: int = Field(ge=0)
    timestamp: UtcDateTime
    run_id: NonEmptyString
    previous_phase: RunPhase | None
    phase: RunPhase
    kind: NonEmptyString
    details: dict[str, JsonValue]


class RunProgress(StateModel):
    """How far through the current phase the worker is."""

    current: int = Field(ge=0)
    total: int = Field(ge=0)
    label: NonEmptyString

    @model_validator(mode="after")
    def _check_progress_is_within_its_total(self) -> Self:
        if self.current > self.total:
            raise ValueError("progress cannot exceed its total")
        return self


class VariantProgress(StateModel):
    """How far one side of a concurrent comparison has got."""

    variant: Literal["baseline", "candidate"]
    completed: int = Field(ge=0)
    total: int = Field(ge=0)
    running: int = Field(ge=0)
    errored: int = Field(ge=0)
    state: Literal["pending", "running", "completed", "failed", "cancelled"]


class RunFailure(ProtocolModel):
    """The machine-safe projection of the failure that ended a run."""

    code: NonEmptyString
    message: NonEmptyString
    details: dict[str, JsonValue]


class RunState(StateModel):
    """What is currently true of a run, rewritten as it advances."""

    run_id: NonEmptyString
    phase: RunPhase
    sequence: int = Field(ge=0)
    updated_at: UtcDateTime
    worker_pid: int | None
    worker_started_at: UtcDateTime | None
    heartbeat_at: UtcDateTime | None
    cancel_requested_at: UtcDateTime | None
    error: RunFailure | None
    progress: RunProgress | None
    variant_progress: dict[str, VariantProgress] = Field(default_factory=dict)
    result_digest: Digest | None


class RunStatus(ProtocolModel):
    """A run's state plus the liveness facts only the host can determine."""

    state: RunState
    worker_alive: bool
    heartbeat_stale: bool
    result_available: bool
