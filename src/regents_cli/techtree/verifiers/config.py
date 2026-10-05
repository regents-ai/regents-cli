"""The only Verifiers configuration Techtree may emit.

This module is an allow-list. Every model forbids extra keys, so a Verifiers knob Techtree has
not deliberately modelled is unrepresentable. Several fields are literals rather than checked
values, because "wrong" and "cannot be spelled" are different guarantees:

`push: Literal[False]` — upstream defaults to true and uploads the complete Episode, prompts
and subject replies included, to the Prime platform. `rich: Literal[None]` — the dashboard is
the whole output when it is on; upstream's `rich` is a table, null is the only spelling that
turns it off, and an omitted key resolves to the dashboard on with log lines suppressed, so
`emitted_document` writes this one null explicitly. `shuffle: Literal[False]` and
`num_rollouts: Literal[1]` — there is no seed in the protocol, so a shuffled run could not be
reproduced. `use_bundled_skill: Literal[False]` — a bundled catalogue is an uncontrolled
second difference. `disabled_tools` is absent by construction: the harness accepts it at config
time and refuses it mid-run, after Docker is provisioned.

The emitted document is JSON because TOML has no null literal and so cannot say "no dashboard".
"""

from __future__ import annotations

import json
import re
from typing import Any, Final, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.models.campaign import CREDENTIAL_ENV_PATTERN, ReasoningEffort

EVAL_CONFIG_INVALID: Final = "eval_config_invalid"

#: Empty: the supported profile routes through the pinned client's own resolution.
ALLOWED_CLIENT_HEADERS: Final[frozenset[str]] = frozenset()

#: Upstream normalizes an empty allow-list to exactly this pair, so Techtree declares the
#: normalized form; otherwise compiled and resolved configs would disagree at `block`.
RESTRICTED_NETWORK: Final[tuple[str, ...]] = ()
RESTRICTED_BLOCK: Final[tuple[str, ...]] = ("*",)
OPEN_NETWORK: Final[tuple[str, ...]] = ("*",)
OPEN_BLOCK: Final[tuple[str, ...]] = ()

IMAGE_DIGEST_PATTERN: Final = r"@sha256:[0-9a-f]{64}$"

_CREDENTIAL_ENV_RE: Final = re.compile(CREDENTIAL_ENV_PATTERN)
_IMAGE_DIGEST_RE: Final = re.compile(IMAGE_DIGEST_PATTERN)

#: The settings whose null the emitted document must state out loud.
_NULL_IS_THE_DECISION: Final[frozenset[str]] = frozenset({"rich"})


class TomlModel(BaseModel):
    """A frozen, extra-forbidden fragment of the emitted configuration."""

    model_config = ConfigDict(frozen=True, extra="forbid", validate_default=True)


class EvalClientToml(TomlModel):
    """The endpoint the evaluation runs against; `base_url` stays unset so the pinned client
    resolves it rather than a deployment detail being frozen into a run's inputs."""

    type: Literal["eval"] = "eval"
    api_key_var: str
    base_url: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_the_client_names_a_variable_and_no_headers(self) -> Self:
        if _CREDENTIAL_ENV_RE.fullmatch(self.api_key_var) is None:
            raise ValueError(
                "api_key_var must be an uppercase environment-variable name, never a credential"
            )
        unknown = sorted(set(self.headers) - ALLOWED_CLIENT_HEADERS)
        if unknown:
            raise ValueError(f"Techtree does not declare client headers; got {unknown}")
        return self


class SamplingToml(TomlModel):
    temperature: float | None = Field(ge=0.0, le=2.0)
    max_tokens: int = Field(ge=1)
    reasoning_effort: ReasoningEffort | None


class HermesHarnessToml(TomlModel):
    """The pinned Hermes Agent harness and the skills inserted into it."""

    id: Literal["hermes-agent"] = "hermes-agent"
    version: str = Field(min_length=1)
    use_bundled_skill: Literal[False] = False
    skills: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_skill_paths_are_absolute_and_distinct(self) -> Self:
        for path in self.skills:
            if not path.startswith("/"):
                raise ValueError(f"skill paths are absolute run-owned paths; got {path!r}")
        if len(set(self.skills)) != len(self.skills):
            raise ValueError("a harness mounts each skill exactly once")
        return self


class DockerRuntimeToml(TomlModel):
    """`image` is unset when each task brings its own: the engine then runs every task in the
    image its task data names."""

    type: Literal["docker"] = "docker"
    image: str | None = Field(default=None, min_length=1)
    allow: list[str] = Field(default_factory=list)
    block: list[str] = Field(default_factory=list)
    cpu: float | None = Field(default=None, gt=0.0)
    memory: float | None = Field(default=None, gt=0.0)

    @property
    def network_is_restricted(self) -> bool:
        return list(self.allow) != list(OPEN_NETWORK) or bool(self.block)

    @model_validator(mode="after")
    def _check_the_egress_lists_are_not_both_concrete(self) -> Self:
        if self.allow and list(self.allow) != list(OPEN_NETWORK) and self.block:
            raise ValueError("a concrete allow list and a block list are mutually exclusive")
        return self


class TimeoutToml(TomlModel):
    """Per-rollout lifecycle limits; `None` is upstream's "no limit"."""

    setup: float | None = Field(default=None, gt=0.0)
    rollout: float | None = Field(default=None, gt=0.0)
    finalize: float | None = Field(default=None, gt=0.0)
    scoring: float | None = Field(default=None, gt=0.0)


class SubjectAgentToml(TomlModel):
    harness: HermesHarnessToml
    runtime: DockerRuntimeToml
    max_turns: int | None = Field(default=None, ge=1)
    max_input_tokens: int | None = Field(default=None, ge=1)
    max_output_tokens: int | None = Field(default=None, ge=1)
    max_total_tokens: int | None = Field(default=None, ge=1)
    timeout: TimeoutToml = Field(default_factory=TimeoutToml)


class TaskImagesToml(TomlModel):
    """The two digest-pinned images one task runs on."""

    agent: str = Field(min_length=1)
    grader: str = Field(min_length=1)


class TasksetToml(TomlModel):
    """`images` is the Tasksmith taskset's own configuration: task id to its pinned images.
    `settings` is any other configuration the taskset takes, exactly as the Campaign commits to
    it; the engine reads it beside `id`, so it is written there, nulls included."""

    id: str = Field(min_length=1)
    images: dict[str, TaskImagesToml] | None = None
    settings: dict[str, JsonValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_settings_do_not_restate_the_taskset(self) -> Self:
        restated = sorted({"id", "images"} & set(self.settings))
        if restated:
            raise ValueError(f"a taskset's settings cannot set {restated}")
        return self

    def document(self) -> dict[str, Any]:
        """The taskset configuration exactly as the engine reads it."""
        return self.model_dump(mode="json", exclude_none=True, exclude={"settings"}) | dict(
            self.settings
        )


class SingleAgentEnvToml(TomlModel):
    """The seat is spelled `subject` because the reference package's Env declares that field,
    and Verifiers stamps the field name onto every trace as `agent.name`."""

    taskset: TasksetToml
    subject: SubjectAgentToml
    max_concurrent_agents: int = Field(default=1, ge=1)

    @property
    def seat(self) -> SubjectAgentToml:
        return self.subject

    @property
    def seat_name(self) -> str:
        return "subject"

    @model_validator(mode="after")
    def _check_one_campaign_image(self) -> Self:
        if self.subject.runtime.image is None:
            raise ValueError("a single-agent run names one image for every task")
        if self.taskset.images is not None:
            raise ValueError("a single-agent run takes no per-task images")
        return self


class HarborEnvToml(TomlModel):
    """The engine's Harbor environment names its one seat `agent`, and stamps that onto every
    trace as `agent.name`. Each task runs in its own images, given to the taskset."""

    taskset: TasksetToml
    agent: SubjectAgentToml
    max_concurrent_agents: int = Field(default=1, ge=1)

    @property
    def seat(self) -> SubjectAgentToml:
        return self.agent

    @property
    def seat_name(self) -> str:
        return "agent"

    @model_validator(mode="after")
    def _check_per_task_images(self) -> Self:
        if self.agent.runtime.image is not None:
            raise ValueError("a Harbor run takes each task's image from the task, not the seat")
        if not self.taskset.images:
            raise ValueError("a Harbor run names every task's agent and grader images")
        return self


class VerifiersSingleAgentEnvToml(TomlModel):
    """Verifiers' own single-agent environment, which a published taskset that exports no
    environment runs in. Its one seat is `agent`, stamped onto every trace as `agent.name`."""

    taskset: TasksetToml
    agent: SubjectAgentToml
    max_concurrent_agents: int = Field(default=1, ge=1)

    @property
    def seat(self) -> SubjectAgentToml:
        return self.agent

    @property
    def seat_name(self) -> str:
        return "agent"

    @model_validator(mode="after")
    def _check_one_campaign_image(self) -> Self:
        if self.agent.runtime.image is None:
            raise ValueError("a single-agent run names one image for every task")
        if self.taskset.images is not None:
            raise ValueError("a single-agent run takes no per-task images")
        return self


EnvToml = SingleAgentEnvToml | HarborEnvToml | VerifiersSingleAgentEnvToml


def image_is_digest_pinned(image: str) -> bool:
    return _IMAGE_DIGEST_RE.search(image) is not None


def runtime_images(env: EnvToml) -> list[str]:
    """Every image the run may start: the seat's own, or each task's agent and grader."""
    if not isinstance(env, HarborEnvToml):
        assert env.seat.runtime.image is not None  # the env's validator guarantees it
        return [env.seat.runtime.image]
    assert env.taskset.images is not None  # the env's validator guarantees it
    return [image for pins in env.taskset.images.values() for image in (pins.agent, pins.grader)]


class EvalToml(TomlModel):
    """One resolved Techtree experiment as a Verifiers evaluation."""

    model: str = Field(min_length=1)
    client: EvalClientToml
    sampling: SamplingToml
    env: EnvToml
    num_tasks: int = Field(ge=1)
    num_rollouts: Literal[1] = 1
    shuffle: Literal[False] = False
    max_concurrent: int = Field(ge=1)
    rich: Literal[None] = None
    push: Literal[False] = False
    output_dir: str = Field(min_length=1)

    @model_validator(mode="after")
    def _check_the_run_is_bounded_and_run_owned(self) -> Self:
        if not self.output_dir.startswith("/"):
            raise ValueError(
                "output_dir is an absolute run-owned path; a relative path lands wherever the "
                "child happened to be started"
            )
        if self.env.max_concurrent_agents > self.max_concurrent:
            raise ValueError(
                "max_concurrent_agents cannot exceed max_concurrent; the product is the number "
                "of live subject runs"
            )
        return self


def egress_for(network_policy: str) -> tuple[list[str], list[str]]:
    """The `(allow, block)` pair one Campaign network policy compiles to."""
    if network_policy == "restricted":
        return list(RESTRICTED_NETWORK), list(RESTRICTED_BLOCK)
    if network_policy == "open":
        return list(OPEN_NETWORK), list(OPEN_BLOCK)
    raise ValidationError(
        f"{network_policy!r} is not a network policy Techtree can compile",
        code=EVAL_CONFIG_INVALID,
        details={"network_policy": network_policy},
    )


def emitted_document(config: EvalToml) -> dict[str, Any]:
    """Exactly the mapping Techtree writes: unset optionals dropped, except `rich`'s null."""
    document: dict[str, Any] = config.model_dump(mode="json")
    emitted = {
        key: _without_nulls(value)
        for key, value in document.items()
        if value is not None or key in _NULL_IS_THE_DECISION
    }
    emitted["env"]["taskset"] = config.env.taskset.document()
    return emitted


def _without_nulls(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _without_nulls(inner) for key, inner in value.items() if inner is not None}
    return value


def config_to_json_bytes(config: EvalToml) -> bytes:
    """Deterministic JSON bytes; the engine picks its parser from the `.json` extension."""
    try:
        return json.dumps(emitted_document(config), indent=2).encode("utf-8") + b"\n"
    except (TypeError, ValueError) as error:
        raise ValidationError(
            f"the compiled evaluation config is not serializable: {error}",
            code=EVAL_CONFIG_INVALID,
        ) from error
