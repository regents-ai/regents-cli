"""A private copy of one accepted collection, written into a new folder.

`forge export` verifies the collection first, then writes a folder holding exactly: each member's
task files under `tasks/`, copied entry by entry from its build's commitment without following a
link; `export.json`, the collection record and its acceptance with each member's build record and
qualification; and a short README. The Source Skill's bytes, the building and qualification logs,
and everything else in the home are never read. The folder is written beside its destination
under a hidden name, its files hashed again against the accepted digests, and only then renamed
into place; it is the owner's alone, and nothing is published.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from regents_cli.techtree.canonical import sha256_digest_bytes
from regents_cli.techtree.errors import ConflictError, NotFoundError, ValidationError
from regents_cli.techtree.forge.builds import read_build_status
from regents_cli.techtree.forge.collection import verify_collection
from regents_cli.techtree.forge.content import commit_task_set
from regents_cli.techtree.forge.models import (
    FORGE_EXPORT_SCHEMA_VERSION,
    TASK_KIND_WORDS,
    ForgeCollectionMember,
    ForgeCollectionRecord,
    ForgeExport,
    ForgeExportTask,
    TaskContentManifest,
)
from regents_cli.techtree.fs import (
    atomic_write_json,
    atomic_write_text,
    open_exclusive,
    remove_tree,
)
from regents_cli.techtree.paths import TechtreePaths

EXPORT_FILENAME: Final = "export.json"
README_FILENAME: Final = "README.md"
TASKS_DIRNAME: Final = "tasks"


def export_collection(paths: TechtreePaths, collection_id: str, destination: Path) -> ForgeExport:
    """Write a checked private copy of an accepted collection into a new folder."""
    status = verify_collection(paths, collection_id)
    assert status.acceptance is not None  # a verified collection was accepted
    destination = destination.expanduser().absolute()
    if destination.exists() or destination.is_symlink():
        raise ConflictError(
            f"{destination} already exists; an export is written to a new folder",
            code="forge_export_exists",
            details={"path": str(destination)},
        )
    if not destination.parent.is_dir():
        raise NotFoundError(
            f"there is no folder {destination.parent} to write the export in",
            code="forge_export_no_folder",
            details={"path": str(destination.parent)},
        )
    members = status.record.review.members
    staging = Path(
        tempfile.mkdtemp(dir=destination.parent, prefix=f".{destination.name}.", suffix=".partial")
    )
    try:
        (staging / TASKS_DIRNAME).mkdir(mode=0o700)
        tasks = [_export_task(paths, member, staging / TASKS_DIRNAME) for member in members]
        copied = commit_task_set(staging / TASKS_DIRNAME, [member.task_id for member in members])
        for member, found in zip(members, copied.tasks, strict=True):
            if found.content_digest != member.content_digest:
                raise ValidationError(
                    f"task {member.task_name} changed while it was copied; export again",
                    code="forge_export_changed",
                    details={"task_id": member.task_id},
                )
        readme = _readme(status.record)
        export = ForgeExport(
            schema_version=FORGE_EXPORT_SCHEMA_VERSION,
            exported_at=datetime.now(UTC),
            collection=status.record,
            acceptance=status.acceptance,
            tasks=tasks,
            readme_digest=sha256_digest_bytes(readme.encode()),
        )
        atomic_write_json(staging / EXPORT_FILENAME, export)
        atomic_write_text(staging / README_FILENAME, readme)
        staging.rename(destination)
    except BaseException:
        remove_tree(staging)
        raise
    return export


def _export_task(
    paths: TechtreePaths, member: ForgeCollectionMember, tasks_dir: Path
) -> ForgeExportTask:
    status = read_build_status(paths, member.build_id)
    assert status.qualification is not None  # a verified member qualified
    [manifest] = status.build.task_set.tasks
    _copy(Path(status.tasks_path) / member.task_id, tasks_dir / member.task_id, manifest)
    evidence = next(task for task in status.qualification.tasks if task.task_id == member.task_id)
    return ForgeExportTask(build=status.build, qualification=evidence)


def _copy(source: Path, target: Path, manifest: TaskContentManifest) -> None:
    """Copy exactly the committed entries, never following a link."""
    target.mkdir(mode=0o700)
    for entry in manifest.entries:
        if entry.kind == "directory":
            (target / entry.path).mkdir(mode=0o700)
            continue
        descriptor = os.open(source / entry.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        with (
            os.fdopen(descriptor, "rb") as reader,
            open_exclusive(target / entry.path, 0o700 if entry.executable else 0o600) as writer,
        ):
            shutil.copyfileobj(reader, writer)


def _readme(record: ForgeCollectionRecord) -> str:
    """What the folder holds, and the fingerprints its reader can match against the sender's."""
    review = record.review
    return "\n".join(
        [
            f"# Collection {record.collection_id}",
            "",
            "A private copy of one accepted collection of tasks, made by Techtree. Nothing in it "
            "has been published.",
            "",
            f"- The collection's fingerprint is `{record.collection_digest}`. This is the same "
            "collection only if it matches the one the sender gave you.",
            f"- The tasks were written from the Skill {review.source_name}, whose fingerprint is "
            f"`{review.source_digest}`. Its text is not included.",
            "",
            "## What it holds",
            "",
            *(
                f"- `{TASKS_DIRNAME}/{member.task_id}/`: {member.task_name}, a "
                f"{TASK_KIND_WORDS[member.kind]} for claim {member.claim}"
                + (", held out" if member.part == "held_out" else "")
                for member in review.members
            ),
            f"- `{EXPORT_FILENAME}`: the collection's records, its acceptance, and each task's "
            "build and qualification records.",
            "",
            "Each task's folder holds its instruction, the files it starts from, its tests and "
            "its reference solutions, so anyone with this folder can read the answers. Give it "
            "only to people who check the tasks, never to an agent being tested on them.",
            "",
            "You can read the tasks here; Techtree has no command that runs them from this folder.",
            "",
        ]
    )
