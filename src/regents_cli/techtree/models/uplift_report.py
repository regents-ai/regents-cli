"""The result of one comparison: did the candidate satisfy the comparison contract?

The five statuses are separate on purpose; collapsing them would make a caller guess which of
five things one word referred to. Whether to deploy the result is not answered here.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal, Self

from pydantic import Field, model_validator

from regents_cli.techtree.models.base import Digest, NonEmptyString, ProtocolModel, UtcDateTime
from regents_cli.techtree.models.campaign import ModelAccess, ProgramRef, PublicContext
from regents_cli.techtree.models.episode_receipt import (
    EvidenceStatus,
    ExecutionLocation,
    ScoreStatus,
)
from regents_cli.techtree.models.experiment import ManifestComparison


class ExecutionStatus(StrEnum):
    """How the run itself ended."""

    COMPLETED = "completed"
    PARTIAL = "partial"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ComparisonStatus(StrEnum):
    """Whether the two variants differed only where permitted."""

    PENDING = "pending"
    CONTROLLED = "controlled"
    CONTROLLED_WITH_WARNINGS = "controlled_with_warnings"
    INVALID = "invalid"
    DEVELOPMENT_ONLY = "development_only"


class PublicationStatus(StrEnum):
    """Where the report stands with respect to being published."""

    NOT_REQUESTED = "not_requested"
    BLOCKED = "blocked"
    PENDING = "pending"
    PUBLISHED = "published"
    FAILED = "failed"


class UpliftDecision(StrEnum):
    """The verdict on the scientific comparison contract."""

    ACCEPTED = "accepted"
    REJECTED = "rejected"
    INCONCLUSIVE = "inconclusive"
    INVALID = "invalid"
    DEVELOPMENT_ONLY = "development_only"


class TaskDelta(ProtocolModel):
    """What one task contributed to the comparison: each side's score under the Campaign's
    rubric, the weighted total of its rewards."""

    task_hash: Digest
    baseline_reward: float
    candidate_reward: float
    delta: float


class PrimaryUpliftResult(ProtocolModel):
    """The headline comparison: the mean task score under the Campaign's rubric, per side."""

    baseline_mean: float
    candidate_mean: float
    absolute_delta: float
    relative_delta: float | None
    wins: int = Field(ge=0)
    losses: int = Field(ge=0)
    ties: int = Field(ge=0)


class EndingCounts(ProtocolModel):
    """How one side's tries ended, one count per ending."""

    completed: int = Field(ge=0)
    token_limit: int = Field(ge=0)
    call_limit: int = Field(ge=0)
    timeout: int = Field(ge=0)

    @property
    def total(self) -> int:
        return self.completed + self.token_limit + self.call_limit + self.timeout


#: Where a run's cost comes from: what Prime reported, in dollars, on the person's own key; or
#: the person's ChatGPT plan, which counts tokens and gives no dollar figure.
CostProvenance = Literal["provider_reported", "plan_included"]

COST_PROVENANCE: dict[ModelAccess, CostProvenance] = {
    "prime_key": "provider_reported",
    "chatgpt_plan": "plan_included",
}


class UpliftStatuses(ProtocolModel):
    """The five independent statuses of a report."""

    execution: ExecutionStatus
    score: ScoreStatus
    evidence: EvidenceStatus
    comparison: ComparisonStatus
    publication: PublicationStatus


class UpliftReportV3(ProtocolModel):
    """The complete result of one baseline-versus-candidate comparison."""

    schema_version: Literal["techtree.uplift-report.v3"]
    id: NonEmptyString
    run_id: NonEmptyString
    campaign_spec_digest: Digest
    program_ref: ProgramRef | None
    public_context: PublicContext | None
    data_policy_digest: Digest
    outcome_contract_digest: Digest | None
    execution_plan_digest: Digest
    execution_location: ExecutionLocation
    taskset_validation_receipt_digest: Digest
    baseline_manifest_digest: Digest
    candidate_manifest_digest: Digest
    statuses: UpliftStatuses
    manifest_comparison: ManifestComparison
    primary_result: PrimaryUpliftResult
    task_deltas: list[TaskDelta]
    #: The one route both sides reached the subject model by.
    access: ModelAccess
    cost_provenance: CostProvenance
    baseline_endings: EndingCounts
    candidate_endings: EndingCounts
    decision: UpliftDecision
    proof_grade: Literal["development_only", "P1"]
    publication_eligible: bool
    #: The published Result this one reruns: same Campaign, same Skill, new runs. A rerun is
    #: a report from someone's own machine, never independent reproduction.
    rerun_of: Digest | None
    created_at: UtcDateTime

    @model_validator(mode="after")
    def _check_report_cannot_overclaim(self) -> Self:
        """Keep a report from claiming more than its own fields support."""
        development_only = self.proof_grade == "development_only"
        if development_only and self.decision is not UpliftDecision.DEVELOPMENT_ONLY:
            raise ValueError("a development_only report reaches a development_only decision")
        if development_only and self.publication_eligible:
            raise ValueError("a development_only report is never publication eligible")
        if self.publication_eligible and self.statuses.publication is PublicationStatus.BLOCKED:
            raise ValueError("a report cannot be publication eligible while publication is blocked")
        if self.baseline_manifest_digest == self.candidate_manifest_digest:
            raise ValueError("a report compares two different manifests")
        if self.cost_provenance != COST_PROVENANCE[self.access]:
            raise ValueError(
                f"a run on the {self.access} route has {COST_PROVENANCE[self.access]} cost"
            )
        for side, endings in (
            ("baseline", self.baseline_endings),
            ("candidate", self.candidate_endings),
        ):
            if endings.total != len(self.task_deltas):
                raise ValueError(f"the {side} side counts an ending for each of its tries")
        return self
