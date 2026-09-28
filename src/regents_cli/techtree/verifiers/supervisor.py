"""One evaluation, supervised by a process that outlives its worker.

A hard-killed worker cannot stop anything, so each variant runs under a small supervisor of its
own holding three things: the read end of a pipe the worker keeps open (its only message is
end-of-file, which the kernel sends when the worker dies), a monotonic deadline for everything
the pipe cannot see, and the evaluation's process group, signalled gently first. Its grace is
shorter than the worker's so the inner escalation always finishes first.

It leaves one private record saying what happened, with no argv, no environment and no
credential in it. The hidden `regents techtree _supervise` command runs `supervise`.
"""

from __future__ import annotations

import contextlib
import errno
import os
import selectors
import signal
import subprocess
import time
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Final

from regents_cli.techtree.fs import atomic_write_json, ensure_private_directory
from regents_cli.techtree.models.base import JsonValue

RECORD_SCHEMA_VERSION: Final = "techtree.eval-supervision.v1"

#: The deadline was reached and the evaluation was stopped.
DEADLINE_EXIT_CODE: Final = 124
#: The supervisor itself could not do its job, most often because the eval did not launch.
SUPERVISOR_FAILURE_EXIT_CODE: Final = 125
#: Stopped rather than finished: signalled, or the worker died.
STOPPED_EXIT_CODE: Final = 130

SUPERVISION_RECORD_MODE: Final = 0o600

_POLL_INTERVAL_SECONDS: Final = 0.1
_REAP_INTERVAL_SECONDS: Final = 0.05


class SupervisionReason(StrEnum):
    """Why one supervised evaluation ended; the record's `reason` field."""

    COMPLETED = "completed"
    CANCELLED = "cancelled"
    DEADLINE_EXCEEDED = "deadline_exceeded"
    PARENT_LOST = "parent_lost"
    LAUNCH_FAILED = "launch_failed"


def supervise(
    *,
    variant: str,
    parent_fd: int,
    record_path: Path,
    deadline_seconds: float,
    grace_seconds: float,
    eval_argv: list[str],
) -> int:
    """Supervise one evaluation and return this process's exit code."""
    return _Supervisor(
        variant=variant,
        parent_fd=parent_fd,
        record_path=record_path,
        deadline_seconds=deadline_seconds,
        grace_seconds=grace_seconds,
        eval_argv=eval_argv,
    ).run()


class _Supervisor:
    def __init__(
        self,
        *,
        variant: str,
        parent_fd: int,
        record_path: Path,
        deadline_seconds: float,
        grace_seconds: float,
        eval_argv: list[str],
    ) -> None:
        self._variant = variant
        self._parent_fd = parent_fd
        self._record_path = record_path
        self._deadline_seconds = deadline_seconds
        self._grace_seconds = grace_seconds
        self._eval_argv = eval_argv

        self._process: subprocess.Popen[bytes] | None = None
        self._group: int | None = None
        self._started_at = datetime.now(UTC)
        self._started_monotonic = time.monotonic()
        self._signalled = False
        self._escalated = False
        self._shutdown_seconds: float | None = None

    def run(self) -> int:
        signal.signal(signal.SIGTERM, self._on_signal)
        signal.signal(signal.SIGINT, self._on_signal)

        reason = SupervisionReason.LAUNCH_FAILED
        exit_code = SUPERVISOR_FAILURE_EXIT_CODE
        try:
            self._launch()
        except OSError:
            self._finish(reason=reason, exit_code=exit_code)
            return exit_code

        try:
            reason = self._watch()
            exit_code = self._stop_if_running(reason)
        except Exception:
            # Whatever went wrong, an evaluation must not outlive the process bounding it.
            reason = SupervisionReason.CANCELLED
            exit_code = SUPERVISOR_FAILURE_EXIT_CODE
            with contextlib.suppress(Exception):
                self._stop_if_running(reason)
        finally:
            self._finish(reason=reason, exit_code=exit_code)
        return exit_code

    def _finish(self, *, reason: SupervisionReason, exit_code: int) -> None:
        self._write_record(reason=reason, exit_code=exit_code)
        self._close_parent_fd()

    def _launch(self) -> None:
        self._process = subprocess.Popen(
            self._eval_argv,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            close_fds=True,
        )
        with contextlib.suppress(OSError):
            self._group = os.getpgid(self._process.pid)

    def _watch(self) -> SupervisionReason:
        """Wait for the first of: the eval finishing, EOF, the deadline, a signal."""
        process = self._process
        assert process is not None
        deadline = self._started_monotonic + self._deadline_seconds

        with selectors.DefaultSelector() as selector:
            selector.register(self._parent_fd, selectors.EVENT_READ)
            while True:
                if process.poll() is not None:
                    return SupervisionReason.COMPLETED
                if self._signalled:
                    return SupervisionReason.CANCELLED
                if time.monotonic() >= deadline:
                    return SupervisionReason.DEADLINE_EXCEEDED
                if selector.select(timeout=_POLL_INTERVAL_SECONDS) and self._at_eof():
                    return SupervisionReason.PARENT_LOST

    def _at_eof(self) -> bool:
        """Nothing is ever written to the pipe, so only the empty read counts as death."""
        try:
            return os.read(self._parent_fd, 1) == b""
        except OSError as error:
            return error.errno != errno.EAGAIN

    def _stop_if_running(self, reason: SupervisionReason) -> int:
        process = self._process
        assert process is not None
        if reason == SupervisionReason.COMPLETED:
            return _exit_code_of(process.returncode)

        started = time.monotonic()
        self._signal_group(signal.SIGTERM)
        grace_until = started + max(self._grace_seconds, 0.0)
        while time.monotonic() < grace_until:
            if process.poll() is not None:
                break
            time.sleep(_REAP_INTERVAL_SECONDS)
        else:
            if process.poll() is None:
                self._escalated = True
                self._signal_group(signal.SIGKILL)
                process.wait()
        self._shutdown_seconds = time.monotonic() - started

        if reason == SupervisionReason.DEADLINE_EXCEEDED:
            return DEADLINE_EXIT_CODE
        return STOPPED_EXIT_CODE

    def _signal_group(self, number: int) -> None:
        process = self._process
        assert process is not None
        if self._group is not None:
            try:
                os.killpg(self._group, number)
                return
            except ProcessLookupError:
                return
            except PermissionError:
                pass
        with contextlib.suppress(ProcessLookupError):
            process.send_signal(number)

    def _on_signal(self, _number: int, _frame: object) -> None:
        self._signalled = True

    def _write_record(self, *, reason: SupervisionReason, exit_code: int) -> None:
        """Written last and unconditionally: it is the only evidence that a hard-killed
        worker's evaluation was stopped."""
        process = self._process
        finished = datetime.now(UTC)
        document: dict[str, JsonValue] = {
            "schema_version": RECORD_SCHEMA_VERSION,
            "variant": self._variant,
            "reason": reason.value,
            "started_at": self._started_at.isoformat(),
            "finished_at": finished.isoformat(),
            "elapsed_seconds": round(time.monotonic() - self._started_monotonic, 3),
            "deadline_seconds": self._deadline_seconds,
            "grace_seconds": self._grace_seconds,
            "supervisor_pid": os.getpid(),
            "eval_pid": None if process is None else process.pid,
            "eval_process_group": self._group,
            # As the operating system reported it: negative means killed by that signal.
            "eval_exit_code": None if process is None else process.returncode,
            "supervisor_exit_code": exit_code,
            "escalated_to_sigkill": self._escalated,
            "shutdown_seconds": (
                None if self._shutdown_seconds is None else round(self._shutdown_seconds, 3)
            ),
        }
        with contextlib.suppress(OSError):
            ensure_private_directory(self._record_path.parent)
            atomic_write_json(self._record_path, document, mode=SUPERVISION_RECORD_MODE)

    def _close_parent_fd(self) -> None:
        with contextlib.suppress(OSError):
            os.close(self._parent_fd)


def _exit_code_of(returncode: int) -> int:
    """One process's exit status as a shell would report it."""
    return 128 + (-returncode) if returncode < 0 else returncode
