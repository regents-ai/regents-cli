"""Everything one run keeps on disk, and the only way anything writes to it.

``request.json`` and ``report/uplift.json`` are written once with ``O_EXCL``. ``events.jsonl``
is appended to and is the only authority on what happened. ``state.json``, ``heartbeat.json``
and ``pid`` are overwritten atomically and are never the source of a fact the log could not
rebuild, except the heartbeat. Every writer holds ``runs/<run-id>/.lock`` because a detached
worker and the CLI write concurrently; the projection is always recomputed from the log.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from filelock import FileLock, Timeout
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object
from regents_cli.techtree.errors import ConflictError, NotFoundError, RunError, ValidationError
from regents_cli.techtree.fs import (
    atomic_write_json,
    atomic_write_text,
    ensure_private_directory,
    fsync_directory,
    open_exclusive,
    read_json,
)
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.models.run import RunEvent, RunPhase, RunRequestV2, RunState
from regents_cli.techtree.models.uplift_report import UpliftReportV3
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.runs.events import (
    CANCEL_REQUESTED,
    DETAIL_REQUEST_DIGEST,
    DETAIL_REQUESTED_BY,
    DETAIL_RESULT_DIGEST,
    DETAIL_WORKER_PID,
    PHASE_ENTERED,
    RESULT_WRITTEN,
    RUN_CREATED,
    WORKER_STARTED,
    append_event,
    event_digest,
    next_sequence,
    read_events,
)
from regents_cli.techtree.runs.machine import apply_event, is_terminal, reduce_events

#: A lock hold is a few file operations; waiting this long means the holder died with it.
LOCK_TIMEOUT_SECONDS: Final = 30.0

_LOCK_FILE_NAME: Final = ".lock"
_REQUEST_FILE_NAME: Final = "request.json"
_EVENTS_FILE_NAME: Final = "events.jsonl"
_STATE_FILE_NAME: Final = "state.json"
_HEARTBEAT_FILE_NAME: Final = "heartbeat.json"
_PID_FILE_NAME: Final = "pid"
_WORKER_LOG_FILE_NAME: Final = "worker.log"
_REPORT_DIRECTORY_NAME: Final = "report"
_RESULT_FILE_NAME: Final = "uplift.json"
_HEARTBEAT_PHASE_KEY: Final = "phase"
_HEARTBEAT_AT_KEY: Final = "at"
_FILE_MODE: Final = 0o600


def _now() -> datetime:
    return datetime.now(UTC)


class RunStore:
    """The run directory."""

    def __init__(self, paths: TechtreePaths) -> None:
        self._paths = paths

    def create(self, request: RunRequestV2) -> RunState:
        """Create the run tree, the immutable request and the opening event."""
        run_id = request.run_id
        run_dir = self._run_dir(run_id)
        ensure_private_directory(self._paths.runs_dir)
        ensure_private_directory(run_dir)
        with self._lock(run_id):
            try:
                self._write_immutable(self._request_path(run_id), request)
            except ConflictError as error:
                raise ConflictError(
                    f"run {run_id} already exists",
                    code="run_already_exists",
                    details={"run_id": run_id},
                ) from error
            append_event(
                self._events_path(run_id),
                RunEvent(
                    sequence=0,
                    timestamp=_now(),
                    run_id=run_id,
                    previous_phase=None,
                    phase=RunPhase.CREATED,
                    kind=RUN_CREATED,
                    details={DETAIL_REQUEST_DIGEST: digest_object(request)},
                ),
            )
            return self._write_projection(run_id)

    def get_request(self, run_id: str) -> RunRequestV2:
        """Load the immutable request."""
        path = self._request_path(run_id)
        try:
            raw = path.read_bytes()
        except FileNotFoundError as error:
            raise NotFoundError(
                f"no such run: {run_id}", code="run_not_found", details={"run_id": run_id}
            ) from error
        try:
            return RunRequestV2.model_validate_json(raw)
        except PydanticValidationError as error:
            raise ValidationError(
                "this run's records do not match what this version writes, so this build "
                f"cannot operate on the run: {path}. The run's files were not changed.",
                code="run_request_unreadable",
                details={"run_id": run_id, "path": str(path)},
            ) from error

    def append(
        self,
        run_id: str,
        *,
        phase: RunPhase | None,
        kind: str = PHASE_ENTERED,
        details: dict[str, JsonValue] | None = None,
    ) -> RunState:
        """Validate, append and project one event.

        ``phase=None`` records the event against whatever phase the run is in at append time,
        under the lock, which is what a progress report must use: between its last look and
        this append the run may have been asked to cancel.
        """
        self._require_run(run_id)
        with self._lock(run_id):
            return self._append_locked(run_id, phase=phase, kind=kind, details=details)

    def request_cancel(self, run_id: str, *, requested_by: str) -> RunState:
        """Ask a run to stop, idempotently."""
        self._require_run(run_id)
        with self._lock(run_id):
            current = reduce_events(read_events(self._events_path(run_id)))
            if current.phase is RunPhase.CANCEL_REQUESTED:
                return self._with_heartbeat(run_id, current)
            if is_terminal(current.phase):
                raise RunError(
                    f"run has already ended in {current.phase.value}; it cannot be cancelled",
                    code="run_not_cancellable",
                    details={"run_id": run_id, "phase": current.phase.value},
                )
            return self._append_locked(
                run_id,
                phase=RunPhase.CANCEL_REQUESTED,
                kind=CANCEL_REQUESTED,
                details={DETAIL_REQUESTED_BY: requested_by},
            )

    def state(self, run_id: str) -> RunState:
        """Load the projection, rebuilding it when it lags the journal."""
        try:
            raw = self._state_path(run_id).read_bytes()
        except FileNotFoundError:
            return self.rebuild_state(run_id)
        try:
            cached = RunState.model_validate_json(raw)
        except PydanticValidationError:
            return self.rebuild_state(run_id)

        # A cache ahead of the journal claims events that never durably happened.
        journal = reduce_events(read_events(self._events_path(run_id)))
        if cached.run_id != journal.run_id or cached.sequence > journal.sequence:
            raise ConflictError(
                "the cached run state is ahead of the run's event journal",
                code="run_state_ahead_of_journal",
                details={
                    "run_id": run_id,
                    "cached_sequence": cached.sequence,
                    "journal_sequence": journal.sequence,
                },
            )
        if cached.sequence < journal.sequence:
            return self.rebuild_state(run_id)
        return cached

    def state_digest(self, run_id: str) -> Digest:
        """Return the digest of this run's log bytes, the identity of how far it has got."""
        self._require_run(run_id)
        return event_digest(self._events_path(run_id))

    def rebuild_state(self, run_id: str) -> RunState:
        """Recompute the projection from the log."""
        self._require_run(run_id)
        with self._lock(run_id):
            return self._write_projection(run_id)

    def write_pid(self, run_id: str, pid: int) -> None:
        """Record the worker's process id: the event is settled first, then the pid file."""
        self._require_run(run_id)
        if pid <= 0:
            raise ValidationError(
                f"a worker process id is positive, not {pid}",
                details={"run_id": run_id, "pid": pid},
            )
        with self._lock(run_id):
            self._require_open_locked(run_id, "take on a worker")
            event = self._prepare_event(
                run_id, phase=None, kind=WORKER_STARTED, details={DETAIL_WORKER_PID: pid}
            )
            atomic_write_text(self._pid_path(run_id), f"{pid}\n")
            self._commit_event(run_id, event)

    def read_pid(self, run_id: str) -> int | None:
        """Read the worker's process id, if one was recorded."""
        self._require_run(run_id)
        path = self._pid_path(run_id)
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        try:
            return int(raw.strip())
        except ValueError as error:
            raise ValidationError(
                f"run pid file does not hold a process id: {path}",
                details={"run_id": run_id, "path": str(path)},
            ) from error

    def write_heartbeat(self, run_id: str, phase: RunPhase) -> None:
        """Refresh the worker's sign of life."""
        self._require_run(run_id)
        with self._lock(run_id):
            atomic_write_json(
                self._heartbeat_path(run_id),
                {_HEARTBEAT_PHASE_KEY: phase, _HEARTBEAT_AT_KEY: _now()},
            )
            self._write_projection(run_id)

    def result_path(self, run_id: str) -> Path:
        """Return where the run's report lives."""
        return self._run_dir(run_id) / _REPORT_DIRECTORY_NAME / _RESULT_FILE_NAME

    def write_result(self, run_id: str, report: UpliftReportV3) -> None:
        """Write the immutable report, announcing it in the log first."""
        self._require_run(run_id)
        if report.run_id != run_id:
            raise ValidationError(
                f"report belongs to run {report.run_id}, not to {run_id}",
                details={"run_id": run_id, "report_run_id": report.run_id},
            )
        path = self.result_path(run_id)
        with self._lock(run_id):
            self._require_open_locked(run_id, "record a result")
            event = self._prepare_event(
                run_id,
                phase=None,
                kind=RESULT_WRITTEN,
                details={DETAIL_RESULT_DIGEST: digest_object(report)},
            )
            ensure_private_directory(path.parent)
            self._write_immutable(path, report)
            self._commit_event(run_id, event)

    def get_result(self, run_id: str) -> UpliftReportV3:
        """Load the report."""
        self._require_run(run_id)
        path = self.result_path(run_id)
        try:
            raw = path.read_bytes()
        except FileNotFoundError as error:
            raise NotFoundError(
                f"run {run_id} has not produced a result", details={"run_id": run_id}
            ) from error
        try:
            return UpliftReportV3.model_validate_json(raw)
        except PydanticValidationError as error:
            raise ValidationError(
                f"run result is not a valid report: {path} ({error.errors()[0]['msg']})",
                details={"run_id": run_id, "path": str(path)},
            ) from error

    def worker_log_path(self, run_id: str) -> Path:
        """Return where the worker's stdout goes."""
        return self._run_dir(run_id) / _WORKER_LOG_FILE_NAME

    def _append_locked(
        self,
        run_id: str,
        *,
        phase: RunPhase | None,
        kind: str,
        details: dict[str, JsonValue] | None = None,
    ) -> RunState:
        event = self._prepare_event(run_id, phase=phase, kind=kind, details=details)
        return self._commit_event(run_id, event)

    def _prepare_event(
        self,
        run_id: str,
        *,
        phase: RunPhase | None,
        kind: str,
        details: dict[str, JsonValue] | None = None,
    ) -> RunEvent:
        events = read_events(self._events_path(run_id))
        current = reduce_events(events)
        try:
            event = RunEvent(
                sequence=next_sequence(events),
                timestamp=_now(),
                run_id=run_id,
                previous_phase=current.phase,
                phase=current.phase if phase is None else phase,
                kind=kind,
                details=dict(details or {}),
            )
        except PydanticValidationError as error:
            raise ValidationError(
                f"run event is not valid ({error.errors()[0]['msg']})",
                code="run_event_kind_invalid",
                details={"run_id": run_id, "kind": kind},
            ) from error
        # Projected against the current state now, so a refused event never reaches the log.
        apply_event(current, event)
        return event

    def _commit_event(self, run_id: str, event: RunEvent) -> RunState:
        append_event(self._events_path(run_id), event)
        return self._write_projection(run_id)

    def _write_projection(self, run_id: str) -> RunState:
        state = self._with_heartbeat(run_id, reduce_events(read_events(self._events_path(run_id))))
        atomic_write_json(self._state_path(run_id), state)
        return state

    def _with_heartbeat(self, run_id: str, state: RunState) -> RunState:
        state.heartbeat_at = self._read_heartbeat(run_id)
        return state

    def _read_heartbeat(self, run_id: str) -> datetime | None:
        path = self._heartbeat_path(run_id)
        if not path.exists():
            return None
        document = read_json(path)
        raw = document.get(_HEARTBEAT_AT_KEY) if isinstance(document, dict) else None
        if not isinstance(raw, str):
            raise ValidationError(
                f"run heartbeat does not record when it was written: {path}",
                details={"run_id": run_id, "path": str(path)},
            )
        try:
            moment = datetime.fromisoformat(raw)
        except ValueError as error:
            raise ValidationError(
                f"run heartbeat time is not a timestamp: {path}",
                details={"run_id": run_id, "path": str(path)},
            ) from error
        if moment.tzinfo is None:
            raise ValidationError(
                f"run heartbeat time names no time zone: {path}",
                details={"run_id": run_id, "path": str(path)},
            )
        return moment

    def _write_immutable(self, path: Path, value: object) -> None:
        data = canonical_json_bytes(value)
        with open_exclusive(path, _FILE_MODE) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        fsync_directory(path.parent)

    def _require_open_locked(self, run_id: str, doing: str) -> RunState:
        state = reduce_events(read_events(self._events_path(run_id)))
        if is_terminal(state.phase):
            raise RunError(
                f"run has already ended in {state.phase.value}; it cannot {doing}",
                code="run_transition_invalid",
                details={"run_id": run_id, "phase": state.phase.value},
            )
        return state

    def _require_run(self, run_id: str) -> None:
        if not self._request_path(run_id).exists():
            raise NotFoundError(
                f"no such run: {run_id}", code="run_not_found", details={"run_id": run_id}
            )

    @contextmanager
    def _lock(self, run_id: str) -> Iterator[None]:
        lock = FileLock(
            self._run_dir(run_id) / _LOCK_FILE_NAME, timeout=LOCK_TIMEOUT_SECONDS, mode=_FILE_MODE
        )
        try:
            lock.acquire()
        except Timeout as error:
            raise ConflictError(
                f"another process is holding the lock on run {run_id}",
                code="run_lock_timeout",
                details={"run_id": run_id, "waited_seconds": LOCK_TIMEOUT_SECONDS},
            ) from error
        try:
            yield
        finally:
            lock.release()

    def _run_dir(self, run_id: str) -> Path:
        return self._paths.run_dir(run_id)

    def _request_path(self, run_id: str) -> Path:
        return self._run_dir(run_id) / _REQUEST_FILE_NAME

    def _events_path(self, run_id: str) -> Path:
        return self._run_dir(run_id) / _EVENTS_FILE_NAME

    def _state_path(self, run_id: str) -> Path:
        return self._run_dir(run_id) / _STATE_FILE_NAME

    def _heartbeat_path(self, run_id: str) -> Path:
        return self._run_dir(run_id) / _HEARTBEAT_FILE_NAME

    def _pid_path(self, run_id: str) -> Path:
        return self._run_dir(run_id) / _PID_FILE_NAME
