"""What the detached worker does with a run.

Nobody is watching, so everything it learns is written down: its pid into the run's journal as
its first act, then a heartbeat every couple of seconds. It may be asked to stop, so the
signal handlers set a flag and return; the cancellation is recorded on the main thread at a
boundary the executor chose. A cancelled run exits 130, a typed failure exits its own code,
and anything else is flattened onto one line, recorded as a failure, and exits 5.
"""

from __future__ import annotations

import os
import signal
import threading
from datetime import UTC, datetime
from types import FrameType
from typing import Final

from regents_cli.techtree.canonical import digest_object, to_json_value
from regents_cli.techtree.constants import DEFAULT_WORKER_HEARTBEAT_SECONDS
from regents_cli.techtree.engines.registry import EngineRegistry
from regents_cli.techtree.errors import (
    CancellationError,
    RunError,
    TechtreeError,
    stable_exception_message,
)
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.identity.store import IdentityStore
from regents_cli.techtree.models.run import RunPhase
from regents_cli.techtree.paths import home
from regents_cli.techtree.runs.artifacts import RunArtifactStore
from regents_cli.techtree.runs.child_registry import ChildRegistry
from regents_cli.techtree.runs.events import DETAIL_ERROR, RUN_CANCELLED, RUN_FAILED
from regents_cli.techtree.runs.executor import ExecutionContext, request_local_cancellation
from regents_cli.techtree.runs.machine import is_terminal, run_failure
from regents_cli.techtree.runs.real import RealVerifiersExecutor
from regents_cli.techtree.runs.report import RunReportService
from regents_cli.techtree.runs.store import RunStore

EXIT_CANCELLED: Final = 130
EXIT_UNEXPECTED: Final = 5

_HEARTBEAT_SECONDS: Final = float(DEFAULT_WORKER_HEARTBEAT_SECONDS)


def worker_log(message: str) -> None:
    """Write one line to the run's log; the worker's stdout is ``worker.log``."""
    moment = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    print(f"{moment} {message}", flush=True)


def execute_run(run_id: str) -> int:
    """Execute one run in this process and return the exit code."""
    paths = home()
    run_store = RunStore(paths)
    artifact_store = RunArtifactStore(paths)

    try:
        request = run_store.get_request(run_id)
        worker_log(f"worker {os.getpid()} taking on run {run_id}")
        if run_store.state(run_id).worker_pid is None:
            run_store.write_pid(run_id, os.getpid())
    except TechtreeError as error:
        worker_log(f"run {run_id} could not be taken on: {error.code}: {error.message}")
        return error.exit_code

    cancellation = threading.Event()
    _install_signal_handlers(cancellation)
    _watch_for_signals(cancellation)

    stop_heartbeat = threading.Event()
    heartbeat = threading.Thread(
        target=_heartbeat_loop,
        args=(stop_heartbeat, run_store, run_id),
        name=f"techtree-heartbeat-{run_id}",
        daemon=True,
    )
    heartbeat.start()

    try:
        execution = RealVerifiersExecutor(
            paths=paths,
            engine_registry=EngineRegistry(paths),
            child_registry=ChildRegistry(),
        ).execute(
            ExecutionContext(
                request=request,
                run_store=run_store,
                artifact_store=artifact_store,
                clock=_utc_now,
            )
        )
        report = RunReportService(
            paths=paths,
            run_store=run_store,
            artifact_store=artifact_store,
            identity=IdentityService(IdentityStore(paths)),
            clock=_utc_now,
        ).complete(request=request, execution=execution)
        _verify_recorded_result(run_store, run_id, digest_object(report))
    except CancellationError:
        worker_log(f"run {run_id} stopped because it was asked to")
        _record_cancelled(run_store, run_id)
        return EXIT_CANCELLED
    except TechtreeError as error:
        worker_log(f"run {run_id} failed: {error.code}: {error.message}")
        _record_failure(run_store, run_id, error)
        return error.exit_code
    except Exception as unexpected:
        worker_log(f"run {run_id} failed unexpectedly: {stable_exception_message(unexpected)}")
        _record_failure(
            run_store,
            run_id,
            TechtreeError(
                stable_exception_message(unexpected),
                code="internal_error",
                details={"exception_type": type(unexpected).__name__},
            ),
        )
        return EXIT_UNEXPECTED
    finally:
        stop_heartbeat.set()
        heartbeat.join(timeout=_HEARTBEAT_SECONDS)

    worker_log(f"run {run_id} completed and its report was recorded")
    return 0


def _install_signal_handlers(cancellation: threading.Event) -> None:
    """Make ``SIGTERM`` and ``SIGINT`` record a request and nothing else."""

    def handle(number: int, frame: FrameType | None) -> None:
        cancellation.set()

    for number in (signal.SIGTERM, signal.SIGINT):
        signal.signal(number, handle)


def _watch_for_signals(cancellation: threading.Event) -> None:
    """A daemon thread turns the signalled event into the executor's cancellation flag."""

    def wait() -> None:
        cancellation.wait()
        request_local_cancellation()

    threading.Thread(target=wait, name="techtree-cancellation", daemon=True).start()


def _heartbeat_loop(stop: threading.Event, run_store: RunStore, run_id: str) -> None:
    """Refresh the heartbeat until asked to stop; one that cannot be written ends the loop."""
    while not stop.is_set():
        try:
            run_store.write_heartbeat(run_id, run_store.state(run_id).phase)
        except TechtreeError:
            return
        stop.wait(_HEARTBEAT_SECONDS)


def _record_failure(run_store: RunStore, run_id: str, error: TechtreeError) -> None:
    failure = run_failure(error)
    try:
        if is_terminal(run_store.state(run_id).phase):
            return
        run_store.append(
            run_id,
            phase=RunPhase.FAILED,
            kind=RUN_FAILED,
            details={DETAIL_ERROR: to_json_value(failure)},
        )
    except TechtreeError:
        return


def _record_cancelled(run_store: RunStore, run_id: str) -> None:
    """A run signalled directly may not carry the request yet; the request is idempotent."""
    try:
        state = run_store.state(run_id)
        if is_terminal(state.phase):
            return
        if state.phase is not RunPhase.CANCEL_REQUESTED:
            run_store.request_cancel(run_id, requested_by="worker")
        run_store.append(run_id, phase=RunPhase.CANCELLED, kind=RUN_CANCELLED)
    except TechtreeError:
        return


def _verify_recorded_result(run_store: RunStore, run_id: str, expected: str) -> None:
    recorded = run_store.state(run_id).result_digest
    if recorded == expected:
        return
    raise RunError(
        f"run {run_id} finished with a report its journal does not name",
        code="run_result_digest_mismatch",
        details={"run_id": run_id, "expected": expected, "recorded": recorded},
    )


def _utc_now() -> datetime:
    return datetime.now(UTC)
