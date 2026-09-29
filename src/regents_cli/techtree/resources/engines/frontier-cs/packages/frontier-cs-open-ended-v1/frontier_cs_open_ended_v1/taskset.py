"""The Verifiers Taskset for ten Frontier-CS open-ended optimisation problems.

Each task is one problem. The subject reads the statement, writes one C++17 program to
``/app/solution.cpp`` in its container, and may compile and try it there. When the subject has
finished, the reward copies the problem's checker, its ten hidden tests and ``grade.py`` into that
same container and scores the program the way Frontier-CS's judge does: each test's score is the
checker's ratio from 0 to 1, and the task's score is their mean.

The tests reach the container only after the subject is done, so it never sees them. Scoring in
the container the subject used is a development Climb's accepted trade: a subject could tamper
with the compiler or Python there.

This module runs inside the managed engine, never in the ordinary Techtree environment.
"""

from __future__ import annotations

import io
import json
import tarfile
from collections.abc import Iterable
from dataclasses import dataclass
from importlib.resources import files
from importlib.resources.abc import Traversable
from typing import Final

import verifiers.v1 as vf
import yaml

__all__ = [
    "BASELINE_SCORES",
    "PROBLEMS",
    "SOLUTION_PATH",
    "CaseScore",
    "FrontierCsData",
    "FrontierCsTask",
    "FrontierCsTaskset",
]

SOLUTION_PATH: Final = "/app/solution.cpp"
WORKDIR: Final = "/app"

PROBLEMS: Final[tuple[tuple[int, str], ...]] = (
    (306, "Scorched Bridges Campaign"),
    (307, "Mobile Relay Layout"),
    (308, "Farmwide Teleport Pad Deployment"),
    (309, "Archipelago Relay Network Design"),
    (310, "Metallic Pink Resonator Layout"),
    (311, "Resonant Bay Layout"),
    (312, "Park Ranger Shift Balancing"),
    (313, "Duff's Defensive Lineup"),
    (314, "Prime Resonance Retuning"),
    (315, "Quadratic Witness Packing"),
)
"""The problems, in task order, with the title each statement opens with."""

BASELINE_SCORES: Final[dict[int, float]] = {
    306: 0.1,
    307: 0.5,
    308: 0.0,
    309: 0.2,
    310: 0.35,
    311: 0.5,
    312: 0.3651203,
    313: 0.5,
    314: 0.1,
    315: 0.1,
}
"""What ``solutions/<id>.cpp`` scores on each problem, exactly.

Each is the statement's own baseline, except 312's, whose baseline would print billions of
numbers; it sends one team along every trail instead. A baseline can score 0 on a test and still
be a valid answer the checker scored: 308's scores 0 everywhere by the statement's design.
"""

INSTRUCTIONS: Final = (
    "\n\n---\n\n"
    "Write your solution as one C++17 program at /app/solution.cpp. When you finish, it is "
    "compiled with `g++ -O2 -pipe -std=gnu++17` and run on 10 hidden tests under the time and "
    "memory limits above. Each test scores from 0 to 1, in proportion to the problem's own score "
    "for that test, and your result is the mean over the 10 tests. A program that does not "
    "compile, crashes, exits with a non-zero code, breaks a limit or prints an infeasible answer "
    "scores 0 on that test. g++ is installed here, so compile your program and try it on the "
    "example before you finish."
)
"""Added after every statement; it names the file the reward reads and how it is scored."""

TASK_NAME_TEMPLATE: Final = "frontier-cs-{problem_id}"
#: Ten tests at twice their time limit, ten checker runs and two compiles fit well inside this.
SCORING_TIMEOUT_SECONDS: Final = 900.0
_PACKAGE: Final = files("frontier_cs_open_ended_v1")


class FrontierCsData(vf.TaskData):
    """Wire data for one problem. The limits are the problem's own, from its configuration."""

    problem_id: int
    time_seconds: int
    memory_mib: int


class FrontierCsTask(vf.Task[FrontierCsData]):
    """One problem, scored in the subject's container after the subject has finished."""

    NEEDS_CONTAINER = True

    @vf.reward
    async def case_score_mean(self, trace: vf.Trace, runtime: vf.Runtime) -> float:
        """The mean of the checker's ratios over the ten tests for ``/app/solution.cpp``.

        Args:
            trace: The rollout trace; the program is read from the container, not the trace.
            runtime: The subject's container, as the subject left it.

        Returns:
            A score from 0 to 1.
        """
        del trace
        return _mean(await grade(runtime, self.data, SOLUTION_PATH))

    async def validate(self, runtime: vf.Runtime) -> bool:
        """Prove the problem scores submissions as recorded, without a model.

        Two conditions, both required. With no program at ``/app/solution.cpp``, no test reaches
        the checker and every test scores 0. The baseline program in ``solutions/`` has every
        answer scored by the checker as valid, and its mean is exactly what ``BASELINE_SCORES``
        records, which proves the checker compiles, reads the tests and scores as recorded.

        Args:
            runtime: A fresh container from the Campaign's subject image.

        Returns:
            True when both hold.
        """
        empty = await grade(runtime, self.data, SOLUTION_PATH)
        baseline_path = "/tmp/frontier-cs-baseline/solution.cpp"
        source = _PACKAGE / "solutions" / f"{self.data.problem_id}.cpp"
        await runtime.write(baseline_path, source.read_bytes())
        baseline = await grade(runtime, self.data, baseline_path)
        return (
            all(not case.scored and case.ratio == 0.0 for case in empty)
            and all(case.scored for case in baseline)
            and _mean(baseline) == BASELINE_SCORES[self.data.problem_id]
        )


class FrontierCsTaskset(vf.Taskset[FrontierCsTask, vf.TasksetConfig]):
    """The ten problems, one task each, in ``PROBLEMS`` order."""

    def load(self) -> Iterable[FrontierCsTask]:
        """Yield one task per problem, in the order the Campaign membership commits to.

        Yields:
            One :class:`FrontierCsTask` per problem.
        """
        for index, (problem_id, title) in enumerate(PROBLEMS):
            problem = _PACKAGE / "problems" / str(problem_id)
            statement = (problem / "statement.txt").read_text(encoding="utf-8")
            if f"# {title}\n" not in statement:
                raise ValueError(f"problem {problem_id}'s statement is not titled {title!r}")
            limits = _Limits.read(problem / "config.yaml")
            yield FrontierCsTask(
                FrontierCsData(
                    idx=index,
                    name=TASK_NAME_TEMPLATE.format(problem_id=problem_id),
                    prompt=statement.rstrip() + INSTRUCTIONS,
                    workdir=WORKDIR,
                    timeout=vf.TaskTimeout(scoring=SCORING_TIMEOUT_SECONDS),
                    problem_id=problem_id,
                    time_seconds=limits.time_seconds,
                    memory_mib=limits.memory_mib,
                ),
                self.config.task,
            )


@dataclass(frozen=True)
class _Limits:
    time_seconds: int
    memory_mib: int

    @classmethod
    def read(cls, config: Traversable) -> _Limits:
        """Read ``time: <n>s`` and ``memory: <n>m`` from a problem's configuration."""
        document = yaml.safe_load(config.read_text(encoding="utf-8"))
        time, memory = str(document["time"]), str(document["memory"])
        if not (time.endswith("s") and memory.endswith("m")):
            raise ValueError(f"unreadable limits in {config}: time {time!r}, memory {memory!r}")
        return cls(time_seconds=int(time[:-1]), memory_mib=int(memory[:-1]))


@dataclass(frozen=True)
class CaseScore:
    """One test: whether the checker scored the answer, and the ratio it gave."""

    scored: bool
    ratio: float


async def grade(runtime: vf.Runtime, data: FrontierCsData, solution: str) -> list[CaseScore]:
    """Score ``solution`` on every test in the container, in case order.

    Raises:
        RuntimeError: When the grader itself fails; a broken checker is never a score of 0.
    """
    made = await runtime.run(["mktemp", "-d"], {})
    if made.exit_code != 0:
        raise RuntimeError(f"no scratch directory in the container: {made.stderr.strip()}")
    root = made.stdout.strip()
    await runtime.write(f"{root}/bundle.tar", _bundle(data.problem_id))
    unpacked = await runtime.run(["tar", "-xf", f"{root}/bundle.tar", "-C", root], {})
    if unpacked.exit_code != 0:
        raise RuntimeError(f"the grading files did not unpack: {unpacked.stderr.strip()}")
    graded = await runtime.run(
        [
            "python3",
            f"{root}/grade.py",
            "--problem",
            f"{root}/problem",
            "--testlib",
            f"{root}/testlib",
            "--solution",
            solution,
            "--work",
            f"{root}/work",
            "--time-seconds",
            str(data.time_seconds),
            "--memory-mib",
            str(data.memory_mib),
        ],
        {},
    )
    if graded.exit_code != 0:
        raise RuntimeError(f"grading failed: {graded.stderr.strip()[-2000:]}")
    report = json.loads(graded.stdout)
    cases = [
        CaseScore(scored=bool(case["scored"]), ratio=float(case["ratio"]))
        for case in report["cases"]
    ]
    if not cases:
        raise RuntimeError(f"problem {data.problem_id} has no tests")
    return cases


def _bundle(problem_id: int) -> bytes:
    """The grader, testlib and one problem's checker and tests, as one tar archive."""
    problem = _PACKAGE / "problems" / str(problem_id)
    entries: list[tuple[str, bytes]] = [
        ("grade.py", (_PACKAGE / "grade.py").read_bytes()),
        ("testlib/testlib.h", (_PACKAGE / "problems" / "testlib.h").read_bytes()),
        ("problem/chk.cc", (problem / "chk.cc").read_bytes()),
    ]
    entries += [
        (f"problem/testdata/{test.name}", test.read_bytes())
        for test in sorted((problem / "testdata").iterdir(), key=lambda test: test.name)
    ]
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for name, content in entries:
            member = tarfile.TarInfo(name)
            member.size = len(content)
            member.mode = 0o644
            archive.addfile(member, io.BytesIO(content))
    return buffer.getvalue()


def _mean(cases: list[CaseScore]) -> float:
    """Sum in case order, then divide, as Frontier-CS's judge does."""
    return sum(case.ratio for case in cases) / len(cases)
