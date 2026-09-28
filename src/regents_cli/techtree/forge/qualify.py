"""Model-free qualification of a committed task, from fresh containers of its own image.

The checks every task gets:
- the package still hashes to its commitment, before and after;
- no file of `tests/` or `solution/` appears in the instruction or the environment;
- the image builds offline from exactly its `environment/` tree and carries no `/tests`,
  `/solution` or `/logs`;
- a run that does nothing scores 0.0;
- the reference solution and the other correct one (`solution/alternative.sh`) score 1.0, and
  the deliberately wrong one (`solution/wrong.sh`) finishes and scores 0.0;
- what the tests leave under `/logs/verifier` stays bounded.

Grading follows the procedure Verifiers applies to a Harbor task: `tests/` is mounted at
`/tests`, `bash /tests/test.sh` runs, and the verdict is the reward file it leaves under
`/logs/verifier`.
"""

from __future__ import annotations

import json
import os
import stat
import tomllib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Final, Literal

from regents_cli.techtree.errors import RunError
from regents_cli.techtree.forge import docker
from regents_cli.techtree.forge.content import verify_task_set
from regents_cli.techtree.forge.docker import Mount
from regents_cli.techtree.forge.models import (
    FORGE_QUALIFICATION_SCHEMA_VERSION,
    ForgeBuildRecord,
    ForgePlatform,
    ForgeQualification,
    QualificationCheck,
    TaskQualification,
)
from regents_cli.techtree.fs import ensure_private_directory
from regents_cli.techtree.models.base import Digest

#: Added to the task's own time limit: container start and image load.
_RUN_MARGIN_SECONDS: Final = 120.0
#: Added to each step's limit in a started container: only `docker exec` needs the room.
_STEP_GRACE_SECONDS: Final = 10.0
_PROBE_TIMEOUT_SECONDS: Final = 120.0
TIMED_OUT_DETAIL: Final = "the tests did not finish within the task's own timeout"
SOLUTION_TIMED_OUT_DETAIL: Final = (
    "the reference solution did not finish within the task's own agent timeout"
)
SOLUTION_FAILED_DETAIL: Final = (
    "the reference solution stopped with an error, so the tests did not run"
)
NOT_STARTED_DETAIL: Final = "the task's image could not be started for the reference solution"
#: A reward file is a number or a small JSON document; anything larger is not a verdict.
_REWARD_FILE_LIMIT: Final = 64 * 1024
#: Everything the tests leave across a task's graded runs fits in these.
_VERIFIER_OUTPUT_LIMIT: Final = 1024 * 1024
_VERIFIER_OUTPUT_ENTRIES: Final = 1024


@dataclass(frozen=True)
class SkillTaskFacts:
    """The time limits, required outputs and Source Skill a task's `task.toml` commits to."""

    agent_timeout: float
    verifier_timeout: float
    artifacts: tuple[str, ...]
    source_skill: str
    source_digest: str


#: Why a graded run left no verdict to read.
type Stop = Literal["tests_timed_out", "solution_timed_out", "solution_failed", "not_started"]

_STOP_DETAILS: Final[dict[Stop, str]] = {
    "tests_timed_out": TIMED_OUT_DETAIL,
    "solution_timed_out": SOLUTION_TIMED_OUT_DETAIL,
    "solution_failed": SOLUTION_FAILED_DETAIL,
    "not_started": NOT_STARTED_DETAIL,
}


@dataclass(frozen=True)
class Verdict:
    """The reward files one graded run left, or why it left none.

    `stopped` is set here, by the host, and nothing the tests write can set it.
    """

    reward: float | None
    details: dict[str, object]
    stopped: Stop | None = None


def task_image_tag(build: ForgeBuildRecord, task_id: str) -> str:
    """A tag no other build shares."""
    return f"techtree-forge/{build.source.recipe}/{task_id.lower()}:{build.build_id[-12:]}"


def qualify_build(
    *, build: ForgeBuildRecord, tasks_dir: Path, work_dir: Path
) -> ForgeQualification:
    """Qualify every task the build committed and say which proved out."""
    verify_task_set(tasks_dir, build.task_set)
    ensure_private_directory(work_dir)
    tasks = [
        _qualify_task(build, tasks_dir / task.task_id, work_dir / task.task_id, task.content_digest)
        for task in build.task_set.tasks
    ]
    verify_task_set(tasks_dir, build.task_set)
    return ForgeQualification(
        schema_version=FORGE_QUALIFICATION_SCHEMA_VERSION,
        build_id=build.build_id,
        membership_digest=build.task_set.membership_digest,
        qualified_at=datetime.now(UTC),
        model_calls=0,
        tasks=tasks,
        qualified_task_ids=[task.task_id for task in tasks if task.qualified],
    )


def _image_build_check(
    build: ForgeBuildRecord, task_dir: Path, work_dir: Path
) -> tuple[str, QualificationCheck]:
    """Build the task image offline from its committed `environment/`; the id is empty on
    failure, with the log at `work_dir/image-build.log`."""
    ensure_private_directory(work_dir)
    try:
        image_id = docker.build(
            context=task_dir / "environment",
            dockerfile=task_dir / "environment" / "Dockerfile",
            tag=task_image_tag(build, task_dir.name),
            platform=build.platform,
            log=work_dir / "image-build.log",
        )
    except RunError as error:
        return "", QualificationCheck(name="image_build", passed=False, detail=str(error))
    return image_id, QualificationCheck(name="image_build", passed=True, detail=image_id)


#: Each graded solution, by the run it is kept under.
_SOLUTIONS: Final = {"reference": "solve.sh", "alternative": "alternative.sh", "wrong": "wrong.sh"}


def _qualify_task(
    build: ForgeBuildRecord, task_dir: Path, work_dir: Path, content_digest: Digest
) -> TaskQualification:
    """Qualify one package: the no-op run gets the verifier's time; each solution gets the
    agent's time and then the tests the verifier's, both from the pinned `task.toml`."""
    facts = read_skill_task_facts(task_dir)
    rewards: dict[str, float | None] = {"control": None, **dict.fromkeys(_SOLUTIONS)}
    checks = [_hidden_material_check(task_dir)]
    image_id, built = _image_build_check(build, task_dir, work_dir)
    checks.append(built)
    if image_id:
        checks.append(_material_check(build, image_id))
        control = grade_task(
            build.platform,
            image_id,
            task_dir,
            work_dir / "control",
            time_limit=facts.verifier_timeout,
        )
        rewards["control"] = control.reward
        checks.append(
            QualificationCheck(
                name="no_op_fails",
                passed=control.reward == 0.0,
                detail=_STOP_DETAILS[control.stopped]
                if control.stopped
                else f"{_reward_words(control.reward)} with nothing done",
            )
        )
        graded = {
            case: _grade_solution(
                build.platform,
                image_id,
                task_dir,
                work_dir / case,
                script=f"/solution/{script}",
                solution_time_limit=facts.agent_timeout,
                tests_time_limit=facts.verifier_timeout,
            )
            for case, script in _SOLUTIONS.items()
        }
        rewards |= {case: verdict.reward for case, verdict in graded.items()}
        reference = graded["reference"]
        checks += [
            QualificationCheck(
                name="reference_solution_passes",
                passed=reference.reward == 1.0,
                detail=_STOP_DETAILS[reference.stopped]
                if reference.stopped
                else f"{_reward_words(reference.reward)} after the reference solution",
            ),
            _case_check(
                "alternative_solution_passes",
                "the other correct solution",
                graded["alternative"],
                expected=1.0,
            ),
            _case_check(
                "wrong_solution_fails",
                "the deliberately wrong solution",
                graded["wrong"],
                expected=0.0,
            ),
            _verifier_output_check(
                [work_dir / run / "verifier" for run in ("control", *_SOLUTIONS)]
            ),
        ]
    return TaskQualification(
        kind="skill",
        task_id=task_dir.name,
        task_content_digest=content_digest,
        image_tag=task_image_tag(build, task_dir.name),
        image_id=image_id,
        control_reward=rewards["control"],
        reference_reward=rewards["reference"],
        alternative_reward=rewards["alternative"],
        wrong_reward=rewards["wrong"],
        checks=checks,
        qualified=all(check.passed for check in checks),
    )


#: Why a recipe case left no verdict, said of the solution it ran.
_CASE_STOP_WORDS: Final[dict[Stop, str]] = {
    "tests_timed_out": "the tests did not finish within the task's own timeout after {solution}",
    "solution_timed_out": "{solution} did not finish within the task's own agent timeout",
    "solution_failed": "{solution} stopped with an error, so the tests did not run",
    "not_started": "the task's image could not be started for {solution}",
}


def _case_check(
    name: str, solution: str, verdict: Verdict, *, expected: float
) -> QualificationCheck:
    """A recipe case holds when its solution ran and the tests gave `expected`."""
    return QualificationCheck(
        name=name,
        passed=verdict.stopped is None and verdict.reward == expected,
        detail=_CASE_STOP_WORDS[verdict.stopped].format(solution=solution)
        if verdict.stopped
        else f"{_reward_words(verdict.reward)} after {solution}",
    )


def _reward_words(reward: float | None) -> str:
    return "no reward" if reward is None else f"reward {reward}"


def read_skill_task_facts(task_dir: Path) -> SkillTaskFacts:
    """Read the time limits, required outputs and Source Skill one task commits to."""
    document = tomllib.loads((task_dir / "task.toml").read_text(encoding="utf-8"))
    return SkillTaskFacts(
        agent_timeout=float(document["agent"]["timeout_sec"]),
        verifier_timeout=float(document["verifier"]["timeout_sec"]),
        artifacts=tuple(str(artifact) for artifact in document["artifacts"]),
        source_skill=str(document["metadata"]["source_skill"]),
        # task.toml holds the bare hex; Techtree writes digests with a prefix.
        source_digest="sha256:" + str(document["metadata"]["source_bundle_digest"]),
    )


def _hidden_material_check(task_dir: Path) -> QualificationCheck:
    """No file of `tests/` or `solution/` appears in what the subject sees.

    The subject sees the instruction and the `environment/` tree, and the image is built offline
    from that tree alone. An empty or whitespace-only file says nothing and is not looked for.
    """
    hidden = [
        path
        for root in ("tests", "solution")
        for path in sorted((task_dir / root).rglob("*"))
        if path.is_file()
    ]
    visible = {
        path: path.read_bytes()
        for path in [
            task_dir / "instruction.md",
            *sorted(path for path in (task_dir / "environment").rglob("*") if path.is_file()),
        ]
    }
    leaks = [
        f"{secret.relative_to(task_dir)} inside {seen.relative_to(task_dir)}"
        for secret in hidden
        if (data := secret.read_bytes()).strip()
        for seen, seen_bytes in visible.items()
        if data in seen_bytes
    ]
    return QualificationCheck(
        name="hidden_material_private",
        passed=not leaks,
        detail=", ".join(leaks)
        if leaks
        else "no tests or solution file appears in the instruction or environment",
    )


def _verifier_output_check(verifier_dirs: list[Path]) -> QualificationCheck:
    """The tests left regular files only, within the output limits, in total.

    Nothing is followed, and anything the walk cannot read fails the check.
    """
    total = 0
    entries = 0
    irregular: list[str] = []
    for verifier_dir in verifier_dirs:
        unreadable: list[OSError] = []
        for directory, subdirectories, names in os.walk(
            verifier_dir, onerror=unreadable.append, followlinks=False
        ):
            for name in [*subdirectories, *names]:
                path = Path(directory) / name
                entries += 1
                try:
                    status = os.lstat(path)
                except OSError as error:
                    unreadable.append(error)
                    continue
                if stat.S_ISREG(status.st_mode):
                    total += status.st_size
                elif not stat.S_ISDIR(status.st_mode):
                    irregular.append(str(path.relative_to(verifier_dir)))
        irregular.extend(
            str(Path(error.filename).relative_to(verifier_dir)) for error in unreadable
        )
    passed = (
        not irregular and total <= _VERIFIER_OUTPUT_LIMIT and entries <= _VERIFIER_OUTPUT_ENTRIES
    )
    detail = f"{total} bytes across {entries} entries"
    if irregular:
        detail += f"; not regular files: {', '.join(irregular)}"
    return QualificationCheck(name="verifier_output_bounded", passed=passed, detail=detail)


def _material_check(build: ForgeBuildRecord, image: str) -> QualificationCheck:
    outcome = docker.run(
        image=image,
        platform=build.platform,
        argv=["sh", "-c", "test ! -e /tests && test ! -e /solution && test ! -e /logs"],
        mounts=[],
        timeout=_PROBE_TIMEOUT_SECONDS,
    )
    return QualificationCheck(
        name="verifier_material_absent",
        passed=outcome.exit_code == 0,
        detail="the image holds no /tests, /solution or /logs"
        if outcome.exit_code == 0
        else "the image already holds verifier material",
    )


def grade_task(
    platform: ForgePlatform,
    image: str,
    task_dir: Path,
    run_dir: Path,
    *,
    time_limit: float,
    workspace: Mount | None = None,
) -> Verdict:
    """Run the task's own test script once and read the verdict it leaves.

    Qualification grades the image's own working directory; a forge run grades what an agent
    left, `workspace` mounted over it. The container runs from the image's content id, gets the
    task's own limit plus a start margin, and the tests write into `run_dir/verifier` only; the
    transcript is kept beside it, where they cannot reach.
    """
    ensure_private_directory(run_dir)
    verifier_dir = run_dir / "verifier"
    ensure_private_directory(verifier_dir)
    mounts = [Mount(source=task_dir / "tests", target="/tests", read_only=True)]
    if workspace is not None:
        mounts.append(workspace)
    mounts.append(Mount(source=verifier_dir, target="/logs/verifier", read_only=False))
    outcome = docker.run(
        image=image,
        platform=platform,
        argv=["bash", "-c", "bash /tests/test.sh"],
        mounts=mounts,
        timeout=time_limit + _RUN_MARGIN_SECONDS,
    )
    (run_dir / "container.log").write_text(
        f"exit {outcome.exit_code}, timed out {outcome.timed_out}\n"
        f"{outcome.stdout}\n{outcome.stderr}",
        encoding="utf-8",
    )
    # A run that did not finish has no verdict, whatever it wrote before it hung.
    if outcome.timed_out:
        return Verdict(reward=None, details={}, stopped="tests_timed_out")
    return _read_verdict(verifier_dir)


def _grade_solution(
    platform: ForgePlatform,
    image: str,
    task_dir: Path,
    run_dir: Path,
    *,
    script: str,
    solution_time_limit: float,
    tests_time_limit: float,
) -> Verdict:
    """Run one solution, then the tests, in one container, and read the verdict.

    Each step is a `docker exec` under its own limit kept from the host: the image was built
    from the task's own recipe, so nothing inside it is trusted to keep time. A step that runs
    out of time, a solution that fails, or an image that cannot start leaves no verdict.
    """
    ensure_private_directory(run_dir)
    verifier_dir = run_dir / "verifier"
    ensure_private_directory(verifier_dir)
    mounts = [
        Mount(source=task_dir / "tests", target="/tests", read_only=True),
        Mount(source=task_dir / "solution", target="/solution", read_only=True),
        Mount(source=verifier_dir, target="/logs/verifier", read_only=False),
    ]
    log: list[str] = []
    try:
        name = docker.start(image=image, platform=platform, mounts=mounts)
    except RunError as error:
        if error.code != "forge_container_unavailable":
            raise
        (run_dir / "container.log").write_text(
            f"{error}\n{error.details['removal']}\n", encoding="utf-8"
        )
        return Verdict(reward=None, details={}, stopped="not_started")
    try:
        stopped = _solve_then_test(name, script, solution_time_limit, tests_time_limit, log)
    finally:
        log.append(docker.remove(name))
        (run_dir / "container.log").write_text("\n".join(log) + "\n", encoding="utf-8")
    return _read_verdict(verifier_dir) if stopped is None else stopped


def _solve_then_test(
    name: str, script: str, solution_time_limit: float, tests_time_limit: float, log: list[str]
) -> Verdict | None:
    """Why the run left no verdict, or None when both steps ran."""
    steps: tuple[tuple[str, str, float, Stop], ...] = (
        ("solution", script, solution_time_limit, "solution_timed_out"),
        ("tests", "/tests/test.sh", tests_time_limit, "tests_timed_out"),
    )
    for step, path, limit, out_of_time in steps:
        outcome = docker.exec_in(name, ["bash", path], timeout=limit + _STEP_GRACE_SECONDS)
        log.append(
            f"{step}: exit {outcome.exit_code}, timed out {outcome.timed_out}\n"
            f"{outcome.stdout}\n{outcome.stderr}"
        )
        if outcome.timed_out:
            return Verdict(reward=None, details={}, stopped=out_of_time)
        if step == "solution" and outcome.exit_code != 0:
            return Verdict(reward=None, details={}, stopped="solution_failed")
    return None


def _read_verdict(verifier_dir: Path) -> Verdict:
    """Read the reward the way Verifiers does: `reward.json` first, then text."""
    reward: float | None = None
    details: dict[str, object] = {}
    json_text = _reward_file(verifier_dir / "reward.json")
    text = _reward_file(verifier_dir / "reward.txt")
    details_text = _reward_file(verifier_dir / "reward-details.json")
    try:
        if json_text is not None:
            reward = float(json.loads(json_text)["reward"])
        elif text is not None:
            reward = float(text.strip())
        if details_text is not None:
            loaded = json.loads(details_text)
            if isinstance(loaded, dict):
                details = loaded
    except (KeyError, TypeError, ValueError):
        reward = None
    return Verdict(reward=reward, details=details)


def _reward_file(path: Path) -> str | None:
    """The text of a small regular file the tests left, or nothing.

    The tests wrote into this directory, so a symlink, directory, pipe, oversized or undecodable
    file is not a verdict, and the open never waits on what it finds.
    """
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
    try:
        descriptor = os.open(path, flags)
    except OSError:
        return None
    try:
        status = os.fstat(descriptor)
        if not stat.S_ISREG(status.st_mode) or status.st_size > _REWARD_FILE_LIMIT:
            return None
        return os.read(descriptor, _REWARD_FILE_LIMIT).decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    finally:
        os.close(descriptor)
