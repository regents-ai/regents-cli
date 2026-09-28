"""What the forge records: builds of one task each, runs, comparisons, revisions, and the
Skill path from an inspected Skill to an accepted collection.

A run starts from its specification (`ForgeRunSpec`), written before any result exists. Two
specifications are comparable only when they differ in the Skill alone; `forge.comparability`
works that out rather than asserting it.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from enum import StrEnum
from typing import Annotated, Final, Literal, Self

from pydantic import AfterValidator, Field, StringConstraints, field_validator, model_validator

from regents_cli.techtree.approval import ReviewedOn
from regents_cli.techtree.canonical import verify_object_digest
from regents_cli.techtree.models.base import (
    Digest,
    JsonValue,
    NonEmptyString,
    ProtocolModel,
    UtcDateTime,
)
from regents_cli.techtree.models.experiment import ManifestComparison
from regents_cli.techtree.models.skill import SkillFile
from regents_cli.techtree.presentation.sanitize import carries_control

FORGE_BUILD_SCHEMA_VERSION: Final = "techtree.forge-build.v1alpha3"
FORGE_QUALIFICATION_SCHEMA_VERSION: Final = "techtree.forge-qualification.v1alpha4"
FORGE_RUN_SCHEMA_VERSION: Final = "techtree.forge-run.v1alpha2"
FORGE_RUN_SPEC_SCHEMA_VERSION: Final = "techtree.forge-run-spec.v1alpha2"
FORGE_TASK_CONTENT_SCHEMA_VERSION: Final = "techtree.forge-task-content.v1alpha1"
FORGE_TASK_SET_SCHEMA_VERSION: Final = "techtree.forge-task-set.v1alpha1"
FORGE_OUTPUT_MANIFEST_SCHEMA_VERSION: Final = "techtree.forge-output-manifest.v1alpha1"
FORGE_COMPARISON_SCHEMA_VERSION: Final = "techtree.forge-comparison.v1alpha5"
FORGE_REVISION_SCHEMA_VERSION: Final = "techtree.forge-revision.v1alpha3"
FORGE_SOURCE_SCHEMA_VERSION: Final = "techtree.forge-source.v1alpha1"
FORGE_PLAN_SCHEMA_VERSION: Final = "techtree.forge-plan.v1alpha1"
FORGE_APPROVAL_SCHEMA_VERSION: Final = "techtree.forge-approval.v1alpha1"
FORGE_MODEL_CALL_SCHEMA_VERSION: Final = "techtree.forge-model-call.v1alpha1"
FORGE_PROPOSAL_SCHEMA_VERSION: Final = "techtree.forge-proposal.v1alpha2"
FORGE_CONSTRUCTION_SCHEMA_VERSION: Final = "techtree.forge-construction.v1alpha2"
FORGE_CONSTRUCTION_RUN_SCHEMA_VERSION: Final = "techtree.forge-construction-run.v1alpha1"
FORGE_CONSTRUCTION_PACKAGE_SCHEMA_VERSION: Final = "techtree.forge-construction-package.v1alpha2"
FORGE_TASK_CORRECTION_SCHEMA_VERSION: Final = "techtree.forge-task-correction.v1alpha1"
FORGE_COLLECTION_SCHEMA_VERSION: Final = "techtree.forge-collection.v1alpha4"
FORGE_EXPORT_SCHEMA_VERSION: Final = "techtree.forge-export.v1alpha4"

type ForgeTaskId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")]

#: The Docker platforms a task is built for: the host's own, never an emulated one.
type ForgePlatform = Literal["linux/arm64", "linux/amd64"]


class ForgeFailure(ProtocolModel):
    """A bounded failure description, without command output or model dumps."""

    code: NonEmptyString
    message: NonEmptyString
    error_type: NonEmptyString


# ---------------------------------------------------------------------------
# Task content and builds
# ---------------------------------------------------------------------------


class TaskContentEntry(ProtocolModel):
    """One relative path; only bytes, kind and owner-executable bit are committed."""

    path: NonEmptyString
    kind: Literal["file", "directory"]
    executable: bool
    size: int = Field(ge=0)
    digest: Digest | None

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        value.encode("utf-8")
        if (
            "\\" in value
            or "\x00" in value
            or any(part in {"", ".", ".."} for part in value.split("/"))
        ):
            raise ValueError("task content path must be a safe relative UTF-8 path")
        return value

    @model_validator(mode="after")
    def validate_kind(self) -> Self:
        if self.kind == "file" and self.digest is None:
            raise ValueError("file content digest is missing")
        if self.kind == "directory" and (self.digest is not None or self.size != 0):
            raise ValueError("directory entry cannot carry file bytes")
        return self


class TaskContentManifest(ProtocolModel):
    """The complete task tree, sorted by relative path, with no exclusions."""

    schema_version: Literal["techtree.forge-task-content.v1alpha1"]
    task_id: ForgeTaskId
    entries: list[TaskContentEntry]
    content_digest: Digest

    @model_validator(mode="after")
    def validate_commitment(self) -> Self:
        paths = [entry.path for entry in self.entries]
        if paths != sorted(set(paths)):
            raise ValueError("task content paths must be unique and sorted")
        if not verify_object_digest(
            {"schema_version": self.schema_version, "entries": self.entries},
            self.content_digest,
        ):
            raise ValueError("task content digest does not match entries")
        return self


class TaskSetCommitment(ProtocolModel):
    """Every task's identity and content, in order."""

    schema_version: Literal["techtree.forge-task-set.v1alpha1"]
    tasks: list[TaskContentManifest]
    membership_digest: Digest

    @model_validator(mode="after")
    def validate_commitment(self) -> Self:
        if len({task.task_id for task in self.tasks}) != len(self.tasks):
            raise ValueError("duplicate task ids in committed membership")
        if not verify_object_digest(
            {
                "schema_version": self.schema_version,
                "tasks": [
                    {"task_id": task.task_id, "content_digest": task.content_digest}
                    for task in self.tasks
                ],
            },
            self.membership_digest,
        ):
            raise ValueError("ordered membership digest does not match tasks")
        return self


#: An image name pinned to a content digest; the only form a task recipe may name an external
#: base image in.
BASE_IMAGE_REFERENCE: Final = r"[a-z0-9][a-z0-9._/:-]*@sha256:[0-9a-f]{64}"


class ForgeBaseImage(ProtocolModel):
    """One release-allow-listed base image, as pulled before the task build."""

    reference: Annotated[str, StringConstraints(pattern=f"^{BASE_IMAGE_REFERENCE}$")]
    image_id: NonEmptyString


class ForgeSkillSource(ProtocolModel):
    """The Source Skill a task was written from, and the pinned recipe that wrote it.

    The base images are the recipe's external `FROM` references, every one on the release
    allow-list and pulled by digest before the offline build.
    """

    kind: Literal["skill"]
    source_skill_digest: Digest
    recipe: Literal["skill2env"]
    recipe_version: NonEmptyString
    producer: Literal["skill2env"]
    producer_version: NonEmptyString
    upstream_url: NonEmptyString
    upstream_revision: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{40}$")]
    harbor_version: NonEmptyString
    base_images: list[ForgeBaseImage] = Field(min_length=1)

    @field_validator("base_images")
    @classmethod
    def validate_base_images(cls, value: list[ForgeBaseImage]) -> list[ForgeBaseImage]:
        if len({image.reference for image in value}) != len(value):
            raise ValueError("base images repeat a reference")
        return value


class ForgeBuildRecord(ProtocolModel):
    """One task package's provenance and the commitment to its files."""

    schema_version: Literal["techtree.forge-build.v1alpha3"]
    build_id: NonEmptyString
    created_at: UtcDateTime
    source: ForgeSkillSource
    platform: ForgePlatform
    task_set: TaskSetCommitment


class QualificationCheck(ProtocolModel):
    """One model-free check on one task, and what it saw."""

    name: NonEmptyString
    passed: bool
    detail: str


class TaskQualification(ProtocolModel):
    """What qualification records about one task.

    The task's image is built offline and checked to carry no verifier material; a run that does
    nothing, the reference, the other correct solution (`alternative_reward`) and the
    deliberately wrong one (`wrong_reward`) are each graded, and every check is kept.
    """

    kind: Literal["skill"]
    task_id: ForgeTaskId
    task_content_digest: Digest
    image_tag: NonEmptyString
    image_id: str
    control_reward: float | None
    reference_reward: float | None
    alternative_reward: float | None
    wrong_reward: float | None
    checks: list[QualificationCheck]
    qualified: bool


class ForgeQualification(ProtocolModel):
    """The qualification of every task one build committed."""

    schema_version: Literal["techtree.forge-qualification.v1alpha4"]
    build_id: NonEmptyString
    membership_digest: Digest
    qualified_at: UtcDateTime
    model_calls: Literal[0]
    tasks: list[TaskQualification]
    qualified_task_ids: list[ForgeTaskId]

    @model_validator(mode="after")
    def validate_qualified_membership(self) -> Self:
        if self.qualified_task_ids != [task.task_id for task in self.tasks if task.qualified]:
            raise ValueError("qualified task count or order differs from task evidence")
        return self


class ForgeBuildStatus(ProtocolModel):
    """A build read back: its record, and its qualification once that finished."""

    build_id: NonEmptyString
    path: NonEmptyString
    tasks_path: NonEmptyString
    build: ForgeBuildRecord
    qualification: ForgeQualification | None


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------

#: The name a Skill is visible to Hermes under: its directory name, in the identifier form
#: Hermes accepts for a Skill.
type ForgeSkillName = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]*$")]


class ForgeArm(StrEnum):
    """Which side of the comparison a run specification describes."""

    BASELINE = "baseline"
    CANDIDATE = "candidate"


class ForgeGradingSpec(ProtocolModel):
    """How a run is scored.

    The Harbor task's own procedure: `bash /tests/test.sh` in a fresh container from the task
    image, with the directory the agent worked in mounted where it had it, the reward read from
    `/logs/verifier/reward.json`, then `reward.txt`. Run by this local experiment, not Verifiers.
    """

    procedure: Literal["harbor-compatible"]
    executed_by: Literal["local-experiment"]


class ForgeAgentSpec(ProtocolModel):
    """The Hermes that will act: which executable, and what it says it is."""

    harness: Literal["hermes"]
    executable: NonEmptyString
    version: NonEmptyString


class ForgeModelSpec(ProtocolModel):
    """The model Hermes is asked for; Hermes reads its own sign-in, and Techtree none."""

    provider: NonEmptyString
    model_id: NonEmptyString
    reasoning: NonEmptyString | None
    credential_source: Literal["hermes-auth-store"]


class ForgeInitialState(ProtocolModel):
    """What Hermes starts from: a profile emptied of all but the sign-in."""

    home: Literal["fresh-empty"]
    memory_enabled: Literal[False]


class ForgeSkillSpec(ProtocolModel):
    """The one Skill an arm carries, by content."""

    name: ForgeSkillName
    root_digest: Digest
    files: list[SkillFile] = Field(min_length=1)
    exposure: Literal["preloaded"]


class ForgeOutputLimits(ProtocolModel):
    """The bounds a capture keeps to, recorded with what it found."""

    entries: int = Field(ge=1)
    checked_bytes: int = Field(ge=1)
    kept_bytes: int = Field(ge=1)


#: The Hermes toolsets a subject may be given, all routed through its sandbox. No web, browser,
#: memory or delegation: the host process must not reach what the container cannot.
type ForgeSubjectToolset = Literal["terminal", "file", "code_execution", "skills"]


class ForgeLimits(ProtocolModel):
    """Bounds on the agent's time, its sandbox, and the capture of what it left.

    The agent's allowance is the task's own `[agent].timeout_sec`, part of the committed task
    content; Hermes is given it as its run budget and Techtree enforces it from outside. A Hermes
    one-shot has no turn cap, so none is claimed.
    """

    agent_budget: Literal["task-timeout"]
    turns: Literal["unbounded"]
    container_cpus: int = Field(ge=1)
    container_memory_mb: int = Field(ge=1)
    network: Literal[False]
    outputs: ForgeOutputLimits


class ForgeSamplingSpec(ProtocolModel):
    """How many attempts each task gets; Hermes exposes no temperature or seed."""

    control: Literal["provider-default"]
    repetitions: int = Field(ge=1)


class ForgeCollectionTasks(ProtocolModel):
    """An accepted collection's tasks: exactly what a person froze."""

    kind: Literal["collection"]
    collection_id: NonEmptyString
    collection_digest: Digest
    membership_digest: Digest


class ForgeRunSpec(ProtocolModel):
    """One arm of a forge experiment, declared before it runs.

    The candidate arm carries exactly one Skill; the baseline carries none, or the earlier Skill
    a revision is measured against. Facts the experiment cannot establish are listed under
    `not_established` so the report can say so.
    """

    schema_version: Literal["techtree.forge-run-spec.v1alpha2"]
    arm: ForgeArm
    tasks_from: ForgeCollectionTasks
    task_ids: list[ForgeTaskId] = Field(min_length=1)
    grading: ForgeGradingSpec
    agent: ForgeAgentSpec
    toolsets: list[ForgeSubjectToolset] = Field(min_length=1)
    model: ForgeModelSpec
    initial_state: ForgeInitialState
    skill: ForgeSkillSpec | None
    limits: ForgeLimits
    sampling: ForgeSamplingSpec
    not_established: list[NonEmptyString]

    @model_validator(mode="after")
    def validate_arm_skill(self) -> Self:
        if len(set(self.task_ids)) != len(self.task_ids):
            raise ValueError("a task may be named once in a run specification")
        if self.arm is ForgeArm.CANDIDATE and self.skill is None:
            raise ValueError("the candidate arm carries exactly one Skill")
        if len(set(self.toolsets)) != len(self.toolsets):
            raise ValueError("a toolset may be named once in a run specification")
        return self


class ForgeEvidence(StrEnum):
    """The evidence one attempt can leave; a claim needs every kind."""

    USAGE_REPORT = "usage_report"
    AGENT_TRANSCRIPT = "agent_transcript"
    OUTPUT_MANIFEST = "output_manifest"
    VERIFIER_VERDICT = "verifier_verdict"


class ForgeAttemptOutcome(StrEnum):
    """How one attempt ended. Only `graded` carries a reward."""

    GRADED = "graded"
    AGENT_TIMED_OUT = "agent_timed_out"
    AGENT_FAILED = "agent_failed"
    OUTPUTS_REJECTED = "outputs_rejected"
    VERIFIER_TIMED_OUT = "verifier_timed_out"
    NO_VERDICT = "no_verdict"


class ForgeUsage(ProtocolModel):
    """What Hermes reported about its own run, kept as reported.

    `cost_status` and `cost_source` say whether the cost is an estimate at all: a subscription
    Hermes cannot price is recorded as unpriced, never as free. `completed` and `failed` are
    read rather than the exit code, because Hermes prints a failure and exits zero.
    """

    model: str | None
    provider: str | None
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    api_calls: int | None
    estimated_cost_usd: float | None
    cost_status: str | None
    cost_source: str | None
    completed: bool | None
    failed: bool | None
    failure: str | None


type ForgeOutputKind = Literal["file", "directory", "symlink", "other"]


class ForgeOutputEntry(ProtocolModel):
    """One entry of a working directory, read without following links.

    A regular file has its `size` and `digest`; a link its `target`, as written.
    """

    path: str = Field(min_length=1)
    kind: ForgeOutputKind
    size: int | None = Field(ge=0)
    digest: Digest | None
    executable: bool
    target: str | None

    @model_validator(mode="after")
    def validate_kind(self) -> Self:
        if (self.kind == "file") != (self.size is not None and self.digest is not None):
            raise ValueError("exactly a regular file has a size and a digest")
        if (self.kind == "symlink") != (self.target is not None):
            raise ValueError("exactly a link has a target")
        return self


type ForgeOutputChangeKind = Literal["added", "modified", "deleted"]


class ForgeOutputChange(ProtocolModel):
    """One entry the subject added, modified or deleted; `kept` means copied under `files/`."""

    change: ForgeOutputChangeKind
    path: str = Field(min_length=1)
    before: ForgeOutputEntry | None
    after: ForgeOutputEntry | None
    kept: bool

    @model_validator(mode="after")
    def validate_sides(self) -> Self:
        expected = {
            "added": (False, True),
            "modified": (True, True),
            "deleted": (True, False),
        }[self.change]
        if (self.before is not None, self.after is not None) != expected:
            raise ValueError(f"an entry {self.change} has the wrong sides")
        if self.kept and (self.after is None or self.after.kind != "file"):
            raise ValueError("only a regular file the subject left is kept")
        return self


type ForgeOutputFailureKind = Literal[
    "escaping_link",
    "special_entry",
    "artifact_missing",
    "output_too_large",
    "capture_incomplete",
]


class ForgeOutputFailure(ProtocolModel):
    """Why what the subject left could not be taken as it is.

    `artifact_missing` is a required output the subject did not leave; the tests still grade
    the attempt. Any other failure stops the attempt before grading: a link out of the working
    directory could hand the tests something the subject did not make.
    """

    kind: ForgeOutputFailureKind
    path: str | None
    detail: NonEmptyString


class ForgeOutputManifest(ProtocolModel):
    """What one subject left in its working directory, before any grading."""

    schema_version: Literal["techtree.forge-output-manifest.v1alpha1"]
    work_dir: NonEmptyString
    limits: ForgeOutputLimits
    changes: list[ForgeOutputChange]
    kept_bytes: int = Field(ge=0)
    failures: list[ForgeOutputFailure]


class ForgeOutputs(ProtocolModel):
    """An attempt's outputs in brief: its manifest by digest, and the counts."""

    work_dir: NonEmptyString
    manifest_digest: Digest
    added: int = Field(ge=0)
    modified: int = Field(ge=0)
    deleted: int = Field(ge=0)
    kept_bytes: int = Field(ge=0)
    failures: list[ForgeOutputFailure]


class ForgeAttemptRecord(ProtocolModel):
    """One attempt at one task: what ran, what it left, how it was scored."""

    task_id: ForgeTaskId
    attempt: int = Field(ge=1)
    started_at: UtcDateTime
    finished_at: UtcDateTime
    config_digest: Digest
    hermes_arguments: list[NonEmptyString]
    agent_exit_code: int | None
    agent_timed_out: bool
    agent_seconds: float = Field(ge=0.0)
    usage: ForgeUsage | None
    outputs: ForgeOutputs
    verifier_timed_out: bool
    reward: float | None
    reward_details: dict[str, JsonValue]
    outcome: ForgeAttemptOutcome
    evidence: list[ForgeEvidence]

    @model_validator(mode="after")
    def validate_reward_follows_outcome(self) -> Self:
        if (self.reward is not None) != (self.outcome is ForgeAttemptOutcome.GRADED):
            raise ValueError("a reward is recorded exactly when the attempt was graded")
        return self


type ForgeRunState = Literal["unfinished", "completed", "failed", "cancelled"]


class ForgeRunRecord(ProtocolModel):
    """A run as it stands, written before the first attempt and after every one."""

    schema_version: Literal["techtree.forge-run.v1alpha2"]
    run_id: NonEmptyString
    spec_digest: Digest
    started_at: UtcDateTime
    updated_at: UtcDateTime
    state: ForgeRunState
    attempts: list[ForgeAttemptRecord]
    failure: ForgeFailure | None


class ForgeRunStatus(ProtocolModel):
    """A run read back from its directory."""

    run_id: NonEmptyString
    path: NonEmptyString
    spec: ForgeRunSpec
    record: ForgeRunRecord


# ---------------------------------------------------------------------------
# Comparisons
# ---------------------------------------------------------------------------

#: Fewer graded pairs than this and no verdict is given.
VERDICT_MINIMUM_PAIRS: Final = 3


class ForgePairResult(StrEnum):
    """What one paired attempt says; a pair is resolved only when both arms were graded."""

    WIN = "win"
    LOSS = "loss"
    TIE = "tie"
    UNRESOLVED = "unresolved"


class ForgeAttemptPair(ProtocolModel):
    """The same task and repetition on both arms; a missing side is None on both its fields."""

    task_id: ForgeTaskId
    attempt: int = Field(ge=1)
    baseline_outcome: ForgeAttemptOutcome | None
    baseline_reward: float | None
    candidate_outcome: ForgeAttemptOutcome | None
    candidate_reward: float | None
    delta: float | None
    result: ForgePairResult

    @model_validator(mode="after")
    def validate_result_follows_rewards(self) -> Self:
        graded = self.baseline_reward is not None and self.candidate_reward is not None
        if graded != (self.result is not ForgePairResult.UNRESOLVED):
            raise ValueError("a pair is resolved exactly when both arms were graded")
        if graded != (self.delta is not None):
            raise ValueError("a difference is recorded exactly when both were graded")
        return self


class ForgeVerdict(StrEnum):
    """What the comparison says about the Skill, decided by `forge_verdict`'s rules in order."""

    INCONCLUSIVE = "inconclusive"
    MIXED = "mixed"
    IMPROVED = "improved"
    REGRESSED = "regressed"
    NO_DIFFERENCE = "no_difference"


class ForgeTaskRegression(ProtocolModel):
    """One task the Skill lost at least once: which attempts, and which it won."""

    task_id: ForgeTaskId
    attempts_lost: list[int] = Field(min_length=1)
    attempts_won: list[int]


class ForgeTaskConsistency(ProtocolModel):
    """How one task went across its attempts, and whether it went both ways."""

    task_id: ForgeTaskId
    wins: int = Field(ge=0)
    losses: int = Field(ge=0)
    ties: int = Field(ge=0)
    unresolved: int = Field(ge=0)
    went_both_ways: bool

    @model_validator(mode="after")
    def validate_both_ways_follows_counts(self) -> Self:
        if self.went_both_ways != (self.wins > 0 and self.losses > 0):
            raise ValueError("a task went both ways exactly when it won and lost")
        return self


class ForgeArmTotals(ProtocolModel):
    """What one arm did and used, added up over its recorded attempts.

    `mean_reward` is over the graded attempts alone. `cost_usd` is a sum only when every attempt
    with a usage report carried a dollar figure; otherwise it is None and `cost_statuses` says
    what Hermes reported instead, because an unpriced attempt is not a free one.
    """

    run_id: NonEmptyString
    state: ForgeRunState
    attempts_planned: int = Field(ge=0)
    attempts_recorded: int = Field(ge=0)
    attempts_graded: int = Field(ge=0)
    mean_reward: float | None
    agent_seconds: float = Field(ge=0.0)
    api_calls: int | None
    total_tokens: int | None
    cost_usd: float | None
    cost_statuses: list[NonEmptyString]


class ForgeSkillRef(ProtocolModel):
    """One Skill in one role, by the name it carries and its content digest."""

    name: NonEmptyString
    digest: Digest


class ForgePartSummary(ProtocolModel):
    """The pairs of one part of a collection, added up and judged on their own."""

    task_ids: list[ForgeTaskId]
    pairs_planned: int = Field(ge=0)
    pairs_graded: int = Field(ge=0)
    wins: int = Field(ge=0)
    losses: int = Field(ge=0)
    ties: int = Field(ge=0)
    unresolved: int = Field(ge=0)
    baseline_mean_reward: float | None
    candidate_mean_reward: float | None
    mean_delta: float | None
    complete: bool
    verdict: ForgeVerdict

    @model_validator(mode="after")
    def validate_counts_agree(self) -> Self:
        if self.wins + self.losses + self.ties != self.pairs_graded:
            raise ValueError("a part's wins, losses and ties add up to its graded pairs")
        if self.pairs_graded + self.unresolved != self.pairs_planned:
            raise ValueError("a part's graded and unresolved pairs add up to its plan")
        if self.complete != (self.unresolved == 0):
            raise ValueError("a part is complete exactly when no pair is unresolved")
        means = (self.baseline_mean_reward, self.candidate_mean_reward, self.mean_delta)
        if any((mean is None) != (self.pairs_graded == 0) for mean in means):
            raise ValueError("a part has means exactly when a pair was graded")
        if self.verdict is not forge_verdict(
            wins=self.wins, losses=self.losses, graded=self.pairs_graded, unresolved=self.unresolved
        ):
            raise ValueError("a part's verdict follows the rules from its counts")
        return self


class ForgeComparisonRecord(ProtocolModel):
    """Two arms of one experiment, paired task by task.

    `source_skill` is the Skill the collection's tasks were written from, `baseline_skill` the
    Skill the baseline carried, if any, and `candidate_skill` the candidate's. `complete` is true
    only when every planned pair was graded on both sides. `study` and `held_out` judge each part
    of the collection on its own: the tasks an improving agent may see, and those it never sees.
    """

    schema_version: Literal["techtree.forge-comparison.v1alpha5"]
    comparison_id: NonEmptyString
    created_at: UtcDateTime
    tasks_from: ForgeCollectionTasks
    baseline_run_id: NonEmptyString
    candidate_run_id: NonEmptyString
    source_skill: ForgeSkillRef
    baseline_skill: ForgeSkillRef | None
    candidate_skill: ForgeSkillRef
    comparability: ManifestComparison
    baseline: ForgeArmTotals
    candidate: ForgeArmTotals
    pairs: list[ForgeAttemptPair]
    pairs_planned: int = Field(ge=0)
    pairs_graded: int = Field(ge=0)
    wins: int = Field(ge=0)
    losses: int = Field(ge=0)
    ties: int = Field(ge=0)
    unresolved: int = Field(ge=0)
    mean_delta: float | None
    complete: bool
    repetitions: int = Field(ge=1)
    verdict: ForgeVerdict
    regressions: list[ForgeTaskRegression]
    consistency: list[ForgeTaskConsistency]
    study: ForgePartSummary
    held_out: ForgePartSummary
    summary: NonEmptyString
    not_established: list[NonEmptyString]

    @model_validator(mode="after")
    def validate_counts_agree(self) -> Self:
        parts = (self.study, self.held_out)
        if (
            sorted(task for part in parts for task in part.task_ids)
            != sorted(task.task_id for task in self.consistency)
            or sum(part.pairs_planned for part in parts) != self.pairs_planned
        ):
            raise ValueError("the parts divide the comparison's tasks between them")
        if self.wins + self.losses + self.ties != self.pairs_graded:
            raise ValueError("wins, losses and ties add up to the graded pairs")
        if self.pairs_graded + self.unresolved != self.pairs_planned:
            raise ValueError("graded and unresolved pairs add up to the planned pairs")
        if len(self.pairs) != self.pairs_planned:
            raise ValueError("every planned pair is listed, resolved or not")
        if self.complete != (self.unresolved == 0):
            raise ValueError("a comparison is complete exactly when no pair is unresolved")
        if (self.mean_delta is None) != (self.pairs_graded == 0):
            raise ValueError("a mean difference exists exactly when a pair was graded")
        if self.verdict is not forge_verdict(
            wins=self.wins, losses=self.losses, graded=self.pairs_graded, unresolved=self.unresolved
        ):
            raise ValueError("the verdict follows the rules from the counts")
        if [r.task_id for r in self.regressions] != [
            c.task_id for c in self.consistency if c.losses > 0
        ]:
            raise ValueError("the regressions are exactly the tasks with a loss")
        for count in ("wins", "losses", "ties", "unresolved"):
            if sum(getattr(c, count) for c in self.consistency) != getattr(self, count):
                raise ValueError(f"the tasks' {count} add up to the comparison's")
        return self


def forge_verdict(*, wins: int, losses: int, graded: int, unresolved: int) -> ForgeVerdict:
    """Apply the verdict rules, in their order, to the counts.

    Inconclusive when any planned pair is unresolved or fewer than `VERDICT_MINIMUM_PAIRS` were
    graded; mixed with a win and a loss; improved with wins only; regressed with losses only;
    no difference when every graded pair tied.
    """
    if unresolved > 0 or graded < VERDICT_MINIMUM_PAIRS:
        return ForgeVerdict.INCONCLUSIVE
    if wins and losses:
        return ForgeVerdict.MIXED
    if wins:
        return ForgeVerdict.IMPROVED
    if losses:
        return ForgeVerdict.REGRESSED
    return ForgeVerdict.NO_DIFFERENCE


class ForgeComparisonStatus(ProtocolModel):
    """A comparison read back from its directory, with where its report is."""

    comparison_id: NonEmptyString
    path: NonEmptyString
    report_path: NonEmptyString
    record: ForgeComparisonRecord


# ---------------------------------------------------------------------------
# Revisions
# ---------------------------------------------------------------------------


class ForgeScreeningFinding(ProtocolModel):
    """One line of a revised Skill that also occurs in a task's hidden material.

    Evidence, not a verdict: the person who approves the second run sees it. A task hides its
    reference solutions and tests, and a held-out task also its instruction and inputs. The line
    is named by its number in the Skill, never by the hidden file's.
    """

    task_id: ForgeTaskId
    material: Literal["reference_solution", "tests", "instruction", "inputs"]
    skill_path: NonEmptyString
    line: int = Field(ge=1)
    excerpt: NonEmptyString


class ForgeRevisionRecord(ProtocolModel):
    """One revised Skill declared against a finished comparison.

    Written when prepared and again once measured. A measured revision names its run, the
    comparison of that run against the same baseline, its verdict on the held-out tasks, and
    `study_verdict` on the tasks the improving agent could see. Nothing here chooses.
    """

    schema_version: Literal["techtree.forge-revision.v1alpha3"]
    revision_id: NonEmptyString
    created_at: UtcDateTime
    updated_at: UtcDateTime
    comparison_id: NonEmptyString
    tasks_from: ForgeCollectionTasks
    baseline_run_id: NonEmptyString
    parent_run_id: NonEmptyString
    parent_skill_digest: Digest
    skill: ForgeSkillSpec
    spec_digest: Digest
    comparability: ManifestComparison
    screening: list[ForgeScreeningFinding]
    state: Literal["prepared", "measured"]
    measured_run_id: NonEmptyString | None
    measured_comparison_id: NonEmptyString | None
    verdict: NonEmptyString | None
    study_verdict: NonEmptyString | None

    @model_validator(mode="after")
    def validate_measurement(self) -> Self:
        facts = (
            self.measured_run_id,
            self.measured_comparison_id,
            self.verdict,
            self.study_verdict,
        )
        if (self.state == "measured") != all(fact is not None for fact in facts):
            raise ValueError("a measured revision names its run, comparison and verdicts")
        if self.state == "prepared" and any(fact is not None for fact in facts):
            raise ValueError("a prepared revision has no measurement yet")
        if self.skill.root_digest == self.parent_skill_digest:
            raise ValueError("a revision differs from the Skill it revises")
        return self


class ForgeRevisionStatus(ProtocolModel):
    """A revision read back from its directory, with the specification it runs."""

    revision_id: NonEmptyString
    path: NonEmptyString
    spec: ForgeRunSpec
    record: ForgeRevisionRecord


# ---------------------------------------------------------------------------
# Source Skills
# ---------------------------------------------------------------------------

#: A Skill's name as the Agent Skills specification allows it.
type AgentSkillName = Annotated[
    str, StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=64)
]

#: Why one file of a Source Skill cannot be carried.
type ForgeUnsupportedReason = Literal[
    "hidden",
    "symlink",
    "special",
    "unreadable",
    "file_type",
    "not_text",
    "too_large",
    "case_collision",
]

#: Why a whole Source Skill is refused.
type ForgeRefusalReason = Literal[
    "required_unsupported",
    "missing_reference",
    "outside_reference",
    "declaration",
    "too_many_files",
    "too_many_bytes",
]


class ForgeSourceEntry(ProtocolModel):
    """One entry of a Source Skill as it was found, and what became of it.

    `required` means the Skill's instructions name it: SKILL.md, and every path a named file
    mentions. A hidden directory, or one that cannot be read, is one entry; nothing under it is
    opened.
    """

    path: NonEmptyString
    kind: Literal["file", "symlink", "directory", "special"]
    size: int | None = Field(ge=0)
    digest: Digest | None
    disposition: Literal["admitted", "unsupported"]
    reason: ForgeUnsupportedReason | None
    required: bool

    @model_validator(mode="after")
    def validate_disposition(self) -> Self:
        if (self.disposition == "admitted") != (self.reason is None):
            raise ValueError("an unsupported entry says why, an admitted one does not")
        if self.disposition == "admitted" and (
            self.kind != "file" or self.size is None or self.digest is None
        ):
            raise ValueError("an admitted entry is a file with its size and digest")
        return self


class ForgeSkillDeclaration(ProtocolModel):
    """What SKILL.md's header declares; `allowed_tools` asks for tools and grants none."""

    name: AgentSkillName
    description: Annotated[str, StringConstraints(min_length=1, max_length=1024)]
    license: NonEmptyString | None
    compatibility: Annotated[str, StringConstraints(min_length=1, max_length=500)] | None
    metadata: dict[NonEmptyString, str]
    allowed_tools: list[NonEmptyString]
    other_fields: dict[NonEmptyString, str]


class ForgeSourceRefusal(ProtocolModel):
    """One reason the Source Skill cannot be used, naming the path concerned."""

    path: NonEmptyString
    reason: ForgeRefusalReason
    message: NonEmptyString


class ForgeSourceRecord(ProtocolModel):
    """One inspection of a Source Skill, written once.

    `admitted_files` and `admitted_digest` describe exactly the bytes an admitted source keeps
    under `skill/`, the bytes that may later be sent to a model. A refused source keeps none.
    """

    schema_version: Literal["techtree.forge-source.v1alpha1"]
    source_id: NonEmptyString
    created_at: UtcDateTime
    origin: NonEmptyString
    state: Literal["admitted", "refused"]
    declaration: ForgeSkillDeclaration | None
    entries: list[ForgeSourceEntry]
    admitted_files: list[SkillFile]
    admitted_digest: Digest
    refusals: list[ForgeSourceRefusal]

    @model_validator(mode="after")
    def validate_record(self) -> Self:
        if (self.state == "refused") != bool(self.refusals):
            raise ValueError("a refused source says why, an admitted one has no refusal")
        if self.state == "admitted" and self.declaration is None:
            raise ValueError("an admitted source carries its declaration")
        admitted = [
            (entry.path, entry.size, entry.digest)
            for entry in self.entries
            if entry.disposition == "admitted"
        ]
        if admitted != [(f.path, f.size, f.digest) for f in self.admitted_files]:
            raise ValueError("admitted files differ from the admitted entries")
        if not verify_object_digest(self.admitted_files, self.admitted_digest):
            raise ValueError("admitted digest does not describe the admitted files")
        return self


class ForgeSourceStatus(ProtocolModel):
    """A Source Skill record read back, with where its kept bytes are."""

    source_id: NonEmptyString
    path: NonEmptyString
    snapshot_path: NonEmptyString | None
    record: ForgeSourceRecord


# ---------------------------------------------------------------------------
# Model calls: planning and construction share approvals and call records
# ---------------------------------------------------------------------------

#: The most tasks one plan may ask for: Skill2Env's own default workflow count.
MAX_PLANNED_TASKS: Final = 8
#: The most claims one proposal may state; each claim needs a task of its own.
MAX_CLAIMS: Final = MAX_PLANNED_TASKS

#: A claim's id: `C` and its place in the proposal's claims, `C1` first.
type ForgeClaimId = Annotated[str, StringConstraints(min_length=1, max_length=8)]


def _one_plain_line(value: str) -> str:
    """Refuse model-written text that could break or rewrite a review screen."""
    if carries_control(value):
        raise ValueError("text may not hold a line break, a tab or a terminal control code")
    return value


#: Text a model wrote that a person reads when approving: one plain line.
_PLAIN: Final = AfterValidator(_one_plain_line)

#: Which case of its claim a task is; see `ForgeProposedTask`.
type ForgeTaskKind = Literal["positive", "boundary", "counterexample"]

TASK_KIND_WORDS: Final[dict[ForgeTaskKind, str]] = {
    "positive": "positive case",
    "boundary": "boundary case",
    "counterexample": "counterexample",
}
TASK_KINDS_EXPLAINED: Final = (
    "A positive case is one where following the Skill should give the right "
    "result; a boundary case sits at the edge of where the claim applies; a "
    "counterexample checks that the Skill is not overused where it would give "
    "a wrong result or should change nothing."
)

type ForgeProposedTaskName = Annotated[
    str, StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=64)
]


class ForgeAuthoringCapabilities(ProtocolModel):
    """What the planner or the creator may do besides answer: nothing.

    Hermes is given its text-only toolset, with memory off and its rules, memory and Skills not
    injected.
    """

    tools: Literal["none"]
    toolset: Literal["bot_room"]
    memory_enabled: Literal[False]


class ForgeApproval(ProtocolModel):
    """A person's approval of exactly one prepared plan, construction or collection."""

    schema_version: Literal["techtree.forge-approval.v1alpha1"]
    subject_id: NonEmptyString
    subject_digest: Digest
    approved_at: UtcDateTime
    reviewed_on: ReviewedOn
    answered_with: Literal["prompt", "yes-flag"]


#: How a model call stands. `started` is written before Hermes is launched; one that stays
#: `started` after its process has gone never recorded an end, and reads `outcome_unknown`.
type ForgeModelCallState = Literal["started", "succeeded", "rejected", "failed", "outcome_unknown"]


class ForgeModelCall(ProtocolModel):
    """One planner or creator call an approval covers, checkpointed.

    Written as `started` before Hermes is launched and again when it has ended. `succeeded`
    names what it made in `result` (a proposal, or a package); `rejected` means the answer is not
    usable, kept as `answer.txt`; `failed` means Hermes said it failed; `outcome_unknown` means it
    was stopped mid-call, so the provider may or may not have answered or charged. None is
    retried.
    """

    schema_version: Literal["techtree.forge-model-call.v1alpha1"]
    subject_id: NonEmptyString
    subject_digest: Digest
    task_name: ForgeProposedTaskName | None
    process_id: int = Field(ge=1)
    started_at: UtcDateTime
    updated_at: UtcDateTime
    state: ForgeModelCallState
    hermes_arguments: list[NonEmptyString]
    config_digest: Digest
    exit_code: int | None
    stopped: Literal["wall_time", "person"] | None
    seconds: float | None = Field(ge=0.0)
    usage: ForgeUsage | None
    answer_bytes: int | None = Field(ge=0)
    answer_digest: Digest | None
    result: NonEmptyString | None
    failure: ForgeFailure | None

    @model_validator(mode="after")
    def validate_state(self) -> Self:
        if (self.state == "succeeded") != (self.result is not None):
            raise ValueError("a call names what it made exactly when it succeeded")
        if (self.state in {"rejected", "failed"}) != (self.failure is not None):
            raise ValueError("a rejected or failed call says why, no other does")
        if (self.state == "outcome_unknown") != (self.stopped is not None):
            raise ValueError("a call with an unknown outcome says what stopped it")
        return self


# ---------------------------------------------------------------------------
# Planning and proposals
# ---------------------------------------------------------------------------


class ForgePlanningRecipe(ProtocolModel):
    """The planning instructions: Techtree's own text, adapted from Skill2Env."""

    name: Literal["skill2env-planner"]
    instructions_digest: Digest
    upstream_url: NonEmptyString
    upstream_revision: NonEmptyString


class ForgePlanDisclosure(ProtocolModel):
    """Exactly what leaves the machine: the Skill's kept files, inside the one prompt."""

    files: list[SkillFile] = Field(min_length=1)
    prompt_bytes: int = Field(ge=1)
    prompt_digest: Digest


class ForgePlanLimits(ProtocolModel):
    """The bounds one planning approval covers."""

    max_tasks: int = Field(ge=1, le=MAX_PLANNED_TASKS)
    attempts: Literal[1]
    wall_seconds: int = Field(ge=1)
    answer_bytes: int = Field(ge=1)


class ForgePlanReview(ProtocolModel):
    """Everything one planning approval binds; its digest is the approval."""

    source_id: NonEmptyString
    source_digest: Digest
    recipe: ForgePlanningRecipe
    agent: ForgeAgentSpec
    model: ForgeModelSpec
    disclosure: ForgePlanDisclosure
    egress: Literal["model-provider"]
    capabilities: ForgeAuthoringCapabilities
    limits: ForgePlanLimits


class ForgePlanRecord(ProtocolModel):
    """One prepared planning call, written before anything is sent, and never changed."""

    schema_version: Literal["techtree.forge-plan.v1alpha1"]
    plan_id: NonEmptyString
    created_at: UtcDateTime
    review: ForgePlanReview
    planning_digest: Digest

    @model_validator(mode="after")
    def validate_digest(self) -> Self:
        if not verify_object_digest(self.review, self.planning_digest):
            raise ValueError("planning digest does not describe the review")
        return self


class ForgeSkillClaim(ProtocolModel):
    """One thing a Skill claims to improve, and the behavior that would show it."""

    claim_id: ForgeClaimId
    statement: Annotated[str, StringConstraints(min_length=1, max_length=500), _PLAIN]
    observable: Annotated[str, StringConstraints(min_length=1, max_length=1000), _PLAIN]


class ForgeProposedTask(ProtocolModel):
    """One proposed task; it tests exactly one claim, as one case of it.

    `positive`: following the Skill should give the correct behavior. `boundary`: the edge of
    where the claim applies. `counterexample`: a naive or over-eager use of the Skill would go
    wrong, or the Skill should change nothing.
    """

    name: ForgeProposedTaskName
    claim: ForgeClaimId
    kind: ForgeTaskKind
    summary: Annotated[str, StringConstraints(min_length=1, max_length=500), _PLAIN]
    scenario: Annotated[str, StringConstraints(min_length=1, max_length=4000), _PLAIN]
    success_criteria: list[
        Annotated[str, StringConstraints(min_length=1, max_length=1000), _PLAIN]
    ] = Field(min_length=1, max_length=12)
    verifier_strategy: Annotated[str, StringConstraints(min_length=1, max_length=4000), _PLAIN]


class ForgeProposalParent(ProtocolModel):
    """The proposal a contributor's correction was made from."""

    proposal_id: NonEmptyString
    proposal_digest: Digest


def _check_claims(claims: list[ForgeSkillClaim], tasks: list[ForgeProposedTask]) -> None:
    """Raise unless every task tests a stated claim and every claim is tested."""
    ids = [claim.claim_id for claim in claims]
    if ids != [f"C{number}" for number in range(1, len(ids) + 1)]:
        raise ValueError("claims must be numbered C1, C2, and so on, in order")
    names = [task.name for task in tasks]
    if len(set(names)) != len(names):
        raise ValueError("two tasks have the same name")
    for task in tasks:
        if task.claim not in ids:
            raise ValueError(
                f"task {task.name} tests claim {task.claim}, which is not one of the claims"
            )
    tested = {task.claim for task in tasks}
    for claim_id in ids:
        if claim_id not in tested:
            raise ValueError(f"no task tests claim {claim_id}")


class ForgeProposalContent(ProtocolModel):
    """What the planner answers and a contributor corrects: claims, then tasks."""

    claims: list[ForgeSkillClaim] = Field(min_length=1, max_length=MAX_CLAIMS)
    tasks: list[ForgeProposedTask] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_claims(self) -> Self:
        _check_claims(self.claims, self.tasks)
        return self


class ForgeProposalRecord(ProtocolModel):
    """What a Skill claims to improve and the tasks that test each claim; never changed.

    A correction is a new proposal naming its parent. `proposal_digest` covers the Source Skill's
    digest, the claims and the tasks, so approving the tasks approves the claims with them.
    """

    schema_version: Literal["techtree.forge-proposal.v1alpha2"]
    proposal_id: NonEmptyString
    created_at: UtcDateTime
    source_id: NonEmptyString
    source_digest: Digest
    plan_id: NonEmptyString
    origin: Literal["planner", "contributor"]
    parent: ForgeProposalParent | None
    claims: list[ForgeSkillClaim] = Field(min_length=1, max_length=MAX_CLAIMS)
    tasks: list[ForgeProposedTask] = Field(min_length=1)
    proposal_digest: Digest

    @model_validator(mode="after")
    def validate_proposal(self) -> Self:
        if (self.origin == "contributor") != (self.parent is not None):
            raise ValueError("a contributor's proposal names its parent, no other does")
        _check_claims(self.claims, self.tasks)
        if not verify_object_digest(
            proposal_content(self.source_digest, self.claims, self.tasks), self.proposal_digest
        ):
            raise ValueError("proposal digest does not describe the claims and tasks")
        return self


def proposal_content(
    source_digest: Digest, claims: list[ForgeSkillClaim], tasks: list[ForgeProposedTask]
) -> dict[str, object]:
    """What a proposal digest covers: the Skill, its claims, the tasks."""
    return {
        "schema_version": FORGE_PROPOSAL_SCHEMA_VERSION,
        "source_digest": source_digest,
        "claims": claims,
        "tasks": tasks,
    }


#: Where a plan stands, read from its records.
type ForgePlanState = Literal[
    "prepared", "running", "succeeded", "rejected", "failed", "outcome_unknown"
]


class ForgePlanStatus(ProtocolModel):
    """A plan read back: `prepared` until approved, `running` while its caller lives, then its
    call's own state."""

    plan_id: NonEmptyString
    path: NonEmptyString
    state: ForgePlanState
    record: ForgePlanRecord
    approval: ForgeApproval | None
    call: ForgeModelCall | None


class ForgeProposalStatus(ProtocolModel):
    """A proposal read back from its directory."""

    proposal_id: NonEmptyString
    path: NonEmptyString
    record: ForgeProposalRecord


# ---------------------------------------------------------------------------
# Construction: building task packages from one reviewed proposal
# ---------------------------------------------------------------------------


class ForgeCreatorRecipe(ProtocolModel):
    """The building instructions and the package contract the creator follows."""

    name: Literal["skill2env-creator"]
    instructions_digest: Digest
    contract_digest: Digest
    base_image: NonEmptyString
    upstream_url: NonEmptyString
    upstream_revision: NonEmptyString


class ForgeConstructionCallReview(ProtocolModel):
    """One creator call an approval covers: the task, its claim and case, and the prompt."""

    task_name: ForgeProposedTaskName
    claim: ForgeClaimId
    kind: ForgeTaskKind
    package_name: Annotated[str, StringConstraints(pattern=r"^task_[a-z0-9-]+_[a-z0-9]{8}$")]
    prompt_bytes: int = Field(ge=1)
    prompt_digest: Digest


class ForgeConstructionDisclosure(ProtocolModel):
    """What leaves the machine: per call, one task and the Skill's files."""

    files: list[SkillFile] = Field(min_length=1)
    calls: list[ForgeConstructionCallReview] = Field(min_length=1)


class ForgeConstructionLimits(ProtocolModel):
    """The bounds one construction approval covers."""

    calls: int = Field(ge=1)
    attempts_per_call: Literal[1]
    wall_seconds_per_call: int = Field(ge=1)
    answer_bytes_per_call: int = Field(ge=1)


class ForgeConstructionReview(ProtocolModel):
    """Everything one construction approval covers, bound by one digest.

    `corrected_by` lists the proposal's corrections that existed when the review was made; a
    later one makes it stale. `source_skill` is the `provider/id` every package's `task.toml`
    names, and `platform` the Docker platform its image is built for.
    """

    proposal_id: NonEmptyString
    proposal_digest: Digest
    claims: list[ForgeSkillClaim] = Field(min_length=1, max_length=MAX_CLAIMS)
    corrected_by: list[NonEmptyString]
    source_id: NonEmptyString
    source_digest: Digest
    source_skill: Annotated[str, StringConstraints(pattern=r"^[a-zA-Z0-9_-]+/[a-zA-Z0-9._-]+$")]
    recipe: ForgeCreatorRecipe
    agent: ForgeAgentSpec
    model: ForgeModelSpec
    platform: ForgePlatform
    disclosure: ForgeConstructionDisclosure
    egress: Literal["model-provider"]
    capabilities: ForgeAuthoringCapabilities
    limits: ForgeConstructionLimits

    @model_validator(mode="after")
    def validate_calls(self) -> Self:
        names = [call.task_name for call in self.disclosure.calls]
        if len(set(names)) != len(names):
            raise ValueError("a construction calls the creator once per task")
        if self.limits.calls != len(names):
            raise ValueError("the call limit is the number of calls reviewed")
        return self


class ForgeConstructionRecord(ProtocolModel):
    """A prepared construction: its review and the digest an approval names."""

    schema_version: Literal["techtree.forge-construction.v1alpha2"]
    construction_id: NonEmptyString
    created_at: UtcDateTime
    review: ForgeConstructionReview
    construction_digest: Digest

    @model_validator(mode="after")
    def validate_digest(self) -> Self:
        if not verify_object_digest(self.review, self.construction_digest):
            raise ValueError("construction digest does not describe its review")
        return self


class ForgeConstructionRun(ProtocolModel):
    """The one pass an approval covers; `stopped` is `person` when Ctrl-C ended it early."""

    schema_version: Literal["techtree.forge-construction-run.v1alpha1"]
    construction_id: NonEmptyString
    process_id: int = Field(ge=1)
    started_at: UtcDateTime
    ended_at: UtcDateTime | None
    stopped: Literal["person"] | None

    @model_validator(mode="after")
    def validate_end(self) -> Self:
        if self.stopped is not None and self.ended_at is None:
            raise ValueError("a pass that was stopped has ended")
        return self


class ForgeConstructionPackage(ProtocolModel):
    """Where one written package went: the build that checked it, and what it kept."""

    schema_version: Literal["techtree.forge-construction-package.v1alpha2"]
    construction_id: NonEmptyString
    task_name: ForgeProposedTaskName
    claim: ForgeClaimId
    kind: ForgeTaskKind
    package_name: NonEmptyString
    build_id: NonEmptyString
    usable_tasks: int = Field(ge=0)
    failure: ForgeFailure | None

    @model_validator(mode="after")
    def validate_outcome(self) -> Self:
        if (self.usable_tasks == 0) != (self.failure is not None):
            raise ValueError("a package that cannot be used says why, no other does")
        return self


class ForgeCreatedFile(ProtocolModel):
    """One file of a package, as the creator answered it."""

    path: Annotated[str, StringConstraints(min_length=1, max_length=255)]
    text: str
    executable: bool


class ForgeCreatedPackage(ProtocolModel):
    """A creator's answer: the task's words and files, but not `task.toml`, which Techtree
    writes from the pinned contract."""

    description: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    keywords: list[Annotated[str, StringConstraints(min_length=1, max_length=64)]] = Field(
        min_length=1, max_length=8
    )
    artifacts: list[Annotated[str, StringConstraints(min_length=2, max_length=255)]] = Field(
        min_length=1, max_length=16
    )
    files: list[ForgeCreatedFile] = Field(min_length=1, max_length=64)


type ForgeConstructionState = Literal["prepared", "running", "finished", "stopped"]
type ForgeConstructionCallState = Literal[
    "not_called", "running", "succeeded", "rejected", "failed", "outcome_unknown"
]


class ForgeTaskCorrectionChange(ProtocolModel):
    """One file or folder a correction added, removed or modified."""

    path: NonEmptyString
    change: Literal["added", "removed", "modified"]


class ForgeTaskCorrection(ProtocolModel):
    """A person's correction of one task of an ended construction, recorded once it qualified.

    `replaces` is the build of the package it corrects (the newest earlier correction, else the
    creator's package, else None), and `changes` are worked out against it.
    """

    schema_version: Literal["techtree.forge-task-correction.v1alpha1"]
    construction_id: NonEmptyString
    task_name: ForgeProposedTaskName
    corrected_at: UtcDateTime
    replaces: NonEmptyString | None
    replaced_digest: Digest | None
    build_id: NonEmptyString
    content_digest: Digest
    changes: list[ForgeTaskCorrectionChange] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_replaced(self) -> Self:
        if self.replaced_digest is not None and self.replaces is None:
            raise ValueError("a replaced package's digest names its build")
        if self.replaced_digest == self.content_digest:
            raise ValueError("a correction changes the package it replaces")
        paths = [change.path for change in self.changes]
        if paths != sorted(set(paths)):
            raise ValueError("changed paths are unique and sorted")
        return self


class ForgeConstructionTaskStatus(ProtocolModel):
    """One task of a construction: its call, its package, and corrections, oldest first."""

    task_name: ForgeProposedTaskName
    package_name: NonEmptyString
    state: ForgeConstructionCallState
    call: ForgeModelCall | None
    package: ForgeConstructionPackage | None
    corrections: list[ForgeTaskCorrection]


class ForgeConstructionStatus(ProtocolModel):
    """A construction read back.

    `prepared` until approved, `running` while its pass's process lives, `finished` when the pass
    ended on its own, and `stopped` when Ctrl-C ended it or its process went before it ended.
    """

    construction_id: NonEmptyString
    path: NonEmptyString
    state: ForgeConstructionState
    record: ForgeConstructionRecord
    approval: ForgeApproval | None
    run: ForgeConstructionRun | None
    tasks: list[ForgeConstructionTaskStatus]


# ---------------------------------------------------------------------------
# Collections
# ---------------------------------------------------------------------------


class ForgeCollectionCandidate(ProtocolModel):
    """One proposed task as acceptance shows it.

    `build_id` names the build of the newest correction, else the creator's package's build, and
    `usable` is whether that build qualified it. `why` is what stopped a call that made nothing.
    """

    task_name: ForgeProposedTaskName
    state: ForgeConstructionCallState
    corrections: list[ForgeTaskCorrection]
    build_id: NonEmptyString | None
    usable: bool
    why: NonEmptyString | None

    @model_validator(mode="after")
    def validate_outcome(self) -> Self:
        if self.corrections and (not self.usable or self.build_id != self.corrections[-1].build_id):
            raise ValueError("a corrected task is its newest correction's build")
        if self.usable and (
            self.build_id is None or (self.why is not None and not self.corrections)
        ):
            raise ValueError("a usable task names its build and no reason it stopped")
        return self


#: Which part of a collection a task is in: the tasks an improving agent may study, or the
#: tasks held out from it, on which a revision is judged.
type ForgeCollectionPart = Literal["study", "held_out"]

#: The fewest tasks a collection holds: at least one in each part.
MINIMUM_COLLECTION_TASKS: Final = 2


def collection_parts(
    proposal_digest: str, members: Sequence[tuple[str, str]]
) -> list[ForgeCollectionPart]:
    """Each task's part, in the order given; nobody chooses it.

    `members` are (task name, fingerprint) pairs. They are ranked by the SHA-256 of
    `proposal_digest:fingerprint`, ties broken by name, and the first half, rounded down, are
    held out; a single task is held out. The result never depends on the order given.
    """
    ranked = sorted(
        range(len(members)),
        key=lambda index: (
            hashlib.sha256(f"{proposal_digest}:{members[index][1]}".encode()).hexdigest(),
            members[index][0],
        ),
    )
    held = max(len(members) // 2, 1)
    parts: dict[int, ForgeCollectionPart] = {
        index: "held_out" if rank < held else "study" for rank, index in enumerate(ranked)
    }
    return [parts[index] for index in range(len(members))]


class ForgeCollectionMember(ProtocolModel):
    """One accepted task: exactly the bytes and the qualification it had.

    `fingerprint` identifies the task whatever it was built as: the digest of its files other than
    the `task.toml` Techtree writes. `part` is given by `collection_parts`, not by the author.
    """

    task_name: ForgeProposedTaskName
    claim: ForgeClaimId
    kind: ForgeTaskKind
    build_id: NonEmptyString
    task_id: ForgeTaskId
    content_digest: Digest
    fingerprint: Digest
    qualification_digest: Digest
    part: ForgeCollectionPart


class ForgeCollectionReview(ProtocolModel):
    """What accepting a collection covers.

    Every task of the proposal with its outcome, so nothing that failed is out of sight, and the
    exact members, each by its content and qualification digests and its part. `source_name` is
    the name the Source Skill declares, so the collection names its Skill by name and digest.
    """

    proposal_id: NonEmptyString
    proposal_digest: Digest
    claims: list[ForgeSkillClaim] = Field(min_length=1, max_length=MAX_CLAIMS)
    source_id: NonEmptyString
    source_name: AgentSkillName
    source_digest: Digest
    construction_id: NonEmptyString
    tasks: list[ForgeCollectionCandidate] = Field(min_length=1)
    members: list[ForgeCollectionMember] = Field(min_length=MINIMUM_COLLECTION_TASKS)
    membership_digest: Digest

    @model_validator(mode="after")
    def validate_membership(self) -> Self:
        usable = {task.task_name for task in self.tasks if task.usable}
        names = [member.task_name for member in self.members]
        if len(set(names)) != len(names) or not set(names) <= usable:
            raise ValueError("members are distinct tasks that qualified")
        if len({member.fingerprint for member in self.members}) != len(self.members):
            raise ValueError("no two members have the same files")
        claims = {claim.claim_id for claim in self.claims}
        if not {member.claim for member in self.members} <= claims:
            raise ValueError("every member tests one of the proposal's claims")
        if [member.part for member in self.members] != collection_parts(
            self.proposal_digest,
            [(member.task_name, member.fingerprint) for member in self.members],
        ):
            raise ValueError("each task's part is the one the rule gives it")
        if not verify_object_digest(self.members, self.membership_digest):
            raise ValueError("membership digest does not describe the members")
        return self

    def parts(self) -> dict[str, ForgeCollectionPart]:
        """Each member's part by its task id."""
        return {member.task_id: member.part for member in self.members}


class ForgeCollectionRecord(ProtocolModel):
    """A prepared collection: its review and the digest acceptance names."""

    schema_version: Literal["techtree.forge-collection.v1alpha4"]
    collection_id: NonEmptyString
    created_at: UtcDateTime
    review: ForgeCollectionReview
    collection_digest: Digest

    @model_validator(mode="after")
    def validate_digest(self) -> Self:
        if not verify_object_digest(self.review, self.collection_digest):
            raise ValueError("collection digest does not describe its review")
        return self


class ForgeCollectionStatus(ProtocolModel):
    """A collection read back; `accepted` means frozen."""

    collection_id: NonEmptyString
    path: NonEmptyString
    state: Literal["prepared", "accepted"]
    record: ForgeCollectionRecord
    acceptance: ForgeApproval | None


class ForgeExportTask(ProtocolModel):
    """One accepted task as an export carries it: its build record and its qualification."""

    build: ForgeBuildRecord
    qualification: TaskQualification


class ForgeExport(ProtocolModel):
    """`export.json`: one accepted collection, as its records state it.

    `tasks` follows the collection's members in order. `readme_digest` is the SHA-256 of the
    README written beside it.
    """

    schema_version: Literal["techtree.forge-export.v1alpha4"]
    exported_at: UtcDateTime
    collection: ForgeCollectionRecord
    acceptance: ForgeApproval
    tasks: list[ForgeExportTask] = Field(min_length=MINIMUM_COLLECTION_TASKS)
    readme_digest: Digest
