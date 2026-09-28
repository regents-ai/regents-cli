"""The scientific execution contract every execution artifact points at.

A Campaign is a commitment: the task membership is fixed and hashed before anything runs,
`shuffle` cannot be spelled `True`, and the only difference a candidate may introduce is the
subject's Skill list. Nothing public (slug, schedule, leaderboard) lives here.
"""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Final, Literal, Self

from pydantic import Field, PositiveFloat, PositiveInt, model_validator

from regents_cli.techtree.models.base import (
    ArtifactRef,
    Digest,
    JsonValue,
    NonEmptyString,
    ProtocolModel,
)

#: The only agent name the protocol defines.
SUBJECT_AGENT: Final = "subject"

#: The single JSON Pointer a candidate is allowed to differ at.
SKILL_MUTATION_POINTER: Final = "/agents/subject/harness/skills"

#: A credential is named, never carried: the name must look like an environment variable.
CREDENTIAL_ENV_PATTERN: Final = r"^[A-Z][A-Z0-9_]{2,63}$"

_CREDENTIAL_ENV_RE = re.compile(CREDENTIAL_ENV_PATTERN)
_IMAGE_INDEX_DIGEST_RE = re.compile(r"@(sha256:[0-9a-f]{64})$")


class ProgramRef(ProtocolModel):
    """A reserved pointer at a future ImprovementProgram."""

    id: NonEmptyString
    version: int = Field(ge=1)


class PublicContext(ProtocolModel):
    """The optional public Climb an execution artifact was produced under."""

    kind: Literal["climb"]
    climb_digest: Digest


class CampaignContext(ProtocolModel):
    """Forward-compatible pointers a Campaign may carry."""

    program_ref: ProgramRef | None = None
    outcome_contract_digest: Digest | None = None


class PackageRef(ProtocolModel):
    """The source package a taskset is defined in."""

    kind: Literal["embedded", "git", "hub"]
    name: NonEmptyString
    revision: NonEmptyString
    digest: Digest


class TasksetRef(ProtocolModel):
    """Which taskset, from which package, with which configuration."""

    kind: Literal["verifiers"]
    id: NonEmptyString
    package: PackageRef
    config: dict[str, JsonValue]


class TaskSelection(ProtocolModel):
    """How many tasks and rollouts; never shuffled, because no seed exists to reproduce one."""

    num_tasks: int = Field(ge=1)
    num_rollouts: int = Field(ge=1)
    shuffle: Literal[False]


class TaskMembershipCommitment(ProtocolModel):
    """The exact tasks a Campaign is fixed to, committed in order."""

    mode: Literal["committed"]
    ordered_task_hashes: list[Digest]
    membership_digest: Digest

    @model_validator(mode="after")
    def _check_membership_is_a_usable_commitment(self) -> Self:
        if not self.ordered_task_hashes:
            raise ValueError("a committed membership must list at least one task")
        if len(set(self.ordered_task_hashes)) != len(self.ordered_task_hashes):
            raise ValueError("committed task hashes must be unique")
        return self


class CampaignTaskset(ProtocolModel):
    """The taskset, the slice of it that is used, and its validation receipt."""

    ref: TasksetRef
    selection: TaskSelection
    membership: TaskMembershipCommitment
    validation_receipt_digest: Digest

    @model_validator(mode="after")
    def _check_membership_matches_selection(self) -> Self:
        committed = len(self.membership.ordered_task_hashes)
        if committed != self.selection.num_tasks:
            raise ValueError(
                f"membership commits {committed} tasks but the selection asks for "
                f"{self.selection.num_tasks}"
            )
        return self


class ModelSpec(ProtocolModel):
    """Which model answers, and the environment variable holding its key."""

    provider: NonEmptyString
    model_id: NonEmptyString
    revision: NonEmptyString | None
    credential_env: NonEmptyString

    @model_validator(mode="after")
    def _check_credential_env_is_a_name(self) -> Self:
        if _CREDENTIAL_ENV_RE.fullmatch(self.credential_env) is None:
            raise ValueError(
                "credential_env must be an uppercase environment-variable name such as "
                "TECHTREE_MODEL_API_KEY, never a credential value"
            )
        return self


class SamplingSpec(ProtocolModel):
    """How the subject model is sampled."""

    temperature: float = Field(ge=0.0, le=2.0)
    max_tokens: int = Field(ge=1)


class RuntimeSpec(ProtocolModel):
    """Where the subject agent executes.

    The image is pinned twice: `image` names an OCI index by digest, and `image_platform_digests`
    names the manifest that index resolves to per platform, because two hosts pulling the same
    index run different bytes and a comparison has to say which.
    """

    type: Literal["docker"]
    image: NonEmptyString
    supported_platforms: list[NonEmptyString]
    image_platform_digests: dict[NonEmptyString, Digest]
    cpu: PositiveFloat | None
    memory_gb: PositiveFloat | None
    network_policy: Literal["restricted", "open"]

    @property
    def image_index_digest(self) -> Digest:
        """The content the pinned reference names."""
        match = _IMAGE_INDEX_DIGEST_RE.search(self.image)
        assert match is not None  # the validator below refuses anything else
        return match.group(1)

    @model_validator(mode="after")
    def _check_the_image_is_pinned_for_every_platform(self) -> Self:
        if not self.supported_platforms:
            raise ValueError("a runtime must support at least one platform")
        if len(set(self.supported_platforms)) != len(self.supported_platforms):
            raise ValueError("supported_platforms must not repeat a platform")
        if _IMAGE_INDEX_DIGEST_RE.search(self.image) is None:
            raise ValueError(
                f"image must name content, as repository@sha256:...; got {self.image!r}"
            )
        declared = sorted(self.image_platform_digests)
        supported = sorted(self.supported_platforms)
        if declared != supported:
            raise ValueError(
                "image_platform_digests must name exactly the supported platforms; it names "
                f"{declared} for {supported}"
            )
        return self


class HarnessSpecV2(ProtocolModel):
    """The Skills inserted into the subject harness; which harness is the plan's subject plane."""

    use_bundled_skill: bool
    skills: list[ArtifactRef]


class AgentSpecV2(ProtocolModel):
    """One named agent, complete."""

    model: ModelSpec
    sampling: SamplingSpec
    harness: HarnessSpecV2
    runtime: RuntimeSpec
    trainable: bool


class EnvironmentSpec(ProtocolModel):
    """The interaction shape the Campaign runs in."""

    id: Literal["single-agent"]


class MutationKind(StrEnum):
    """Which shape of Skill change the candidate makes."""

    SKILL_INSERTION = "skill_insertion"
    SKILL_REPLACEMENT = "skill_replacement"


class MutationContract(ProtocolModel):
    """What a candidate is allowed to change, and by how much."""

    kind: MutationKind
    target_agent: Literal["subject"]
    allowed_differences: list[NonEmptyString]
    minimum_skills: int = Field(ge=0)
    maximum_skills: int = Field(ge=1)

    @model_validator(mode="after")
    def _check_bounds_and_pointer(self) -> Self:
        if self.minimum_skills > self.maximum_skills:
            raise ValueError("minimum_skills cannot exceed maximum_skills")
        if self.allowed_differences != [SKILL_MUTATION_POINTER]:
            raise ValueError(f"the only allowed difference is exactly [{SKILL_MUTATION_POINTER!r}]")
        return self


class VariantSchedule(StrEnum):
    """Whether the two variants run one after the other or side by side."""

    SEQUENTIAL = "baseline_then_candidate"
    PARALLEL = "parallel_variants"


class ExecutionSpec(ProtocolModel):
    """How the two variants are executed against each other."""

    order: VariantSchedule
    max_concurrent: int = Field(ge=1)
    timeout_seconds: int = Field(ge=1)
    retry_limit: int = Field(ge=0)


class ScoringSpec(ProtocolModel):
    """Which reward decides the comparison, and what counts as an improvement."""

    primary_reward: NonEmptyString
    aggregation: Literal["mean"]
    require_candidate_above_baseline: bool
    minimum_absolute_delta: float = Field(ge=0.0)


class EvidenceRequirementsV2(ProtocolModel):
    """Whether the subject's runtime must be receipted; native evidence is the plan's plane."""

    runtime_evidence: Literal["not_required", "optional", "required"]


class BudgetSpec(ProtocolModel):
    """Optional ceilings on what a run may consume."""

    maximum_input_tokens: PositiveInt | None = None
    maximum_output_tokens: PositiveInt | None = None
    maximum_model_calls: PositiveInt | None = None
    maximum_usd: PositiveFloat | None = None


class CampaignMetadata(ProtocolModel):
    """Identity and intent. Nothing public, nothing presentational."""

    id: NonEmptyString
    version: int = Field(ge=1)
    purpose: Literal[
        "component_uplift",
        "baseline",
        "release_assurance",
        "environment_validation",
        "reproduction",
    ]


class CampaignSpecV2(ProtocolModel):
    """A Campaign that binds exactly one resolved execution plan by digest."""

    schema_version: Literal["techtree.campaign.v2"]
    kind: Literal["Campaign"]
    metadata: CampaignMetadata
    context: CampaignContext
    taskset: CampaignTaskset
    environment: EnvironmentSpec
    agents: dict[str, AgentSpecV2]
    mutation_contract: MutationContract
    execution: ExecutionSpec
    scoring: ScoringSpec
    evidence: EvidenceRequirementsV2
    budgets: BudgetSpec
    data_policy_digest: Digest
    execution_plan_digest: Digest

    @property
    def subject(self) -> AgentSpecV2:
        return self.agents[SUBJECT_AGENT]

    @model_validator(mode="after")
    def _check_the_comparison_is_controlled(self) -> Self:
        """The Campaign describes the baseline, so its Skill list follows from the mutation kind."""
        if self.taskset.selection.num_rollouts != 1:
            raise ValueError("one rollout is scored per task; num_rollouts must be 1")
        if self.mutation_contract.target_agent != SUBJECT_AGENT:
            raise ValueError("the mutation contract must target the subject agent")
        if set(self.agents) != {SUBJECT_AGENT}:
            raise ValueError(
                f"a Campaign defines exactly one agent named {SUBJECT_AGENT!r}; "
                f"got {sorted(self.agents)}"
            )
        skills = len(self.subject.harness.skills)
        if self.mutation_contract.kind is MutationKind.SKILL_INSERTION:
            if skills:
                raise ValueError("a skill_insertion Campaign describes a baseline with no skills")
        elif skills != 1:
            raise ValueError(
                "a skill_replacement Campaign describes a baseline carrying exactly one skill "
                f"to replace; got {skills}"
            )
        if self.subject.harness.use_bundled_skill:
            raise ValueError("use_bundled_skill would be an uncontrolled second difference")
        if self.evidence.runtime_evidence != "not_required":
            raise ValueError("runtime evidence is not collected, so requiring it is unsatisfiable")
        return self
