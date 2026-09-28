"""A build: one task package committed byte for byte, its base images pulled, and qualified.

A package gets to a build's `tasks/` folder one of two ways: construction writes the creator's
answer there itself, or a person's hand-corrected copy is admitted into it
(`skill2env.admit`). From there both go the same way.
"""

from __future__ import annotations

import platform
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from regents_cli.techtree.errors import RunError, TechtreeError
from regents_cli.techtree.forge import docker
from regents_cli.techtree.forge.content import commit_task_set
from regents_cli.techtree.forge.models import (
    FORGE_BUILD_SCHEMA_VERSION,
    ForgeBaseImage,
    ForgeBuildRecord,
    ForgeBuildStatus,
    ForgePlatform,
    ForgeQualification,
)
from regents_cli.techtree.forge.qualify import qualify_build
from regents_cli.techtree.forge.records import inspect_command, read_optional, read_record
from regents_cli.techtree.forge.report import task_verdict
from regents_cli.techtree.forge.skill2env import skill_source
from regents_cli.techtree.fs import atomic_write_json
from regents_cli.techtree.ids import validate_id
from regents_cli.techtree.models.engine import normalize_host_platform
from regents_cli.techtree.paths import TechtreePaths

BUILD_FILENAME: Final = "build.json"
QUALIFICATION_FILENAME: Final = "qualification.json"
TASKS_DIRNAME: Final = "tasks"


def host_docker_platform() -> ForgePlatform:
    """The Docker platform matching this machine's architecture."""
    host = normalize_host_platform(sys.platform, platform.machine())
    return "linux/arm64" if host.endswith("/arm64") else "linux/amd64"


def package_dir(paths: TechtreePaths, build_id: str, package_name: str) -> Path:
    """Where a build's one package lives."""
    return paths.forge_build_dir(build_id) / TASKS_DIRNAME / package_name


def qualify_package(
    paths: TechtreePaths,
    build_id: str,
    package_name: str,
    *,
    bases: tuple[str, ...],
    source_digest: str,
    platform: ForgePlatform,
) -> ForgeBuildStatus:
    """Commit the package, pull its bases by digest, write the build record and qualify it.

    Any failure, Ctrl-C included, is raised as a `RunError` naming the build; so is a package
    that did not qualify.
    """
    build_dir = paths.forge_build_dir(build_id)
    try:
        task_set = commit_task_set(build_dir / TASKS_DIRNAME, [package_name])
        docker.require_daemon()
        record = ForgeBuildRecord(
            schema_version=FORGE_BUILD_SCHEMA_VERSION,
            build_id=build_id,
            created_at=datetime.now(UTC),
            source=skill_source(
                source_digest,
                [
                    ForgeBaseImage(
                        reference=reference, image_id=docker.pull_pinned(reference, platform)
                    )
                    for reference in bases
                ],
            ),
            platform=platform,
            task_set=task_set,
        )
        atomic_write_json(build_dir / BUILD_FILENAME, record)
        qualification = qualify_build(
            build=record,
            tasks_dir=build_dir / TASKS_DIRNAME,
            work_dir=build_dir / "qualification",
        )
        atomic_write_json(build_dir / QUALIFICATION_FILENAME, qualification)
    except (Exception, KeyboardInterrupt) as error:
        if isinstance(error, KeyboardInterrupt):
            code, message = "forge_build_cancelled", "build cancelled by Ctrl-C"
        elif isinstance(error, TechtreeError):
            code, message = error.code, error.message
        else:
            code = "forge_build_failed"
            message = f"unexpected {type(error).__name__}; inspect the build logs"
        raise RunError(
            f"{message}. Inspect: {inspect_command(build_id)}",
            code=code,
            details={"build_id": build_id, "path": str(build_dir)},
        ) from error
    if not qualification.qualified_task_ids:
        raise RunError(
            "Qualification finished with no usable task. "
            + "; ".join(task_verdict(task) for task in qualification.tasks)
            + f". Inspect: {inspect_command(build_id)}",
            code="forge_no_usable_tasks",
            details={"build_id": build_id, "path": str(build_dir), "usable_tasks": 0},
        )
    return read_build_status(paths, build_id)


def read_build_record(paths: TechtreePaths, build_id: str) -> ForgeBuildRecord | None:
    """A build's record, or None when it failed before one was written."""
    return read_optional(
        ForgeBuildRecord,
        paths.forge_build_dir(build_id) / BUILD_FILENAME,
        details={"build_id": build_id},
    )


def read_build_status(paths: TechtreePaths, build_id: str) -> ForgeBuildStatus:
    """A build's record, and its qualification once that finished."""
    build_dir = paths.forge_build_dir(validate_id(build_id, "build"))
    details = {"build_id": build_id, "path": str(build_dir)}
    return ForgeBuildStatus(
        build_id=build_id,
        path=str(build_dir),
        tasks_path=str(build_dir / TASKS_DIRNAME),
        build=read_record(
            ForgeBuildRecord,
            build_dir / BUILD_FILENAME,
            missing=f"no recorded forge build {build_id}",
            code="forge_build_not_found",
            details=details,
        ),
        qualification=read_optional(
            ForgeQualification, build_dir / QUALIFICATION_FILENAME, details=details
        ),
    )
