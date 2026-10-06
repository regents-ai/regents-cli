"""Whether a compiled configuration survives the engine, and whether an execution is usable.

The dry run is the only cheap way to ask the pinned engine what it thinks of a configuration.
It costs nothing and touches no provider. The resolved configuration is compared to the
compiled one as a projection, never byte for byte: the engine fills in `client.base_url`,
writes every default, and records the `--output-dir` from argv. The platform upload is checked
in the resolved document even though the compiled one never mentions it, because the engine's
default is the dangerous answer.

After the run, `verify_variant_execution` answers one question, is this execution complete and
usable, as an ordered list of named verdicts. A zero exit code is never sufficient.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.engines.runner import EngineProcessResult, EngineRunner
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.fs import ensure_private_directory
from regents_cli.techtree.models.campaign import (
    SUBJECT_AGENT,
    AgentSpecV2,
    Rubric,
    pinned_task_images,
)
from regents_cli.techtree.models.engine import EngineDescriptor
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import ExperimentManifestV4
from regents_cli.techtree.models.validation import TasksetLock
from regents_cli.techtree.verifiers.child import (
    CANCELLATION_EXIT_CODE,
    DRY_RUN_NAME,
    EVAL_EXECUTABLE,
    dry_run_argv,
    write_command_log,
)
from regents_cli.techtree.verifiers.config import (
    EvalToml,
    emitted_document,
    image_is_digest_pinned,
    runtime_images,
)
from regents_cli.techtree.verifiers.models import (
    ExecutionCheck,
    NormalizedTrace,
    VariantExecutionResult,
    VariantName,
)
from regents_cli.techtree.verifiers.outputs import RESOLVED_CONFIG_PATH
from regents_cli.techtree.verifiers.paths import COMMAND_LOG_FILENAME, VERIFIERS_DIRECTORY

VARIANT_DRY_RUN_FAILED: Final = "variant_dry_run_failed"
VARIANT_EXECUTION_UNCHECKABLE: Final = "variant_execution_uncheckable"
DEFAULT_DRY_RUN_TIMEOUT_SECONDS: Final = 300.0

#: The one key the engine fills in that Techtree deliberately left out.
_ENGINE_RESOLVED_KEYS: Final[frozenset[str]] = frozenset({"client.base_url"})


@dataclass(frozen=True)
class DryRunOutcome:
    """What one dry run established about one compiled configuration."""

    variant: VariantName
    process: EngineProcessResult
    resolved_config_path: Path | None
    resolved_config: dict[str, Any] | None
    checks: tuple[ExecutionCheck, ...]

    @property
    def ok(self) -> bool:
        return all(check.status in ("passed", "warning") for check in self.checks)

    @property
    def failures(self) -> tuple[ExecutionCheck, ...]:
        return tuple(check for check in self.checks if check.status == "failed")


def dry_run_variant_config(
    *,
    engine_runner: EngineRunner,
    variant: VariantName,
    compiled: EvalToml,
    input_config_path: Path,
    dry_run_dir: Path,
    timeout: float = DEFAULT_DRY_RUN_TIMEOUT_SECONDS,
) -> DryRunOutcome:
    """Resolve one compiled configuration against the installed engine.

    The child gets the engine's ordinary minimal environment: a dry run makes no model call,
    so it needs no credential and cannot leak one.
    """
    if not input_config_path.is_file():
        raise ValidationError(
            "the compiled evaluation config was not written before the dry run",
            code=VARIANT_DRY_RUN_FAILED,
            details={"variant": variant.value, "path": str(input_config_path)},
        )
    ensure_private_directory(dry_run_dir)

    argv = dry_run_argv(input_config_path=input_config_path, dry_run_dir=dry_run_dir)
    process = engine_runner.run(EVAL_EXECUTABLE, argv, timeout=timeout)
    write_command_log(
        dry_run_dir / COMMAND_LOG_FILENAME,
        variant=variant,
        argv=process.argv,
        exit_code=process.exit_code,
        stdout=process.stdout,
        stderr=process.stderr,
    )

    checks: list[ExecutionCheck] = [_invocation_check(process)]
    resolved_path = dry_run_dir / DRY_RUN_NAME / RESOLVED_CONFIG_PATH
    resolved: dict[str, Any] | None = None

    if process.exit_code == 0 and resolved_path.is_file():
        resolved = _read_resolved_config(resolved_path)
        checks.append(
            ExecutionCheck(
                id="resolved_config_written",
                status="passed",
                detail=f"the engine wrote {RESOLVED_CONFIG_PATH} to the dry-run directory.",
            )
        )
        # `--output-dir` on argv overrides the file, so compare the config as it was handed over.
        checks.extend(
            verify_compiled_config(
                compiled=compiled.model_copy(update={"output_dir": str(dry_run_dir)}),
                resolved=resolved,
            )
        )
        checks.append(_output_directory_check(compiled))
    else:
        checks.append(
            ExecutionCheck(
                id="resolved_config_written",
                status="failed",
                detail="the engine wrote no resolved configuration; the dry run did not get "
                "far enough to resolve one.",
            )
        )

    checks.append(_image_pinning_check(compiled))

    return DryRunOutcome(
        variant=variant,
        process=process,
        resolved_config_path=resolved_path if resolved is not None else None,
        resolved_config=resolved,
        checks=tuple(checks),
    )


def verify_compiled_config(
    *, compiled: EvalToml, resolved: Mapping[str, Any]
) -> list[ExecutionCheck]:
    """Compare what the engine resolved against the document Techtree wrote.

    A declared key missing from the resolved document is a difference too: `rich` is declared
    as a null, and an engine that resolved it into a table would flatten to `rich.show_logs`.
    """
    declared = _flatten(emitted_document(compiled))
    observed = _flatten(resolved)
    differences = sorted(
        key
        for key, value in declared.items()
        if key not in _ENGINE_RESOLVED_KEYS and (key not in observed or observed[key] != value)
    )
    return [
        ExecutionCheck(
            id="resolved_config_matches_compiled",
            status="passed" if not differences else "failed",
            detail=(
                "every value Techtree declared came back unchanged."
                if not differences
                else f"the engine resolved a different value at {', '.join(differences)}."
            ),
        ),
        _push_check(observed),
        _subject_seat_check(observed, compiled.env.seat_name),
    ]


def _invocation_check(process: EngineProcessResult) -> ExecutionCheck:
    if process.exit_code == 0:
        return ExecutionCheck(
            id="engine_eval_accepted_config",
            status="passed",
            detail="the engine's eval entrypoint resolved the configuration.",
        )
    return ExecutionCheck(
        id="engine_eval_accepted_config",
        status="failed",
        detail=f"the engine's eval entrypoint exited {process.exit_code}: "
        f"{_last_meaningful_line(process)}",
    )


def _push_check(observed: Mapping[str, Any]) -> ExecutionCheck:
    disabled = observed.get("push") is False
    return ExecutionCheck(
        id="platform_push_disabled",
        status="passed" if disabled else "failed",
        detail=(
            "the resolved configuration records push = false, so no episode leaves this machine."
            if disabled
            else "the resolved configuration would upload this run's episodes to the Prime "
            "platform."
        ),
    )


def _subject_seat_check(observed: Mapping[str, Any], seat: str) -> ExecutionCheck:
    seats = {
        key.split(".")[1] for key in observed if key.startswith(("env.subject.", "env.agent."))
    }
    if seats == {seat}:
        return ExecutionCheck(
            id="named_subject_seat_resolved",
            status="passed",
            detail=f"the resolved environment declares the {seat!r} seat, so every trace will "
            f"record agent.name == {seat!r}.",
        )
    return ExecutionCheck(
        id="named_subject_seat_resolved",
        status="failed",
        detail=f"the resolved environment does not declare exactly the {seat!r} seat; the "
        "taskset package must export the environment this Campaign names.",
    )


def _output_directory_check(compiled: EvalToml) -> ExecutionCheck:
    output_dir = Path(compiled.output_dir)
    inside = output_dir.is_absolute() and VERIFIERS_DIRECTORY in output_dir.parts
    return ExecutionCheck(
        id="output_directory_is_run_owned",
        status="passed" if inside else "failed",
        detail=(
            f"the real run would write to {compiled.output_dir}, inside the run's own "
            "evaluation tree."
            if inside
            else f"the real run would write to {compiled.output_dir}, which is not inside the "
            "run's own evaluation tree."
        ),
    )


def _image_pinning_check(compiled: EvalToml) -> ExecutionCheck:
    unpinned = [
        image for image in runtime_images(compiled.env) if not image_is_digest_pinned(image)
    ]
    if not unpinned:
        return ExecutionCheck(
            id="runtime_image_digest_pinned",
            status="passed",
            detail="every runtime image is pinned by content digest.",
        )
    return ExecutionCheck(
        id="runtime_image_digest_pinned",
        status="warning",
        detail=f"the runtime image {unpinned[0]!r} is not pinned by content digest, "
        "so what runs could change without the Campaign changing.",
    )


def _read_resolved_config(path: Path) -> dict[str, Any]:
    try:
        document: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        return document
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValidationError(
            "the engine's resolved configuration could not be read",
            code=VARIANT_DRY_RUN_FAILED,
            details={"path": str(path)},
        ) from error


def _flatten(document: Mapping[str, Any], prefix: str = "") -> dict[str, Any]:
    flat: dict[str, Any] = {}
    for key, value in document.items():
        dotted = f"{prefix}{key}"
        if isinstance(value, dict):
            flat.update(_flatten(value, prefix=f"{dotted}."))
        else:
            flat[dotted] = value
    return flat


def _last_meaningful_line(process: EngineProcessResult) -> str:
    """The engine renders errors as a box-drawn panel; keep the last line that is not frame."""
    frame = set("│╭╮╰╯─ ")
    for stream in (process.stderr, process.stdout):
        lines = [
            line.strip("│ ").strip()
            for line in reversed(stream.splitlines())
            if line.strip() and set(line) - frame
        ]
        if lines:
            return lines[0]
    return "<no output>"


def verify_variant_execution(
    *,
    result: VariantExecutionResult,
    experiment: ExperimentManifestV4,
    plan: ResolvedExecutionPlan,
    taskset_lock: TasksetLock,
    rubric: Rubric,
    engine: EngineDescriptor | None = None,
) -> list[ExecutionCheck]:
    """Ordered checks over one completed variant; raises only when nothing can be checked."""
    plan_digest = digest_object(plan)
    if plan_digest != experiment.configuration.execution_plan_digest:
        raise ValidationError(
            "this execution plan is not the one the experiment manifest was resolved under, so "
            "there is nothing to verify this execution against",
            code=VARIANT_EXECUTION_UNCHECKABLE,
            details={
                "manifest_id": experiment.id,
                "variant": result.variant.value,
                "manifest_execution_plan_digest": experiment.configuration.execution_plan_digest,
                "plan_digest": plan_digest,
            },
        )
    subject = experiment.configuration.agents.get(SUBJECT_AGENT)
    if subject is None:
        raise ValidationError(
            f"the experiment manifest defines no {SUBJECT_AGENT!r} agent, so there is nothing "
            "to verify this execution against",
            code=VARIANT_EXECUTION_UNCHECKABLE,
            details={"manifest_id": experiment.id, "variant": result.variant.value},
        )

    checks = [_completion_check(result)]
    checks.extend(_membership_checks(result, taskset_lock))
    checks.extend(_trace_checks(result, subject, plan, rubric))
    checks.append(_task_image_check(result, experiment, subject))
    checks.append(_manifest_check(result, experiment))
    if engine is not None:
        checks.append(_pin_check(result, engine))
    return checks


def _task_image_check(
    result: VariantExecutionResult, experiment: ExperimentManifestV4, subject: AgentSpecV2
) -> ExecutionCheck:
    """Every trace ran its own task's pinned agent image and was graded in its grader image."""
    pins = {
        pin.task_hash: (pin.agent.image, None if pin.grader is None else pin.grader.image)
        for pin in pinned_task_images(subject.runtime, experiment.configuration.taskset)
    }
    wrong = [
        trace.task_hash
        for episode in result.episodes
        for trace in episode.traces
        if pins.get(trace.task_hash) != (trace.runtime.image, trace.grader_image)
    ]
    return _verdict(
        "runtime_images_match",
        not wrong,
        "every trace ran its task's pinned images.",
        f"{len(wrong)} trace(s) ran images their task does not pin, starting with task "
        f"{wrong[0] if wrong else ''}.",
    )


def _completion_check(result: VariantExecutionResult) -> ExecutionCheck:
    outcome = result.child_outcome
    if outcome.cancelled or outcome.exit_code == CANCELLATION_EXIT_CODE:
        return ExecutionCheck(
            id="child_completed",
            status="failed",
            detail="the evaluation was cancelled, so it produced no answer rather than a "
            "wrong one.",
        )
    if outcome.exit_code != 0:
        return ExecutionCheck(
            id="child_completed",
            status="failed",
            detail=f"the evaluation child exited {outcome.exit_code}.",
        )
    return ExecutionCheck(
        id="child_completed",
        status="passed",
        detail="the evaluation child ran to completion and was not cancelled.",
    )


def _membership_checks(
    result: VariantExecutionResult, taskset_lock: TasksetLock
) -> list[ExecutionCheck]:
    observed = [episode.task_hash for episode in result.episodes]
    committed = list(taskset_lock.ordered_task_hashes)
    positions = [episode.task_position for episode in result.episodes]
    episode_ids = [episode.episode_id for episode in result.episodes]
    incomplete = [episode for episode in result.episodes if not episode.ok]
    return [
        _verdict(
            "episode_count",
            len(observed) == len(committed),
            f"{len(observed)} episodes for {len(committed)} committed tasks.",
            f"{len(observed)} episodes were recorded for {len(committed)} committed tasks.",
        ),
        _verdict(
            "ordered_task_membership",
            observed == committed,
            "the normalized episodes cover exactly the committed tasks, in the committed order.",
            "the normalized episodes do not match the committed membership; pairing joins on "
            "task hash, never on position.",
        ),
        _verdict(
            "task_positions_are_membership_positions",
            positions == list(range(len(observed))),
            "every episode carries its membership position.",
            f"episode positions are not 0..{len(observed) - 1} exactly once.",
        ),
        _verdict(
            "episode_ids_unique",
            len(set(episode_ids)) == len(episode_ids),
            "every episode has its own identifier.",
            "two episodes share an identifier.",
        ),
        _verdict(
            "all_episodes_completed",
            not incomplete,
            "every episode completed.",
            f"{len(incomplete)} episode(s) did not complete.",
        ),
    ]


def _trace_checks(
    result: VariantExecutionResult,
    subject: AgentSpecV2,
    plan: ResolvedExecutionPlan,
    rubric: Rubric,
) -> list[ExecutionCheck]:
    """Whether every trace is the subject the manifest declared, scored."""
    traces = [trace for episode in result.episodes for trace in episode.traces]
    per_episode = {len(episode.traces) for episode in result.episodes}
    trace_ids = [trace.trace_id for trace in traces]
    checks = [
        _verdict(
            "one_subject_trace_per_episode",
            per_episode <= {1},
            "each episode carries exactly one subject trace.",
            f"episodes carry {sorted(per_episode)} traces.",
        ),
        _verdict(
            "trace_ids_unique",
            len(set(trace_ids)) == len(trace_ids),
            "every trace has its own identifier.",
            "two traces share an identifier.",
        ),
    ]

    expectations: list[tuple[str, str, Any, set[Any]]] = [
        ("model_id_matches", "model", subject.model.requested_name, {t.model_id for t in traces}),
        ("harness_id_matches", "harness", plan.subject.harness_id, {t.harness_id for t in traces}),
        (
            "harness_version_matches",
            "harness version",
            plan.subject.harness_version,
            {t.harness_version for t in traces},
        ),
    ]
    for identifier, label, expected, seen in expectations:
        checks.append(
            _verdict(
                identifier,
                seen == {expected},
                f"every trace ran the declared {label}.",
                f"the declared {label} is {expected!r}; traces recorded "
                f"{sorted(str(value) for value in seen)}.",
            )
        )

    declared_skills = tuple(sorted(artifact.digest for artifact in subject.harness.skills))
    bundled = {trace.use_bundled_skill for trace in traces}
    skills = {tuple(sorted(trace.skill_root_digests)) for trace in traces}
    runtimes = {trace.runtime.kind for trace in traces}
    roles = {trace.agent_role for trace in traces}
    incomplete = [trace for trace in traces if not trace.ok]
    checks.extend(
        [
            _verdict(
                "bundled_skills_disabled",
                bundled <= {False},
                "no trace enabled the harness's bundled skill catalogue.",
                "a trace ran with the bundled skill catalogue enabled.",
            ),
            _verdict(
                "skill_digests_match_variant",
                skills <= {declared_skills},
                f"every trace carried the {len(declared_skills)} skill(s) this variant declares.",
                "a trace carried skills the variant does not declare.",
            ),
            _verdict(
                "runtime_is_docker",
                runtimes <= {"docker"},
                "every trace ran in a Docker runtime.",
                f"traces ran on {sorted(runtimes)}.",
            ),
            _verdict(
                "every_trace_is_the_subject",
                roles <= {SUBJECT_AGENT},
                f"every trace records the {SUBJECT_AGENT!r} role.",
                f"traces recorded the roles {sorted(roles)}.",
            ),
            _verdict(
                "all_traces_completed",
                not incomplete,
                "every trace completed.",
                f"{len(incomplete)} trace(s) did not complete.",
            ),
            _rubric_check(traces, rubric),
            _tool_inventory_check(traces),
        ]
    )
    return checks


def _rubric_check(traces: list[NormalizedTrace], rubric: Rubric) -> ExecutionCheck:
    weights = rubric.weights
    off_rubric = [
        trace
        for trace in traces
        if {reward.name: reward.weight for reward in trace.rewards} != weights
    ]
    return _verdict(
        "rewards_match_rubric",
        not off_rubric,
        f"every trace scored the rubric's {len(weights)} reward(s) at the rubric's weights.",
        f"{len(off_rubric)} trace(s) scored other rewards or weights than the rubric's "
        f"{sorted(weights)}, so their task scores are not the pinned scorer's.",
    )


def _tool_inventory_check(traces: list[NormalizedTrace]) -> ExecutionCheck:
    for trace in traces:
        names = [tool.name for tool in trace.tools]
        if len(set(names)) != len(names):
            return ExecutionCheck(
                id="tool_inventory_valid",
                status="failed",
                detail=f"trace {trace.trace_id} advertises a tool name twice.",
            )
    return ExecutionCheck(
        id="tool_inventory_valid",
        status="passed",
        detail="every trace's tool inventory names each tool once.",
    )


def _manifest_check(
    result: VariantExecutionResult, experiment: ExperimentManifestV4
) -> ExecutionCheck:
    return _verdict(
        "result_matches_experiment",
        result.experiment_manifest_digest == digest_object(experiment),
        "the result was produced from this experiment manifest.",
        "the result names a different experiment manifest.",
    )


def _pin_check(result: VariantExecutionResult, engine: EngineDescriptor) -> ExecutionCheck:
    """Every trace records the Verifiers build that wrote it, so the pin is checked from the
    evidence rather than from a caller's claim about which engine ran."""
    observed = {
        (trace.verifiers_version, trace.verifiers_revision)
        for episode in result.episodes
        for trace in episode.traces
    }
    expected = (engine.verifiers_version, engine.verifiers_revision)
    return _verdict(
        "verifiers_pin_matches_engine",
        observed == {expected},
        f"every trace was produced by Verifiers {expected[0]} at {expected[1]}, which is what "
        "the engine descriptor pins.",
        f"the engine descriptor pins Verifiers {expected[0]} at {expected[1]}, but the traces "
        f"record {sorted(f'{version} at {revision}' for version, revision in observed)}.",
    )


def _verdict(identifier: str, held: bool, passed: str, failed: str) -> ExecutionCheck:
    return ExecutionCheck(
        id=identifier, status="passed" if held else "failed", detail=passed if held else failed
    )
