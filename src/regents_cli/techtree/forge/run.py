"""Running one arm of a forge experiment with the person's own Hermes.

A run executes a `ForgeRunSpec` and nothing else: the specification was declared first, and every
attempt here is what it says. Its tasks come from an accepted collection, checked byte for byte
against what a person accepted before anything starts. Before the first attempt, every task's
working directory is checked: it must hold all the task's required outputs, lie where the sandbox
does not cover it with empty folders of its own, and be readable within the declared bounds as
the image left it, so that no model is paid for an attempt whose outputs could never be taken.
For each named task and each repetition, in order:

1. the task's working directory is copied out of its image to the host, so the agent works in a
   real directory Techtree can read and grade, and read once before the agent starts;
2. the person's `techtree` Hermes profile is emptied of everything but its sign-in and given a
   `config.yaml` Techtree wrote (Docker sandbox from the task image with that directory mounted
   back where it came from, no network, memory off, no title generation) and, on an arm that
   carries a Skill, that Skill under `skills/<name>` from the run's own copy;
3. the person's `hermes` runs one-shot in that profile, in the directory, with the task's
   instruction, the arm's Skill preloaded if it has one, and the task's own agent timeout as its
   run budget and as Techtree's deadline;
4. what the agent left is recorded before any grading: the directory is read again and every
   entry added, modified or deleted is written to a manifest, with the bytes of the files it
   left, within the bounds the specification declared (`capture`);
5. the task's own tests grade the directory the way qualification graded the reference. A task
   whose outputs could not be taken as they are is not graded; one that is only missing a
   required output still is, and the tests decide.

On an arm that carries a Skill the run takes its own copy of it under `skill/` before the first
attempt, once the directory it was declared from still hashes to what the specification says;
every attempt is served from that copy, and it is what `uplift skill-source` reads back.

The profile is one the person made and signed in once: Hermes keeps each profile's sign-ins to
itself, which is what lets Techtree copy no credential. The run holds the profile from its first
attempt to its last. After each attempt the profile's transcript database is kept beside the
evidence, the profile is emptied again but for the sign-in, and the sandbox containers Hermes
stopped but left on the daemon are removed by the profile label Hermes gave them; nothing under
the profile is read but that one file.

Every outcome is its own kind: a graded attempt has a reward, and an agent that timed out or
failed, outputs that were rejected, a verifier that timed out, or a verifier that left no
readable verdict are recorded as exactly that, never as zero.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Final

from regents_cli.techtree.canonical import canonical_json_bytes, sha256_digest_bytes
from regents_cli.techtree.errors import RunError, TechtreeError, ValidationError
from regents_cli.techtree.forge import docker
from regents_cli.techtree.forge.builds import read_build_status
from regents_cli.techtree.forge.calls import (
    PROFILE_NAME,
    STATE_DB,
    hold_profile,
    keep_transcript,
    launch,
    read_usage,
    require_signed_in,
    reset_profile,
)
from regents_cli.techtree.forge.capture import capture_outputs, take_snapshot
from regents_cli.techtree.forge.collection import verify_collection
from regents_cli.techtree.forge.docker import Mount
from regents_cli.techtree.forge.experiment import run_spec_digest
from regents_cli.techtree.forge.models import (
    FORGE_RUN_SCHEMA_VERSION,
    ForgeAttemptOutcome,
    ForgeAttemptRecord,
    ForgeBuildRecord,
    ForgeEvidence,
    ForgeFailure,
    ForgeRunRecord,
    ForgeRunSpec,
    ForgeRunStatus,
)
from regents_cli.techtree.forge.qualify import grade_task, read_skill_task_facts
from regents_cli.techtree.forge.records import inspect_command, read_record
from regents_cli.techtree.forge.skill import SKILL_DIRNAME, scan_skill_spec, snapshot_skill
from regents_cli.techtree.fs import atomic_write_bytes, atomic_write_json
from regents_cli.techtree.ids import new_id, validate_id
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.paths import TechtreePaths

SPEC_FILENAME: Final = "spec.json"
RUN_FILENAME: Final = "run.json"
#: Added to the task's agent timeout before Techtree stops Hermes itself; Hermes is given the
#: timeout as its own budget and should stop first.
AGENT_MARGIN_SECONDS: Final = 120.0
_PROFILE_LABEL: Final = "hermes-profile"


@dataclass(frozen=True)
class _RunTask:
    """One task a run names, read once before the first attempt."""

    task_id: str
    build: ForgeBuildRecord
    image: str
    task_dir: Path
    agent_timeout: float
    verifier_timeout: float
    artifacts: tuple[str, ...]


def run_arm(paths: TechtreePaths, spec: ForgeRunSpec, skill_root: Path | None) -> ForgeRunStatus:
    """Execute every attempt the specification names and record each one."""
    skill_files = _skill_files(spec, skill_root)
    tasks = _collection_tasks(paths, spec)
    with hold_profile() as profile:
        return _recorded_run(paths, spec, skill_files, tasks, profile)


def _run_config(
    spec: ForgeRunSpec, image: str, agent_timeout: float, workspace: Path, directory: str
) -> bytes:
    """The `config.yaml` Techtree writes for one attempt, as bytes.

    The exported `workspace` is mounted back at `directory`, where it was copied from, as an
    explicit volume and the shell starts there: Hermes binds its own working directory only for
    a shared container, and the sandbox here is per session. JSON is YAML, and the canonical
    encoder is what makes the digest of this file the fact the evidence records.
    """
    return canonical_json_bytes(
        {
            "terminal": {
                "backend": "docker",
                "docker_image": image,
                "docker_volumes": [f"{workspace}:{directory}"],
                "cwd": directory,
                "docker_network": spec.limits.network,
                "container_persistent": False,
                "docker_persist_across_processes": False,
                "docker_orphan_reaper": False,
                "container_cpu": spec.limits.container_cpus,
                "container_memory": spec.limits.container_memory_mb,
            },
            "memory": {
                "memory_enabled": spec.initial_state.memory_enabled,
                "user_profile_enabled": False,
            },
            "agent": {"run_budget_seconds": agent_timeout},
            "auxiliary": {"title_generation": {"enabled": False}},
            "skills": {"external_dirs": []},
        }
    )


def _collection_tasks(paths: TechtreePaths, spec: ForgeRunSpec) -> list[_RunTask]:
    """Read the collection's named tasks, once it is still exactly as accepted and declared."""
    tasks_from = spec.tasks_from
    status = verify_collection(paths, tasks_from.collection_id)
    require_signed_in(spec.agent.executable, spec.model.provider)
    if status.record.collection_digest != tasks_from.collection_digest:
        raise ValidationError(
            "the collection is not the one the specification was declared on",
            code="forge_membership_mismatch",
            details={
                "collection_id": tasks_from.collection_id,
                "declared": tasks_from.collection_digest,
                "stored": status.record.collection_digest,
            },
        )
    members = {member.task_id: member for member in status.record.review.members}
    tasks = []
    for task_id in spec.task_ids:
        built = read_build_status(paths, members[task_id].build_id)
        assert built.qualification is not None  # a verified member qualified
        task_dir = Path(built.tasks_path) / task_id
        facts = read_skill_task_facts(task_dir)
        tasks.append(
            _RunTask(
                task_id=task_id,
                build=built.build,
                image=next(
                    task.image_id for task in built.qualification.tasks if task.task_id == task_id
                ),
                task_dir=task_dir,
                agent_timeout=facts.agent_timeout,
                verifier_timeout=facts.verifier_timeout,
                artifacts=facts.artifacts,
            )
        )
    return tasks


def _recorded_run(
    paths: TechtreePaths,
    spec: ForgeRunSpec,
    skill_files: list[tuple[Path, str]],
    tasks: list[_RunTask],
    profile: Path,
) -> ForgeRunStatus:
    """Record the run and every attempt; the caller holds the profile."""
    run_id = new_id("forgerun")
    run_dir = paths.forge_run_dir(run_id)
    run_dir.mkdir(parents=True, mode=0o700)
    atomic_write_bytes(run_dir / SPEC_FILENAME, canonical_json_bytes(spec))
    snapshot_skill(skill_files, run_dir / SKILL_DIRNAME)
    now = datetime.now(UTC)
    record = ForgeRunRecord(
        schema_version=FORGE_RUN_SCHEMA_VERSION,
        run_id=run_id,
        spec_digest=run_spec_digest(spec),
        started_at=now,
        updated_at=now,
        state="unfinished",
        attempts=[],
        failure=None,
    )

    def persist(**update: object) -> None:
        nonlocal record
        updated = record.model_copy(update={"updated_at": datetime.now(UTC), **update})
        atomic_write_json(run_dir / RUN_FILENAME, updated)
        record = updated

    try:
        persist()
        docker.require_daemon()
        directories = [_directory(spec, task, run_dir) for task in tasks]
        for task, directory in zip(tasks, directories, strict=True):
            for attempt in range(1, spec.sampling.repetitions + 1):
                result = _attempt(spec, task, directory, run_dir, attempt, profile)
                persist(attempts=[*record.attempts, result])
        persist(state="completed")
    except (Exception, KeyboardInterrupt) as error:
        failure = _run_failure(error)
        receipt_written = True
        try:
            persist(
                failure=failure,
                state="cancelled" if isinstance(error, KeyboardInterrupt) else "failed",
            )
        except Exception:
            receipt_written = False
        raise RunError(
            f"{failure.message}. Inspect: {inspect_command(run_id)}"
            + ("" if receipt_written else "; final failure receipt could not be written"),
            code=failure.code,
            details={
                "run_id": run_id,
                "path": str(run_dir),
                "attempts_recorded": len(record.attempts),
                "failure_recorded": receipt_written,
            },
        ) from error
    return ForgeRunStatus(run_id=run_id, path=str(run_dir), spec=spec, record=record)


def _skill_files(spec: ForgeRunSpec, skill_root: Path | None) -> list[tuple[Path, str]]:
    """The Skill's files to copy, once they are the declared ones."""
    if spec.skill is None:
        if skill_root is not None:
            raise ValidationError(
                "this run was declared without a Skill, so it takes none",
                code="forge_skill_not_declared",
            )
        return []
    if skill_root is None:
        raise ValidationError(
            "this run needs the Skill directory it was declared with",
            code="forge_skill_not_given",
        )
    found, files = scan_skill_spec(skill_root, name=spec.skill.name)
    if found.root_digest != spec.skill.root_digest:
        raise ValidationError(
            "the Skill directory no longer matches the Skill the specification declared; "
            "declare it again",
            code="forge_skill_changed",
            details={"declared": spec.skill.root_digest, "found": found.root_digest},
        )
    return files


def _directory(spec: ForgeRunSpec, task: _RunTask, run_dir: Path) -> str:
    """Where the task's agent works: its image's working directory.

    Every output it must leave has to be inside it, and it must be readable within the declared
    bounds as the image left it, or no attempt runs.
    """
    directory = docker.working_dir(task.image)
    base = PurePosixPath(directory)
    outside = [
        artifact for artifact in task.artifacts if not PurePosixPath(artifact).is_relative_to(base)
    ]
    if base == PurePosixPath("/"):
        reason = "the whole filesystem cannot be read back as its outputs"
    elif outside:
        reason = f"its required outputs {', '.join(outside)} are outside it"
    else:
        _require_readable(spec, task, directory, run_dir)
        return directory
    raise ValidationError(
        f"task {task.task_id} cannot be run: its image works in {directory}, and {reason}",
        code="forge_work_dir_unusable",
        details={"task_id": task.task_id, "work_dir": directory, "artifacts": list(task.artifacts)},
    )


def _require_readable(spec: ForgeRunSpec, task: _RunTask, directory: str, run_dir: Path) -> None:
    """Refuse a working directory the image leaves past the declared bounds."""
    with tempfile.TemporaryDirectory(dir=run_dir) as scratch:
        docker.export_directory(
            image=task.image,
            platform=task.build.platform,
            source=directory,
            destination=Path(scratch),
        )
        start = take_snapshot(Path(scratch), spec.limits.outputs)
    if start.incomplete:
        raise ValidationError(
            f"task {task.task_id} cannot be run: its image leaves {directory} past what can be "
            "read back as its outputs ("
            + "; ".join(failure.detail for failure in start.incomplete)
            + ")",
            code="forge_work_dir_unreadable",
            details={"task_id": task.task_id, "work_dir": directory},
        )


def _attempt(
    spec: ForgeRunSpec,
    task: _RunTask,
    directory: str,
    run_dir: Path,
    attempt: int,
    profile: Path,
) -> ForgeAttemptRecord:
    started = datetime.now(UTC)
    attempt_dir = run_dir / "tasks" / task.task_id / str(attempt)
    workspace = attempt_dir / "workspace"
    workspace.mkdir(parents=True, mode=0o700)
    docker.export_directory(
        image=task.image, platform=task.build.platform, source=directory, destination=workspace
    )
    before = take_snapshot(workspace, spec.limits.outputs)

    config = _run_config(spec, task.image, task.agent_timeout, workspace, directory)
    atomic_write_bytes(attempt_dir / "config.yaml", config)
    reset_profile(profile)
    (profile / "skills").mkdir(mode=0o700)
    atomic_write_bytes(profile / "config.yaml", config)
    if spec.skill is not None:
        snapshot_skill(
            [(run_dir / SKILL_DIRNAME / file.path, file.path) for file in spec.skill.files],
            profile / "skills" / spec.skill.name,
        )

    usage_file = attempt_dir / "usage.json"
    instruction = (task.task_dir / "instruction.md").read_text(encoding="utf-8")
    argv = [
        spec.agent.executable,
        "--yolo",
        "--in",
        str(workspace),
        "-m",
        spec.model.model_id,
        "--provider",
        spec.model.provider,
        *(("--reasoning", spec.model.reasoning) if spec.model.reasoning else ()),
        "-t",
        ",".join(spec.toolsets),
        "--usage-file",
        str(usage_file),
        *(("-s", spec.skill.name) if spec.skill is not None else ()),
        "-z",
        instruction,
    ]
    env = {
        **os.environ,
        "HERMES_HOME": str(profile),
        "HERMES_YOLO_MODE": "1",
        "HERMES_ACCEPT_HOOKS": "1",
    }
    try:
        agent = launch(
            argv,
            env,
            workspace,
            stdout=attempt_dir / "agent.log",
            stderr=None,
            timeout=task.agent_timeout + AGENT_MARGIN_SECONDS,
        )
    finally:
        keep_transcript(profile, attempt_dir)
        reset_profile(profile)
        docker.remove_labelled(_PROFILE_LABEL, PROFILE_NAME)

    usage = read_usage(usage_file)
    outputs = capture_outputs(
        workspace,
        before,
        work_dir=directory,
        artifacts=list(task.artifacts),
        limits=spec.limits.outputs,
        destination=attempt_dir / "outputs",
    )
    evidence = [
        *([ForgeEvidence.USAGE_REPORT] if usage is not None else []),
        *([ForgeEvidence.AGENT_TRANSCRIPT] if (attempt_dir / STATE_DB).is_file() else []),
        ForgeEvidence.OUTPUT_MANIFEST,
    ]

    reward: float | None = None
    details: dict[str, JsonValue] = {}
    verifier_timed_out = False
    agent_failed = agent.exit_code != 0 or usage is None or usage.failed or not usage.completed
    if agent.timed_out:
        outcome = ForgeAttemptOutcome.AGENT_TIMED_OUT
    elif agent_failed:
        outcome = ForgeAttemptOutcome.AGENT_FAILED
    elif any(failure.kind != "artifact_missing" for failure in outputs.failures):
        outcome = ForgeAttemptOutcome.OUTPUTS_REJECTED
    else:
        verdict = grade_task(
            task.build.platform,
            task.image,
            task.task_dir,
            attempt_dir / "grading",
            time_limit=task.verifier_timeout,
            workspace=Mount(source=workspace, target=directory, read_only=False),
        )
        verifier_timed_out = verdict.stopped == "tests_timed_out"
        if verifier_timed_out:
            outcome = ForgeAttemptOutcome.VERIFIER_TIMED_OUT
        elif verdict.reward is None:
            outcome = ForgeAttemptOutcome.NO_VERDICT
        else:
            outcome = ForgeAttemptOutcome.GRADED
            reward = verdict.reward
            details = _json_details(verdict.details)
            evidence.append(ForgeEvidence.VERIFIER_VERDICT)

    return ForgeAttemptRecord(
        task_id=task.task_id,
        attempt=attempt,
        started_at=started,
        finished_at=datetime.now(UTC),
        config_digest=sha256_digest_bytes(config),
        hermes_arguments=["instruction.md" if item == instruction else item for item in argv[1:]],
        agent_exit_code=agent.exit_code,
        agent_timed_out=agent.timed_out,
        agent_seconds=agent.seconds,
        usage=usage,
        outputs=outputs,
        verifier_timed_out=verifier_timed_out,
        reward=reward,
        reward_details=details,
        outcome=outcome,
        evidence=evidence,
    )


def read_run_status(paths: TechtreePaths, run_id: str) -> ForgeRunStatus:
    """One run's specification and record, read back from its directory."""
    run_dir = paths.forge_run_dir(validate_id(run_id, "forgerun"))
    details = {"run_id": run_id, "path": str(run_dir)}
    missing = f"no recorded forge run {run_id}"
    return ForgeRunStatus(
        run_id=run_id,
        path=str(run_dir),
        spec=read_record(
            ForgeRunSpec,
            run_dir / SPEC_FILENAME,
            missing=missing,
            code="forge_run_not_found",
            details=details,
        ),
        record=read_record(
            ForgeRunRecord,
            run_dir / RUN_FILENAME,
            missing=missing,
            code="forge_run_not_found",
            details=details,
        ),
    )


def _json_details(details: dict[str, object]) -> dict[str, JsonValue]:
    """Keep the verifier's details only where they are plain JSON."""
    try:
        return {key: json.loads(json.dumps(value)) for key, value in details.items()}
    except (TypeError, ValueError):
        return {}


def _run_failure(error: Exception | KeyboardInterrupt) -> ForgeFailure:
    if isinstance(error, KeyboardInterrupt):
        code, message = "forge_run_cancelled", "run cancelled by Ctrl-C"
    elif isinstance(error, TechtreeError):
        code, message = error.code, error.message
    else:
        code = "forge_run_failed"
        message = f"unexpected {type(error).__name__}; inspect the run's evidence"
    return ForgeFailure(code=code, message=message[:512], error_type=type(error).__name__)
