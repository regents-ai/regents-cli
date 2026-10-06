"""Running both sides of a comparison at once.

Every input either variant needs is checked before either child starts; nothing is written
between the two launches, so the recorded skew measures two forks and nothing else; and one
variant's failure ends the other, with both children's partial evidence left where they wrote
it. A run whose route says to stop (spend reaching the maximum on the person's own Prime key, a
used-up or refusing ChatGPT plan) is stopped the same way, by the guard the run passes in.
"""

from __future__ import annotations

import contextlib
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from regents_cli.techtree.errors import CancellationError, RunError, TechtreeError, ValidationError
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.models.campaign import VariantSchedule
from regents_cli.techtree.models.run import RunPhase, VariantProgress
from regents_cli.techtree.runs.child_registry import (
    ChildRegistry,
    LaunchedChild,
    write_children_record,
)
from regents_cli.techtree.runs.events import (
    DETAIL_COMPLETED,
    DETAIL_ERRORED,
    DETAIL_RUNNING,
    DETAIL_STATE,
    DETAIL_TOTAL,
    DETAIL_VARIANT,
    VARIANT_COMPLETED,
    VARIANT_PROGRESS,
    VARIANT_STARTED,
)
from regents_cli.techtree.runs.executor import raise_if_cancel_requested
from regents_cli.techtree.runs.store import RunStore
from regents_cli.techtree.verifiers.child import DEFAULT_GRACE_SECONDS, VerifiersChild
from regents_cli.techtree.verifiers.models import (
    ChildProcessOutcome,
    VariantExecutionPlan,
    VariantName,
)
from regents_cli.techtree.verifiers.outputs import TRACES_FILENAME
from regents_cli.techtree.verifiers.progress import inspect_progress, pending_progress

VARIANT_INPUTS_MISSING: Final = "variant_inputs_missing"
VARIANT_CHILD_START_FAILED: Final = "variant_child_start_failed"
VARIANT_EXECUTION_FAILED: Final = "variant_execution_failed"
VARIANT_CONCURRENCY_EXCEEDED: Final = "variant_concurrency_exceeded"
DEFAULT_POLL_INTERVAL_SECONDS: Final = 0.25

_VARIANT_ORDER: Final[tuple[VariantName, ...]] = (VariantName.BASELINE, VariantName.CANDIDATE)


@dataclass(frozen=True)
class VariantPair:
    """The two plans one comparison executes."""

    baseline: VariantExecutionPlan
    candidate: VariantExecutionPlan

    def __post_init__(self) -> None:
        if self.baseline.variant is not VariantName.BASELINE:
            raise ValidationError(
                "the baseline slot holds the baseline plan",
                code=VARIANT_INPUTS_MISSING,
                details={"variant": self.baseline.variant.value},
            )
        if self.candidate.variant is not VariantName.CANDIDATE:
            raise ValidationError(
                "the candidate slot holds the candidate plan",
                code=VARIANT_INPUTS_MISSING,
                details={"variant": self.candidate.variant.value},
            )
        if self.baseline.task_count != self.candidate.task_count:
            raise ValidationError(
                "the two variants of a comparison score the same tasks; this pair scores "
                f"{self.baseline.task_count} against {self.candidate.task_count}",
                code=VARIANT_INPUTS_MISSING,
                details={
                    "baseline_task_count": self.baseline.task_count,
                    "candidate_task_count": self.candidate.task_count,
                },
            )

    def plan(self, variant: VariantName) -> VariantExecutionPlan:
        return self.baseline if variant is VariantName.BASELINE else self.candidate

    @property
    def total_max_concurrent(self) -> int:
        return self.baseline.max_concurrent + self.candidate.max_concurrent


def require_concurrency_budget(pair: VariantPair, *, max_concurrent: int) -> None:
    """Refuse a pair whose two halves together exceed the Campaign's own bound."""
    if pair.total_max_concurrent > max_concurrent:
        raise ValidationError(
            f"this pair would run {pair.total_max_concurrent} episodes at once and the "
            f"Campaign permits {max_concurrent}",
            code=VARIANT_CONCURRENCY_EXCEEDED,
            details={
                "campaign_max_concurrent": max_concurrent,
                "baseline_max_concurrent": pair.baseline.max_concurrent,
                "candidate_max_concurrent": pair.candidate.max_concurrent,
            },
        )


@dataclass(frozen=True)
class LaunchSkew:
    """How far apart the two children started, measured on the monotonic clock."""

    baseline_started_at: datetime
    candidate_started_at: datetime
    seconds: float
    first: VariantName


@dataclass(frozen=True)
class VariantPairOutcome:
    """Both children's outcomes, and how far apart they were launched."""

    baseline: ChildProcessOutcome
    candidate: ChildProcessOutcome
    schedule: VariantSchedule
    skew: LaunchSkew


class VariantScheduler:
    """Starts, watches, and stops the children of one comparison."""

    def __init__(
        self,
        *,
        run_store: RunStore,
        child_registry: ChildRegistry,
        poll_interval_seconds: float = DEFAULT_POLL_INTERVAL_SECONDS,
        grace_seconds: float = DEFAULT_GRACE_SECONDS,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if poll_interval_seconds <= 0:
            raise ValidationError(
                "a poller needs a positive interval",
                details={"poll_interval_seconds": poll_interval_seconds},
            )
        self._run_store = run_store
        self._children = child_registry
        self._poll_interval = poll_interval_seconds
        self._grace = grace_seconds
        self._clock = clock or _utc_now

    def execute_parallel(
        self,
        *,
        run_id: str,
        run_root: Path,
        pair: VariantPair,
        baseline_child: VerifiersChild,
        candidate_child: VerifiersChild,
        guard: Callable[[], None],
    ) -> VariantPairOutcome:
        """Run both variants side by side under one ``running_variants`` phase, stopping both
        as soon as `guard`, called on every poll, raises a RunError."""
        children = {VariantName.BASELINE: baseline_child, VariantName.CANDIDATE: candidate_child}
        self._require_inputs(pair, children)
        raise_if_cancel_requested(self._run_store, run_id)
        self._run_store.append(run_id, phase=RunPhase.RUNNING_VARIANTS)

        skew = self._start_both(run_id, run_root=run_root, children=children)
        for variant in _VARIANT_ORDER:
            self._emit(
                run_id, VARIANT_STARTED, pending_progress(variant, pair.plan(variant).task_count)
            )

        outcomes = self._watch_both(run_id, pair, children, guard)
        return VariantPairOutcome(
            baseline=outcomes[VariantName.BASELINE],
            candidate=outcomes[VariantName.CANDIDATE],
            schedule=VariantSchedule.PARALLEL,
            skew=skew,
        )

    def _require_inputs(
        self, pair: VariantPair, children: dict[VariantName, VerifiersChild]
    ) -> None:
        for variant in _VARIANT_ORDER:
            if children[variant].variant is not variant:
                raise ValidationError(
                    f"the {variant.value} slot holds a {children[variant].variant.value} child",
                    code=VARIANT_INPUTS_MISSING,
                    details={"variant": variant.value},
                )
            plan = pair.plan(variant)
            for label, path in (
                ("compiled config", Path(plan.verifiers_input_config_path)),
                ("experiment manifest", Path(plan.experiment_manifest_path)),
            ):
                if not path.is_file():
                    raise ValidationError(
                        f"the {variant.value} variant's {label} is not on disk, so neither "
                        "variant may start",
                        code=VARIANT_INPUTS_MISSING,
                        details={"variant": variant.value, "path": str(path)},
                    )
            for skill in plan.skill_paths:
                if not Path(skill).is_dir():
                    raise ValidationError(
                        f"the {variant.value} variant declares a skill that is not staged in "
                        "the run's own input tree",
                        code=VARIANT_INPUTS_MISSING,
                        details={"variant": variant.value, "path": skill},
                    )
            traces = _traces_path(plan)
            if traces.exists():
                raise ValidationError(
                    f"the {variant.value} variant's output directory already holds evidence; "
                    "a run writes its own",
                    code=VARIANT_INPUTS_MISSING,
                    details={"variant": variant.value, "path": str(traces)},
                )

    def _start_both(
        self, run_id: str, *, run_root: Path, children: dict[VariantName, VerifiersChild]
    ) -> LaunchSkew:
        first = self._start_one(run_id, children[VariantName.BASELINE])
        first_monotonic = time.monotonic()
        try:
            second = self._start_one(run_id, children[VariantName.CANDIDATE])
        except BaseException:
            # The pair never existed: stop the one child that did, so a failed launch does
            # not leave a container talking to a provider.
            self._children.terminate_all(run_id, self._grace)
            raise
        second_monotonic = time.monotonic()
        skew = LaunchSkew(
            baseline_started_at=first.started_at,
            candidate_started_at=second.started_at,
            seconds=max(second_monotonic - first_monotonic, 0.0),
            first=VariantName.BASELINE,
        )
        write_children_record(
            run_root=run_root,
            run_id=run_id,
            schedule=VariantSchedule.PARALLEL,
            children=[first, second],
            launch_skew_seconds=skew.seconds,
        )
        return skew

    def _start_one(self, run_id: str, child: VerifiersChild) -> LaunchedChild:
        try:
            child.start()
        except RunError:
            raise
        except OSError as error:
            raise RunError(
                f"the {child.variant.value} evaluation child could not be started: "
                f"{error.strerror or error}",
                code=VARIANT_CHILD_START_FAILED,
                details={"run_id": run_id, "variant": child.variant.value},
            ) from error
        self._children.register(run_id, child)
        return LaunchedChild(
            variant=child.variant,
            pid=child.pid,
            argv_digest=child.argv_digest,
            started_at=self._clock(),
        )

    def _watch_both(
        self,
        run_id: str,
        pair: VariantPair,
        children: dict[VariantName, VerifiersChild],
        guard: Callable[[], None],
    ) -> dict[VariantName, ChildProcessOutcome]:
        reported: dict[VariantName, VariantProgress | None] = dict.fromkeys(_VARIANT_ORDER)
        exits: dict[VariantName, int] = {}
        outcomes: dict[VariantName, ChildProcessOutcome] = {}
        try:
            while len(outcomes) < len(_VARIANT_ORDER):
                raise_if_cancel_requested(self._run_store, run_id)
                guard()
                for variant in _VARIANT_ORDER:
                    if variant in outcomes:
                        continue
                    child = children[variant]
                    code = child.poll()
                    progress = self._inspect(pair, variant, code)
                    if code is None:
                        if reported[variant] != progress:
                            self._emit(run_id, VARIANT_PROGRESS, progress)
                            reported[variant] = progress
                        continue
                    exits[variant] = code
                    outcomes[variant] = child.outcome()
                    self._children.unregister(run_id, variant)
                    self._emit(run_id, VARIANT_COMPLETED, progress)
                    reported[variant] = progress
                    if code != 0:
                        self._stop_sibling(run_id, variant, children, outcomes)
                if len(outcomes) < len(_VARIANT_ORDER):
                    time.sleep(self._poll_interval)
        except (CancellationError, RunError):
            self._children.terminate_all(run_id, self._grace)
            for variant in _VARIANT_ORDER:
                if variant not in outcomes:
                    with contextlib.suppress(RunError):
                        outcomes[variant] = children[variant].outcome()
            raise

        failed = sorted((variant.value, code) for variant, code in exits.items() if code != 0)
        if failed:
            detail: list[JsonValue] = [{"variant": v, "exit_code": c} for v, c in failed]
            raise RunError(
                f"the {', '.join(v for v, _ in failed)} evaluation did not finish; a comparison "
                "needs both sides, so the pair failed and the partial evidence was kept",
                code=VARIANT_EXECUTION_FAILED,
                details={"run_id": run_id, "variants": detail},
            )
        return outcomes

    def _stop_sibling(
        self,
        run_id: str,
        failed: VariantName,
        children: dict[VariantName, VerifiersChild],
        outcomes: dict[VariantName, ChildProcessOutcome],
    ) -> None:
        for variant in _VARIANT_ORDER:
            if variant is failed or variant in outcomes:
                continue
            sibling = children[variant]
            sibling.terminate(self._grace)
            outcomes[variant] = sibling.outcome()
            self._children.unregister(run_id, variant)

    def _inspect(
        self, pair: VariantPair, variant: VariantName, exit_code: int | None
    ) -> VariantProgress:
        plan = pair.plan(variant)
        return inspect_progress(
            variant=variant,
            traces_path=_traces_path(plan),
            total=plan.task_count,
            child_exit_code=exit_code,
            max_concurrent=plan.max_concurrent,
        )

    def _emit(self, run_id: str, kind: str, progress: VariantProgress) -> None:
        with self._cancellation_aware(run_id):
            self._run_store.append(
                run_id,
                phase=None,
                kind=kind,
                details={
                    DETAIL_VARIANT: progress.variant,
                    DETAIL_COMPLETED: progress.completed,
                    DETAIL_TOTAL: progress.total,
                    DETAIL_RUNNING: progress.running,
                    DETAIL_ERRORED: progress.errored,
                    DETAIL_STATE: progress.state,
                },
            )

    @contextlib.contextmanager
    def _cancellation_aware(self, run_id: str) -> Iterator[None]:
        """Report an append refused after another process cancelled the run as the cancellation."""
        try:
            yield
        except TechtreeError:
            raise_if_cancel_requested(self._run_store, run_id)
            raise


def _traces_path(plan: VariantExecutionPlan) -> Path:
    return Path(plan.verifiers_output_dir) / TRACES_FILENAME


def _utc_now() -> datetime:
    return datetime.now(UTC)
