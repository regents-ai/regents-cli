"""Build and push each Tasksmith task's agent and grader images, and write the pins they produced.

For each task, from its folder as published at HF FineEnvs/HF_ML_Tasksmith (see
package_tasksmith.py for the download):

- the agent image is the task's own ``environment/Dockerfile`` with
  ``tasksmith-image/agent-layer.Dockerfile`` appended, built in ``environment/``;
- the grader image is the task's own ``tests/Dockerfile``, built in ``tests/``.

Both are pushed for every platform asked for, and the pins file maps each task to its two
digest-pinned references and their per-platform manifest digests. build_fixture_catalog.py reads
that file into the Tasksmith Campaigns, so pushing changes nothing until the catalog is rebuilt.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Final

from package_tasksmith import HELD_OUT_TASKS, TRAINING_TASKS

from regents_cli.techtree.fs import atomic_write_json

AGENT_LAYER: Final = Path(__file__).resolve().parent / "tasksmith-image/agent-layer.Dockerfile"
DEFAULT_REPOSITORY: Final = "ghcr.io/regents-ai/techtree-tasksmith"
DEFAULT_PLATFORMS: Final = ("linux/amd64", "linux/arm64")
HERMES_TAG: Final = "hermes-v2026.9.24"


def build(
    *, dockerfile: Path, context: Path, reference: str, platforms: list[str], work: Path
) -> str:
    """Build and push one image; return the digest the registry gave it."""
    metadata = work / "metadata.json"
    subprocess.run(
        [
            "docker",
            "buildx",
            "build",
            "--file",
            str(dockerfile),
            "--platform",
            ",".join(platforms),
            "--provenance=false",
            "--sbom=false",
            "--push",
            "--metadata-file",
            str(metadata),
            "--tag",
            reference,
            str(context),
        ],
        check=True,
        stdin=subprocess.DEVNULL,
    )
    return str(json.loads(metadata.read_text(encoding="utf-8"))["containerimage.digest"])


def platform_digests(pinned: str, platforms: list[str]) -> dict[str, str]:
    """Each platform's manifest digest under a pushed reference.

    A build for one platform is pushed as that platform's manifest itself, not an index of one.
    """
    if len(platforms) == 1:
        return {platforms[0]: pinned.rsplit("@", 1)[1]}
    raw = subprocess.run(
        ["docker", "buildx", "imagetools", "inspect", "--raw", pinned],
        check=True,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
    ).stdout
    document = json.loads(raw)
    found = {
        f"{entry['platform']['os']}/{entry['platform']['architecture']}": entry["digest"]
        for entry in document["manifests"]
    }
    if sorted(found) != sorted(platforms):
        raise SystemExit(f"{pinned} holds {sorted(found)}, not {sorted(platforms)}")
    return found


def pin(reference: str, digest: str, platforms: list[str]) -> dict[str, object]:
    repository = reference.rsplit(":", 1)[0]
    pinned = f"{repository}@{digest}"
    return {"image": pinned, "platform_digests": platform_digests(pinned, platforms)}


def build_task(
    source: Path, task_id: str, repository: str, platforms: list[str]
) -> dict[str, object]:
    """Build and push one task's two images and return their pins."""
    published = source / "tasks" / task_id
    with tempfile.TemporaryDirectory(prefix="techtree-tasksmith-image-") as directory:
        work = Path(directory)
        dockerfile = work / "agent.Dockerfile"
        dockerfile.write_text(
            (published / "environment/Dockerfile").read_text(encoding="utf-8")
            + "\n"
            + AGENT_LAYER.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        agent = f"{repository}:{task_id}-agent-{HERMES_TAG}"
        grader = f"{repository}:{task_id}-grader"
        agent_digest = build(
            dockerfile=dockerfile,
            context=published / "environment",
            reference=agent,
            platforms=platforms,
            work=work,
        )
        grader_digest = build(
            dockerfile=published / "tests/Dockerfile",
            context=published / "tests",
            reference=grader,
            platforms=platforms,
            work=work,
        )
    return {
        "agent": pin(agent, agent_digest, platforms),
        "grader": pin(grader, grader_digest, platforms),
    }


def main() -> None:
    """Build every task asked for and write the pins file."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--pins", required=True, type=Path)
    parser.add_argument("--repository", default=DEFAULT_REPOSITORY)
    parser.add_argument("--platform", action="append", dest="platforms")
    parser.add_argument("--task", action="append", dest="tasks")
    arguments = parser.parse_args()
    platforms = sorted(arguments.platforms or DEFAULT_PLATFORMS)
    tasks = arguments.tasks or [*TRAINING_TASKS, *HELD_OUT_TASKS]
    pins = {
        task_id: build_task(arguments.source, task_id, arguments.repository, platforms)
        for task_id in tasks
    }
    atomic_write_json(arguments.pins, pins, mode=0o644)
    for task_id, images in pins.items():
        sys.stdout.write(f"{task_id} {json.dumps(images, sort_keys=True)}\n")


if __name__ == "__main__":
    main()
