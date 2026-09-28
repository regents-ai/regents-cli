"""The run state machine and its projection, as pure functions of the event log.

The normal path is a straight line from ``created`` through ``validating_taskset``,
``running_variants``, ``building_receipts``, ``verifying_comparison`` and ``building_report``
to ``completed``. Any working phase may fail or be asked to cancel; a cancel-requested run
ends in ``cancelled`` or ``failed``. Terminal phases have no outgoing edges. ``heartbeat_at``
is deliberately not event-sourced and is always left unset here; the store merges it in.
"""

from __future__ import annotations

from typing import Final

from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import validate_digest
from regents_cli.techtree.errors import RunError, TechtreeError, ValidationError
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.models.run import (
    PublicRunState,
    RunEvent,
    RunFailure,
    RunPhase,
    RunProgress,
    RunState,
    VariantProgress,
)
from regents_cli.techtree.runs.events import (
    CANCEL_REQUESTED,
    DETAIL_COMPLETED,
    DETAIL_CURRENT,
    DETAIL_ERROR,
    DETAIL_ERRORED,
    DETAIL_LABEL,
    DETAIL_RESULT_DIGEST,
    DETAIL_RUNNING,
    DETAIL_STATE,
    DETAIL_TOTAL,
    DETAIL_VARIANT,
    DETAIL_WORKER_PID,
    PROGRESS_UPDATED,
    RESULT_WRITTEN,
    RUN_COMPLETED,
    RUN_CREATED,
    RUN_FAILED,
    SAME_PHASE_EVENT_KINDS,
    VARIANT_EVENT_KINDS,
    WORKER_STARTED,
    validate_event_kind,
)

#: The successful sequence, in order.
NORMAL_PATH: Final[tuple[RunPhase, ...]] = (
    RunPhase.CREATED,
    RunPhase.VALIDATING_TASKSET,
    RunPhase.RUNNING_VARIANTS,
    RunPhase.BUILDING_RECEIPTS,
    RunPhase.VERIFYING_COMPARISON,
    RunPhase.BUILDING_REPORT,
    RunPhase.COMPLETED,
)

_TERMINAL_PHASES: Final[frozenset[RunPhase]] = frozenset(
    {RunPhase.COMPLETED, RunPhase.FAILED, RunPhase.CANCELLED}
)


def _build_allowed_transitions() -> dict[RunPhase, frozenset[RunPhase]]:
    allowed: dict[RunPhase, frozenset[RunPhase]] = {}
    working = [phase for phase in NORMAL_PATH if phase not in _TERMINAL_PHASES]
    for position, phase in enumerate(working):
        allowed[phase] = frozenset(
            {NORMAL_PATH[position + 1], RunPhase.FAILED, RunPhase.CANCEL_REQUESTED}
        )
    allowed[RunPhase.CANCEL_REQUESTED] = frozenset({RunPhase.CANCELLED, RunPhase.FAILED})
    for phase in _TERMINAL_PHASES:
        allowed[phase] = frozenset()
    return allowed


#: Every phase a run may move to from each phase. No phase maps to itself.
ALLOWED_TRANSITIONS: Final[dict[RunPhase, frozenset[RunPhase]]] = _build_allowed_transitions()

PUBLIC_STATE_BY_PHASE: Final[dict[RunPhase, PublicRunState]] = {
    RunPhase.CREATED: PublicRunState.PREPARED,
    RunPhase.VALIDATING_TASKSET: PublicRunState.RUNNING,
    RunPhase.RUNNING_VARIANTS: PublicRunState.RUNNING,
    RunPhase.BUILDING_RECEIPTS: PublicRunState.RUNNING,
    RunPhase.VERIFYING_COMPARISON: PublicRunState.RUNNING,
    RunPhase.BUILDING_REPORT: PublicRunState.RUNNING,
    RunPhase.CANCEL_REQUESTED: PublicRunState.RUNNING,
    RunPhase.COMPLETED: PublicRunState.COMPLETED,
    RunPhase.FAILED: PublicRunState.FAILED,
    RunPhase.CANCELLED: PublicRunState.CANCELLED,
}


def validate_transition(current: RunPhase, target: RunPhase) -> None:
    """Raise unless a run in ``current`` may move to ``target``."""
    if target in ALLOWED_TRANSITIONS[current]:
        return
    if is_terminal(current):
        raise RunError(
            f"run has already ended in {current.value}; it records no further events, "
            f"so it cannot move to {target.value}",
            code="run_transition_invalid",
            details={"phase": current.value, "target_phase": target.value},
        )
    if current is target:
        raise RunError(
            f"a run in {current.value} does not move to itself; only "
            f"{_named(SAME_PHASE_EVENT_KINDS)} report without leaving a phase",
            code="run_transition_invalid",
            details={"phase": current.value, "target_phase": target.value},
        )
    allowed: list[JsonValue] = [phase.value for phase in sorted(ALLOWED_TRANSITIONS[current])]
    raise RunError(
        f"a run in {current.value} cannot move to {target.value}",
        code="run_transition_invalid",
        details={"phase": current.value, "target_phase": target.value, "allowed": allowed},
    )


def validate_same_phase_event(state: RunState, event: RunEvent) -> None:
    """Raise unless this event may leave the run in the phase it is in."""
    if is_terminal(state.phase):
        raise RunError(
            f"run has already ended in {state.phase.value}; it records no further events",
            code="run_transition_invalid",
            details={"run_id": state.run_id, "phase": state.phase.value},
        )
    if event.kind not in SAME_PHASE_EVENT_KINDS:
        raise RunError(
            f"a run records nothing without leaving {state.phase.value} except "
            f"{_named(SAME_PHASE_EVENT_KINDS)}",
            code="run_transition_invalid",
            details={"run_id": state.run_id, "phase": state.phase.value, "kind": event.kind},
        )
    if event.kind == PROGRESS_UPDATED and not phase_progress_allowed(state.phase):
        raise RunError(
            f"a run in {state.phase.value} has no progress to report",
            code="run_transition_invalid",
            details={"run_id": state.run_id, "phase": state.phase.value},
        )


def is_terminal(phase: RunPhase) -> bool:
    """Return whether a run in this phase has ended."""
    return not ALLOWED_TRANSITIONS[phase]


def phase_progress_allowed(phase: RunPhase) -> bool:
    """Return whether a phase measures work a run can be part-way through."""
    return not is_terminal(phase) and phase is not RunPhase.CREATED


def _named(kinds: frozenset[str]) -> str:
    return ", ".join(sorted(kinds))


def public_state(phase: RunPhase) -> PublicRunState:
    """Return the public state a phase projects onto.

    ``cancel_requested`` projects to ``running``: cancellation is cooperative and takes effect
    at a phase boundary, so a run asked to stop has not stopped yet.
    """
    return PUBLIC_STATE_BY_PHASE[phase]


def reduce_events(events: list[RunEvent]) -> RunState:
    """Project the complete state from a run's events."""
    if not events:
        raise ValidationError(
            "a run event log cannot be empty; every run opens with its created event",
            code="run_event_log_corrupt",
        )
    state = initial_state(events[0])
    for event in events[1:]:
        state = apply_event(state, event)
    return state


def initial_state(created_event: RunEvent) -> RunState:
    """Project the event every run opens with."""
    if created_event.kind != RUN_CREATED:
        raise ValidationError(
            f"a run event log opens with {RUN_CREATED}, not {created_event.kind}",
            code="run_event_kind_invalid",
            details={"run_id": created_event.run_id, "kind": created_event.kind},
        )
    validate_event_kind(created_event)
    return _project(_opening_state(created_event), created_event)


def apply_event(state: RunState, event: RunEvent) -> RunState:
    """Apply one event to a state, refusing anything the machine does not admit."""
    if event.run_id != state.run_id:
        raise ValidationError(
            f"run event belongs to {event.run_id}, not to {state.run_id}",
            code="run_event_log_corrupt",
            details={"run_id": state.run_id, "event_run_id": event.run_id},
        )
    if event.sequence != state.sequence + 1:
        raise ValidationError(
            f"run event {event.sequence} does not follow {state.sequence}",
            code="run_event_sequence_invalid",
            details={
                "run_id": state.run_id,
                "sequence": event.sequence,
                "expected_sequence": state.sequence + 1,
            },
        )
    if event.previous_phase is not state.phase:
        recorded = None if event.previous_phase is None else event.previous_phase.value
        raise ValidationError(
            f"run event claims to leave {recorded}, but the run is in {state.phase.value}",
            code="run_event_log_corrupt",
            details={
                "run_id": state.run_id,
                "phase": state.phase.value,
                "event_previous_phase": recorded,
            },
        )
    validate_event_kind(event)
    if event.phase is state.phase:
        validate_same_phase_event(state, event)
    else:
        validate_transition(state.phase, event.phase)
    return _project(state, event)


def _project(previous: RunState, event: RunEvent) -> RunState:
    worker_pid = _worker_pid(event) if event.kind == WORKER_STARTED else None
    progress = _progress(event) if event.kind == PROGRESS_UPDATED else None
    carries_result = event.kind in (RESULT_WRITTEN, RUN_COMPLETED)
    entered_new_phase = previous.phase is not event.phase

    variant_progress = {} if entered_new_phase else dict(previous.variant_progress)
    if event.kind in VARIANT_EVENT_KINDS:
        reported = _variant_progress(event)
        variant_progress[reported.variant] = reported

    return RunState(
        run_id=event.run_id,
        phase=event.phase,
        sequence=event.sequence,
        updated_at=event.timestamp,
        worker_pid=worker_pid if worker_pid is not None else previous.worker_pid,
        worker_started_at=(
            event.timestamp if worker_pid is not None else previous.worker_started_at
        ),
        heartbeat_at=None,
        cancel_requested_at=(
            event.timestamp if event.kind == CANCEL_REQUESTED else previous.cancel_requested_at
        ),
        error=_error(event) if event.kind == RUN_FAILED else previous.error,
        progress=(
            progress if progress is not None else (None if entered_new_phase else previous.progress)
        ),
        variant_progress=variant_progress,
        result_digest=_result_digest(event) if carries_result else previous.result_digest,
    )


def _opening_state(event: RunEvent) -> RunState:
    return RunState(
        run_id=event.run_id,
        phase=RunPhase.CREATED,
        sequence=0,
        updated_at=event.timestamp,
        worker_pid=None,
        worker_started_at=None,
        heartbeat_at=None,
        cancel_requested_at=None,
        error=None,
        progress=None,
        variant_progress={},
        result_digest=None,
    )


def _worker_pid(event: RunEvent) -> int:
    raw = event.details[DETAIL_WORKER_PID]
    if not isinstance(raw, int) or isinstance(raw, bool) or raw <= 0:
        raise _detail_invalid(event, f"{DETAIL_WORKER_PID} must be a positive integer")
    return raw


def _progress(event: RunEvent) -> RunProgress:
    try:
        return RunProgress.model_validate(
            {
                "current": event.details[DETAIL_CURRENT],
                "total": event.details[DETAIL_TOTAL],
                "label": event.details[DETAIL_LABEL],
            }
        )
    except PydanticValidationError as error:
        raise _detail_invalid(
            event, f"progress is not valid ({error.errors()[0]['msg']})"
        ) from error


def _variant_progress(event: RunEvent) -> VariantProgress:
    try:
        return VariantProgress.model_validate(
            {
                "variant": event.details[DETAIL_VARIANT],
                "completed": event.details[DETAIL_COMPLETED],
                "total": event.details[DETAIL_TOTAL],
                "running": event.details[DETAIL_RUNNING],
                "errored": event.details[DETAIL_ERRORED],
                "state": event.details[DETAIL_STATE],
            }
        )
    except PydanticValidationError as error:
        raise _detail_invalid(
            event, f"variant progress is not valid ({error.errors()[0]['msg']})"
        ) from error


def _result_digest(event: RunEvent) -> Digest:
    raw = event.details[DETAIL_RESULT_DIGEST]
    if not isinstance(raw, str):
        raise _detail_invalid(event, f"{DETAIL_RESULT_DIGEST} must be a digest string")
    try:
        return validate_digest(raw)
    except ValidationError as error:
        raise _detail_invalid(event, f"{DETAIL_RESULT_DIGEST} is not a digest") from error


def _error(event: RunEvent) -> RunFailure:
    try:
        return RunFailure.model_validate(event.details[DETAIL_ERROR])
    except PydanticValidationError as error:
        raise _detail_invalid(
            event, f"{DETAIL_ERROR} is not a run failure ({error.errors()[0]['msg']})"
        ) from error


def _detail_invalid(event: RunEvent, reason: str) -> ValidationError:
    return ValidationError(
        f"run event {reason}",
        code="run_event_kind_invalid",
        details={"run_id": event.run_id, "sequence": event.sequence, "kind": event.kind},
    )


def run_failure(error: TechtreeError) -> RunFailure:
    """Project a failure into the run record; its details are validated as JSON on the way."""
    return RunFailure.model_validate(
        {"code": error.code, "message": error.message, "details": error.details}
    )
