"""What one scored episode produced, and where the work ran."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal, Self

from pydantic import model_validator

from regents_cli.techtree.models.base import ArtifactRef, Digest, NonEmptyString, ProtocolModel
from regents_cli.techtree.models.campaign import ProgramRef, PublicContext
from regents_cli.techtree.models.experiment import ExperimentVariant
from regents_cli.techtree.models.run import ExecutorKind


class ExecutionLocation(ProtocolModel):
    """The proof's location facet: this build runs on the participant's machine."""

    kind: Literal["local"]


class ScoreStatus(StrEnum):
    """How much weight the recorded reward carries."""

    PENDING = "pending"
    VALID = "valid"
    INVALID = "invalid"
    ERRORED = "errored"
    MISSING = "missing"
    DEVELOPMENT_ONLY = "development_only"


class EvidenceStatus(StrEnum):
    """How complete the supporting evidence is."""

    NOT_COLLECTED = "not_collected"
    COMPLETE = "complete"
    PARTIAL = "partial"
    INVALID = "invalid"
    DEVELOPMENT_ONLY = "development_only"


class NamedTraceReceipt(ProtocolModel):
    """One named trace within an episode."""

    role: NonEmptyString
    trace_id: NonEmptyString
    trace_digest: Digest
    task_hash: Digest
    rewards: dict[str, float]
    metrics: dict[str, float | None]
    ok: bool


class SubjectRuntimeReceipt(ProtocolModel):
    """Where the subject agent actually executed, if it executed."""

    kind: Literal["not_executed", "docker"]
    resolved_image_digest: Digest | None = None
    #: The image the episode was graded in, when grading happened in a box of its own.
    grader_image_digest: Digest | None = None
    platform: NonEmptyString | None = None

    @model_validator(mode="after")
    def _check_runtime_evidence_matches_kind(self) -> Self:
        if self.kind == "not_executed" and (
            self.resolved_image_digest is not None
            or self.grader_image_digest is not None
            or self.platform is not None
        ):
            raise ValueError("an episode that did not execute a runtime cannot report one")
        if self.kind == "docker" and self.resolved_image_digest is None:
            raise ValueError("a docker episode records the image digest it ran")
        return self


class EpisodeReceiptV3(ProtocolModel):
    """The complete record of one scored episode."""

    schema_version: Literal["techtree.episode-receipt.v3"]
    id: NonEmptyString
    run_id: NonEmptyString
    campaign_spec_digest: Digest
    program_ref: ProgramRef | None
    public_context: PublicContext | None
    data_policy_digest: Digest
    outcome_contract_digest: Digest | None
    execution_plan_digest: Digest
    execution_location: ExecutionLocation
    subject_runtime: SubjectRuntimeReceipt
    variant: ExperimentVariant
    experiment_manifest_digest: Digest
    episode_id: NonEmptyString
    episode_digest: Digest
    task_hash: Digest
    named_traces: dict[str, list[NamedTraceReceipt]]
    score_status: ScoreStatus
    evidence_status: EvidenceStatus
    executor_kind: ExecutorKind
    artifacts: list[ArtifactRef]
