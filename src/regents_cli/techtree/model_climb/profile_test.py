"""A compatibility profile's paid step (contract 7.4 steps 2 and 3), and the plan it runs on.

`draft_plan` writes the plan a grant is issued against: a dataset release, a benchmark release,
a study and a recipe that say exactly what the test is (four public fixtures, one pinned tuple,
no claim about quality), and a resolved plan that reserves the money and names the compute.

`advance` takes a grant one step and never waits: it submits the one batch job, or looks at
the job already submitted, or, once the provider says the job has ended, reads what it
measured, judges it and writes the measured profile. A submission needs the grant to admit it;
a look at a job already submitted does not, so a grant that has expired or been revoked never
leaves a job unread. Running the command again is how a person or an agent looks again. The
job measures and this module judges: coverage, the nonzero adapter and whether the adapter
changes the output are all decided here.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from importlib.resources import files as resource_files
from pathlib import Path
from typing import Any, Final, Literal

from pydantic import ValidationError as PydanticValidationError

from regents_cli import output
from regents_cli.techtree import fs
from regents_cli.techtree.canonical import digest_object, sha256_digest_bytes
from regents_cli.techtree.errors import (
    ConflictError,
    PolicyError,
    TechtreeError,
    ValidationError,
)
from regents_cli.techtree.identity.models import ExecutorIdentity
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.ids import new_id
from regents_cli.techtree.model_climb import grants, ledger, profiles
from regents_cli.techtree.model_climb.attempts import Journal, submit_once
from regents_cli.techtree.model_climb.contracts import (
    AttemptEnd,
    BenchmarkRelease,
    BenchmarkReleaseSpec,
    BudgetReservation,
    Budgets,
    ComputeTarget,
    Created,
    DataPolicy,
    DatasetRelease,
    DatasetReleaseSpec,
    ExecutionGrant,
    HarnessProfile,
    LoraConfig,
    Metrics,
    ModelStudySpec,
    ModelStudySpecSpec,
    Optimizer,
    PriceQuote,
    ResolvedModelPlan,
    ResolvedModelPlanSpec,
    SamplingProtocol,
    SelectionRule,
    SnapshotOperational,
    SplitCommitment,
    SplitCommitments,
    StudyOperational,
    TrainerRef,
    TrainingLimits,
    TrainingRecipe,
    TrainingRecipeSpec,
    VerifierRef,
    seal,
)
from regents_cli.techtree.model_climb.data import MINIMUM_SALT_BYTES, split_commitment
from regents_cli.techtree.model_climb.provider import (
    BUDGET_EXHAUSTED,
    MICROS_PER_CENT,
    UNSUPPORTED_CAPABILITY,
    Autoresearch,
    Job,
    ProviderError,
    Receipt,
    SubmissionRefusedError,
    UnreadableAnswerError,
    cents,
)
from regents_cli.techtree.model_climb.store import ModelClimbStore
from regents_cli.techtree.models.base import Digest, JsonValue, ObjectEnvelope, ProtocolModel

IMAGE_FOLDER: Final = "model-climb-image"
DOCKERFILE: Final = "Dockerfile.gpu"
COMMAND: Final = "/opt/prime-rl/.venv/bin/python /opt/m0/job.py"
#: The job's success check: the file its script writes only when every step ran to its end.
PROFILE_FILE: Final = "/output/profile.json"
FIXTURES: Final = "fixtures.jsonl"
OUTPUT_SCHEMA: Final = "invoice-fields.schema.json"
#: The fixture Verifiers runs, and the only one that decides whether the adapter changes
#: the output.
DECIDING_FIXTURE: Final = "invoice-fields"
VERIFIERS_VERSION: Final = "0.3.2.dev208"
EGRESS: Final = ("huggingface.co",)
PLAN_LIFETIME: Final = timedelta(hours=24)
#: An attempt's folder: the job as submitted, and the month's image-build usage read before it.
JOB_FILE: Final = "job.json"
BUILDS_BEFORE_FILE: Final = "builds-before.json"
JOURNAL_FILE: Final = "journal.jsonl"
#: The provider stops an image build here; it is the only limit on the build (contract 6.1).
BUILD_TIMEOUT_MINUTES: Final = 60
#: A grant states its hours in hundredths, which say a whole number of minutes exactly only
#: when that number is a multiple of this; a plan's minutes are one, so plan, grant and job
#: name the same figure.
MINUTE_STEP: Final = 3
#: What Dockerfile.gpu sets so that a step which tries to install fails instead (contract 6.1):
#: uv may resolve nothing and has no package index to fetch from.
PACKAGE_TOOLS: Final[dict[str, str | None]] = {"UV_FROZEN": "1", "UV_NO_INDEX": "1"}
#: What Dockerfile.gpu sets so that vLLM sends its maker no usage report, which would be a
#: host the plan does not declare.
USAGE_REPORTS: Final[dict[str, str | None]] = {"VLLM_NO_USAGE_STATS": "1", "DO_NOT_TRACK": "1"}
#: The adapter's log-probabilities must move by more than this, and by more than this many
#: times what two identical requests to the base model differ by (contract 7.4).
SIGNAL_FLOOR: Final = 0.01
SIGNAL_OVER_NOISE: Final = 10

HUB_TOKEN: Final = "none: the pinned model is public, and the job holds no token of any kind"
INSTALLS: Final = (
    "Every Python package is the wheel a lock names by sha256, or the git commit it pins: "
    "prime-rl's own lock, and the lock in the image folder for the small program Verifiers "
    "runs as the model's side of an evaluation. Two things are not pinned by hash: the tools "
    "that build the few packages installed from source, fetched when the image is built, and "
    "Ubuntu's system packages, which come from its signed archive into a base image named by "
    "digest. Nothing is installed while the job runs."
)
EGRESS_NOTE: Final = "declared and not enforced by the provider"
LIMITATIONS: Final = (
    "validation rows are the training rows; nothing here measures quality",
    "certifies this one tuple of model, trainer, server and hardware, and no other",
)

_MESSAGE: Final[dict[str, JsonValue]] = {
    "type": "object",
    "properties": {
        "role": {"enum": ["system", "user", "assistant"]},
        "content": {"type": "string"},
    },
    "required": ["role", "content"],
    "additionalProperties": False,
}
_MESSAGES: Final[dict[str, JsonValue]] = {"type": "array", "items": _MESSAGE, "minItems": 1}
#: A fixture row: a conversation, whole or split into its prompt and its completion.
ROW_SCHEMA: Final[dict[str, JsonValue]] = {
    "oneOf": [
        {
            "type": "object",
            "properties": {"id": {"type": "string"}, "messages": _MESSAGES},
            "required": ["id", "messages"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "prompt": _MESSAGES,
                "completion": _MESSAGES,
            },
            "required": ["id", "prompt", "completion"],
            "additionalProperties": False,
        },
    ]
}


# The image the provider builds: the Dockerfile and every file beside it.


def build_context() -> dict[str, str]:
    folder = resource_files("regents_cli.techtree") / "resources" / IMAGE_FOLDER
    return {
        entry.name: entry.read_text(encoding="utf-8")
        for entry in sorted(folder.iterdir(), key=lambda entry: entry.name)
        if entry.is_file()
    }


def context_digest(context: dict[str, str]) -> Digest:
    """A recipe's image digest when the provider builds the image (contract 3.2)."""
    return digest_object(
        {name: sha256_digest_bytes(text.encode("utf-8")) for name, text in context.items()}
    )


def _files_digest(files: dict[str, str]) -> Digest:
    return digest_object({name: f"sha256:{sha256}" for name, sha256 in files.items()})


# The model-free report a plan stands on.


def dry_run_report(store: ModelClimbStore, profile: profiles.Profile) -> tuple[Path, Digest]:
    """The newest `profile check --dry-run` report that found no problem with this profile's
    settings as they are now, and its digest."""
    folder = store.profiles_dir / profile.name
    for path in sorted(folder.glob("*-dry-run.json"), reverse=True):
        report: Any = fs.read_json(path)
        passed = [check["status"] == "pass" for check in report["checks"]]
        if report["recipe"] == profile.recipe and all(passed):
            return path, digest_object(report)
    raise ValidationError(
        f"no model-free check of {profile.name} with its current settings has found no "
        f"problem on this machine. Run regents techtree model-climb profile check "
        f"{profile.name} --dry-run first.",
        details={"profile": profile.name},
    )


def _layer_types(store: ModelClimbStore, profile: profiles.Profile, digest: Digest) -> list[str]:
    """The kinds of the model's text layers, from the model-free report the plan names."""
    for path in (store.profiles_dir / profile.name).glob("*-dry-run.json"):
        report: Any = fs.read_json(path)
        if digest_object(report) == digest:
            return list(report["modules"]["layer_types"])
    raise ConflictError(
        f"the model-free report {digest} the plan stands on is no longer on this machine",
        code=grants.PLAN_CHANGED,
        details={"compatibility_profile": digest},
    )


# The plan.


def mission_name(profile: profiles.Profile) -> str:
    """The operator's mission every job of this profile is filed under (contract 6.1)."""
    return f"model-climb-{profile.name}"


def job_minutes(
    max_cents: int, cents_per_gpu_hour: int, gpu_count: int, wall_seconds: int | None = None
) -> int:
    """The minutes a job is given (contract 6.1): the largest multiple of three whose cost at
    the plan's rate is no more than `max_cents` and, under a grant, that fits its wall time."""
    minutes = max_cents * 60 // (cents_per_gpu_hour * gpu_count)
    if wall_seconds is not None:
        minutes = min(minutes, wall_seconds // 60)
    return minutes - minutes % MINUTE_STEP


def granted_minutes(grant: ExecutionGrant, plan: ResolvedModelPlan) -> int:
    """The minutes the job gets under `grant`, which are fewer than the plan's when the grant
    is tighter. The grant's review and the job itself both take the figure from here."""
    return job_minutes(
        grant.max_cents,
        plan.spec.budget.prices[0].cents_per_hour,
        grant.gpu_count,
        grant.max_wall_time_seconds,
    )


def build_notice(max_cents: int, minutes: int, gpu_count: int) -> str:
    """What a grant's figure covers and what it does not (contract 6.1)."""
    figure = f"${max_cents // 100}.{max_cents % 100:02d}"
    return (
        f"The {figure} is for GPU time only: {minutes} minutes on {gpu_count} GPUs. Building "
        "the software image is billed separately by the provider: it stops the build at "
        f"{BUILD_TIMEOUT_MINUTES} minutes, it is free within the provider's monthly allowance, "
        "and past that it is charged at a rate the provider does not publish. That charge is "
        f"not in the {figure}."
    )


def cents_per_gpu_hour(micros_per_gpu_minute: int) -> int:
    return cents(micros_per_gpu_minute * 60)


@dataclass(frozen=True)
class Drafted:
    plan: ResolvedModelPlan
    minutes: int
    micros_per_gpu_minute: int
    worst_case_cents: int
    report_path: Path


def draft_plan(
    store: ModelClimbStore,
    profile: profiles.Profile,
    *,
    max_cents: int,
    micros_per_gpu_minute: int,
    now: datetime,
) -> Drafted:
    """Write the test's plan and the four objects it names into the store."""
    report_path, report_digest = dry_run_report(store, profile)
    minutes = job_minutes(max_cents, cents_per_gpu_hour(micros_per_gpu_minute), profile.gpu_count)
    if minutes < MINUTE_STEP:
        raise ValidationError(
            f"{max_cents} cents buys less than {MINUTE_STEP} minutes on {profile.gpu_count} "
            f"{profile.gpu_model} GPUs at the rate read now",
            details={"micros_per_gpu_minute": micros_per_gpu_minute},
        )
    context = build_context()
    rows = _fixture_rows(context)
    dataset = _dataset(store, profile, context, rows, now)
    benchmark = _benchmark(context, dataset, profile, now)
    study = _study(profile, rows, dataset, benchmark, max_cents, minutes, now)
    recipe = _recipe(profile, context, now)
    plan = seal(
        ResolvedModelPlan,
        ResolvedModelPlanSpec(
            study=study.digest,
            dataset_release=dataset.digest,
            benchmark_release=benchmark.digest,
            recipe=recipe.digest,
            compute=ComputeTarget(
                provider="sfcompute_autoresearch",
                mission=mission_name(profile),
                gpu_model=profile.gpu_model,
                gpu_count=profile.gpu_count,
            ),
            egress=[*EGRESS],
            compatibility_profile=report_digest,
            budget=BudgetReservation(
                amount_cents=max_cents,
                enforcement="bounded_operational_limit",
                shutdown_allowance_cents=0,
                credit_ceiling_attested=True,
                prices=[
                    PriceQuote(
                        item=f"{profile.gpu_model} batch, per GPU",
                        cents_per_hour=cents_per_gpu_hour(micros_per_gpu_minute),
                    )
                ],
            ),
            expires_at=now + PLAN_LIFETIME,
        ),
        Created(created_at=now),
    )
    for value in (dataset, benchmark, study, recipe, plan):
        # The same science sealed at another moment is the same object: the stored one stays.
        if not store.object_path(value.digest).exists():
            store.put(value)
    return Drafted(
        plan=plan,
        minutes=minutes,
        micros_per_gpu_minute=micros_per_gpu_minute,
        worst_case_cents=cents(minutes * micros_per_gpu_minute * profile.gpu_count),
        report_path=report_path,
    )


def _fixture_rows(context: dict[str, str]) -> list[dict[str, JsonValue]]:
    return [json.loads(line) for line in context[FIXTURES].splitlines() if line.strip()]


def _split_salt(store: ModelClimbStore, profile: profiles.Profile) -> bytes:
    """This machine's salt for the profile's split commitments, made once and never sent."""
    path = store.profiles_dir / profile.name / "split-salt"
    if not path.exists():
        fs.atomic_write_bytes(path, os.urandom(MINIMUM_SALT_BYTES))
    return path.read_bytes()


def _dataset(
    store: ModelClimbStore,
    profile: profiles.Profile,
    context: dict[str, str],
    rows: list[dict[str, JsonValue]],
    now: datetime,
) -> DatasetRelease:
    salt = _split_salt(store, profile)
    row_ids = [str(row["id"]) for row in rows]
    every_row = SplitCommitment(commitment=split_commitment(salt, row_ids), rows=len(row_ids))
    return seal(
        DatasetRelease,
        DatasetReleaseSpec(
            snapshot_digest=sha256_digest_bytes(context[FIXTURES].encode("utf-8")),
            source_lineage=[],
            rights_class="public_synthetic",
            row_schema_digest=digest_object(ROW_SCHEMA),
            transformation_digest=None,
            feature_cutoff_rule="none: the rows are synthetic and hold no dated feature",
            label_policy="none: each row was written with its answer",
            duplicate_cluster_rule="none: four hand-written rows, each its own cluster",
            splits=SplitCommitments(
                train=every_row,
                # The same four rows: the test shows the stack runs, and measures no quality.
                validation=every_row,
                proving=SplitCommitment(commitment=split_commitment(salt, []), rows=0),
                debug=None,
            ),
            exclusions={},
        ),
        SnapshotOperational(
            snapshot_handle=f"regents-cli:{IMAGE_FOLDER}/{FIXTURES}", created_at=now
        ),
    )


def _benchmark(
    context: dict[str, str], dataset: DatasetRelease, profile: profiles.Profile, now: datetime
) -> BenchmarkRelease:
    settings = profile.settings
    return seal(
        BenchmarkRelease,
        BenchmarkReleaseSpec(
            dataset_release=dataset.digest,
            verifier=VerifierRef(
                package="verifiers", version=VERIFIERS_VERSION, environment=settings.taskset
            ),
            proving_commitment=dataset.spec.splits.proving.commitment,
            output_schema_digest=digest_object(json.loads(context[OUTPUT_SCHEMA])),
            sampling=SamplingProtocol(
                temperature=settings.eval_temperature,
                max_output_tokens=settings.eval_max_tokens,
                samples_per_case=1,
                seed=settings.seed,
            ),
            scorer_test_digest=None,
            qualification_report_digest=None,
        ),
        Created(created_at=now),
    )


def _study(
    profile: profiles.Profile,
    rows: list[dict[str, JsonValue]],
    dataset: DatasetRelease,
    benchmark: BenchmarkRelease,
    max_cents: int,
    minutes: int,
    now: datetime,
) -> ModelStudySpec:
    [deciding] = [row for row in rows if row["id"] == DECIDING_FIXTURE]
    messages = deciding["messages"]
    assert isinstance(messages, list)
    return seal(
        ModelStudySpec,
        ModelStudySpecSpec(
            workspace="local",
            task_kind="structured_prediction",
            hypothesis=(
                "The pinned Qwen3.5-9B, prime-rl and vLLM tuple trains, exports and serves a "
                "LoRA adapter on two H100s."
            ),
            mutation="model_weights",
            baseline=profile.model,
            baseline_weights_digest=_files_digest(profile.weight_files),
            baseline_tokenizer_digest=_files_digest(profile.tokenizer_files),
            harness=HarnessProfile(
                prompt_digest=digest_object(messages[:-1]),
                output_schema_digest=benchmark.spec.output_schema_digest,
                decision_policy_digest=None,
            ),
            dataset_release=dataset.digest,
            benchmark_release=benchmark.digest,
            selection=SelectionRule(
                split="validation", rule="the adapter at the last step", candidate_limit=1
            ),
            metrics=Metrics(
                primary="fixture_reward",
                constraints=[],
                minimum_positives=1,
                minimum_negatives=1,
            ),
            budgets=Budgets(
                training_max_cents=max_cents,
                evaluation_max_cents=0,
                inference_trial_max_cents=0,
                maximum_wall_time_seconds=minutes * 60,
                maximum_parallel_jobs=1,
            ),
            data_policy=DataPolicy(
                export_beyond_approved_boundary="denied",
                external_teacher="denied",
                external_judge="denied",
                monitoring_upload="denied",
                public_publication="denied",
                chatgpt_projection="denied",
            ),
        ),
        StudyOperational(label=f"{profile.name} compatibility test", created_at=now),
    )


def _recipe(profile: profiles.Profile, context: dict[str, str], now: datetime) -> TrainingRecipe:
    settings = profile.settings
    return seal(
        TrainingRecipe,
        TrainingRecipeSpec(
            trainer=TrainerRef(
                name="prime-rl",
                revision=profile.trainer_revision,
                lock_digest=f"sha256:{profile.trainer_lock_sha256}",
            ),
            image_digest=context_digest(context),
            model=profile.model,
            renderer=profile.renderer,
            loss_mask="assistant_only",
            lora=LoraConfig(
                rank=settings.rank,
                alpha=settings.alpha,
                dropout=settings.dropout,
                targets=profile.targets,
                expected_modules=profile.expected_modules,
            ),
            optimizer=Optimizer(
                name="AdamW",
                learning_rate=settings.learning_rate,
                weight_decay=settings.weight_decay,
                optimization_dtype="bfloat16",
                reduce_dtype="bfloat16",
            ),
            seed=settings.seed,
            limits=TrainingLimits(
                micro_batch_size=settings.micro_batch_size,
                batch_size=settings.batch_size,
                max_context_tokens=settings.max_context_tokens,
                max_steps=settings.max_steps,
            ),
            checkpoint_selection="none: the adapter written at the last step",
        ),
        Created(created_at=now),
    )


# The job.


def job_body(
    profile: profiles.Profile, plan: ResolvedModelPlan, context: dict[str, str], minutes: int
) -> dict[str, JsonValue]:
    """The one batch job (contract 6.1), less the intent id it is submitted under."""
    spec: dict[str, JsonValue] = {
        "profile": profile.name,
        "model": profile.model.model_dump(mode="json"),
        "recipe": profile.recipe,
        "weight_files": {**profile.weight_files},
        "tokenizer_files": {**profile.tokenizer_files},
    }
    return {
        "chip": plan.spec.compute.gpu_model,
        "chip_count": plan.spec.compute.gpu_count,
        "mission": plan.spec.compute.mission,
        # Each file as the provider's API takes it: an object holding the text.
        "context": {name: {"content": text} for name, text in context.items()},
        "dockerfile_path": DOCKERFILE,
        "build_timeout_minutes": BUILD_TIMEOUT_MINUTES,
        "command": COMMAND,
        # The job's settings and nothing else: no key and no token (contract 6.1).
        "env": {"MODEL_CLIMB_JOB": json.dumps(spec, sort_keys=True)},
        "model": f"{profile.model.model_id}@{profile.model.revision}",
        "checks": {"success": {"check": {"type": "file_exists", "path": PROFILE_FILE}}},
        "max_duration_minutes": minutes,
        "max_restarts": 0,
        "resume": "none",
    }


@dataclass(frozen=True)
class _Submission:
    """One job body at the provider, submitted and looked up under an attempt's intent id."""

    provider: Autoresearch
    body: dict[str, JsonValue]
    #: How long the provider may hold the job in its queue before dropping it.
    queue_ttl_minutes: int

    def submit(self, intent_id: str) -> str:
        return self.provider.submit(
            {
                **self.body,
                "idempotency_key": intent_id,
                "label": intent_id,
                "queue_ttl_minutes": self.queue_ttl_minutes,
            }
        )

    def find(self, intent_id: str) -> str | None:
        return self.provider.find(intent_id)


# What the job writes to $GMN_RESULT_PATH (resources/model-climb-image/job.py).


class GpuSeen(ProtocolModel):
    index: str
    name: str
    memory_total_mib: int
    driver: str


class JobEnvironment(ProtocolModel):
    gpus: list[GpuSeen]
    cuda: str | None
    kernel: str
    machine: str
    python: str
    prime_rl_revision: str
    packages: dict[str, str]
    #: uv's settings as the job saw them, by name; None for one that was not set.
    package_tools: dict[str, str | None]
    usage_reports: dict[str, str | None]


class Downloaded(ProtocolModel):
    seconds: int
    files_checked: int


class Trained(ProtocolModel):
    seconds: int
    resolved: JsonValue


class Adapter(ProtocolModel):
    step: int
    sha256: str
    config: JsonValue
    modules: list[str]
    zero_lora_b: list[str]


class FixtureRun(ProtocolModel):
    taskset: str
    pushed: bool
    episodes: int
    rewards: list[float | None]


class Compared(ProtocolModel):
    id: str
    structured_output: bool
    base_text: str
    base_again_text: str
    adapter_text: str
    noise: float | None
    signal: float | None


class Stopped(ProtocolModel):
    step: str
    reason: str


class JobResult(ProtocolModel):
    profile: str
    completed: bool
    gpu_peak_memory_mib: dict[str, int]
    environment: JobEnvironment | None = None
    download: Downloaded | None = None
    train: Trained | None = None
    adapter: Adapter | None = None
    verifiers: FixtureRun | None = None
    answers: list[Compared] | None = None
    stopped: Stopped | None = None


type OutputCase = Literal["inconclusive", "text_differs", "logprobs_differ", "unchanged"]


def output_case(row: Compared) -> OutputCase:
    """Whether the adapter changed the base model's output on one fixture (contract 7.4)."""
    if row.base_text != row.base_again_text:
        return "inconclusive"
    if row.adapter_text != row.base_text:
        return "text_differs"
    if (
        row.signal is not None
        and row.noise is not None
        and row.signal > SIGNAL_FLOOR
        and row.signal > SIGNAL_OVER_NOISE * row.noise
    ):
        return "logprobs_differ"
    return "unchanged"


_CASE_DETAIL: Final[dict[OutputCase, str]] = {
    "inconclusive": "two identical requests to the base model gave different text, so nothing "
    "can be concluded",
    "text_differs": "the adapter's text differs from the base model's",
    "logprobs_differ": "the text is the same and the adapter moved its log-probabilities",
    "unchanged": "the text is the same and the log-probabilities did not move enough",
}


def judge(
    profile: profiles.Profile, job: Job, result: JobResult | None, layer_types: list[str]
) -> list[output.Check]:
    """The measured profile's checks. A step the job never reached has no check, and the
    first check says where the job stopped."""
    checks: list[output.Check] = []

    def check(label: str, holds: bool, detail: str) -> None:
        checks.append(output.Check(label, "pass" if holds else "fail", detail))

    if result is None:
        check("Job", False, f"the job ended {job.status} and its result can't be read")
        return checks
    stopped = result.stopped
    check(
        "Job",
        job.status == "succeeded" and result.completed,
        f"the job ended {job.status}"
        + (f"; it stopped at {stopped.step}: {stopped.reason}" if stopped else ""),
    )
    if result.environment is not None:
        seen = result.environment
        check(
            "Pinned trainer",
            seen.prime_rl_revision == profile.trainer_revision,
            f"prime-rl {seen.prime_rl_revision}",
        )
        check(
            "GPUs",
            len(seen.gpus) == profile.gpu_count,
            ", ".join(f"{gpu.name} (driver {gpu.driver})" for gpu in seen.gpus) or "none",
        )
        check(
            "Package tools closed",
            seen.package_tools == PACKAGE_TOOLS,
            "inside the job uv was set to resolve nothing and to use no package index"
            if seen.package_tools == PACKAGE_TOOLS
            else f"inside the job uv's settings were {seen.package_tools}",
        )
        check(
            "Usage reports off",
            seen.usage_reports == USAGE_REPORTS,
            "inside the job vLLM was set to send its maker no usage report"
            if seen.usage_reports == USAGE_REPORTS
            else f"inside the job the settings were {seen.usage_reports}",
        )
    if result.download is not None:
        pinned = len(profile.weight_files) + len(profile.tokenizer_files)
        check(
            "Pinned model files",
            result.download.files_checked == pinned,
            f"{result.download.files_checked} of {pinned} weight and tokenizer files match "
            "their pinned sha256",
        )
    if result.train is not None:
        checks.extend(profiles.config_checks(result.train.resolved))
    if result.adapter is not None:
        adapter = result.adapter
        check(
            "Trained to the last step",
            adapter.step == profile.settings.max_steps,
            f"the adapter was written at step {adapter.step} of {profile.settings.max_steps}",
        )
        found = profiles.coverage(profile, adapter.modules, layer_types=layer_types)
        check(
            "LoRA coverage",
            found.holds,
            f"the adapter holds {found.matched} modules, {found.expected} expected"
            + (
                ""
                if found.holds
                else f"; {len(found.missing)} missing, {len(found.unexpected)} unexpected"
            ),
        )
        check(
            "Adapter trained",
            not adapter.zero_lora_b,
            "every lora_B tensor is nonzero"
            if not adapter.zero_lora_b
            else f"{len(adapter.zero_lora_b)} lora_B tensors are still zero",
        )
    if result.verifiers is not None:
        ran = result.verifiers
        scored = ran.episodes == 1 and None not in ran.rewards
        check(
            "Verifiers fixture",
            scored and not ran.pushed,
            f"{ran.taskset} ran {ran.episodes} time(s) against the adapter on a fresh vLLM, "
            f"reward {ran.rewards}, nothing uploaded"
            if scored
            else f"{ran.taskset} ran {ran.episodes} time(s) and an episode ended in an error",
        )
    if result.answers is not None:
        deciding = [row for row in result.answers if row.id == DECIDING_FIXTURE]
        case = output_case(deciding[0]) if len(deciding) == 1 else None
        check(
            "Adapter changes the output",
            case in ("text_differs", "logprobs_differ"),
            _CASE_DETAIL[case] if case else f"the job did not answer for {DECIDING_FIXTURE}",
        )
    return checks


# One step of an attempt.


@dataclass(frozen=True)
class Waiting:
    """The job is submitted and has not ended."""

    intent_id: str
    job_id: str
    status: str
    #: What the provider says the job is waiting for while it is queued, as it says it.
    wait_reason: str | None
    max_cost_cents: int


@dataclass(frozen=True)
class Measured:
    """The job has ended and its measured profile is written."""

    intent_id: str
    job_id: str
    path: Path
    digest: Digest
    document: dict[str, JsonValue]
    checks: list[output.Check]


def advance(
    store: ModelClimbStore,
    service: IdentityService,
    provider: Autoresearch,
    profile: profiles.Profile,
    envelope: ObjectEnvelope[ExecutionGrant],
    *,
    now: datetime,
) -> Waiting | Measured:
    """One step of the grant's attempt: begin it and submit its job, or look at the job it
    has. The ledger is held throughout, so two commands started together cannot both find a
    use left and both submit."""
    with ledger.held(store.ledger_path):
        return _advance(store, service, provider, profile, envelope, now)


def _advance(
    store: ModelClimbStore,
    service: IdentityService,
    provider: Autoresearch,
    profile: profiles.Profile,
    envelope: ObjectEnvelope[ExecutionGrant],
    now: datetime,
) -> Waiting | Measured:
    identity = service.ensure()
    grant = envelope.payload
    intent_id = unfinished(store, identity, envelope)
    # The job is dropped from the provider's queue while the grant still has the time an
    # image build may take, so it cannot start under a grant that has run out.
    queue_minutes = int((grant.expires_at - now).total_seconds()) // 60 - BUILD_TIMEOUT_MINUTES
    if intent_id is None or Journal(store.attempts_dir / intent_id / JOURNAL_FILE).latest() is None:
        # Nothing has been sent for this attempt, so this run may submit. Only here must the
        # grant still admit the job and the plan still be the one this regents-cli would write.
        intent_id = _ready(
            store, provider, profile, envelope, identity, intent_id, queue_minutes, now
        )
    # From here a job may exist. Whatever has become of the grant or of this regents-cli
    # since, the job is still read, and cancelled or collected.
    plan = grants.stored_plan(store, grant.plan)
    folder = store.attempts_dir / intent_id
    body = fs.read_json(folder / JOB_FILE)
    assert isinstance(body, dict)
    # The use is on the ledger before the job is submitted, never after (contract 6).
    grants.use(store, service, envelope, intent_id=intent_id, now=now)
    try:
        job_id = submit_once(
            Journal(folder / JOURNAL_FILE), _Submission(provider, body, queue_minutes), intent_id
        )
    except SubmissionRefusedError:
        # No job exists, so the attempt is over; its use stays spent.
        _finish(folder, "failed", None, None)
        raise
    try:
        return _follow(store, identity, provider, profile, plan, envelope, intent_id, job_id, now)
    except ProviderError as error:
        raise TechtreeError(
            f"job {job_id} was submitted, and this look at it did not finish: {error.message}. "
            "If the job has not ended it is still running. Run this command again to look at "
            "it, or stop it on the provider's page.",
            code=error.code,
            details={**error.details, "job_id": job_id, "intent_id": intent_id},
        ) from error


def _ready(
    store: ModelClimbStore,
    provider: Autoresearch,
    profile: profiles.Profile,
    envelope: ObjectEnvelope[ExecutionGrant],
    identity: ExecutorIdentity,
    intent_id: str | None,
    queue_minutes: int,
    now: datetime,
) -> str:
    """The attempt a submission may now be made for: the one already begun, or a new one."""
    grant = grants.admit(
        store,
        envelope,
        identity=identity,
        operation=grants.PROFILE_TEST,
        plan_digest=envelope.payload.plan,
        now=now,
        intent_id=intent_id,
    )
    plan = grants.stored_plan(store, grant.plan)
    context = build_context()
    if _recipe(profile, context, now).digest != plan.spec.recipe:
        raise ConflictError(
            f"the plan {grant.plan} was written for other settings or another image than "
            f"this regents-cli holds for {profile.name}. Write a new plan and grant.",
            code=grants.PLAN_CHANGED,
            details={"plan": grant.plan, "recipe": plan.spec.recipe},
        )
    if queue_minutes < 1:
        raise PolicyError(
            f"grant {grant.grant_id} expires at {grant.expires_at.isoformat()}, which leaves "
            f"no time for a job after the {BUILD_TIMEOUT_MINUTES} minutes its image build may "
            "take. Issue a grant that lasts longer; nothing was submitted.",
            code=grants.APPROVAL_REQUIRED,
            details={"grant_id": grant.grant_id},
        )
    return intent_id or _begin(store, provider, profile, plan, grant, context)


def _follow(
    store: ModelClimbStore,
    identity: ExecutorIdentity,
    provider: Autoresearch,
    profile: profiles.Profile,
    plan: ResolvedModelPlan,
    envelope: ObjectEnvelope[ExecutionGrant],
    intent_id: str,
    job_id: str,
    now: datetime,
) -> Waiting | Measured:
    """Look at the attempt's job: collect it when it has ended, cancel it when it may not
    run, and otherwise say that it is still going."""
    grant = envelope.payload
    folder = store.attempts_dir / intent_id
    try:
        job = provider.job(job_id)
    except UnreadableAnswerError as error:
        # A job the engine cannot read is a job it cannot hold to the grant, so it is stopped.
        # The attempt stays open: a later look can still collect what the provider has.
        provider.cancel(job_id)
        raise TechtreeError(
            f"job {job_id} was cancelled, because {error.message}. Its attempt stays open, so "
            "this command can be run again; the grant's use is spent.",
            code=UNSUPPORTED_CAPABILITY,
            details={**error.details, "job_id": job_id, "intent_id": intent_id},
        ) from error
    if job.ended:
        return _collect(store, provider, profile, plan, grant, intent_id, job, now)
    ceiling = job.max_cost_usd_micros
    if ceiling is None or ceiling <= 0 or ceiling > grant.max_cents * MICROS_PER_CENT:
        raise _stop(
            provider,
            folder,
            job_id,
            intent_id,
            "budget_exhausted",
            (
                "the provider's answer names no maximum for it"
                if ceiling is None or ceiling <= 0
                else f"the provider's maximum for it is {cents(ceiling)} cents"
            )
            + f", and the grant allows {grant.max_cents}",
            max_cost_usd_micros=ceiling,
        )
    if job.money_wait is not None:
        # Automatic top-up is off, so this wait cannot end by itself, and a job that starts
        # whenever money is next added is not the run that was approved (contract 6.1).
        raise _stop(
            provider,
            folder,
            job_id,
            intent_id,
            "budget_exhausted",
            f'the provider was holding it for a reason only money ends ("{job.money_wait}")',
            wait_reason=job.money_wait,
        )
    if grants.revoked(store, identity, envelope):
        raise _stop(
            provider,
            folder,
            job_id,
            intent_id,
            "cancelled",
            f"grant {grant.grant_id} was revoked while it was going",
            kind=PolicyError,
            code=grants.APPROVAL_REQUIRED,
        )
    return Waiting(
        intent_id=intent_id,
        job_id=job_id,
        status=job.status,
        wait_reason=job.queue.wait_reason if job.queue else None,
        max_cost_cents=cents(ceiling),
    )


def _stop(
    provider: Autoresearch,
    folder: Path,
    job_id: str,
    intent_id: str,
    end: AttemptEnd,
    why: str,
    *,
    kind: type[TechtreeError] = TechtreeError,
    code: str = BUDGET_EXHAUSTED,
    **details: JsonValue,
) -> TechtreeError:
    """Cancel the job, close its attempt, and return the refusal that says so. What the job
    was charged is read from the provider's receipt after the cancel, however little of it
    ran, and is never filled in when the provider gives no figure (contract 7.4 step 3)."""
    provider.cancel(job_id)
    receipt = provider.job(job_id).receipt
    _finish(folder, end, None, receipt)
    charged = receipt.charged_usd_micros if receipt else None
    return kind(
        f"job {job_id} was cancelled: {why}. "
        + (
            "The provider gave no figure for what it charged."
            if charged is None
            else f"The provider's receipt shows {cents(charged)} cents charged."
        )
        + " The grant's use is spent.",
        code=code,
        details={
            "job_id": job_id,
            "intent_id": intent_id,
            "charged_usd_micros": charged,
            **details,
        },
    )


def unfinished(
    store: ModelClimbStore, identity: ExecutorIdentity, envelope: ObjectEnvelope[ExecutionGrant]
) -> str | None:
    """The attempt this grant was last used on, while it has no outcome yet."""
    used = [
        line.intent_id
        for line in ledger.lines(store.ledger_path, identity, envelope)
        if line.event == "used" and line.intent_id is not None
    ]
    if used and not (store.attempts_dir / used[-1] / "outcome.json").exists():
        return used[-1]
    return None


def _begin(
    store: ModelClimbStore,
    provider: Autoresearch,
    profile: profiles.Profile,
    plan: ResolvedModelPlan,
    grant: ExecutionGrant,
    context: dict[str, str],
) -> str:
    """A new attempt: its job, written down before anything is spent on it."""
    rate = provider.micros_per_gpu_minute(grant.gpu_model, grant.gpu_count)
    planned = plan.spec.budget.prices[0].cents_per_hour
    if cents_per_gpu_hour(rate) != planned:
        raise ConflictError(
            f"the provider's rate is now {cents_per_gpu_hour(rate)} cents per GPU-hour, and "
            f"the plan was written at {planned}. Write a new plan and grant.",
            code=grants.PLAN_CHANGED,
            details={"plan": grant.plan, "cents_per_gpu_hour": cents_per_gpu_hour(rate)},
        )
    body = job_body(profile, plan, context, granted_minutes(grant, plan))
    ceiling = provider.preflight(body)
    if ceiling > grant.max_cents * MICROS_PER_CENT:
        raise TechtreeError(
            f"the provider's maximum for this job would be {cents(ceiling)} cents, and the "
            f"grant allows {grant.max_cents}; nothing was submitted",
            code=BUDGET_EXHAUSTED,
            details={"grant_id": grant.grant_id, "max_cost_usd_micros": ceiling},
        )
    billing = provider.billing()
    if billing.auto_topup.enabled:
        raise PolicyError(
            "automatic top-up is on at the compute account, and the grant was issued on the "
            "operator's word that it is off. Turn it off there and run this again; nothing "
            "was submitted.",
            code=grants.APPROVAL_REQUIRED,
            details={"grant_id": grant.grant_id, "auto_topup": True},
        )
    available = billing.balance.available_usd_micros
    if billing.balance.at_zero or available < ceiling:
        raise TechtreeError(
            f"the compute account has {available // MICROS_PER_CENT} cents to spend, and the "
            f"provider's maximum for this job would be {cents(ceiling)}; nothing was submitted",
            code=BUDGET_EXHAUSTED,
            details={"grant_id": grant.grant_id, "available_usd_micros": available},
        )
    builds_before = provider.build_usage()
    intent_id = new_id("attempt")
    folder = store.attempts_dir / intent_id
    fs.atomic_write_json(folder / JOB_FILE, body)
    fs.atomic_write_json(folder / BUILDS_BEFORE_FILE, builds_before)
    return intent_id


def _finish(
    folder: Path, exit_reason: AttemptEnd, profile_path: Path | None, receipt: Receipt | None
) -> None:
    """Close the attempt. The two figures are the provider's receipt's, and null when it gave
    none: no zero stands in for a figure that was not given."""
    fs.atomic_write_json(
        folder / "outcome.json",
        {
            "exit_reason": exit_reason,
            "profile": str(profile_path) if profile_path else None,
            "charged_usd_micros": receipt.charged_usd_micros if receipt else None,
            "billed_seconds_per_gpu": receipt.billed_seconds if receipt else None,
        },
    )


def _collect(
    store: ModelClimbStore,
    provider: Autoresearch,
    profile: profiles.Profile,
    plan: ResolvedModelPlan,
    grant: ExecutionGrant,
    intent_id: str,
    job: Job,
    now: datetime,
) -> Measured:
    """Read what the ended job measured, judge it and write the measured profile."""
    assert job.receipt is not None
    try:
        result = JobResult.model_validate(job.result)
    except PydanticValidationError:
        result = None
    layer_types = _layer_types(store, profile, plan.spec.compatibility_profile)
    checks = judge(profile, job, result, layer_types)
    compared: list[JsonValue] = [
        {"id": row.id, "case": output_case(row), "noise": row.noise, "signal": row.signal}
        for row in (result.answers or [] if result else [])
    ]
    resolved = result.train.resolved if result and result.train else None
    folder = store.attempts_dir / intent_id
    submitted: Any = fs.read_json(folder / JOB_FILE)
    charged = job.receipt.charged_usd_micros
    document: dict[str, JsonValue] = {
        "profile": profile.name,
        "tested_at": now.isoformat(),
        "passed": all(check.status == "pass" for check in checks),
        "model": profile.model.model_dump(mode="json"),
        "trainer_revision": profile.trainer_revision,
        "plan": plan.digest,
        "grant_id": grant.grant_id,
        "intent_id": intent_id,
        "job_id": job.id,
        "job_status": job.status,
        "image_digest": job.receipt.image_digest,
        # The image folder the job was submitted with, which a later regents-cli may not hold.
        "build_context_digest": context_digest(
            {name: file["content"] for name, file in submitted["context"].items()}
        ),
        # The provider's receipt's figures; null when it gave none, never a zero in its place.
        "measured_cost_cents": cents(charged) if charged is not None else None,
        "charged_usd_micros": charged,
        "billed_seconds_per_gpu": job.receipt.billed_seconds,
        # The month's image-build minutes as the provider's usage gives them, read before the
        # job was submitted and now; the build of this run is what was added in between.
        "build_usage": {
            "before_submit": fs.read_json(folder / BUILDS_BEFORE_FILE),
            "after": provider.build_usage(),
        },
        "egress": {"declared": [*plan.spec.egress], "enforcement": EGRESS_NOTE},
        "hub_token": HUB_TOKEN,
        "installs": INSTALLS,
        "observed_config_digest": digest_object(resolved) if resolved is not None else None,
        "outputs": compared,
        "checks": [
            {"label": item.label, "status": item.status, "detail": item.detail} for item in checks
        ],
        "limitations": [*LIMITATIONS],
        "result": job.result,
    }
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    path = store.profiles_dir / profile.name / f"{stamp}-test.json"
    fs.atomic_write_json(path, document)
    exit_reason: AttemptEnd = (
        "succeeded"
        if job.status == "succeeded"
        else "cancelled"
        if job.status.startswith("cancel")
        else "failed"
    )
    _finish(folder, exit_reason, path, job.receipt)
    return Measured(
        intent_id=intent_id,
        job_id=job.id,
        path=path,
        digest=digest_object(document),
        document=document,
        checks=checks,
    )
