"""The scientific execution contract every execution artifact points at.

A Campaign is a commitment: the task membership is fixed and hashed before anything runs,
`shuffle` cannot be spelled `True`, and the only difference a candidate may introduce is the
subject's Skill list. Nothing public (slug, schedule, leaderboard) lives here.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from enum import StrEnum
from typing import Annotated, Final, Literal, NamedTuple, Self

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
_HUB_NAME_PATTERN: Final = r"^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$"


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


class EmbeddedPackageRef(ProtocolModel):
    """A taskset package shipped inside the engine bundle; `digest` is its source tree's."""

    kind: Literal["embedded"]
    name: NonEmptyString
    revision: NonEmptyString
    digest: Digest


class HubPackageRef(ProtocolModel):
    """A taskset package published on the Prime Environments Hub.

    `name` is the Hub's `owner/environment`, `revision` the Hub's full content hash for this
    publication, and `digest` the sha256 of the exact wheel at `artifact_url`. The version
    string alone is not an identity: the Hub lets an owner publish the same version twice.
    """

    kind: Literal["hub"]
    name: Annotated[str, Field(pattern=_HUB_NAME_PATTERN)]
    version: NonEmptyString
    revision: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    digest: Digest
    artifact_url: Annotated[str, Field(pattern=r"^https://hub\.primeintellect\.ai/\S+\.whl$")]

    @property
    def distribution(self) -> str:
        """The Python distribution the wheel installs: the Hub name without its owner."""
        return self.name.split("/", 1)[1]


PackageRef = Annotated[EmbeddedPackageRef | HubPackageRef, Field(discriminator="kind")]


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
    """The taskset, the slice of it that is used, its validation receipt, and, when each task
    brings its own images, those images in membership order."""

    ref: TasksetRef
    selection: TaskSelection
    membership: TaskMembershipCommitment
    validation_receipt_digest: Digest
    task_images: list[TaskImages] | None

    @model_validator(mode="after")
    def _check_membership_matches_selection(self) -> Self:
        committed = len(self.membership.ordered_task_hashes)
        if committed != self.selection.num_tasks:
            raise ValueError(
                f"membership commits {committed} tasks but the selection asks for "
                f"{self.selection.num_tasks}"
            )
        if self.task_images is not None:
            pinned = [entry.task_hash for entry in self.task_images]
            if pinned != self.membership.ordered_task_hashes:
                raise ValueError(
                    "task_images must list every committed task once, in membership order"
                )
            task_ids = [entry.task_id for entry in self.task_images]
            if len(set(task_ids)) != len(task_ids):
                raise ValueError("task_images must not repeat a task id")
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


#: The reasoning efforts a subject model can be asked for, as Prime names them.
ReasoningEffort = Literal["none", "low", "medium", "high", "xhigh", "max"]


class SamplingSpec(ProtocolModel):
    """How the subject model is sampled. A null setting is never sent, so the provider's own
    default applies: a model with no temperature setting has a null temperature."""

    temperature: float | None = Field(ge=0.0, le=2.0)
    max_tokens: int = Field(ge=1)
    reasoning_effort: ReasoningEffort | None


def _require_content_reference(image: str) -> None:
    if _IMAGE_INDEX_DIGEST_RE.search(image) is None:
        raise ValueError(f"image must name content, as repository@sha256:...; got {image!r}")


def _require_platforms_pinned(
    label: str, platform_digests: Mapping[str, Digest], supported_platforms: list[str]
) -> None:
    declared = sorted(platform_digests)
    supported = sorted(supported_platforms)
    if declared != supported:
        raise ValueError(
            f"{label} must name exactly the supported platforms; it names {declared} for "
            f"{supported}"
        )


class PinnedImage(ProtocolModel):
    """One image pinned twice: `image` names an OCI index by digest, and `platform_digests`
    names the manifest that index resolves to per platform, because two hosts pulling the same
    index run different bytes and a comparison has to say which."""

    image: NonEmptyString
    platform_digests: dict[NonEmptyString, Digest]

    @property
    def index_digest(self) -> Digest:
        """The content the pinned reference names."""
        match = _IMAGE_INDEX_DIGEST_RE.search(self.image)
        assert match is not None  # the validator below refuses anything else
        return match.group(1)

    @model_validator(mode="after")
    def _check_the_image_names_content(self) -> Self:
        _require_content_reference(self.image)
        return self


class TaskImages(ProtocolModel):
    """The two images one task runs on: the agent works in one, a fresh box of the other grades."""

    task_hash: Digest
    task_id: NonEmptyString
    agent: PinnedImage
    grader: PinnedImage


class _RuntimeBase(ProtocolModel):
    type: Literal["docker"]
    supported_platforms: list[NonEmptyString]
    cpu: PositiveFloat | None
    memory_gb: PositiveFloat | None
    network_policy: Literal["restricted", "open"]

    @model_validator(mode="after")
    def _check_platforms(self) -> Self:
        if not self.supported_platforms:
            raise ValueError("a runtime must support at least one platform")
        if len(set(self.supported_platforms)) != len(self.supported_platforms):
            raise ValueError("supported_platforms must not repeat a platform")
        return self


class CampaignImageRuntime(_RuntimeBase):
    """Every task runs in the one image the Campaign pins."""

    image_source: Literal["campaign"]
    image: NonEmptyString
    image_platform_digests: dict[NonEmptyString, Digest]

    @property
    def pinned_image(self) -> PinnedImage:
        return PinnedImage(image=self.image, platform_digests=self.image_platform_digests)

    @model_validator(mode="after")
    def _check_the_image_is_pinned_for_every_platform(self) -> Self:
        _require_content_reference(self.image)
        _require_platforms_pinned(
            "image_platform_digests", self.image_platform_digests, self.supported_platforms
        )
        return self


class TaskImageRuntime(_RuntimeBase):
    """Each task runs in its own images, pinned in the Campaign's `taskset.task_images`."""

    image_source: Literal["task"]


#: Where the subject agent executes, and where its image comes from.
RuntimeSpec = Annotated[
    CampaignImageRuntime | TaskImageRuntime, Field(discriminator="image_source")
]


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


#: The engine's name for the subject's seat in each environment. Techtree calls the role
#: "subject" everywhere; the engine's Harbor environment and Verifiers' own single-agent
#: environment name their one seat "agent".
ENGINE_SEATS: Final[dict[str, str]] = {
    "single-agent": "subject",
    "harbor-separate-grader": "agent",
    "verifiers-single-agent": "agent",
}


class EnvironmentSpec(ProtocolModel):
    """The interaction shape the Campaign runs in.

    `harbor-separate-grader`: the agent works in its task's agent image, then a fresh box from
    the task's grader image grades only the files the task lists, under the limits and network
    the task itself declares.

    `verifiers-single-agent`: Verifiers' own single-agent environment, the one a published
    taskset that brings no environment of its own runs in; one image for every task.
    """

    id: Literal["single-agent", "harbor-separate-grader", "verifiers-single-agent"]

    @property
    def engine_seat(self) -> str:
        """The seat the engine runs the subject in."""
        return ENGINE_SEATS[self.id]


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
    """The two variants run side by side; max_concurrent is divided between them."""

    PARALLEL = "parallel_variants"


class ExecutionSpec(ProtocolModel):
    """How the two variants are executed against each other."""

    order: VariantSchedule
    max_concurrent: int = Field(ge=1)
    timeout_seconds: int = Field(ge=1)
    retry_limit: int = Field(ge=0)


class RubricReward(ProtocolModel):
    """One reward the environment scores, and the weight its scorer gives it."""

    name: NonEmptyString
    weight: float = Field(allow_inf_nan=False)


class Rubric(ProtocolModel):
    """The environment's own scorer, recorded as it scores.

    A task's score is the scorer's own aggregation: the sum of every reward's score times its
    weight, which is what Verifiers reports as an episode's reward. `scorer_digest` is the
    taskset package the rewards are defined in. Rewards are listed once each, by name.
    """

    rewards: list[RubricReward] = Field(min_length=1)
    scorer_digest: Digest

    @model_validator(mode="after")
    def _check_rewards_are_listed_once_in_name_order(self) -> Self:
        names = [reward.name for reward in self.rewards]
        if names != sorted(set(names)):
            raise ValueError("a rubric lists each reward once, in name order")
        return self

    @property
    def weights(self) -> dict[str, float]:
        return {reward.name: reward.weight for reward in self.rewards}


class ScoringSpec(ProtocolModel):
    """How each task is scored, and what counts as an improvement across them."""

    rubric: Rubric
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


class CampaignSpecV3(ProtocolModel):
    """A Campaign that binds exactly one resolved execution plan by digest."""

    schema_version: Literal["techtree.campaign.v3"]
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
        check_images(self.environment, self.subject.runtime, self.taskset)
        if self.scoring.rubric.scorer_digest != self.taskset.ref.package.digest:
            raise ValueError("the rubric's scorer is the taskset package the Campaign pins")
        return self


def check_images(
    environment: EnvironmentSpec, runtime: RuntimeSpec, taskset: CampaignTaskset
) -> None:
    """Hold the environment, the runtime's image source and the task images to one story."""
    separate_grader = environment.id == "harbor-separate-grader"
    if separate_grader != isinstance(runtime, TaskImageRuntime):
        raise ValueError(
            "the harbor-separate-grader environment runs each task in its own images, and only "
            "it does: it pairs with image_source 'task'"
        )
    if isinstance(runtime, CampaignImageRuntime):
        if taskset.task_images is not None:
            raise ValueError("a runtime with image_source 'campaign' takes no task_images")
        return
    if taskset.task_images is None:
        raise ValueError("a runtime with image_source 'task' needs taskset.task_images")
    for entry in taskset.task_images:
        for role, pinned in (("agent", entry.agent), ("grader", entry.grader)):
            _require_platforms_pinned(
                f"the {role} image of {entry.task_id}",
                pinned.platform_digests,
                runtime.supported_platforms,
            )


class TaskImagePins(NamedTuple):
    """One committed task's images; a Campaign-image runtime grades in the agent's own box."""

    task_hash: Digest
    agent: PinnedImage
    grader: PinnedImage | None


def pinned_task_images(runtime: RuntimeSpec, taskset: CampaignTaskset) -> list[TaskImagePins]:
    """Each committed task's agent image and grader image, in membership order."""
    if isinstance(runtime, CampaignImageRuntime):
        image = runtime.pinned_image
        return [
            TaskImagePins(task_hash, image, None)
            for task_hash in taskset.membership.ordered_task_hashes
        ]
    assert taskset.task_images is not None  # check_images guarantees it
    return [
        TaskImagePins(entry.task_hash, entry.agent, entry.grader) for entry in taskset.task_images
    ]
