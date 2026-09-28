"""Skill2Env as Techtree pins it: its resources, the rules every task package keeps, and inert
admission of a person's hand-corrected package.

Only the host-authored, single-task Harbor 1.4 shape is supported, and no upstream launcher,
model, Docker command, credential resolution or dependency is used. The recipe's external base
images must be on the release allow-list (`resources/forge/skill2env/base-images.json`) by exact
name and digest; they are pulled by digest and the recipe is built with the network off.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import stat
import tomllib
import unicodedata
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path, PurePosixPath
from typing import Any, Final

from pydantic import TypeAdapter

from regents_cli.techtree.canonical import sha256_digest_bytes
from regents_cli.techtree.errors import RunError
from regents_cli.techtree.forge.content import commit_task_set, stat_signature
from regents_cli.techtree.forge.models import (
    BASE_IMAGE_REFERENCE,
    ForgeBaseImage,
    ForgePlatform,
    ForgeSkillSource,
    TaskContentEntry,
)

MAX_TASK_BYTES: Final = 128 * 1024 * 1024
MAX_TASK_ENTRIES: Final = 4096
MAX_TASK_DEPTH: Final = 32
_DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
#: Names a task may not carry because the task's own integrity depends on them:
#: the Skill under test, the agent's standing instructions, the creator's own
#: record, and the reward the tests alone may write.
_PRIVATE_NAMES: Final = frozenset(
    {
        "skill.md",
        "agents.md",
        "skill-card.md",
        "creator-result.json",
        "creator-transcript.jsonl",
        "creator-prompt.md",
        "reward.txt",
        "reward.json",
    }
)
#: Where a package's files may be.
_ROOTS: Final = frozenset({"instruction.md", "task.toml", "environment", "tests", "solution"})
#: Names the build context may not carry: they would change how the task is built or leak
#: what only the tests and the reference may hold.
_PRIVILEGED: Final = frozenset(
    {
        "docker-compose.yaml",
        "docker-compose.yml",
        "compose.yaml",
        "compose.yml",
        "instruction.md",
        "task.toml",
        "tests",
        "solution",
        "rubric.md",
    }
)


def resource(name: str) -> bytes:
    """One file of the pinned Skill2Env resources, as released."""
    return (files("regents_cli.techtree") / "resources" / "forge" / "skill2env" / name).read_bytes()


def contract() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(resource("contract.json"))
    return loaded


def local_source_skill(name: str) -> str:
    """The Source Skill identity a package written from a Skill named `name` on this computer
    carries in `task.toml`."""
    return f"local/{name}"


def skill_source(source_digest: str, base_images: list[ForgeBaseImage]) -> ForgeSkillSource:
    """The provenance a build of one package records: the Skill, the pinned recipe, its bases."""
    pinned = contract()
    return ForgeSkillSource(
        kind="skill",
        source_skill_digest=source_digest,
        recipe="skill2env",
        recipe_version=sha256_digest_bytes(resource("contract.json")),
        producer="skill2env",
        producer_version=pinned["producer_version"],
        upstream_url=pinned["upstream_url"],
        upstream_revision=pinned["upstream_revision"],
        harbor_version=pinned["harbor_version"],
        base_images=base_images,
    )


def check_members(entries: Mapping[str, bytes | None], source_digest: str) -> None:
    """Raise `ValueError` for a package member no task may have.

    `entries` maps each path to its bytes, or None for a folder.
    """
    provenance = source_digest.removeprefix("sha256:").encode()
    for path, data in entries.items():
        parts = path.split("/")
        if path == "rubric.md":
            raise ValueError("root rubric.md is unsupported; use tests/rubric.md")
        if parts[0] not in _ROOTS:
            raise ValueError(f"unsupported task root member: {path}")
        if any(_private(part) for part in parts):
            raise ValueError(f"private or hidden task material: {path}")
        if data is not None and path != "task.toml" and provenance in data:
            raise ValueError(f"private source provenance in task material: {path}")
        if parts[0] == "environment" and parts[-1].casefold() in _PRIVILEGED:
            raise ValueError(f"unsupported or privileged build context material: {path}")


def _private(name: str) -> bool:
    return name.startswith(".") or name.casefold() in _PRIVATE_NAMES


@dataclass(frozen=True)
class _Entry:
    data: bytes | None
    executable: bool


def _snapshot(root: Path) -> dict[str, _Entry]:
    """Read bounded regular bytes through held, no-follow directory handles."""
    entries: dict[str, _Entry] = {}
    names_seen: set[str] = set()
    total = 0

    def walk(directory: int, prefix: str, depth: int) -> None:
        nonlocal total
        if depth > MAX_TASK_DEPTH:
            raise ValueError(f"task exceeds directory depth limit at {prefix}")
        before = os.fstat(directory)
        names = sorted(os.listdir(directory))
        if len(names) > MAX_TASK_ENTRIES - len(entries):
            raise ValueError(f"too many task entries at {prefix or '.'}")
        for name in names:
            relative = prefix + name
            TaskContentEntry.validate_path(relative)
            key = unicodedata.normalize("NFC", relative).casefold()
            if key in names_seen or len(entries) >= MAX_TASK_ENTRIES:
                raise ValueError(f"duplicate/case-colliding path or too many entries: {relative}")
            names_seen.add(key)
            # Refuse hidden and reserved names before opening their contents.
            if _private(name):
                raise ValueError(f"private or hidden task material: {relative}")
            info = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                child = os.open(name, _DIRECTORY_FLAGS, dir_fd=directory)
                try:
                    if stat_signature(info) != stat_signature(os.fstat(child)):
                        raise ValueError(f"directory changed: {relative}")
                    entries[relative] = _Entry(None, bool(info.st_mode & stat.S_IXUSR))
                    walk(child, relative + "/", depth + 1)
                finally:
                    os.close(child)
            elif stat.S_ISREG(info.st_mode):
                if info.st_size > MAX_TASK_BYTES - total:
                    raise ValueError(f"task exceeds 128 MiB limit: {relative}")
                fd = os.open(
                    name,
                    os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                    dir_fd=directory,
                )
                with os.fdopen(fd, "rb") as stream:
                    if stat_signature(info) != stat_signature(os.fstat(stream.fileno())):
                        raise ValueError(f"file changed before reading: {relative}")
                    data = stream.read(MAX_TASK_BYTES - total + 1)
                    if len(data) != info.st_size or stat_signature(info) != stat_signature(
                        os.fstat(stream.fileno())
                    ):
                        raise ValueError(f"file changed while reading: {relative}")
                total += len(data)
                entries[relative] = _Entry(data, bool(info.st_mode & stat.S_IXUSR))
            else:
                raise ValueError(f"symlink or special file: {relative}")
        if names != sorted(os.listdir(directory)) or stat_signature(before) != stat_signature(
            os.fstat(directory)
        ):
            raise ValueError(f"directory changed while reading: {prefix or '.'}")

    descriptor = os.open(root, _DIRECTORY_FLAGS)
    try:
        walk(descriptor, "", 0)
    finally:
        os.close(descriptor)
    return entries


def _text(entries: dict[str, _Entry], path: str) -> str:
    entry = entries.get(path)
    if entry is None or entry.data is None:
        raise ValueError(f"required regular file missing: {path}")
    try:
        return entry.data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError(f"required UTF-8 file is invalid: {path}") from error


def _config(
    text: str, task_name: str, source_skill: str, digest: str, contract: dict[str, Any]
) -> dict[str, str]:
    """Validate ``task.toml`` and return the base image pins it declares."""
    config = tomllib.loads(text)
    if set(config) != {
        "schema_version",
        "artifacts",
        "task",
        "metadata",
        *contract["fixed_sections"],
    }:
        raise ValueError("task.toml requires exactly the pinned single-task sections")
    if config["schema_version"] != contract["task_schema"]:
        raise ValueError(f"task.toml requires Harbor schema {contract['task_schema']}")
    for section, expected in contract["fixed_sections"].items():
        if config[section] != expected:
            raise ValueError(f"task.toml [{section}] differs from the pinned offline contract")
    task = config["task"]
    if (
        not isinstance(task, dict)
        or set(task) != {"name", "description", "authors", "keywords"}
        or task["name"] != f"skill2env/{task_name}"
        or task["authors"] != [{"name": "skill2env"}]
        or not isinstance(task["description"], str)
        or not task["description"].strip()
        or not isinstance(task["keywords"], list)
        or not task["keywords"]
        or any(not isinstance(word, str) or not word.strip() for word in task["keywords"])
    ):
        raise ValueError("task.toml [task] must identify the authoritative Skill2Env package")
    metadata = config["metadata"]
    axes = {
        "archetype",
        "primary_verifier_pattern",
        "complexity",
        "persona",
        "tone",
        "expertise",
    }
    if (
        not isinstance(metadata, dict)
        or set(metadata) - {"source_skill", "source_bundle_digest", "base_image_pins", *axes}
        or metadata.get("source_skill") != source_skill
        or metadata.get("source_bundle_digest") != digest
    ):
        raise ValueError(
            "task.toml Source Skill identity or bundle digest does not match expected provenance"
        )
    for key in axes & metadata.keys():
        if not isinstance(metadata[key], str) or not metadata[key].strip():
            raise ValueError(f"task.toml metadata.{key} must be a nonempty string")
    pins = metadata.get("base_image_pins", {})
    if not isinstance(pins, dict) or any(
        not isinstance(key, str)
        or not isinstance(value, str)
        or not re.fullmatch(r"sha256:[0-9a-f]{64}", value)
        for key, value in pins.items()
    ):
        raise ValueError("task.toml metadata.base_image_pins is invalid")
    artifacts = config["artifacts"]
    if not isinstance(artifacts, list) or not artifacts:
        raise ValueError("task.toml requires expected artifacts")
    paths: list[PurePosixPath] = []
    for artifact in artifacts:
        if (
            not isinstance(artifact, str)
            or not artifact.startswith("/")
            or any(char in artifact for char in "\\\x00*?[")
            or ".." in PurePosixPath(artifact).parts
        ):
            raise ValueError("task.toml artifacts must be literal absolute container paths")
        path = PurePosixPath(artifact)
        if (
            path == PurePosixPath("/")
            or path.is_relative_to("/logs")
            or any(path.is_relative_to(other) or other.is_relative_to(path) for other in paths)
        ):
            raise ValueError("task.toml artifacts overlap or use reserved paths")
        paths.append(path)
    return pins


_DOCKERFILE_INSTRUCTIONS = frozenset(
    {
        "FROM",
        "RUN",
        "COPY",
        "WORKDIR",
        "ENV",
        "CMD",
        "ENTRYPOINT",
        "LABEL",
        "USER",
        "EXPOSE",
        "STOPSIGNAL",
        "SHELL",
        "HEALTHCHECK",
    }
)
# BuildKit continues a line only when a backslash is followed by spaces or tabs
# and the newline; it then appends the next raw line with no separator.
_CONTINUATION = re.compile(r"\\[ \t]*$")


def _logical_lines(text: str) -> list[str]:
    """Join continued lines exactly as BuildKit does, or refuse the file.

    Anything BuildKit would read differently from a byte-level reader (other
    whitespace after the backslash, non-ASCII, CR, blank or comment lines
    inside a continued instruction) is rejected rather than interpreted.
    """
    if not re.fullmatch(r"[\x20-\x7e\t\n]*", text):
        raise ValueError("environment/Dockerfile must be printable ASCII with LF line endings")
    lines: list[str] = []
    logical: str | None = None
    for raw in text.split("\n"):
        if logical is None:
            stripped = raw.strip()
            if not stripped:
                continue
            if stripped.startswith("#"):
                if re.match(r"#\s*(syntax|escape)\s*=", stripped, re.I):
                    raise ValueError("environment/Dockerfile: parser directives are unsupported")
                continue
            logical = ""
            current = raw.lstrip()
        else:
            current = raw
            if not raw.strip() or raw.lstrip().startswith("#"):
                raise ValueError(
                    "environment/Dockerfile: blank or comment line inside a continued instruction"
                )
        continued = _CONTINUATION.search(current)
        if continued is not None:
            logical += current[: continued.start()]
            continue
        lines.append(logical + current)
        logical = None
    if logical is not None:
        raise ValueError("environment/Dockerfile ends inside a continued instruction")
    return lines


def _allowed(platform: ForgePlatform) -> dict[str, frozenset[str]]:
    """The release's base images: exact name to its accepted digests.

    A recipe may pin a name to its multi-platform index digest or to the manifest digest of
    `platform`; a pin to another platform's manifest is refused rather than emulated.
    """
    listed = TypeAdapter(dict[str, dict[str, str]]).validate_json(resource("base-images.json"))
    return {
        name: frozenset({digests["index"], digests[platform]})
        for name, digests in listed.items()
        if platform in digests
    }


def dockerfile_bases(text: str, paths: Collection[str], platform: ForgePlatform) -> tuple[str, ...]:
    """The external base images `environment/Dockerfile` names, in order; `ValueError` for
    syntax that could bypass the local build context policy.

    `paths` are the package's member paths, which `COPY` sources must be among.
    """
    allowed = _allowed(platform)
    stages: set[str] = set()
    bases: list[str] = []
    from_count = 0
    for logical in _logical_lines(text):
        parts = re.split(r"[ \t]+", logical.strip(), maxsplit=1)
        instruction = parts[0].upper()
        arguments = parts[1] if len(parts) > 1 else ""
        if "<<" in arguments or instruction not in _DOCKERFILE_INSTRUCTIONS:
            raise ValueError(f"environment/Dockerfile: unsupported instruction {instruction}")
        if instruction == "FROM":
            match = re.fullmatch(
                r"(?:--platform=(\S+)\s+)?(\S+)(?:\s+[Aa][Ss]\s+([a-zA-Z0-9_-]+))?",
                arguments,
            )
            if match is None or (match[1] is not None and match[1] != platform):
                raise ValueError("environment/Dockerfile: invalid FROM or platform mismatch")
            base = match[2]
            if base.casefold() not in stages and base != "scratch":
                if not re.fullmatch(BASE_IMAGE_REFERENCE, base):
                    raise ValueError(
                        "environment/Dockerfile: external FROM requires a static sha256 pin"
                    )
                name, digest = base.split("@", 1)
                if digest not in allowed.get(name, ()):
                    raise ValueError(
                        f"environment/Dockerfile: base image {base} is not on "
                        f"the release allow-list for {platform}"
                    )
                if base not in bases:
                    bases.append(base)
            if match[3]:
                if match[3].casefold() in stages:
                    raise ValueError("environment/Dockerfile: duplicate stage")
                stages.add(match[3].casefold())
            from_count += 1
        elif from_count == 0:
            raise ValueError("environment/Dockerfile must start with FROM")
        elif instruction == "RUN" and arguments.startswith("--"):
            raise ValueError("environment/Dockerfile: RUN flags/mounts are unsupported")
        elif instruction == "COPY":
            operands = (
                json.loads(arguments) if arguments.startswith("[") else shlex.split(arguments)
            )
            if (
                not isinstance(operands, list)
                or len(operands) < 2
                or any(not isinstance(x, str) for x in operands)
            ):
                raise ValueError("environment/Dockerfile: invalid COPY")
            for source in operands[:-1]:
                if (
                    not source
                    or source.startswith(("/", "--"))
                    or any(c in source for c in "$:*?[\\\x00")
                    or ".." in PurePosixPath(source).parts
                ):
                    raise ValueError("environment/Dockerfile: COPY requires literal local sources")
                path = PurePosixPath("environment") / source
                if path.as_posix() not in paths:
                    raise ValueError(f"environment/Dockerfile: COPY source missing: {source}")
    if not from_count:
        raise ValueError("environment/Dockerfile is incomplete")
    if not bases:
        raise ValueError("environment/Dockerfile names no allow-listed base image")
    return tuple(bases)


def admit(
    task_dir: Path,
    *,
    destination: Path,
    source_skill: str,
    source_digest: str,
    platform: ForgePlatform,
) -> tuple[str, ...]:
    """Copy a person's package's exact bytes to `destination`, new, and return its bases.

    Nothing is pulled or built here. A failure leaves whatever was partly copied, in a build
    that is never reused.
    """
    try:
        if not re.fullmatch(r"task_[a-z0-9-]+_[a-z0-9]{8}", task_dir.name):
            raise ValueError("task directory must use the authoritative Skill2Env task name")
        pinned = contract()
        entries = _snapshot(task_dir)
        for path in pinned["required_files"]:
            _text(entries, path)
        check_members({path: entry.data for path, entry in entries.items()}, source_digest)
        pins = _config(
            _text(entries, "task.toml"),
            task_dir.name,
            source_skill,
            source_digest.removeprefix("sha256:"),
            pinned,
        )
        bases = dockerfile_bases(_text(entries, "environment/Dockerfile"), entries, platform)
        # Skill2Env's build audit records the digest it pinned each FROM to; when the task
        # carries that record it must be the recipe's own pins.
        if pins and pins != dict(base.split("@", 1) for base in bases):
            raise ValueError(
                "task.toml metadata.base_image_pins differ from the recipe's FROM pins"
            )
        if entries != _snapshot(task_dir):
            raise ValueError("task changed during admission")
        # The build is new, so the task tree is created exclusively; an existing directory,
        # file or symlink of that name is never reused.
        destination.parent.mkdir(parents=True, mode=0o700)
        destination.mkdir(mode=0o700)
        for path, entry in entries.items():
            target = destination / path
            if entry.data is None:
                target.mkdir(mode=0o700)
            else:
                with target.open("xb") as output:
                    output.write(entry.data)
                target.chmod(0o700 if entry.executable else 0o600)
        for path, entry in reversed(entries.items()):
            if entry.data is None:
                (destination / path).chmod(0o700 if entry.executable else 0o600)
        # The commitment hashes the written bytes; comparing it with the validated in-memory
        # bytes is the one check that the copy is exact.
        [copied] = commit_task_set(destination.parent, [destination.name]).tasks
        for committed in copied.entries:
            original = entries[committed.path]
            if original.data is not None and committed.digest != sha256_digest_bytes(original.data):
                raise ValueError(f"copied task bytes changed: {committed.path}")
        return bases
    except (OSError, ValueError) as error:
        raise RunError(
            f"cannot import Skill2Env task {task_dir}: {error}",
            code="forge_task_content_invalid",
        ) from error
