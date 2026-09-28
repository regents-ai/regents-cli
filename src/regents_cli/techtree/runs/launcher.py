"""Starting and signalling the detached worker.

The worker is started in its own session so it outlives the CLI that launched it and so its
process group holds the run and nothing else. The command is an argument array, never a shell
string. The environment is built from a short allow-list rather than filtered from the
operator's shell, so a model credential in that shell is never inherited by a run.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
from collections.abc import Sequence
from typing import Final

from regents_cli.techtree.errors import RunError
from regents_cli.techtree.fs import ensure_private_directory
from regents_cli.techtree.runs.store import RunStore

WORKER_LAUNCH_FAILED: Final = "worker_launch_failed"
WORKER_SIGNAL_FAILED: Final = "worker_signal_failed"

_LOG_FILE_MODE: Final = 0o600
_INHERITED_VARIABLES: Final[tuple[str, ...]] = ("PATH", "HOME", "TMPDIR")


def worker_command(run_id: str) -> Sequence[str]:
    """Return the argument array that starts one run's worker."""
    return [sys.executable, "-m", "regents_cli", "techtree", "_worker", "--run-id", run_id]


def worker_environment() -> dict[str, str]:
    """Return the whole environment a worker is given."""
    environment = {name: os.environ[name] for name in _INHERITED_VARIABLES if name in os.environ}
    environment["PYTHONUNBUFFERED"] = "1"
    return environment


class WorkerLauncher:
    """Launches and signals one detached local worker per run."""

    def __init__(self, run_store: RunStore) -> None:
        self._runs = run_store

    def launch(self, run_id: str) -> int:
        """Start the detached worker for one run and return its process id."""
        log_path = self._runs.worker_log_path(run_id)
        run_dir = log_path.parent
        ensure_private_directory(run_dir)
        descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, _LOG_FILE_MODE)
        try:
            process = subprocess.Popen(
                worker_command(run_id),
                stdin=subprocess.DEVNULL,
                stdout=descriptor,
                stderr=subprocess.STDOUT,
                env=worker_environment(),
                cwd=str(run_dir),
                start_new_session=True,
                close_fds=True,
                shell=False,
            )
        except OSError as error:
            raise RunError(
                f"the worker for run {run_id} could not be started: {error.strerror or error}",
                code=WORKER_LAUNCH_FAILED,
                details={"run_id": run_id},
            ) from error
        finally:
            os.close(descriptor)
        return process.pid

    def is_alive(self, run_id: str) -> bool:
        """Return whether this run's worker process still exists."""
        pid = self._runs.read_pid(run_id)
        if pid is None:
            return False
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    def request_termination(self, run_id: str) -> None:
        """Ask this run's process group to stop, tolerating a worker that already ended."""
        pid = self._runs.read_pid(run_id)
        if pid is None:
            return
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except ProcessLookupError:
            return
        except OSError as error:
            raise RunError(
                f"run {run_id} could not be signalled: {error.strerror or error}",
                code=WORKER_SIGNAL_FAILED,
                details={"run_id": run_id, "signal": signal.SIGTERM.name},
            ) from error
