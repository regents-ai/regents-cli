"""The person's own Hermes, called once: the forge's one reviewed model-call helper.

Every forge step that calls a model does it through the person's Hermes, in the one profile
named `techtree` they create and sign in once:

    hermes profile create techtree --no-alias
    hermes -p techtree auth add PROVIDER

`--no-alias` because Hermes would otherwise offer a `techtree` shortcut command, and that name is
Techtree's own. Hermes keeps each profile's sign-ins to itself, which is what lets Techtree copy
no credential and read none. Techtree owns everything else in the profile: before and after
every call it is emptied of all but the sign-in, and one holder at a time has it.

A planner or creator call is Hermes one-shot with its text-only toolset, memory off and its
rules, memory and Skills not injected, in an empty workspace. Its answer is what Hermes prints;
everything else goes to a log. The call is recorded as `started` before Hermes is launched and
again when it ends, so a call stopped mid-way reads as of unknown outcome, never as not made.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import time
from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Final, Literal

from filelock import FileLock, Timeout
from pydantic import ValidationError as ModelValidationError

from regents_cli.techtree.canonical import canonical_json_bytes, sha256_digest_bytes
from regents_cli.techtree.errors import (
    ConflictError,
    PrerequisiteError,
    RunError,
    TechtreeError,
    ValidationError,
)
from regents_cli.techtree.forge.models import (
    FORGE_MODEL_CALL_SCHEMA_VERSION,
    ForgeAgentSpec,
    ForgeFailure,
    ForgeModelCall,
    ForgeModelSpec,
    ForgeSourceStatus,
    ForgeUsage,
)
from regents_cli.techtree.fs import atomic_write_bytes, atomic_write_json, remove_tree
from regents_cli.techtree.models.skill import SkillFile

PROFILE_NAME: Final = "techtree"
CREATE_PROFILE_COMMAND: Final = f"hermes profile create {PROFILE_NAME} --no-alias"
#: The largest prompt handed to Hermes. It takes the prompt as one command-line argument, and
#: Linux caps one argument at 128 KiB.
PROMPT_LIMIT: Final = 120 * 1024
#: Hermes' toolset with no tool in it.
TEXT_ONLY_TOOLSET: Final = "bot_room"
#: The transcript Hermes keeps in the profile; the one file of it Techtree copies out.
STATE_DB: Final = "state.db"
ANSWER_FILENAME: Final = "answer.txt"

#: `Hermes Agent v0.21.3 (2026.9.14) · upstream 6d712cf8`. All of it is the version: Hermes
#: updates from its upstream without changing the number.
_VERSION_BANNER: Final = re.compile(r"^Hermes Agent v(?P<version>\S.*?)\s*$")
_VERSION_TIMEOUT_SECONDS: Final = 30.0
_STATUS_TIMEOUT_SECONDS: Final = 60.0
#: After an interrupt Hermes writes its usage report and exits; then it is killed.
_INTERRUPT_GRACE_SECONDS: Final = 30.0
_LOCK_FILENAME: Final = "techtree-run.lock"
#: What a sign-in is made of: Hermes' authentication store and its lock, and the file a
#: provider's static key lives in. Nothing here is ever read.
_KEPT: Final = frozenset({"auth.json", "auth.lock", ".env", _LOCK_FILENAME})
_USAGE_KEYS: Final = (
    "model",
    "provider",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "api_calls",
    "estimated_cost_usd",
    "cost_status",
    "cost_source",
    "completed",
    "failed",
    "failure",
)


# ---------------------------------------------------------------------------
# Hermes and its profile
# ---------------------------------------------------------------------------


def hermes_executable() -> Path:
    found = shutil.which("hermes")
    if found is None:
        raise PrerequisiteError(
            "no hermes on the path; install Hermes Agent and sign in to a provider before "
            "planning, building or running tasks",
            code="hermes_not_found",
        )
    return Path(found)


def agent_spec() -> ForgeAgentSpec:
    """The Hermes on the path, and the version it prints for itself."""
    executable = hermes_executable()
    completed = _ask([str(executable), "--version"], _VERSION_TIMEOUT_SECONDS)
    first_line = completed.stdout.splitlines()[0] if completed.stdout else ""
    match = _VERSION_BANNER.match(first_line)
    if completed.returncode != 0 or match is None:
        raise PrerequisiteError(
            f"{executable} did not report a Hermes Agent version",
            code="hermes_version_unreadable",
            details={
                "executable": str(executable),
                "exit_code": completed.returncode,
                "first_line": first_line,
            },
        )
    return ForgeAgentSpec(
        harness="hermes", executable=str(executable), version=match.group("version")
    )


def model_spec(provider: str, model_id: str, reasoning: str | None) -> ForgeModelSpec:
    return ForgeModelSpec(
        provider=provider,
        model_id=model_id,
        reasoning=reasoning,
        credential_source="hermes-auth-store",
    )


def profile_dir() -> Path:
    """Where the `techtree` profile lives, the way Hermes resolves its root.

    `HERMES_HOME` names the root, or a profile under `<root>/profiles`; otherwise the root is
    `~/.hermes`.
    """
    configured = os.environ.get("HERMES_HOME", "")
    if configured:
        home = Path(configured).expanduser()
        root = home.parent.parent if home.parent.name == "profiles" else home
    else:
        root = Path.home() / ".hermes"
    return root / "profiles" / PROFILE_NAME


def require_signed_in(executable: str, provider: str) -> None:
    """Refuse unless the profile exists and Hermes says it is signed in to `provider`.

    Hermes is asked, read-only; its authentication store is never opened here.
    """
    profile = profile_dir()
    sign_in = f"hermes -p {PROFILE_NAME} auth add {provider}"
    if not profile.is_dir():
        raise PrerequisiteError(
            f"model calls run in a Hermes profile named {PROFILE_NAME}, and there is none "
            f"yet. Create it with `{CREATE_PROFILE_COMMAND}`, then sign it in with `{sign_in}`",
            code="forge_profile_missing",
            details={"profile": str(profile)},
        )
    completed = _ask(
        [executable, "-p", PROFILE_NAME, "auth", "status", provider], _STATUS_TIMEOUT_SECONDS
    )
    if f"{provider}: logged in" not in completed.stdout.splitlines():
        raise PrerequisiteError(
            f"the Hermes profile {PROFILE_NAME} is not signed in to {provider}. "
            f"Sign it in with `{sign_in}`",
            code="forge_profile_signed_out",
            details={"profile": str(profile), "provider": provider},
        )


@contextmanager
def hold_profile() -> Iterator[Path]:
    """Hold the profile for one pass or run; a second holder is refused, not queued."""
    profile = profile_dir()
    lock = FileLock(profile / _LOCK_FILENAME, timeout=0, mode=0o600)
    try:
        lock.acquire()
    except Timeout as error:
        raise ConflictError(
            f"another forge step is using the Hermes profile {PROFILE_NAME}; start this one "
            "when it has finished",
            code="forge_profile_busy",
            details={"profile": str(profile)},
        ) from error
    try:
        yield profile
    finally:
        lock.release()


def reset_profile(profile: Path) -> None:
    """Empty the profile of everything but the sign-in."""
    for entry in profile.iterdir():
        if entry.name not in _KEPT:
            remove_tree(entry)


def keep_transcript(profile: Path, directory: Path) -> None:
    """Copy the profile's transcript beside the evidence, when Hermes left a plain one."""
    transcript = profile / STATE_DB
    if transcript.is_file() and not transcript.is_symlink():
        shutil.copyfile(transcript, directory / STATE_DB)


def _ask(argv: list[str], timeout: float) -> subprocess.CompletedProcess[str]:
    """Run one short, read-only Hermes command with its output captured."""
    try:
        return subprocess.run(
            argv,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            check=False,
            timeout=timeout,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired as error:
        raise RunError(
            f"{argv[0]} did not finish within {timeout:.0f}s",
            code="forge_command_timeout",
            details={"argv0": argv[0], "timeout_seconds": timeout},
        ) from error
    except OSError as error:
        raise RunError(
            f"{argv[0]} could not be started: {error.strerror or error}",
            code="forge_command_unusable",
            details={"argv0": argv[0]},
        ) from error


# ---------------------------------------------------------------------------
# The one launcher
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Outcome:
    """What one Hermes process did."""

    exit_code: int | None
    timed_out: bool
    seconds: float


def launch(
    argv: list[str],
    env: dict[str, str],
    cwd: Path,
    *,
    stdout: Path,
    stderr: Path | None,
    timeout: float,
) -> Outcome:
    """Run Hermes once, stopping it at `timeout` or on Ctrl-C; no `stderr` joins it to `stdout`.

    Hermes is interrupted first so it can write its usage report, and killed only if it does
    not exit in time. A Ctrl-C is passed on and raised again once Hermes has gone.
    """
    with ExitStack() as files:
        out = files.enter_context(stdout.open("wb"))
        err = subprocess.STDOUT if stderr is None else files.enter_context(stderr.open("wb"))
        started = time.monotonic()
        try:
            process = subprocess.Popen(
                argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err
            )
        except OSError as error:
            raise RunError(
                f"{argv[0]} could not be started: {error.strerror or error}",
                code="hermes_unusable",
                details={"executable": argv[0]},
            ) from error
        try:
            exit_code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            _stop(process)
            return Outcome(exit_code=None, timed_out=True, seconds=time.monotonic() - started)
        except KeyboardInterrupt:
            _stop(process)
            raise
        return Outcome(exit_code=exit_code, timed_out=False, seconds=time.monotonic() - started)


def _stop(process: subprocess.Popen[bytes]) -> None:
    process.send_signal(signal.SIGINT)
    try:
        process.wait(timeout=_INTERRUPT_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def read_usage(usage_file: Path) -> ForgeUsage | None:
    """Hermes' usage report as it reported it, or nothing."""
    try:
        loaded = json.loads(usage_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(loaded, dict):
        return None
    try:
        return ForgeUsage.model_validate({key: loaded.get(key) for key in _USAGE_KEYS})
    except ModelValidationError:
        return None


def alive(process_id: int) -> bool:
    """Whether a process with this id is running; a reused id reads as alive."""
    try:
        os.kill(process_id, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


# ---------------------------------------------------------------------------
# What a planner or creator call sends
# ---------------------------------------------------------------------------


def kept_files(source: ForgeSourceStatus, *, called: str) -> list[tuple[SkillFile, bytes]]:
    """Read the admitted files back from the kept copy, as recorded.

    `called` names who would have been sent them, for the refusal.
    """
    record = source.record
    if source.snapshot_path is None:
        raise ValidationError(
            f"Techtree cannot use Source Skill {source.source_id} as it is: "
            + "; ".join(refusal.message for refusal in record.refusals)
            + f". {called} was not called. Fix this and look at the Skill again with "
            "forge inspect-skill.",
            code="forge_skill_unsupported",
            details={
                "source_id": source.source_id,
                "refusals": [refusal.model_dump(mode="json") for refusal in record.refusals],
            },
        )
    snapshot = Path(source.snapshot_path)
    kept: list[tuple[SkillFile, bytes]] = []
    for file in record.admitted_files:
        try:
            data = (snapshot / file.path).read_bytes()
        except OSError:
            data = b""
        if len(data) != file.size or sha256_digest_bytes(data) != file.digest:
            raise ValidationError(
                f"Techtree's kept copy of {file.path} no longer matches what Source Skill "
                f"{source.source_id} recorded, so it cannot be sent as that Skill. {called} "
                "was not called; look at the Skill again with forge inspect-skill",
                code="forge_source_changed",
                details={"source_id": source.source_id, "path": file.path},
            )
        kept.append((file, data))
    return kept


def skill_text(kept: list[tuple[SkillFile, bytes]]) -> bytes:
    """Every kept file, word for word, each between two marker lines."""
    parts: list[bytes] = []
    for file, data in kept:
        parts.append(f"\n===== {file.path} ({file.size} bytes) =====\n".encode())
        parts.append(data if data.endswith(b"\n") else data + b"\n")
        parts.append(f"===== end of {file.path} =====\n".encode())
    return b"".join(parts)


# ---------------------------------------------------------------------------
# One reviewed call
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Call:
    """One planner or creator call an approval covers.

    `prompt_name` is where the prompt is kept, relative to the subject's directory; it stands
    for the prompt in the recorded arguments. The call's files go in `directory`.
    """

    subject_id: str
    subject_digest: str
    task_name: str | None
    agent: ForgeAgentSpec
    model: ForgeModelSpec
    prompt: bytes
    prompt_name: str
    wall_seconds: int
    directory: Path


def model_call(
    call: Call,
    profile: Path,
    *,
    record: Path,
    answer: Callable[[bytes], str],
    who: Literal["planner", "creator"],
) -> ForgeModelCall:
    """Make the call, record it at `record` before and after, and return how it ended.

    `answer` turns a usable answer into what it made (a proposal id, a package name) and raises
    `ValidationError` for one that cannot be used, which is recorded as `rejected`. Ctrl-C is
    raised again once the call is recorded as of unknown outcome.
    """
    directory = call.directory
    workspace = directory / "workspace"
    workspace.mkdir(mode=0o700)
    usage_file = directory / "usage.json"
    answer_file = directory / ANSWER_FILENAME
    config = canonical_json_bytes(
        {
            "memory": {"memory_enabled": False, "user_profile_enabled": False},
            "agent": {"run_budget_seconds": call.wall_seconds},
            "auxiliary": {"title_generation": {"enabled": False}},
            "skills": {"external_dirs": []},
        }
    )
    atomic_write_bytes(directory / "config.yaml", config)
    argv = [
        call.agent.executable,
        "--ignore-rules",
        "--in",
        str(workspace),
        "-m",
        call.model.model_id,
        "--provider",
        call.model.provider,
        *(("--reasoning", call.model.reasoning) if call.model.reasoning else ()),
        "-t",
        TEXT_ONLY_TOOLSET,
        "--usage-file",
        str(usage_file),
        "-z",
        call.prompt.decode("utf-8"),
    ]
    now = datetime.now(UTC)
    started = ForgeModelCall(
        schema_version=FORGE_MODEL_CALL_SCHEMA_VERSION,
        subject_id=call.subject_id,
        subject_digest=call.subject_digest,
        task_name=call.task_name,
        process_id=os.getpid(),
        started_at=now,
        updated_at=now,
        state="started",
        hermes_arguments=[*argv[1:-1], call.prompt_name],
        config_digest=sha256_digest_bytes(config),
        exit_code=None,
        stopped=None,
        seconds=None,
        usage=None,
        answer_bytes=None,
        answer_digest=None,
        result=None,
        failure=None,
    )
    atomic_write_json(record, started)

    def finish(**update: object) -> ForgeModelCall:
        data = answer_file.read_bytes() if answer_file.is_file() else None
        ended = ForgeModelCall.model_validate(
            started.model_copy(
                update={
                    "updated_at": datetime.now(UTC),
                    "usage": read_usage(usage_file),
                    "answer_bytes": None if data is None else len(data),
                    "answer_digest": None if data is None else sha256_digest_bytes(data),
                    **update,
                }
            )
        )
        atomic_write_json(record, ended)
        return ended

    reset_profile(profile)
    atomic_write_bytes(profile / "config.yaml", config)
    try:
        outcome = launch(
            argv,
            {**os.environ, "HERMES_HOME": str(profile)},
            workspace,
            stdout=answer_file,
            stderr=directory / "hermes.log",
            timeout=float(call.wall_seconds),
        )
    except KeyboardInterrupt:
        finish(state="outcome_unknown", stopped="person")
        raise
    except TechtreeError as error:
        finish(
            state="failed",
            failure=ForgeFailure(
                code=error.code, message=error.message[:512], error_type=type(error).__name__
            ),
        )
        raise
    finally:
        keep_transcript(profile, directory)
        reset_profile(profile)

    if outcome.timed_out:
        return finish(state="outcome_unknown", stopped="wall_time", seconds=outcome.seconds)
    ended = {"exit_code": outcome.exit_code, "seconds": outcome.seconds}
    usage = read_usage(usage_file)
    if outcome.exit_code != 0 or usage is None or usage.failed or not usage.completed:
        reason = usage.failure if usage is not None and usage.failure else None
        message = f"Hermes ended without an answer (exit {outcome.exit_code}" + (
            f": {reason})" if reason else ")"
        )
        return finish(
            state="failed",
            failure=ForgeFailure(
                code=f"forge_{who}_failed",
                message=message[:512],
                error_type=f"{who.title()}Failure",
            ),
            **ended,
        )
    try:
        result = answer(answer_file.read_bytes())
    except ValidationError as rejection:
        return finish(
            state="rejected",
            failure=ForgeFailure(
                code=rejection.code,
                message=rejection.message[:512],
                error_type=f"{who.title()}Answer",
            ),
            **ended,
        )
    return finish(state="succeeded", result=result, **ended)
