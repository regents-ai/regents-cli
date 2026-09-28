"""One live evaluation child process.

The engine's `eval` is addressed by absolute path: the pinned build installs it under that
bare name, and a PATH lookup would let the shell builtin answer for the engine. Standard output
goes to a run-owned file and is never streamed: with the dashboard off the pinned CLI prints
every trace, the subject's full transcripts, to stdout when the run finishes. Cancellation goes
to the whole process group, SIGTERM first so the engine's own handler tears its containers
down, SIGKILL only after the grace period.

The process this class starts is not the evaluation but its supervisor, holding the read end
of a pipe this worker keeps open; the worker's death closes the pipe and the supervisor stops
the evaluation. The `argv_digest` reported here remains the evaluation's own.
"""

from __future__ import annotations

import contextlib
import os
import signal
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import IO, Final, Self

from regents_cli.techtree.canonical import sha256_digest_bytes
from regents_cli.techtree.errors import RunError
from regents_cli.techtree.fs import ensure_private_directory, fsync_directory
from regents_cli.techtree.models.base import ArtifactRef, Digest
from regents_cli.techtree.verifiers.models import ChildProcessOutcome, VariantName
from regents_cli.techtree.verifiers.paths import EVAL_RUN_NAME

EVAL_EXECUTABLE: Final = "eval"

#: `eval` takes its configuration as `@` followed by the path, as two argv entries.
CONFIG_ARGUMENT_MARKER: Final = "@"
DRY_RUN_FLAG: Final = "--dry-run"
OUTPUT_DIR_FLAG: Final = "--output-dir"
RUN_NAME_FLAG: Final = "--run.name"
DRY_RUN_NAME: Final = "dry-run"

#: Belt and braces beside `push = false` in the file: upstream defaults to uploading the
#: participant's episodes, and a flag on argv overrides whatever the file says.
PUSH_DISABLED_FLAG: Final = "--no-push"
#: Runs the rollouts in this child rather than through the engine's env-server worker pool;
#: one child, one process group, one cancellation path.
SERVE_DISABLED_FLAG: Final = "--no-serve"

#: The Ctrl-C code the pinned CLI exits on after tearing its containers down.
CANCELLATION_EXIT_CODE: Final = 130

DEFAULT_GRACE_SECONDS: Final = 30.0
#: Shorter than the worker's grace on purpose: during a cancellation both are running, and
#: the inner escalation must finish first or the worker kills a supervisor mid-teardown.
SUPERVISOR_GRACE_SECONDS: Final = 20.0
#: The longest one variant may run, whatever anything else believes; orphan containment only.
VARIANT_HARD_DEADLINE_SECONDS: Final = 3600.0

CAPTURE_MEDIA_TYPE: Final = "text/plain"

CHILD_NOT_STARTED: Final = "eval_child_not_started"
CHILD_START_FAILED: Final = "eval_child_start_failed"
CHILD_STILL_RUNNING: Final = "eval_child_still_running"

_REAP_INTERVAL_SECONDS: Final = 0.05


def eval_argv(*, eval_executable: Path, input_config_path: Path) -> list[str]:
    """The invocation for one variant's real evaluation; no credential is on it or can be."""
    return [
        str(eval_executable),
        CONFIG_ARGUMENT_MARKER,
        str(input_config_path),
        PUSH_DISABLED_FLAG,
        SERVE_DISABLED_FLAG,
        RUN_NAME_FLAG,
        EVAL_RUN_NAME,
    ]


def dry_run_argv(*, input_config_path: Path, dry_run_dir: Path) -> list[str]:
    """The arguments for a dry run; the executable is prepended by the engine runner."""
    return [
        CONFIG_ARGUMENT_MARKER,
        str(input_config_path),
        DRY_RUN_FLAG,
        PUSH_DISABLED_FLAG,
        SERVE_DISABLED_FLAG,
        RUN_NAME_FLAG,
        DRY_RUN_NAME,
        OUTPUT_DIR_FLAG,
        str(dry_run_dir),
    ]


def supervisor_argv(
    *,
    variant: VariantName,
    parent_fd: int,
    record_path: Path,
    deadline_seconds: float,
    grace_seconds: float,
    eval_argv: Sequence[str],
) -> list[str]:
    """The invocation that wraps one evaluation in its supervisor: this interpreter, by module."""
    return [
        sys.executable,
        "-m",
        "regents_cli",
        "techtree",
        "_supervise",
        "--variant",
        variant.value,
        "--parent-fd",
        str(parent_fd),
        "--record",
        str(record_path),
        "--deadline-seconds",
        f"{deadline_seconds:g}",
        "--grace-seconds",
        f"{grace_seconds:g}",
        "--",
        *eval_argv,
    ]


def argv_digest(argv: Sequence[str]) -> Digest:
    return sha256_digest_bytes("\0".join(argv).encode("utf-8"))


def capture_artifact(path: Path) -> ArtifactRef:
    data = path.read_bytes()
    return ArtifactRef(
        digest=sha256_digest_bytes(data),
        media_type=CAPTURE_MEDIA_TYPE,
        size=len(data),
        relative_path=None,
    )


def write_command_log(
    path: Path,
    *,
    variant: VariantName,
    argv: Sequence[str],
    exit_code: int,
    stdout: str,
    stderr: str,
) -> Path:
    """Record what a short captured engine command did."""
    ensure_private_directory(path.parent)
    document = "\n".join(
        [
            f"variant: {variant.value}",
            f"argv-digest: {argv_digest(argv)}",
            f"argv: {' '.join(argv)}",
            f"exit-code: {exit_code}",
            "--- stdout ---",
            stdout.rstrip("\n"),
            "--- stderr ---",
            stderr.rstrip("\n"),
            "",
        ]
    )
    _write_private(path, document.encode("utf-8"))
    return path


class VerifiersChild:
    """One `eval` process, its capture files, and its outcome. Construct, `start`, observe
    through `poll` or `wait`, then `outcome`."""

    def __init__(
        self,
        *,
        variant: VariantName,
        argv: Sequence[str],
        cwd: Path,
        env: Mapping[str, str],
        stdout_path: Path,
        stderr_path: Path,
        supervision_record_path: Path,
        hard_deadline_seconds: float = VARIANT_HARD_DEADLINE_SECONDS,
        supervisor_grace_seconds: float = SUPERVISOR_GRACE_SECONDS,
    ) -> None:
        self._variant = variant
        self._argv = tuple(argv)
        self._cwd = cwd
        self._env = dict(env)
        self._stdout_path = stdout_path
        self._stderr_path = stderr_path
        self._supervision_record_path = supervision_record_path
        self._hard_deadline_seconds = hard_deadline_seconds
        self._supervisor_grace_seconds = supervisor_grace_seconds

        self._process: subprocess.Popen[bytes] | None = None
        self._parent_liveness_fd: int | None = None
        self._streams: list[IO[bytes]] = []
        self._started_at: datetime | None = None
        self._started_monotonic: float | None = None
        self._finished_at: datetime | None = None
        self._elapsed_seconds: float | None = None
        self._cancelled = False

    @property
    def variant(self) -> VariantName:
        return self._variant

    @property
    def argv_digest(self) -> Digest:
        return argv_digest(self._argv)

    @property
    def pid(self) -> int | None:
        return None if self._process is None else self._process.pid

    @property
    def cancelled(self) -> bool:
        return self._cancelled

    @property
    def elapsed_seconds(self) -> float | None:
        return self._elapsed_seconds

    def start(self) -> int:
        """Start the supervised evaluation in its own session and return the supervisor's pid.

        The pipe's read end is the only descriptor handed to the supervisor; its write end is
        held here and never written to, so the supervisor reads end-of-file the moment this
        worker stops existing, including when it is killed outright.
        """
        if self._process is not None:
            raise RunError(
                f"the {self._variant.value} evaluation child has already started",
                code=CHILD_START_FAILED,
                details={"variant": self._variant.value},
            )

        ensure_private_directory(self._cwd)
        stdout = self._open_capture(self._stdout_path, stream="stdout")
        stderr = self._open_capture(self._stderr_path, stream="stderr")

        read_fd, write_fd = os.pipe()
        self._parent_liveness_fd = write_fd
        launch = supervisor_argv(
            variant=self._variant,
            parent_fd=read_fd,
            record_path=self._supervision_record_path,
            deadline_seconds=self._hard_deadline_seconds,
            grace_seconds=self._supervisor_grace_seconds,
            eval_argv=self._argv,
        )

        self._started_at = datetime.now(UTC)
        self._started_monotonic = time.monotonic()
        try:
            self._process = subprocess.Popen(
                launch,
                cwd=str(self._cwd),
                env=self._env,
                stdin=subprocess.DEVNULL,
                stdout=stdout,
                stderr=stderr,
                start_new_session=True,
                close_fds=True,
                pass_fds=(read_fd,),
            )
        except OSError as error:
            self._close_streams()
            self._close_parent_liveness()
            raise RunError(
                f"the evaluation child could not be started: {error.strerror or error}",
                code=CHILD_START_FAILED,
                details={"variant": self._variant.value, "program": self._argv[0]},
            ) from error
        finally:
            # Only the supervisor reads the liveness pipe, and only this process writes.
            os.close(read_fd)
        return self._process.pid

    def poll(self) -> int | None:
        process = self._require_started()
        code = process.poll()
        if code is not None:
            self._record_exit()
        return code

    def wait(self, timeout: float | None = None) -> int:
        process = self._require_started()
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired as error:
            raise RunError(
                f"the {self._variant.value} evaluation did not finish within {timeout:.0f}s",
                code=CHILD_STILL_RUNNING,
                details={"variant": self._variant.value, "timeout_seconds": timeout},
            ) from error
        self._record_exit()
        return code

    def terminate(self, grace_seconds: float = DEFAULT_GRACE_SECONDS) -> None:
        """SIGTERM the group so the engine tears containers down, SIGKILL after the grace."""
        process = self._require_started()
        self._cancelled = True
        if process.poll() is not None:
            self._record_exit()
            return

        self._signal_group(signal.SIGTERM)
        deadline = time.monotonic() + max(grace_seconds, 0.0)
        while time.monotonic() < deadline:
            if process.poll() is not None:
                self._record_exit()
                return
            time.sleep(_REAP_INTERVAL_SECONDS)

        self._signal_group(signal.SIGKILL)
        process.wait()
        self._record_exit()

    def outcome(self) -> ChildProcessOutcome:
        """The finished child, with both capture files hashed."""
        process = self._require_started()
        code = process.poll()
        if code is None:
            raise RunError(
                f"the {self._variant.value} evaluation child is still running",
                code=CHILD_STILL_RUNNING,
                details={"variant": self._variant.value},
            )
        self._record_exit()
        assert self._started_at is not None
        assert self._finished_at is not None
        return ChildProcessOutcome(
            variant=self._variant,
            argv_digest=self.argv_digest,
            exit_code=code,
            started_at=self._started_at,
            finished_at=self._finished_at,
            stdout_artifact=capture_artifact(self._stdout_path),
            stderr_artifact=capture_artifact(self._stderr_path),
            cancelled=self._cancelled,
        )

    def __enter__(self) -> Self:
        self.start()
        return self

    def __exit__(self, *_: object) -> None:
        if self._process is not None and self._process.poll() is None:
            self.terminate()
        self._close_streams()
        self._close_parent_liveness()

    def _require_started(self) -> subprocess.Popen[bytes]:
        if self._process is None:
            raise RunError(
                f"the {self._variant.value} evaluation child has not been started",
                code=CHILD_NOT_STARTED,
                details={"variant": self._variant.value},
            )
        return self._process

    def _open_capture(self, path: Path, *, stream: str) -> IO[bytes]:
        """One capture file, seeded with a provenance line so an empty stream still hashes."""
        ensure_private_directory(path.parent)
        header = (
            f"# techtree {self._variant.value} {stream}; argv-digest {self.argv_digest}; "
            f"started {datetime.now(UTC).isoformat()}\n"
        )
        handle = _open_private(path)
        handle.write(header.encode("utf-8"))
        handle.flush()
        self._streams.append(handle)
        return handle

    def _close_streams(self) -> None:
        while self._streams:
            handle = self._streams.pop()
            try:
                handle.flush()
                os.fsync(handle.fileno())
            except (OSError, ValueError):
                pass
            handle.close()

    def _record_exit(self) -> None:
        if self._finished_at is not None:
            return
        self._finished_at = datetime.now(UTC)
        if self._started_monotonic is not None:
            self._elapsed_seconds = time.monotonic() - self._started_monotonic
        self._close_streams()
        self._close_parent_liveness()

    def _close_parent_liveness(self) -> None:
        descriptor = self._parent_liveness_fd
        if descriptor is None:
            return
        self._parent_liveness_fd = None
        with contextlib.suppress(OSError):
            os.close(descriptor)

    def _signal_group(self, number: int) -> None:
        process = self._require_started()
        try:
            os.killpg(os.getpgid(process.pid), number)
        except ProcessLookupError:
            return
        except PermissionError:
            with contextlib.suppress(ProcessLookupError):
                process.send_signal(number)


def _open_private(path: Path) -> IO[bytes]:
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    return os.fdopen(descriptor, "wb")


def _write_private(path: Path, data: bytes) -> None:
    with _open_private(path) as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    fsync_directory(path.parent)
