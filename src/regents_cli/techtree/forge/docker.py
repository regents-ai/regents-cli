"""Docker as the forge uses it: pull a pinned base, build offline, run bounded containers.

Every container the forge starts is bounded and disconnected: a fixed memory, CPU and process
cap, no network, one Linux capability and no other, no privilege gain through a setuid program,
and a name the forge chose. Docker removes it on exit; on timeout or interruption the forge
attempts bounded removal and reports the outcome.
"""

from __future__ import annotations

import subprocess
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from regents_cli.techtree.errors import PrerequisiteError, RunError
from regents_cli.techtree.forge.models import ForgePlatform

#: The bound ends a hung build, not a slow one.
BUILD_TIMEOUT_SECONDS: Final = 1800.0
DAEMON_TIMEOUT_SECONDS: Final = 30.0
#: What every forge container gets, recorded in the qualification as the bound the tests ran
#: under.
CONTAINER_MEMORY: Final = "4g"
CONTAINER_CPUS: Final = "2"
#: Enough for a test suite's worker processes; a fork bomb stops here.
CONTAINER_PIDS: Final = "512"
#: How much of a timed-out command's last output is kept.
_OUTPUT_TAIL_CHARS: Final = 8000


@dataclass(frozen=True)
class Mount:
    """One host directory a container sees."""

    source: Path
    target: str
    read_only: bool


@dataclass(frozen=True)
class RunOutcome:
    """What one container command produced."""

    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool


def _command(argv: Sequence[str], timeout: float) -> subprocess.CompletedProcess[str]:
    """Run one docker command with the caller's environment, output captured as UTF-8.

    The environment passes through on purpose: docker needs its context and credentials store.
    """
    try:
        return subprocess.run(
            list(argv),
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=timeout,
            stdin=subprocess.DEVNULL,
        )
    except OSError as error:
        raise RunError(
            f"{argv[0]} could not be started: {error.strerror or error}",
            code="forge_command_unusable",
            details={"argv0": str(argv[0])},
        ) from error


def _tail(output: bytes | str | None) -> str:
    if output is None:
        return ""
    text = output.decode("utf-8", "replace") if isinstance(output, bytes) else output
    return text[-_OUTPUT_TAIL_CHARS:]


def require_daemon() -> str:
    """Return the daemon's platform, or say why nothing can be built."""
    try:
        completed = _command(
            ["docker", "version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"],
            DAEMON_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        completed = subprocess.CompletedProcess([], 1, "", "docker version timed out")
    if completed.returncode != 0 or not completed.stdout.strip():
        raise PrerequisiteError(
            "the Docker daemon did not answer; start Docker and try again",
            code="forge_docker_unavailable",
            details={"detail": completed.stderr.strip()[-500:]},
        )
    return completed.stdout.strip()


def _checked(argv: Sequence[str], timeout: float) -> subprocess.CompletedProcess[str]:
    """Run a docker command that must finish in time."""
    try:
        return _command(argv, timeout)
    except subprocess.TimeoutExpired as error:
        raise RunError(
            f"{argv[0]} {argv[1]} did not finish within {timeout:.0f}s",
            code="forge_command_timeout",
            details={"stdout": _tail(error.stdout), "stderr": _tail(error.stderr)},
        ) from error


def pull_pinned(reference: str, platform: ForgePlatform) -> str:
    """Pull `reference`, a `name@sha256:…` pin the daemon verifies, and return its content id."""
    completed = _checked(
        ["docker", "pull", "--quiet", "--platform", platform, reference], BUILD_TIMEOUT_SECONDS
    )
    if completed.returncode != 0:
        raise RunError(
            f"base image {reference} could not be pulled: {completed.stderr.strip()[-300:]}",
            code="forge_base_image_unavailable",
            details={"reference": reference, "exit_code": completed.returncode},
        )
    return image_id(reference)


def build(*, context: Path, dockerfile: Path, tag: str, platform: ForgePlatform, log: Path) -> str:
    """Build `tag` offline from `context` and return the image's content id.

    Every `RUN` step has the network disabled: a task recipe builds from its pinned base images
    and its own context alone. The whole output goes to `log`, which is what says why a build
    failed.
    """
    completed = _checked(
        [
            "docker",
            "build",
            "--platform",
            platform,
            "--network",
            "none",
            "--file",
            str(dockerfile),
            "--tag",
            tag,
            str(context),
        ],
        BUILD_TIMEOUT_SECONDS,
    )
    log.write_text(f"{completed.stdout}\n{completed.stderr}", encoding="utf-8")
    if completed.returncode != 0:
        raise RunError(
            f"docker build of {tag} failed; the build log is at {log}",
            code="forge_image_build_failed",
            details={"tag": tag, "log": str(log), "exit_code": completed.returncode},
        )
    return image_id(tag)


def _inspect(image: str, template: str) -> subprocess.CompletedProcess[str]:
    completed = _checked(
        ["docker", "image", "inspect", image, "--format", template], DAEMON_TIMEOUT_SECONDS
    )
    if completed.returncode != 0:
        raise RunError(
            f"the Docker daemon does not hold {image}",
            code="forge_image_missing",
            details={"tag": image},
        )
    return completed


def image_id(tag: str) -> str:
    """The content id the daemon holds for `tag`."""
    found = _inspect(tag, "{{.Id}}").stdout.strip()
    if not found:
        raise RunError(
            f"the Docker daemon does not hold {tag}",
            code="forge_image_missing",
            details={"tag": tag},
        )
    return found


def working_dir(image: str) -> str:
    """The directory `image` starts its commands in; `/` when it names none."""
    return _inspect(image, "{{.Config.WorkingDir}}").stdout.strip() or "/"


def run(
    *, image: str, platform: ForgePlatform, argv: list[str], mounts: list[Mount], timeout: float
) -> RunOutcome:
    """Run `argv` once in a fresh, bounded, offline container."""
    name = f"techtree-forge-{uuid.uuid4().hex}"
    return _bounded(
        ["docker", "run", *_bounds(name, platform, mounts), image, *argv], name, timeout
    )


def start(*, image: str, platform: ForgePlatform, mounts: list[Mount]) -> str:
    """Start a fresh, bounded, offline container that only sleeps, and return its name.

    `exec_in` runs commands in it; the caller removes it with `remove`.
    """
    name = f"techtree-forge-{uuid.uuid4().hex}"
    command = [
        "docker",
        "run",
        "--detach",
        *_bounds(name, platform, mounts),
        image,
        "sleep",
        "infinity",
    ]
    try:
        completed = _checked(command, DAEMON_TIMEOUT_SECONDS)
    except (KeyboardInterrupt, RunError) as error:
        error.add_note(f"Container removal attempted: {remove(name)}")
        raise
    if completed.returncode != 0:
        raise RunError(
            f"a container from {image} could not be started: {completed.stderr.strip()[-300:]}",
            code="forge_container_unavailable",
            details={"image": image, "removal": remove(name)},
        )
    return name


def exec_in(name: str, argv: list[str], timeout: float) -> RunOutcome:
    """Run `argv` in the container `start` named, with the deadline kept on the host.

    A command still running at the deadline ends with its whole container, which is removed.
    """
    return _bounded(["docker", "exec", name, *argv], name, timeout)


def _bounded(command: list[str], name: str, timeout: float) -> RunOutcome:
    """Run one container command; on timeout or interrupt remove `name`."""
    try:
        completed = _command(command, timeout)
    except KeyboardInterrupt as error:
        error.add_note(f"Container removal attempted: {remove(name)}")
        raise
    except subprocess.TimeoutExpired as error:
        return RunOutcome(
            exit_code=-1,
            stdout=_tail(error.stdout),
            stderr=f"{_tail(error.stderr)}\ndid not finish within {timeout:.0f}s\n{remove(name)}",
            timed_out=True,
        )
    return RunOutcome(
        exit_code=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
        timed_out=False,
    )


def export_directory(
    *, image: str, platform: ForgePlatform, source: str, destination: Path
) -> None:
    """Copy the directory `source` of `image`, as it was built, into `destination`.

    The container is created and never started.
    """
    name = f"techtree-forge-{uuid.uuid4().hex}"
    try:
        created = _checked(
            ["docker", "create", "--name", name, "--platform", platform, image],
            DAEMON_TIMEOUT_SECONDS,
        )
        if created.returncode != 0:
            raise RunError(
                f"a container from {image} could not be created: {created.stderr.strip()[-300:]}",
                code="forge_workspace_export_failed",
                details={"image": image},
            )
        copied = _checked(
            ["docker", "cp", f"{name}:{source.rstrip('/')}/.", str(destination)],
            BUILD_TIMEOUT_SECONDS,
        )
        if copied.returncode != 0:
            raise RunError(
                f"{source} of {image} could not be copied out: {copied.stderr.strip()[-300:]}",
                code="forge_workspace_export_failed",
                details={"image": image, "destination": str(destination)},
            )
    finally:
        remove(name)


def remove_labelled(label: str, value: str) -> list[str]:
    """Remove every container labelled `label=value`, and say what happened.

    Hermes labels each sandbox with its profile; this takes back what a Hermes that crashed or
    was killed left behind.
    """
    listed = _checked(
        ["docker", "ps", "--all", "--quiet", "--filter", f"label={label}={value}"],
        DAEMON_TIMEOUT_SECONDS,
    )
    if listed.returncode != 0:
        return [f"containers labelled {label}={value} were not listed"]
    return [remove(name) for name in listed.stdout.split()]


def remove(name: str) -> str:
    """Remove the container named `name`; the sentence returned is a report, not a promise."""
    try:
        completed = _checked(["docker", "rm", "--force", name], DAEMON_TIMEOUT_SECONDS)
    except RunError as error:
        return f"container {name} was not removed: {error}"
    if completed.returncode != 0:
        if "No such container" in completed.stderr:
            return f"container {name} was already gone"
        return f"container {name} was not removed: {completed.stderr.strip()[-300:]}"
    return f"container {name} removed"


def _bounds(name: str, platform: ForgePlatform, mounts: list[Mount]) -> list[str]:
    """The `docker run` options every forge container gets.

    Every capability is dropped but `CAP_DAC_OVERRIDE`: on a Linux host a bind-mounted folder
    keeps the host user's ownership, and root without it can neither run the task's scripts,
    write the verdict nor let git write its index.
    """
    options = [
        "--rm",
        "--name",
        name,
        "--platform",
        platform,
        "--network",
        "none",
        "--memory",
        CONTAINER_MEMORY,
        "--cpus",
        CONTAINER_CPUS,
        "--pids-limit",
        CONTAINER_PIDS,
        "--cap-drop",
        "ALL",
        "--cap-add",
        "DAC_OVERRIDE",
        "--security-opt",
        "no-new-privileges",
    ]
    for mount in mounts:
        suffix = ":ro" if mount.read_only else ""
        options += ["--volume", f"{mount.source}:{mount.target}{suffix}"]
    return options
