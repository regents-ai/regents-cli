"""The public wrapper around a Campaign, and the resolved graph behind it.

A Climb holds a digest of the Campaign and nothing of its contents. A Climb that promises what
its DataPolicy forbids is not malformed, it lies, so that is a `PolicyError`.
"""

from __future__ import annotations

from typing import Literal, Self

from pydantic import Field, model_validator

from regents_cli.techtree.errors import PolicyError
from regents_cli.techtree.models.base import Digest, NonEmptyString, ProtocolModel, UtcDateTime
from regents_cli.techtree.models.campaign import CampaignSpecV2
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.validation import TasksetValidationReceipt


class CandidateConstraints(ProtocolModel):
    """How many Skills a candidate submits, and in which format."""

    min_skills: int = Field(ge=0)
    max_skills: int = Field(ge=1)
    format: Literal["techtree-instruction-skill-v1"]

    @model_validator(mode="after")
    def _check_bounds(self) -> Self:
        if self.min_skills > self.max_skills:
            raise ValueError("min_skills cannot exceed max_skills")
        return self


class CandidatePolicy(ProtocolModel):
    """What participants submit and whether it becomes public."""

    required_mutation: Literal["skill_insertion"]
    skill_visibility: Literal["public", "private"]
    constraints: CandidateConstraints


class PublicationPolicy(ProtocolModel):
    """What Techtree publishes about a completed run."""

    report_visibility: Literal["public", "private"]
    raw_episode_visibility: Literal["private", "prohibited"]
    public_trace_projection: Literal["redacted", "none"]
    proof_grade: Literal["development_only", "P1"]


class LeaderboardPolicy(ProtocolModel):
    """Whether results are ranked publicly, and on what evidence."""

    enabled: bool
    evidence_required: Literal["not_required", "complete", "complete_or_partial"]


class ClimbMetadata(ProtocolModel):
    """Public identity and schedule."""

    id: NonEmptyString
    slug: NonEmptyString
    version: int = Field(ge=1)
    title: NonEmptyString
    summary: NonEmptyString
    status: Literal["open", "closed", "development"]
    opens_at: UtcDateTime | None = None
    closes_at: UtcDateTime | None = None

    @model_validator(mode="after")
    def _check_window(self) -> Self:
        if (
            self.opens_at is not None
            and self.closes_at is not None
            and self.closes_at <= self.opens_at
        ):
            raise ValueError("closes_at must be after opens_at")
        return self


class ClimbManifest(ProtocolModel):
    """A public invitation to run one Campaign."""

    schema_version: Literal["techtree.climb.v1alpha1"]
    kind: Literal["Climb"]
    metadata: ClimbMetadata
    campaign_spec_digest: Digest
    candidate_policy: CandidatePolicy
    publication: PublicationPolicy
    leaderboard: LeaderboardPolicy

    @model_validator(mode="after")
    def _check_leaderboard_matches_proof_grade(self) -> Self:
        if self.publication.proof_grade == "development_only" and self.leaderboard.enabled:
            raise ValueError("a development_only Climb cannot enable a leaderboard")
        return self


def check_climb_policy_consistency(climb: ClimbManifest, data_policy: DataPolicy) -> None:
    """Raise `PolicyError` when a Climb promises what its DataPolicy forbids."""
    candidate = climb.candidate_policy
    publication = climb.publication
    derived = data_policy.derived_artifacts
    skill_release = data_policy.candidate_skill.public_release

    if candidate.skill_visibility == "public" and skill_release == "prohibited":
        raise PolicyError(
            "the Climb publishes candidate skills but the DataPolicy prohibits releasing them",
            details={
                "skill_visibility": candidate.skill_visibility,
                "candidate_skill_public_release": skill_release,
            },
        )
    if candidate.skill_visibility == "private" and skill_release == "required_for_climb":
        raise PolicyError(
            "the DataPolicy requires candidate skills to be released but the Climb keeps "
            "them private",
            details={
                "skill_visibility": candidate.skill_visibility,
                "candidate_skill_public_release": skill_release,
            },
        )
    if publication.report_visibility == "public" and derived.uplift_report != "public":
        raise PolicyError(
            "the Climb publishes the uplift report but the DataPolicy does not make it public",
            details={
                "report_visibility": publication.report_visibility,
                "uplift_report": derived.uplift_report,
            },
        )
    if (
        publication.public_trace_projection == "redacted"
        and derived.redacted_trace_projection != "public"
    ):
        raise PolicyError(
            "the Climb publishes a redacted trace projection but the DataPolicy does not "
            "make it public",
            details={
                "public_trace_projection": publication.public_trace_projection,
                "redacted_trace_projection": derived.redacted_trace_projection,
            },
        )
    if (
        publication.raw_episode_visibility == "private"
        and data_policy.raw_episodes.local_retention == "prohibited"
    ):
        raise PolicyError(
            "the Climb keeps raw episodes privately visible but the DataPolicy prohibits "
            "retaining them at all",
            details={
                "raw_episode_visibility": publication.raw_episode_visibility,
                "local_retention": data_policy.raw_episodes.local_retention,
            },
        )


class ResolvedClimb(ProtocolModel):
    """A Climb with every object it points at, loaded and cross-checked."""

    climb: ClimbManifest
    climb_digest: Digest
    campaign: CampaignSpecV2
    campaign_digest: Digest
    data_policy: DataPolicy
    data_policy_digest: Digest
    publisher_validation: TasksetValidationReceipt
    publisher_validation_digest: Digest
    execution_plan: ResolvedExecutionPlan
    execution_plan_digest: Digest

    @model_validator(mode="after")
    def _check_graph(self) -> Self:
        """Reject a graph whose edges do not point where its objects say."""
        if self.climb.campaign_spec_digest != self.campaign_digest:
            raise ValueError("the Climb references a different Campaign than the one resolved")
        if self.campaign.data_policy_digest != self.data_policy_digest:
            raise ValueError("the Campaign references a different DataPolicy than the one resolved")
        if self.campaign.taskset.validation_receipt_digest != self.publisher_validation_digest:
            raise ValueError("the Campaign references a different validation receipt")
        if self.campaign.execution_plan_digest != self.execution_plan_digest:
            raise ValueError("the Campaign binds a different execution plan than the one resolved")

        mutation = self.campaign.mutation_contract
        candidate = self.climb.candidate_policy
        if candidate.required_mutation != mutation.kind:
            raise ValueError("the Climb requires a different mutation than the Campaign defines")
        if (
            candidate.constraints.min_skills != mutation.minimum_skills
            or candidate.constraints.max_skills != mutation.maximum_skills
        ):
            raise ValueError("the Climb candidate constraints do not match the mutation bounds")

        check_climb_policy_consistency(self.climb, self.data_policy)
        return self
