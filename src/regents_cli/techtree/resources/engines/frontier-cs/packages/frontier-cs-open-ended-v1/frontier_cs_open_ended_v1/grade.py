"""Score one C++ submission to one problem the way Frontier-CS's judge scores it.

This script runs inside the subject's container, after the subject has finished, with only the
standard library. The reward copies it there beside one problem's checker and tests. Every limit
and every rule below is taken from Frontier-CS commit dc91d8e, `algorithmic/judge/src/gojudge.js`
and `judge_engine.js`:

- The submission is compiled with `g++ main.cpp -O2 -pipe -std=gnu++17 -o a` inside 10 s of CPU.
  If it does not compile, every test scores 0.
- The checker is compiled with `-I` pointing at testlib. A checker that does not compile is a
  broken problem, not a bad submission, so the script fails instead of scoring.
- Each test runs the program with the test's input on stdin, under the problem's CPU time, twice
  that of wall time, the problem's memory as its address-space and stack limit, 128 processes,
  128 MiB of stdout and 64 MiB of stderr. A run that breaks a limit, dies on a signal or exits
  non-zero scores 0 and the checker never sees it.
- The checker runs as `chk in.txt out.txt ans.txt` under 10 s of CPU, 20 s of wall time and
  256 MiB. Its message is its stdout, or its stderr when stdout is empty. When it exits 0 or 7 on
  its own, the first `Ratio: <number>` in that message is the test's score; with no ratio, exit 0
  scores 1 and exit 7 scores 0. Any other ending scores 0. Only the checker's words are read, so a
  program cannot print its own ratio.

It prints one JSON object: whether the submission compiled and, per test in case order, how the
run ended, whether the checker scored the answer (exit 0 or 7 on its own) and what it scored. The
reward averages the scores.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import resource
import shutil
import signal
import subprocess
import sys
import threading
from pathlib import Path

PATH_ONLY = {"PATH": "/usr/bin:/bin"}
MIB = 1024 * 1024

COMPILE_CPU_SECONDS = 10
CHECKER_COMPILE_CPU_SECONDS = 30
#: gojudge sets no wall limit on compiles; this only stops a hung compiler holding scoring open.
COMPILE_WALL_SECONDS = 120

STDOUT_LIMIT = 128 * MIB
STDERR_LIMIT = 64 * MIB
PROCESS_LIMIT = 128

CHECKER_CPU_SECONDS = 10
CHECKER_WALL_SECONDS = 20
CHECKER_MEMORY = 256 * MIB
CHECKER_MESSAGE_LIMIT = 1 * MIB

TESTLIB_OK = 0
TESTLIB_POINTS = 7
RATIO = re.compile(r"Ratio: ([\d.]+)")
#: JavaScript's parseFloat over a run of digits and dots reads the longest leading number.
LEADING_NUMBER = re.compile(r"\d+(?:\.\d*)?|\.\d+")
#: How much of a message the report keeps; enough to see why a test scored what it did.
REPORTED_MESSAGE = 400


class Ended:
    """How one sandboxed process ended, named the way gojudge names it."""

    def __init__(self, status: str, exit_code: int | None) -> None:
        self.status = status
        self.exit_code = exit_code


def main() -> None:
    """Compile, run every test, check every output, print the report."""
    arguments = parse_args()
    problem = arguments.problem
    work = Path(arguments.work)
    checker = compile_checker(problem, arguments.testlib, work / "checker")
    program = compile_submission(arguments.solution, work / "build")
    cases = sorted(
        (path.stem for path in (problem / "testdata").glob("*.in")), key=lambda stem: int(stem)
    )
    results = []
    for case in cases:
        if program is None:
            results.append(_unscored(case, "Compile Error"))
            continue
        results.append(
            judge_case(
                program,
                checker,
                problem / "testdata",
                case,
                work / "cases" / case,
                cpu_seconds=arguments.time_seconds,
                memory=arguments.memory_mib * MIB,
            )
        )
    sys.stdout.write(json.dumps({"compiled": program is not None, "cases": results}))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Score one Frontier-CS submission.")
    parser.add_argument("--problem", required=True, type=Path)
    parser.add_argument("--testlib", required=True, type=Path)
    parser.add_argument("--solution", required=True, type=Path)
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--time-seconds", required=True, type=int)
    parser.add_argument("--memory-mib", required=True, type=int)
    return parser.parse_args()


def compile_checker(problem: Path, testlib: Path, directory: Path) -> Path:
    directory.mkdir(parents=True)
    shutil.copyfile(problem / "chk.cc", directory / "chk.cc")
    ended = run(
        ["/usr/bin/g++", "chk.cc", "-O2", "-pipe", "-std=gnu++17", "-I", str(testlib), "-o", "chk"],
        cwd=directory,
        cpu_seconds=CHECKER_COMPILE_CPU_SECONDS,
        wall_seconds=COMPILE_WALL_SECONDS,
    )
    if ended.status != "Accepted":
        raise SystemExit(f"the checker for {problem.name} did not compile: {ended.status}")
    return directory / "chk"


def compile_submission(solution: Path, directory: Path) -> Path | None:
    """The compiled program, or None when there is no source or it does not compile."""
    directory.mkdir(parents=True)
    if not solution.is_file():
        return None
    # A copy, so what is judged is what existed when scoring began.
    shutil.copyfile(solution, directory / "main.cpp")
    ended = run(
        ["/usr/bin/g++", "main.cpp", "-O2", "-pipe", "-std=gnu++17", "-o", "a"],
        cwd=directory,
        cpu_seconds=COMPILE_CPU_SECONDS,
        wall_seconds=COMPILE_WALL_SECONDS,
    )
    return directory / "a" if ended.status == "Accepted" else None


def judge_case(
    program: Path,
    checker: Path,
    testdata: Path,
    case: str,
    directory: Path,
    *,
    cpu_seconds: int,
    memory: int,
) -> dict[str, object]:
    sandbox = directory / "run"
    sandbox.mkdir(parents=True)
    shutil.copyfile(program, sandbox / "a")
    os.chmod(sandbox / "a", 0o755)
    stdout_path = directory / "out.txt"
    stderr_path = directory / "stderr.txt"
    with (
        (testdata / f"{case}.in").open("rb") as stdin,
        stdout_path.open("wb") as stdout,
        stderr_path.open("wb") as stderr,
    ):
        ended = run(
            ["./a"],
            cwd=sandbox,
            cpu_seconds=cpu_seconds,
            wall_seconds=2 * cpu_seconds,
            memory=memory,
            address_space=True,
            file_size=STDOUT_LIMIT,
            stdin=stdin,
            stdout=stdout,
            stderr=stderr,
        )
    if ended.status == "Accepted" and stderr_path.stat().st_size > STDERR_LIMIT:
        ended = Ended("Output Limit Exceeded", ended.exit_code)
    if ended.status != "Accepted":
        return _unscored(case, ended.status)

    shutil.copyfile(testdata / f"{case}.in", directory / "in.txt")
    shutil.copyfile(testdata / f"{case}.ans", directory / "ans.txt")
    checked = subprocess_capture(
        [str(checker), "in.txt", "out.txt", "ans.txt"],
        cwd=directory,
        cpu_seconds=CHECKER_CPU_SECONDS,
        wall_seconds=CHECKER_WALL_SECONDS,
        memory=CHECKER_MEMORY,
    )
    verdict, stdout_text, stderr_text = checked
    message = stdout_text or stderr_text
    scoring = verdict.status in ("Accepted", "Nonzero Exit Status") and verdict.exit_code in (
        TESTLIB_OK,
        TESTLIB_POINTS,
    )
    ok = verdict.status == "Accepted" and verdict.exit_code == TESTLIB_OK
    ratio = parse_ratio(message) if scoring else None
    return {
        "case": case,
        "status": "Accepted" if ok else "Wrong Answer",
        "scored": scoring,
        "ratio": ratio if ratio is not None else (1.0 if ok else 0.0),
        "message": message[:REPORTED_MESSAGE],
    }


def _unscored(case: str, status: str) -> dict[str, object]:
    """A test whose answer never reached the checker."""
    return {"case": case, "status": status, "scored": False, "ratio": 0.0, "message": ""}


def parse_ratio(message: str) -> float | None:
    found = RATIO.search(message)
    if found is None:
        return None
    number = LEADING_NUMBER.match(found.group(1))
    return float(number.group()) if number is not None else None


def subprocess_capture(
    argv: list[str], *, cwd: Path, cpu_seconds: int, wall_seconds: int, memory: int
) -> tuple[Ended, str, str]:
    """Run the checker with empty stdin, keeping at most 1 MiB of each output stream."""
    stdout_path = cwd / "checker.stdout"
    stderr_path = cwd / "checker.stderr"
    with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        ended = run(
            argv,
            cwd=cwd,
            cpu_seconds=cpu_seconds,
            wall_seconds=wall_seconds,
            memory=memory,
            stdout=stdout,
            stderr=stderr,
        )
    return (
        ended,
        _read_text(stdout_path, CHECKER_MESSAGE_LIMIT),
        _read_text(stderr_path, CHECKER_MESSAGE_LIMIT),
    )


def run(
    argv: list[str],
    *,
    cwd: Path,
    cpu_seconds: int,
    wall_seconds: int,
    memory: int | None = None,
    address_space: bool = False,
    file_size: int | None = None,
    stdin: object = subprocess.DEVNULL,
    stdout: object = subprocess.DEVNULL,
    stderr: object = subprocess.DEVNULL,
) -> Ended:
    """Run one process under gojudge-style limits and name how it ended.

    CPU, processes, file size and (for the program) address space and stack are kernel limits.
    Memory is also checked afterwards from the process's own peak resident size, which is what
    gojudge's cgroup limit measures. Wall time is a timer that kills the process group.
    """

    def limit() -> None:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
        resource.setrlimit(resource.RLIMIT_NPROC, (PROCESS_LIMIT, PROCESS_LIMIT))
        if file_size is not None:
            resource.setrlimit(resource.RLIMIT_FSIZE, (file_size, file_size))
        if address_space and memory is not None:
            resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
            resource.setrlimit(resource.RLIMIT_STACK, (memory, memory))

    # The limits are set between fork and exec. That is safe because no other thread is alive
    # here: each run joins its wall-time timer before returning.
    process = subprocess.Popen(
        argv,
        cwd=cwd,
        env=PATH_ONLY,
        stdin=stdin,
        stdout=stdout,
        stderr=stderr,
        preexec_fn=limit,  # noqa: PLW1509
        start_new_session=True,
    )
    timed_out = threading.Event()

    def kill_group() -> None:
        timed_out.set()
        _kill_group(process.pid)

    timer = threading.Timer(wall_seconds, kill_group)
    timer.start()
    try:
        # wait4 reports this process's own usage, not every child this script has had.
        _, status, usage = os.wait4(process.pid, 0)
    finally:
        timer.cancel()
        timer.join()
        # Anything the process left running in its group goes with it.
        _kill_group(process.pid)
    process.returncode = os.waitstatus_to_exitcode(status)
    returncode = process.returncode
    if timed_out.is_set():
        return Ended("Time Limit Exceeded", None)
    if usage.ru_utime + usage.ru_stime > cpu_seconds or returncode == -signal.SIGXCPU:
        return Ended("Time Limit Exceeded", None)
    # ru_maxrss is in KiB on Linux.
    if memory is not None and usage.ru_maxrss * 1024 > memory:
        return Ended("Memory Limit Exceeded", None)
    if returncode == -signal.SIGXFSZ:
        return Ended("Output Limit Exceeded", None)
    if returncode < 0:
        return Ended("Signalled", None)
    if returncode != 0:
        return Ended("Nonzero Exit Status", returncode)
    return Ended("Accepted", 0)


def _kill_group(pid: int) -> None:
    with contextlib.suppress(ProcessLookupError):
        os.killpg(pid, signal.SIGKILL)


def _read_text(path: Path, limit: int) -> str:
    with path.open("rb") as handle:
        return handle.read(limit).decode("utf-8", errors="replace")


if __name__ == "__main__":
    main()
