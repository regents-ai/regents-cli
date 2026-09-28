"""The packaged catalog index, the Climb summary, and the compatibility verdict.

The index is generated, never hand-edited, and typed so a hand-edit is caught. `compatible` is
derived from the blocking issues rather than asserted beside them.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal, Self

from pydantic import Field, model_validator

from regents_cli.techtree.models.base import Digest, NonEmptyString, ProtocolModel
from regents_cli.techtree.models.skill import check_relative_posix_path


class CatalogClimbEntry(ProtocolModel):
    """One public Climb the package ships."""

    reference: NonEmptyString
    digest: Digest
    path: NonEmptyString

    @model_validator(mode="after")
    def _check_path(self) -> Self:
        check_relative_posix_path(self.path)
        return self


class CatalogObjectLocationV2(ProtocolModel):
    """Where one content-addressed object lives, and what kind it is."""

    kind: Literal[
        "campaign",
        "data_policy",
        "execution_plan",
        "taskset_validation",
        "validation_evidence",
    ]
    path: NonEmptyString
    media_type: NonEmptyString

    @model_validator(mode="after")
    def _check_path(self) -> Self:
        check_relative_posix_path(self.path)
        return self


class CatalogIndexV2(ProtocolModel):
    """The generated map of everything the package ships."""

    schema_version: Literal["techtree.catalog.v2"]
    climbs: list[CatalogClimbEntry]
    objects: dict[Digest, CatalogObjectLocationV2]

    @model_validator(mode="after")
    def _check_index_is_unambiguous(self) -> Self:
        """Reject repeated references, repeated digests, or shared paths."""
        references = [entry.reference for entry in self.climbs]
        if len(set(references)) != len(references):
            raise ValueError("each Climb reference appears once in the catalog")
        digests = [entry.digest for entry in self.climbs]
        if len(set(digests)) != len(digests):
            raise ValueError("each Climb digest appears once in the catalog")
        paths = [entry.path for entry in self.climbs]
        paths += [location.path for location in self.objects.values()]
        if len(set(paths)) != len(paths):
            raise ValueError("two catalog entries claim the same file")
        return self


class CompatibilityIssue(ProtocolModel):
    """One reason a Climb might not run here."""

    code: NonEmptyString
    severity: Literal["warning", "error"]
    message: NonEmptyString
    blocking: bool

    @model_validator(mode="after")
    def _check_blocking_implies_error(self) -> Self:
        if self.blocking and self.severity != "error":
            raise ValueError("a blocking issue is an error, not a warning")
        return self


class EngineCompatibilityStatus(StrEnum):
    """What is known about the required engine on this host."""

    UNKNOWN = "unknown"
    NOT_INSTALLED = "not_installed"
    INSTALLED_UNVERIFIED = "installed_unverified"
    VERIFIED = "verified"


class CompatibilityResultV2(ProtocolModel):
    """Whether this host can run this Campaign, and what stands in the way.

    `required_engine_digest` is the engine the publisher validated the taskset against, from the
    validation receipt; `evaluation_engine_digest` is the engine the plan pins. They are reported
    side by side because a host holding one and not the other has to be told.
    """

    compatible: bool
    host_platform: NonEmptyString
    host_supported: bool
    required_engine_digest: Digest
    engine_status: EngineCompatibilityStatus
    execution_plan_digest: Digest
    evaluation_engine_source_commit: NonEmptyString
    evaluation_engine_digest: Digest
    execution_backend_kind: Literal["local"]
    execution_backend_supported: bool
    subject_backend_kind: Literal["direct"]
    subject_backend_supported: bool
    issues: list[CompatibilityIssue]

    @model_validator(mode="after")
    def _check_compatibility_follows_from_the_issues(self) -> Self:
        blocking = any(issue.blocking for issue in self.issues)
        if self.compatible and blocking:
            raise ValueError("compatible is true only when no listed issue is blocking")
        if not self.compatible and not blocking:
            raise ValueError("an incompatible result must list the blocking issue")
        if len({issue.code for issue in self.issues}) != len(self.issues):
            raise ValueError("each compatibility issue is reported once")
        return self


class DataPolicySummary(ProtocolModel):
    """The four rights a participant most needs to see before starting."""

    raw_episode_server_upload: Literal["allowed", "prohibited", "consent_required"]
    raw_episode_training_use: Literal["allowed", "prohibited", "consent_required"]
    candidate_skill_public_release: Literal[
        "required_for_climb",
        "allowed",
        "prohibited",
        "consent_required",
    ]
    uplift_report_visibility: Literal["public", "private", "prohibited"]


class ClimbSummaryV2(ProtocolModel):
    """Everything `climb list` and `climb show` display, in one object."""

    reference: NonEmptyString
    climb_digest: Digest
    campaign_spec_digest: Digest
    title: NonEmptyString
    summary: NonEmptyString
    status: Literal["open", "closed", "development"]
    purpose: NonEmptyString
    taskset_id: NonEmptyString
    task_count: int = Field(ge=1)
    subject_harness: NonEmptyString
    subject_harness_version: NonEmptyString
    mutation_kind: Literal["skill_insertion"]
    candidate_skill_visibility: Literal["public", "private"]
    execution_backend_kind: Literal["local"]
    proof_grade: Literal["development_only", "P1"]
    data_policy: DataPolicySummary
    compatibility: CompatibilityResultV2
