"""The append-only run event log and its closed vocabulary of kinds.

One event is one line of canonical JSON, appended with ``O_APPEND`` and fsynced, so a crash
can lose a trailing event but never interleave two. Sequence numbers start at zero and rise
by exactly one; a log that skips lost something and is refused rather than projected.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Final

from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import canonical_json_bytes, sha256_digest_bytes
from regents_cli.techtree.errors import NotFoundError, ValidationError
from regents_cli.techtree.fs import fsync_directory
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.models.run import RunEvent, RunPhase

_LINE_SEPARATOR: Final = b"\n"
_FILE_MODE: Final = 0o600

#: The run exists and its request is fixed. Always sequence zero.
RUN_CREATED: Final = "run.created"
#: A person read the review of what this run would do and approved it.
RUN_APPROVED: Final = "run.approved"
#: A detached worker took the run on and announced its process id.
WORKER_STARTED: Final = "worker.started"
#: The run moved from one phase to another.
PHASE_ENTERED: Final = "phase.entered"
#: How far through the current phase the worker is.
PROGRESS_UPDATED: Final = "progress.updated"
#: Someone asked the run to stop.
CANCEL_REQUESTED: Final = "cancel.requested"
#: The run stopped because something went wrong.
RUN_FAILED: Final = "run.failed"
#: The run stopped because it was asked to.
RUN_CANCELLED: Final = "run.cancelled"
#: The report was persisted and its digest recorded.
RESULT_WRITTEN: Final = "result.written"
#: The run finished the normal path.
RUN_COMPLETED: Final = "run.completed"
#: One side of the comparison began.
VARIANT_STARTED: Final = "variant.started"
#: How far one side of the comparison has got.
VARIANT_PROGRESS: Final = "variant.progress"
#: One side of the comparison stopped, whichever way it stopped.
VARIANT_COMPLETED: Final = "variant.completed"

VARIANT_EVENT_KINDS: Final[frozenset[str]] = frozenset(
    {VARIANT_STARTED, VARIANT_PROGRESS, VARIANT_COMPLETED}
)

EVENT_KINDS: Final[frozenset[str]] = frozenset(
    {
        RUN_CREATED,
        RUN_APPROVED,
        WORKER_STARTED,
        PHASE_ENTERED,
        PROGRESS_UPDATED,
        CANCEL_REQUESTED,
        RUN_FAILED,
        RUN_CANCELLED,
        RESULT_WRITTEN,
        RUN_COMPLETED,
        *VARIANT_EVENT_KINDS,
    }
)

#: The kinds that report something true of a run without moving it on.
SAME_PHASE_EVENT_KINDS: Final[frozenset[str]] = frozenset(
    {RUN_APPROVED, WORKER_STARTED, PROGRESS_UPDATED, RESULT_WRITTEN, *VARIANT_EVENT_KINDS}
)

DETAIL_REQUEST_DIGEST: Final = "request_digest"
DETAIL_DRAFT_DIGEST: Final = "draft_digest"
DETAIL_ACTOR: Final = "actor"
DETAIL_APPROVED_AT: Final = "approved_at"
DETAIL_WORKER_PID: Final = "worker_pid"
DETAIL_CURRENT: Final = "current"
DETAIL_TOTAL: Final = "total"
DETAIL_LABEL: Final = "label"
DETAIL_REQUESTED_BY: Final = "requested_by"
DETAIL_ERROR: Final = "error"
DETAIL_RESULT_DIGEST: Final = "result_digest"
DETAIL_VARIANT: Final = "variant"
DETAIL_COMPLETED: Final = "completed"
DETAIL_RUNNING: Final = "running"
DETAIL_ERRORED: Final = "errored"
DETAIL_STATE: Final = "state"

_VARIANT_DETAILS: Final[tuple[str, ...]] = (
    DETAIL_VARIANT,
    DETAIL_COMPLETED,
    DETAIL_TOTAL,
    DETAIL_RUNNING,
    DETAIL_ERRORED,
    DETAIL_STATE,
)

_REQUIRED_DETAILS: Final[dict[str, tuple[str, ...]]] = {
    RUN_CREATED: (DETAIL_REQUEST_DIGEST,),
    RUN_APPROVED: (DETAIL_DRAFT_DIGEST, DETAIL_ACTOR, DETAIL_APPROVED_AT),
    WORKER_STARTED: (DETAIL_WORKER_PID,),
    PROGRESS_UPDATED: (DETAIL_CURRENT, DETAIL_TOTAL, DETAIL_LABEL),
    CANCEL_REQUESTED: (DETAIL_REQUESTED_BY,),
    RUN_FAILED: (DETAIL_ERROR,),
    RESULT_WRITTEN: (DETAIL_RESULT_DIGEST,),
    RUN_COMPLETED: (DETAIL_RESULT_DIGEST,),
    VARIANT_STARTED: _VARIANT_DETAILS,
    VARIANT_PROGRESS: _VARIANT_DETAILS,
    VARIANT_COMPLETED: _VARIANT_DETAILS,
}

#: Phases that exactly one kind enters, and that kind enters nothing else.
_EXCLUSIVE_PHASE_KINDS: Final[dict[RunPhase, str]] = {
    RunPhase.CANCEL_REQUESTED: CANCEL_REQUESTED,
    RunPhase.FAILED: RUN_FAILED,
    RunPhase.CANCELLED: RUN_CANCELLED,
    RunPhase.COMPLETED: RUN_COMPLETED,
}

_ONLY_IN_PHASE: Final[dict[str, RunPhase]] = {
    RUN_APPROVED: RunPhase.CREATED,
    WORKER_STARTED: RunPhase.CREATED,
    RESULT_WRITTEN: RunPhase.BUILDING_REPORT,
    **dict.fromkeys(VARIANT_EVENT_KINDS, RunPhase.RUNNING_VARIANTS),
}

_REQUIRED_PREVIOUS_PHASE: Final[dict[str, RunPhase]] = {
    RUN_CANCELLED: RunPhase.CANCEL_REQUESTED,
    RUN_COMPLETED: RunPhase.BUILDING_REPORT,
}


def validate_event_kind(event: RunEvent) -> None:
    """Reject unknown kinds, kind and phase mismatches, and missing details."""
    if event.kind not in EVENT_KINDS:
        known: list[JsonValue] = list(sorted(EVENT_KINDS))
        raise ValidationError(
            f"{event.kind!r} is not a run event kind",
            code="run_event_kind_invalid",
            details={
                "run_id": event.run_id,
                "sequence": event.sequence,
                "kind": event.kind,
                "known": known,
            },
        )
    _check_phases(event)
    for key in _REQUIRED_DETAILS.get(event.kind, ()):
        if key not in event.details:
            raise _kind_mismatch(event, f"a {event.kind} event carries details.{key}")


def _check_phases(event: RunEvent) -> None:
    if event.kind == RUN_CREATED:
        _check_created_event(event)
    elif event.previous_phase is None:
        raise _kind_mismatch(event, f"only {RUN_CREATED} comes from no earlier phase")

    entering = event.previous_phase is not event.phase
    for phase, kind in _EXCLUSIVE_PHASE_KINDS.items():
        if entering and event.phase is phase and event.kind != kind:
            raise _kind_mismatch(event, f"only {kind} enters {phase.value}")
        if event.kind == kind and event.phase is not phase:
            raise _kind_mismatch(event, f"{kind} enters {phase.value}")

    required_phase = _ONLY_IN_PHASE.get(event.kind)
    if required_phase is not None and event.phase is not required_phase:
        raise _kind_mismatch(
            event, f"{event.kind} belongs to {required_phase.value}, not to {event.phase.value}"
        )

    required_previous = _REQUIRED_PREVIOUS_PHASE.get(event.kind)
    if required_previous is not None and event.previous_phase is not required_previous:
        raise _kind_mismatch(event, f"{event.kind} follows {required_previous.value}")

    same_phase = event.phase is event.previous_phase
    if same_phase and event.kind not in SAME_PHASE_EVENT_KINDS:
        raise _kind_mismatch(
            event, f"{event.kind} moves a run on, but this one stays in {event.phase.value}"
        )
    if not same_phase and event.kind in SAME_PHASE_EVENT_KINDS:
        raise _kind_mismatch(event, f"{event.kind} does not move a run out of {event.phase.value}")


def _check_created_event(event: RunEvent) -> None:
    if event.sequence != 0:
        raise _kind_mismatch(
            event, f"{RUN_CREATED} opens a log at sequence 0, not {event.sequence}"
        )
    if event.previous_phase is not None:
        raise _kind_mismatch(
            event,
            "a run's first event comes from no earlier phase, but this one claims to leave "
            f"{event.previous_phase.value}",
        )
    if event.phase is not RunPhase.CREATED:
        raise _kind_mismatch(event, f"{RUN_CREATED} opens a run in {RunPhase.CREATED.value}")


def _kind_mismatch(event: RunEvent, reason: str) -> ValidationError:
    previous = None if event.previous_phase is None else event.previous_phase.value
    return ValidationError(
        reason,
        code="run_event_kind_invalid",
        details={
            "run_id": event.run_id,
            "sequence": event.sequence,
            "kind": event.kind,
            "phase": event.phase.value,
            "event_previous_phase": previous,
        },
    )


def append_event(path: Path, event: RunEvent) -> None:
    """Append one canonical JSON line and fsync the file and its directory."""
    line = canonical_json_bytes(event) + _LINE_SEPARATOR
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, _FILE_MODE)
    try:
        written = 0
        while written < len(line):
            written += os.write(descriptor, line[written:])
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    fsync_directory(path.parent)


def read_events(path: Path) -> list[RunEvent]:
    """Read every event, refusing an empty line, an unparseable line or a sequence gap."""
    try:
        raw = path.read_bytes()
    except FileNotFoundError as error:
        raise NotFoundError(f"no run event log at {path}", details={"path": str(path)}) from error

    lines = raw.split(_LINE_SEPARATOR)
    if lines and lines[-1] == b"":
        lines.pop()

    events: list[RunEvent] = []
    for number, line in enumerate(lines, start=1):
        if not line.strip():
            raise ValidationError(
                f"run event log line {number} is empty: {path}",
                code="run_event_log_corrupt",
                details={"path": str(path), "line": number},
            )
        try:
            event = RunEvent.model_validate_json(line)
        except PydanticValidationError as error:
            raise ValidationError(
                f"run event log line {number} is not a run event: {path} "
                f"({error.errors()[0]['msg']})",
                code="run_event_log_corrupt",
                details={"path": str(path), "line": number},
            ) from error
        expected = len(events)
        if event.sequence != expected:
            raise ValidationError(
                f"run event log skips from sequence {expected - 1} to {event.sequence}: {path}",
                code="run_event_sequence_invalid",
                details={
                    "path": str(path),
                    "line": number,
                    "expected_sequence": expected,
                    "sequence": event.sequence,
                },
            )
        events.append(event)
    return events


def next_sequence(events: list[RunEvent]) -> int:
    """Return the sequence number the next event takes."""
    return 0 if not events else events[-1].sequence + 1


def event_digest(path: Path) -> Digest:
    """Digest the log's exact bytes."""
    try:
        return sha256_digest_bytes(path.read_bytes())
    except FileNotFoundError as error:
        raise NotFoundError(f"no run event log at {path}", details={"path": str(path)}) from error
