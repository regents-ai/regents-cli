"""What one execution of a run is given, and where it may be interrupted.

Cancellation is cooperative. The CLI appends ``cancel.requested`` and signals the worker; the
executor notices at a boundary of its own choosing. A signal handler in this process cannot
safely read a file or take a lock, so it sets a flag that the same check consults.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from regents_cli.techtree.errors import CancellationError
from regents_cli.techtree.models.run import RunPhase, RunRequestV2
from regents_cli.techtree.runs.artifacts import RunArtifactStore
from regents_cli.techtree.runs.store import RunStore

_LOCAL_CANCELLATION: Final[threading.Event] = threading.Event()


@dataclass(frozen=True)
class ExecutionContext:
    """Everything one execution of one run is given."""

    request: RunRequestV2
    run_store: RunStore
    artifact_store: RunArtifactStore
    clock: Callable[[], datetime]


def request_local_cancellation() -> None:
    """Record that this process has been asked to stop; safe from a signal handler."""
    _LOCAL_CANCELLATION.set()


def raise_if_cancel_requested(run_store: RunStore, run_id: str) -> None:
    """Raise when this run has been asked to stop, by signal or by another process."""
    if _LOCAL_CANCELLATION.is_set():
        raise CancellationError(
            f"run {run_id} was signalled to stop",
            details={"run_id": run_id, "requested_by": "signal"},
        )
    if run_store.state(run_id).phase is RunPhase.CANCEL_REQUESTED:
        raise CancellationError(
            f"run {run_id} was asked to stop",
            details={"run_id": run_id, "requested_by": "run_journal"},
        )
