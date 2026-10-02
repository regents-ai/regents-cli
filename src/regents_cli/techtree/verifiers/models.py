"""What one native Verifiers execution recorded, projected onto the fields a receipt may cite.

Nothing here is a protocol root: these describe one machine's execution of one Campaign and
are written into a run directory, never into the Campaign graph.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal, Self

from pydantic import Field, model_validator

from regents_cli.techtree.models.base import (
    ArtifactRef,
    Digest,
    JsonValue,
    NonEmptyString,
    ProtocolModel,
)
from regents_cli.techtree.models.campaign import VariantSchedule


class VariantName(StrEnum):
    """Which side of the comparison a child process is running."""

    BASELINE = "baseline"
    CANDIDATE = "candidate"


class ResolvedImage(ProtocolModel):
    """One pinned reference, and the content (the OCI index) the daemon holds for it."""

    image: NonEmptyString
    index_digest: Digest


class ImageResolution(ProtocolModel):
    """What the local daemon answered about every image a variant may start, asked before launch.

    One daemon serves every image on one platform; the platform-specific manifest digest is the
    Campaign's to pin.
    """

    variant: VariantName
    platform: NonEmptyString
    images: list[ResolvedImage]

    @model_validator(mode="after")
    def _check_each_image_once(self) -> Self:
        names = [entry.image for entry in self.images]
        if not names or names != sorted(set(names)):
            raise ValueError("a resolution lists each image once, sorted")
        return self

    def index_digest(self, image: str) -> Digest | None:
        return next((entry.index_digest for entry in self.images if entry.image == image), None)


class ChildProcessOutcome(ProtocolModel):
    """What one Verifiers child process did; argv by digest, so no command line is logged."""

    variant: VariantName
    argv_digest: Digest
    exit_code: int
    started_at: datetime
    finished_at: datetime
    stdout_artifact: ArtifactRef
    stderr_artifact: ArtifactRef
    cancelled: bool

    @model_validator(mode="after")
    def _check_the_clock_moves_forward(self) -> Self:
        if self.finished_at < self.started_at:
            raise ValueError("a child process cannot finish before it starts")
        return self


class NormalizedExecutionError(ProtocolModel):
    """One failure the engine's normalizer preserved; a traceback only for a real failure."""

    type: NonEmptyString
    message: str
    traceback: str | None = None


class NormalizedReward(ProtocolModel):
    """One reward as Verifiers scored it, with its weighted contribution."""

    name: NonEmptyString
    score: float
    weight: float
    value: float

    @model_validator(mode="after")
    def _check_every_number_is_finite(self) -> Self:
        for field, number in (
            ("score", self.score),
            ("weight", self.weight),
            ("value", self.value),
        ):
            if number != number or number in (float("inf"), float("-inf")):
                raise ValueError(f"reward {field} must be finite; got {number!r}")
        return self


class NormalizedUsage(ProtocolModel):
    """Token consumption for one trace; `cost_usd` only when the provider reported one."""

    input_tokens: int = Field(ge=0)
    output_tokens: int = Field(ge=0)
    total_tokens: int = Field(ge=0)
    cached_input_tokens: int | None = Field(default=None, ge=0)
    cost_usd: float | None = Field(default=None, ge=0.0)


class NormalizedTool(ProtocolModel):
    """One tool the subject was offered, by digest, so no prompt surface is republished."""

    name: NonEmptyString
    description_digest: Digest
    parameters_digest: Digest


class NormalizedRuntime(ProtocolModel):
    """The box one trace ran in; the image digest is the reference's, not the daemon's answer."""

    kind: Literal["docker"]
    runtime_id: str | None
    image: NonEmptyString
    image_index_digest: Digest
    cpu: float | None
    memory_gb: float | None


class NormalizedTrace(ProtocolModel):
    """One subject rollout, projected onto the fields a receipt may cite."""

    trace_id: NonEmptyString
    agent_role: Literal["subject"]
    task_hash: Digest
    ok: bool
    verifiers_version: NonEmptyString
    verifiers_revision: NonEmptyString
    model_id: NonEmptyString
    sampling: dict[str, JsonValue]
    harness_id: NonEmptyString
    harness_version: NonEmptyString
    use_bundled_skill: bool
    skill_root_digests: list[Digest]
    runtime: NormalizedRuntime
    #: The image a fresh grader box was started from; None when graded in the agent's box.
    grader_image: NonEmptyString | None
    tools: list[NormalizedTool]
    rewards: list[NormalizedReward]
    metrics: dict[str, float | None]
    usage: NormalizedUsage | None
    model_calls: int = Field(ge=0)
    num_turns: int = Field(ge=0)
    last_reply: str | None
    errors: list[NormalizedExecutionError]
    raw_trace_digest: Digest

    @model_validator(mode="after")
    def _check_rewards_are_named_once(self) -> Self:
        names = [reward.name for reward in self.rewards]
        if len(set(names)) != len(names):
            raise ValueError("a trace records each reward exactly once")
        return self

    @model_validator(mode="after")
    def _check_sampling_was_resolved(self) -> Self:
        if not self.sampling:
            raise ValueError("a trace records the sampling settings its rollout resolved")
        return self

    def reward(self, name: str) -> NormalizedReward | None:
        for reward in self.rewards:
            if reward.name == name:
                return reward
        return None


class NormalizedEpisode(ProtocolModel):
    """One task's episode, ordered by the Campaign's committed membership."""

    episode_id: NonEmptyString
    env_id: NonEmptyString
    task_hash: Digest
    task_position: int = Field(ge=0)
    ok: bool
    traces: list[NormalizedTrace]
    errors: list[NormalizedExecutionError]
    raw_episode_digest: Digest

    @model_validator(mode="after")
    def _check_every_trace_belongs_to_this_task(self) -> Self:
        for trace in self.traces:
            if trace.task_hash != self.task_hash:
                raise ValueError(
                    "an episode's traces all score the episode's own task; got "
                    f"{trace.task_hash} inside {self.task_hash}"
                )
        return self


class VariantExecutionResult(ProtocolModel):
    """One variant, executed, with raw evidence and its normalized projection."""

    variant: VariantName
    experiment_manifest_digest: Digest
    resolved_verifiers_config: ArtifactRef
    raw_traces: ArtifactRef
    eval_log: ArtifactRef
    normalized_episodes: ArtifactRef
    child_outcome: ChildProcessOutcome
    image_resolution: ImageResolution
    episodes: list[NormalizedEpisode]

    @model_validator(mode="after")
    def _check_the_outcome_describes_this_variant(self) -> Self:
        if self.child_outcome.variant is not self.variant:
            raise ValueError(
                f"a {self.variant.value} result carries a "
                f"{self.child_outcome.variant.value} child outcome"
            )
        if self.image_resolution.variant is not self.variant:
            raise ValueError(
                f"a {self.variant.value} result carries a "
                f"{self.image_resolution.variant.value} image resolution"
            )
        return self


class RealExecutionResult(ProtocolModel):
    """Both variants, executed under one schedule."""

    execution_backend: Literal["verifiers"]
    engine_digest: Digest
    verifiers_revision: NonEmptyString
    schedule: VariantSchedule
    baseline: VariantExecutionResult
    candidate: VariantExecutionResult

    @model_validator(mode="after")
    def _check_each_side_is_the_side_it_claims(self) -> Self:
        if self.baseline.variant is not VariantName.BASELINE:
            raise ValueError("the baseline slot holds the baseline variant")
        if self.candidate.variant is not VariantName.CANDIDATE:
            raise ValueError("the candidate slot holds the candidate variant")
        return self


class VariantExecutionPlan(ProtocolModel):
    """Everything one variant's child process needs, resolved."""

    variant: VariantName
    experiment_manifest_digest: Digest
    experiment_manifest_path: NonEmptyString
    verifiers_input_config_path: NonEmptyString
    verifiers_output_dir: NonEmptyString
    skill_paths: list[NonEmptyString]
    task_count: int = Field(ge=1)
    max_concurrent: int = Field(ge=1)


class ExecutionCheck(ProtocolModel):
    """One named question about an execution, and its answer."""

    id: NonEmptyString
    status: Literal["passed", "failed", "warning", "not_run"]
    detail: NonEmptyString
