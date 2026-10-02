"""Copy the Tasksmith Climb's twelve tasks into the tasksmith engine's package, with provenance.

The source is HF FineEnvs/HF_ML_Tasksmith at the pinned revision, downloaded beforehand:

    hf download FineEnvs/HF_ML_Tasksmith --repo-type dataset --revision <REVISION> \\
        --local-dir <source> --include "tasks/tasksmith-<id>/*"

Each task folder is copied with only what the engine reads while it runs. The rest builds the
task's two images, which carry it: ``environment/`` is the agent image's build context and
``tests/Dockerfile`` with ``tests/source/`` the grader image's. One line changes: the engine
refuses ``user`` in ``[verifier]``, and both grader images already grade as root.
``provenance.json`` records, per task, the published ``bundle_hash``, the published task.toml's
digest, the packaged folder's digest and the exact change, so every packaged byte traces back to
the revision.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import tomllib
from pathlib import Path
from typing import Final

from build_engine_bundle import ENGINES_ROOT, package_source_digest

from regents_cli.techtree.fs import atomic_write_json

DATASET: Final = "FineEnvs/HF_ML_Tasksmith"
REVISION: Final = "3c63c8b059d734fe74f932101f44dd0b16e7ee26"

#: The six training tasks the Climb runs every round, then the six held-out tasks drawn with
#: seed techtree-tasksmith-held-out-2026-10-02.
TRAINING_TASKS: Final = (
    "tasksmith-0d2d1e298e86",
    "tasksmith-35c1a487454c",
    "tasksmith-7bc616ce49d7",
    "tasksmith-9f3fb07e5766",
    "tasksmith-c488fc138ba1",
    "tasksmith-ecb1931929df",
)
HELD_OUT_TASKS: Final = (
    "tasksmith-0df9b3cd6191",
    "tasksmith-0ea2241cceeb",
    "tasksmith-1c5704b1f07f",
    "tasksmith-5dd11b34cce1",
    "tasksmith-9aea936e30e4",
    "tasksmith-c98f3a4a299d",
)

PACKAGE_ROOT: Final = ENGINES_ROOT / "tasksmith/packages/hf-tasksmith-v1/hf_tasksmith_v1"
#: What the engine reads while a task runs: the rest of tests/ is copied into the grader box.
KEPT_TESTS: Final = ("contract.json", "grade.py", "test.sh", "test_driver.py", "test_results.py")
LEFT_OUT: Final = ("environment/", "tests/Dockerfile", "tests/source/")
DROPPED_LINE: Final = 'user = "root"'


def packaged_task_toml(published: str) -> tuple[str, int]:
    """The task.toml with `[verifier]`'s user line dropped, and that line's number."""
    lines = published.splitlines(keepends=True)
    section = ""
    for number, line in enumerate(lines, start=1):
        stripped = line.strip()
        if stripped.startswith("["):
            section = stripped
        elif section == "[verifier]" and stripped == DROPPED_LINE:
            return "".join(lines[: number - 1] + lines[number:]), number
    raise SystemExit(f"no {DROPPED_LINE!r} line in [verifier]")


def package_task(source: Path, task_id: str) -> dict[str, object]:
    """Copy one task in and return its provenance record."""
    published = source / "tasks" / task_id
    target = PACKAGE_ROOT / "tasks" / task_id
    if target.exists():
        raise SystemExit(f"{target} already exists; move the old package out first")
    task_toml = (published / "task.toml").read_bytes()
    toml, line = packaged_task_toml(task_toml.decode("utf-8"))
    (target / "tests").mkdir(parents=True)
    (target / "task.toml").write_text(toml, encoding="utf-8")
    shutil.copyfile(published / "instruction.md", target / "instruction.md")
    for name in KEPT_TESTS:
        shutil.copyfile(published / "tests" / name, target / "tests" / name)
    shutil.copytree(published / "solution", target / "solution")
    return {
        "task_id": task_id,
        "published_bundle_hash": tomllib.loads(task_toml.decode("utf-8"))["metadata"]["repo2env"][
            "bundle_hash"
        ],
        "published_task_toml_sha256": f"sha256:{hashlib.sha256(task_toml).hexdigest()}",
        "packaged_digest": package_source_digest(target),
        "changes": [f"task.toml: line {line}, {DROPPED_LINE!r} in [verifier], dropped"],
    }


def main() -> None:
    """Package every task and write provenance.json beside them."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", required=True, type=Path)
    source = parser.parse_args().source
    tasks = [package_task(source, task_id) for task_id in (*TRAINING_TASKS, *HELD_OUT_TASKS)]
    shutil.copyfile(source / "LICENSES.md", PACKAGE_ROOT / "LICENSES.md")
    atomic_write_json(
        PACKAGE_ROOT / "provenance.json",
        {
            "dataset": DATASET,
            "revision": REVISION,
            "left_out": list(LEFT_OUT),
            "left_out_reason": "build inputs of each task's agent and grader images, which "
            "carry them",
            "tasks": tasks,
        },
        mode=0o644,
    )
    for task in tasks:
        sys.stdout.write(f"{task['task_id']} {task['packaged_digest']}\n")


if __name__ == "__main__":
    main()
