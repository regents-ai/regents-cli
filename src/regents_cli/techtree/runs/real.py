"""The executor that evaluates both variants of a Campaign through the pinned engine.

The order of `RealVerifiersExecutor.execute` is the whole spending argument (spec 6.17):
every free refusal happens before every costly one. The staged inputs are verified before
the engine is resolved; the engine before the credential is required; the credential before
the taskset is validated; the taskset before a configuration is compiled; and both
configurations survive a model-free dry run against the real engine before a single container
starts. A run that is going to fail should fail while it is still free.
"""

from __future__ import annotations

import contextlib
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from regents_cli.techtree.canonical import sha256_digest_bytes, to_json_value
from regents_cli.techtree.doctor.checks import CheckStatus, check_live_campaign
from regents_cli.techtree.engines.bundle import read_engine_descriptor
from regents_cli.techtree.engines.registry import EngineRegistry
from regents_cli.techtree.engines.runner import EngineRunner
from regents_cli.techtree.errors import (
    EngineError,
    PrerequisiteError,
    ValidationError,
    VerificationError,
)
from regents_cli.techtree.execution_facts import require_executable_execution_plan
from regents_cli.techtree.fs import atomic_write_json, ensure_private_directory, open_exclusive
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.models.campaign import SUBJECT_AGENT, AgentSpecV2, CampaignSpecV3
from regents_cli.techtree.models.engine import EngineDescriptor, EngineInstallation
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import ExperimentManifestV3
from regents_cli.techtree.models.run import RunPhase, RunRequestV2
from regents_cli.techtree.models.skill import SkillArtifact
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.runs.artifacts import RunInputBundle
from regents_cli.techtree.runs.child_registry import ChildRegistry, execution_dir
from regents_cli.techtree.runs.executor import ExecutionContext
from regents_cli.techtree.runs.validation import TasksetValidationOutcome, validate_taskset
from regents_cli.techtree.runs.variants import (
    DEFAULT_POLL_INTERVAL_SECONDS,
    VariantPair,
    VariantPairOutcome,
    VariantScheduler,
    require_concurrency_budget,
)
from regents_cli.techtree.verifiers.budget import require_executable_budget
from regents_cli.techtree.verifiers.child import (
    DEFAULT_GRACE_SECONDS,
    EVAL_EXECUTABLE,
    VerifiersChild,
    eval_argv,
)
from regents_cli.techtree.verifiers.compiler import (
    compile_plans,
    compile_variant_config,
    skill_directory_name,
    write_variant_config,
)
from regents_cli.techtree.verifiers.credentials import (
    require_credentials,
    scrubbed_child_environment,
)
from regents_cli.techtree.verifiers.image import resolve_images
from regents_cli.techtree.verifiers.models import (
    ChildProcessOutcome,
    ImageResolution,
    RealExecutionResult,
    VariantExecutionPlan,
    VariantExecutionResult,
    VariantName,
)
from regents_cli.techtree.verifiers.outputs import (
    DEFAULT_NORMALIZE_TIMEOUT_SECONDS,
    build_variant_result,
)
from regents_cli.techtree.verifiers.paths import RunPaths
from regents_cli.techtree.verifiers.verify import (
    DEFAULT_DRY_RUN_TIMEOUT_SECONDS,
    dry_run_variant_config,
    verify_variant_execution,
)

REAL_EXECUTION_UNSUPPORTED: Final = "real_execution_unsupported"
VARIANT_NOT_USABLE: Final = "variant_execution_not_usable"
TASKSET_LOCK_FILENAME: Final = "taskset-lock.json"
REAL_EXECUTION_RESULT_FILENAME: Final = "real-execution-result.json"

_PRIVATE_FILE_MODE: Final = 0o600
_PRIVATE_DIRECTORY_MODE: Final = 0o700
_VARIANT_ORDER: Final[tuple[VariantName, ...]] = (VariantName.BASELINE, VariantName.CANDIDATE)


@dataclass(frozen=True)
class _ResolvedEngine:
    digest: Digest
    installation: EngineInstallation
    descriptor: EngineDescriptor
    runner: EngineRunner


def require_live_campaign(campaign: CampaignSpecV3) -> None:
    """Refuse a Campaign whose coordinates are development placeholders."""
    check = check_live_campaign(campaign)
    if check.status is CheckStatus.PASS:
        return
    raise PrerequisiteError(
        f"this Campaign cannot be executed for real: {check.detail}",
        code=REAL_EXECUTION_UNSUPPORTED,
        details={"campaign_id": campaign.metadata.id},
    )


def real_execution_result_path(run_root: Path) -> Path:
    """Where one run records what the executor hands the report stage."""
    return execution_dir(run_root) / REAL_EXECUTION_RESULT_FILENAME


def keep_evaluation_private(run_paths: RunPaths) -> Path:
    """Make everything the engine wrote for one run readable by its owner only.

    The engine writes traces, logs and resolved configuration under the operator's umask, and
    the traces are the subject's complete transcripts. Tightening them afterwards is the only
    moment available, and it is done whether the run succeeded, failed or was cancelled.
    Links are never followed: the target may not be the run's.
    """
    root = run_paths.verifiers_dir
    if root.is_dir():
        _make_private(root)
        for path in root.rglob("*"):
            _make_private(path)
    return root


def _make_private(path: Path) -> None:
    if path.is_symlink():
        return
    with contextlib.suppress(OSError):
        if path.is_dir():
            path.chmod(_PRIVATE_DIRECTORY_MODE)
        elif path.is_file():
            path.chmod(_PRIVATE_FILE_MODE)


class RealVerifiersExecutor:
    """Executes both variants of a real Campaign through the pinned engine."""

    def __init__(
        self,
        *,
        paths: TechtreePaths,
        engine_registry: EngineRegistry,
        child_registry: ChildRegistry,
        poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
        grace_seconds: float = DEFAULT_GRACE_SECONDS,
        dry_run_timeout_seconds: float = DEFAULT_DRY_RUN_TIMEOUT_SECONDS,
        normalize_timeout_seconds: float = DEFAULT_NORMALIZE_TIMEOUT_SECONDS,
    ) -> None:
        self._paths = paths
        self._registry = engine_registry
        self._child_registry = child_registry
        self._poll_interval = poll_interval_seconds
        self._grace = grace_seconds
        self._dry_run_timeout = dry_run_timeout_seconds
        self._normalize_timeout = normalize_timeout_seconds

    def execute(self, context: ExecutionContext) -> RealExecutionResult:
        """Execute one Campaign's two variants, refusing everything free before anything costly."""
        request = context.request
        run_id = request.run_id
        run_paths = RunPaths.for_run(self._paths, run_id)

        # 1-3. The run's own inputs, verified, and the rights it runs under.
        inputs = context.artifact_store.load_inputs(run_id, request)
        campaign = inputs.campaign
        plan = inputs.execution_plan
        self._require_acknowledged_policy(request, campaign)
        self._require_executable_plan(request, campaign, plan)
        require_live_campaign(campaign)
        subject = self._subject(campaign)

        # 4-5. The engine, then the credential the subject's calls are paid with, then
        # whether every limit the engine enforces is set. All three refusals are free.
        engine = self._resolve_engine(plan.evaluation.engine_digest)
        require_credentials(subject.model)
        require_executable_budget(campaign)

        # 6-7. The publisher's validation, re-checked, and the membership it commits to.
        validation = self._validate_taskset(context, inputs)
        lock_path = self._write_taskset_lock(run_paths, validation)

        # 8-11. Both configurations compiled and dry-run, and every image resolved, before
        # either child is launched, so a missing image costs nothing rather than half a run.
        self._materialize_skill_mount(inputs, run_paths)
        pair = self._compile_pair(campaign, plan, inputs, run_paths, engine, subject)
        images = {
            variant: resolve_images(subject.runtime, campaign.taskset, variant)
            for variant in _VARIANT_ORDER
        }

        try:
            # 12-15. Both children, started and watched.
            outcome = self._run_children(
                context, pair=pair, engine=engine, maximum_usd=campaign.budgets.maximum_usd
            )
            # 16-18. The engine's own reading of what each child left behind.
            results = self._normalize(
                pair=pair,
                outcome=outcome,
                images=images,
                inputs=inputs,
                validation=validation,
                engine=engine,
                lock_path=lock_path,
            )
            return self._record(run_paths, engine, outcome, results)
        finally:
            keep_evaluation_private(run_paths)

    def _require_acknowledged_policy(self, request: RunRequestV2, campaign: CampaignSpecV3) -> None:
        acknowledged = request.policy_acknowledgement.data_policy_digest
        if acknowledged == campaign.data_policy_digest:
            return
        raise ValidationError(
            "the DataPolicy this run acknowledged is not the one its Campaign is governed by",
            code=REAL_EXECUTION_UNSUPPORTED,
            details={
                "run_id": request.run_id,
                "acknowledged": acknowledged,
                "campaign": campaign.data_policy_digest,
            },
        )

    def _require_executable_plan(
        self, request: RunRequestV2, campaign: CampaignSpecV3, plan: ResolvedExecutionPlan
    ) -> None:
        digest = require_executable_execution_plan(campaign, plan)
        if digest == request.execution_plan_digest:
            return
        raise ValidationError(
            "the execution plan this run was created under is not the one its Campaign binds",
            code=REAL_EXECUTION_UNSUPPORTED,
            details={
                "run_id": request.run_id,
                "requested": request.execution_plan_digest,
                "campaign": digest,
            },
        )

    def _subject(self, campaign: CampaignSpecV3) -> AgentSpecV2:
        subject = campaign.agents.get(SUBJECT_AGENT)
        if subject is None:
            raise ValidationError(
                f"this Campaign defines no {SUBJECT_AGENT!r} agent to execute",
                code=REAL_EXECUTION_UNSUPPORTED,
                details={"campaign_id": campaign.metadata.id},
            )
        return subject

    def _resolve_engine(self, digest: Digest) -> _ResolvedEngine:
        """The engine the Campaign's execution plan names, installed and verified here."""
        status = self._registry.status(digest)
        installation = self._registry.installation(digest)
        if not status.installed or not status.verified or installation is None:
            raise EngineError(
                "the evaluation engine this Climb names is not installed and verified on this "
                "machine; run regents techtree setup",
                code="engine_not_verified",
                details={
                    "engine_digest": digest,
                    "installed": status.installed,
                    "verified": status.verified,
                },
            )
        return _ResolvedEngine(
            digest=digest,
            installation=installation,
            descriptor=read_engine_descriptor(self._registry.path(digest)),
            runner=EngineRunner(self._registry, digest),
        )

    def _validate_taskset(
        self, context: ExecutionContext, inputs: RunInputBundle
    ) -> TasksetValidationOutcome:
        run_id = context.request.run_id
        context.run_store.append(run_id, phase=RunPhase.VALIDATING_TASKSET)
        validation = validate_taskset(run_id, inputs)
        context.artifact_store.write_validation_marker(run_id, validation.marker_document())
        if validation.lock.ordered_task_hashes != inputs.ordered_task_hashes:
            raise VerificationError(
                "the validated taskset does not hold the tasks the Campaign commits to",
                code=VARIANT_NOT_USABLE,
                details={"run_id": run_id},
            )
        return validation

    def _write_taskset_lock(
        self, run_paths: RunPaths, validation: TasksetValidationOutcome
    ) -> Path:
        """Write the run's own copy of the membership the normalizer joins episodes on."""
        path = run_paths.inputs_dir / TASKSET_LOCK_FILENAME
        if path.is_file():
            return path
        ensure_private_directory(path.parent)
        with open_exclusive(path) as handle:
            handle.write(validation.lock.model_dump_json().encode("utf-8"))
        return path

    def _materialize_skill_mount(self, inputs: RunInputBundle, run_paths: RunPaths) -> None:
        """Place the candidate Skill at the content address the compiler mounts.

        The bytes are re-verified against the artifact as they are copied, so what the subject
        reads is provably the tree the run's manifests name. A variant asking for any skill the
        run does not own stops the run.
        """
        staged = inputs.candidate_skill
        for manifest in (inputs.baseline, inputs.candidate):
            subject = manifest.configuration.agents.get(SUBJECT_AGENT)
            if subject is None:
                continue
            for reference in subject.harness.skills:
                if reference.digest != staged.artifact.root_digest:
                    raise VerificationError(
                        "a variant declares a skill this run does not own",
                        code=VARIANT_NOT_USABLE,
                        details={
                            "declared": reference.digest,
                            "staged": staged.artifact.root_digest,
                        },
                    )
                self._copy_skill_tree(
                    skill=staged.artifact,
                    source=staged.files,
                    destination=run_paths.skill_files_dir / skill_directory_name(reference.digest),
                )

    def _copy_skill_tree(self, *, skill: SkillArtifact, source: Path, destination: Path) -> None:
        for entry in skill.files:
            target = destination / entry.path
            if target.is_file():
                continue
            ensure_private_directory(target.parent)
            data = (source / entry.path).read_bytes()
            if len(data) != entry.size or sha256_digest_bytes(data) != entry.digest:
                raise VerificationError(
                    f"this run's copy of the skill file {entry.path} is not what the artifact "
                    "says it is, so it is not what the subject may be given",
                    code=VARIANT_NOT_USABLE,
                    details={"path": entry.path},
                )
            with open_exclusive(target) as handle:
                handle.write(data)

    def _compile_pair(
        self,
        campaign: CampaignSpecV3,
        plan: ResolvedExecutionPlan,
        inputs: RunInputBundle,
        run_paths: RunPaths,
        engine: _ResolvedEngine,
        subject: AgentSpecV2,
    ) -> VariantPair:
        """Compile, write and dry-run both variants' configurations."""
        baseline_plan, candidate_plan = compile_plans(
            campaign=campaign,
            plan=plan,
            baseline=inputs.baseline,
            candidate=inputs.candidate,
            run_paths=run_paths,
        )
        pair = VariantPair(baseline=baseline_plan, candidate=candidate_plan)
        require_concurrency_budget(pair, max_concurrent=campaign.execution.max_concurrent)

        manifests = {VariantName.BASELINE: inputs.baseline, VariantName.CANDIDATE: inputs.candidate}
        for variant in _VARIANT_ORDER:
            compiled = compile_variant_config(
                campaign=campaign,
                plan=plan,
                experiment=manifests[variant],
                run_paths=run_paths,
                variant=variant,
                variant_max_concurrent=pair.plan(variant).max_concurrent,
            )
            input_path = run_paths.variant_input_config(variant)
            write_variant_config(compiled, input_path)
            outcome = dry_run_variant_config(
                engine_runner=engine.runner,
                variant=variant,
                compiled=compiled,
                input_config_path=input_path,
                dry_run_dir=run_paths.variant_dry_run_dir(variant),
                model=subject.model,
                timeout=self._dry_run_timeout,
            )
            if not outcome.ok:
                failures: list[JsonValue] = [to_json_value(check) for check in outcome.failures]
                raise ValidationError(
                    f"the {variant.value} configuration did not survive the engine's own "
                    "validation, so nothing was executed",
                    code=VARIANT_NOT_USABLE,
                    details={"variant": variant.value, "checks": failures},
                )
        return pair

    def _run_children(
        self,
        context: ExecutionContext,
        *,
        pair: VariantPair,
        engine: _ResolvedEngine,
        maximum_usd: float | None,
    ) -> VariantPairOutcome:
        run_id = context.request.run_id
        run_paths = RunPaths.for_run(self._paths, run_id)
        environment = scrubbed_child_environment(engine=engine.installation)
        executable = self._registry.executable(engine.digest, EVAL_EXECUTABLE)
        children = {
            variant: self._build_child(
                variant=variant,
                plan=pair.plan(variant),
                executable=executable,
                environment=environment,
                run_paths=run_paths,
            )
            for variant in _VARIANT_ORDER
        }
        scheduler = VariantScheduler(
            run_store=context.run_store,
            child_registry=self._child_registry,
            poll_interval_seconds=self._poll_interval,
            grace_seconds=self._grace,
        )
        return scheduler.execute_parallel(
            run_id=run_id,
            run_root=run_paths.root,
            pair=pair,
            baseline_child=children[VariantName.BASELINE],
            candidate_child=children[VariantName.CANDIDATE],
            maximum_usd=maximum_usd,
        )

    def _build_child(
        self,
        *,
        variant: VariantName,
        plan: VariantExecutionPlan,
        executable: Path,
        environment: Mapping[str, str],
        run_paths: RunPaths,
    ) -> VerifiersChild:
        return VerifiersChild(
            variant=variant,
            argv=eval_argv(
                eval_executable=executable,
                input_config_path=Path(plan.verifiers_input_config_path),
            ),
            cwd=Path(plan.verifiers_output_dir),
            env=environment,
            stdout_path=run_paths.variant_stdout_log(variant),
            stderr_path=run_paths.variant_stderr_log(variant),
            supervision_record_path=run_paths.variant_supervision_record(variant),
        )

    def _normalize(
        self,
        *,
        pair: VariantPair,
        outcome: VariantPairOutcome,
        images: Mapping[VariantName, ImageResolution],
        inputs: RunInputBundle,
        validation: TasksetValidationOutcome,
        engine: _ResolvedEngine,
        lock_path: Path,
    ) -> dict[VariantName, VariantExecutionResult]:
        """Normalize and verify both variants, or fail the whole execution."""
        outcomes: dict[VariantName, ChildProcessOutcome] = {
            VariantName.BASELINE: outcome.baseline,
            VariantName.CANDIDATE: outcome.candidate,
        }
        manifests: dict[VariantName, ExperimentManifestV3] = {
            VariantName.BASELINE: inputs.baseline,
            VariantName.CANDIDATE: inputs.candidate,
        }
        results: dict[VariantName, VariantExecutionResult] = {}
        for variant in _VARIANT_ORDER:
            result = build_variant_result(
                plan=pair.plan(variant),
                outcome=outcomes[variant],
                image_resolution=images[variant],
                engine_registry=self._registry,
                engine_digest=engine.digest,
                engine_runner=engine.runner,
                taskset_lock_path=lock_path,
                timeout=self._normalize_timeout,
            )
            checks = verify_variant_execution(
                result=result,
                experiment=manifests[variant],
                plan=inputs.execution_plan,
                taskset_lock=validation.lock,
                primary_reward=inputs.campaign.scoring.primary_reward,
                engine=engine.descriptor,
            )
            failed = [check for check in checks if check.status == "failed"]
            if failed:
                detail: list[JsonValue] = [to_json_value(check) for check in failed]
                raise VerificationError(
                    f"the {variant.value} variant's execution is not scientifically usable",
                    code=VARIANT_NOT_USABLE,
                    details={"variant": variant.value, "checks": detail},
                )
            results[variant] = result
        return results

    def _record(
        self,
        run_paths: RunPaths,
        engine: _ResolvedEngine,
        outcome: VariantPairOutcome,
        results: dict[VariantName, VariantExecutionResult],
    ) -> RealExecutionResult:
        result = RealExecutionResult(
            execution_backend="verifiers",
            engine_digest=engine.digest,
            verifiers_revision=engine.descriptor.verifiers_revision,
            schedule=outcome.schedule,
            baseline=results[VariantName.BASELINE],
            candidate=results[VariantName.CANDIDATE],
        )
        path = real_execution_result_path(run_paths.root)
        ensure_private_directory(path.parent)
        atomic_write_json(path, to_json_value(result))
        return result
