"""What exactly a Skill directory would snapshot, and what in it must be refused.

It refuses rather than repairs: a symlink is not resolved, a hidden file is not skipped, an
oversized file is not truncated. Every refusal is about a file's shape, never its words.
"""

from __future__ import annotations

import os
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final

from regents_cli.techtree.canonical import sha256_digest_bytes
from regents_cli.techtree.constants import (
    ALLOWED_SKILL_SUFFIXES,
    MAX_SKILL_FILE_BYTES,
    MAX_SKILL_FILES,
    MAX_SKILL_TOTAL_BYTES,
)
from regents_cli.techtree.errors import NotFoundError, ValidationError
from regents_cli.techtree.fs import realpath_within
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.skill import SKILL_ENTRY_FILE

MEDIA_TYPES: Final[dict[str, str]] = {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".json": "application/json",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
}


@dataclass
class ScannedFile:
    """A validated file, and everything the snapshot needs to know about it."""

    source_path: Path
    relative_path: PurePosixPath
    size: int
    media_type: str
    digest: Digest


@dataclass
class SkillScanResult:
    """The complete, ordered description of what would be snapshotted."""

    root: Path
    files: list[ScannedFile]


def resolve_skill_root(path: Path) -> Path:
    """Accept SKILL.md or its containing directory; symlinks are left for `scan_skill` to refuse."""
    if not path.exists() and not path.is_symlink():
        raise NotFoundError(f"no such skill path: {path}", details={"path": str(path)})
    if path.is_dir():
        root = path
    elif path.is_file():
        if path.name != SKILL_ENTRY_FILE:
            raise ValidationError(
                "a skill is named by its directory or by its SKILL.md, not by one of its "
                f"other files: {path.name}",
                details={"path": str(path)},
            )
        root = path.parent
    else:
        raise ValidationError(
            f"skill path is neither a directory nor a regular file: {path}",
            details={"path": str(path)},
        )
    entrypoint = root / SKILL_ENTRY_FILE
    if not entrypoint.is_file():
        raise ValidationError(
            f"skill directory has no {SKILL_ENTRY_FILE} entrypoint: {root}",
            details={"root": str(root), "entrypoint": SKILL_ENTRY_FILE},
        )
    return root


def enumerate_files(root: Path) -> list[Path]:
    """Every entry under the root without following symlinks, so validation can report them."""
    found: list[Path] = []
    _walk(root, found)
    return sorted(found, key=lambda item: _relative_key(item, root))


def _walk(directory: Path, found: list[Path]) -> None:
    with os.scandir(directory) as entries:
        for entry in entries:
            child = Path(entry.path)
            if entry.is_symlink():
                found.append(child)
            elif entry.is_dir(follow_symlinks=False):
                _walk(child, found)
            else:
                found.append(child)


def _relative_key(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def _relative_path(path: Path, root: Path) -> PurePosixPath:
    try:
        return PurePosixPath(path.relative_to(root).as_posix())
    except ValueError as error:
        raise ValidationError(
            f"file is outside the skill root: {path}",
            details={"path": str(path), "root": str(root)},
        ) from error


def validate_file(path: Path, root: Path) -> None:
    """Validate containment, type, suffix, size, and hidden status."""
    relative = _relative_path(path, root)
    hidden = next((part for part in relative.parts if part.startswith(".")), None)
    if hidden is not None:
        raise ValidationError(
            f"skill contains a hidden path, which is never submitted: {relative}",
            details={"path": relative.as_posix(), "hidden_component": hidden},
        )
    if path.is_symlink():
        raise ValidationError(
            "skill contains a symlink, and a snapshot must mean the same thing on every "
            f"machine: {relative}",
            details={"path": relative.as_posix()},
        )
    try:
        status = path.stat(follow_symlinks=False)
    except OSError as error:
        raise ValidationError(
            f"skill file cannot be read: {relative}", details={"path": relative.as_posix()}
        ) from error
    if not stat.S_ISREG(status.st_mode):
        raise ValidationError(
            f"skill contains {_describe_type(status.st_mode)}, which cannot be snapshotted: "
            f"{relative}",
            details={"path": relative.as_posix(), "kind": _describe_type(status.st_mode)},
        )
    suffix = path.suffix.lower()
    if suffix not in ALLOWED_SKILL_SUFFIXES:
        raise ValidationError(
            f"skill file has an unsupported suffix: {relative}",
            details={
                "path": relative.as_posix(),
                "suffix": suffix,
                "allowed_suffixes": sorted(ALLOWED_SKILL_SUFFIXES),
            },
        )
    if status.st_size > MAX_SKILL_FILE_BYTES:
        raise ValidationError(
            f"skill file is larger than {MAX_SKILL_FILE_BYTES} bytes: {relative}",
            details={
                "path": relative.as_posix(),
                "size": status.st_size,
                "maximum_file_bytes": MAX_SKILL_FILE_BYTES,
            },
        )
    if not realpath_within(path, root):
        raise ValidationError(
            f"skill file resolves outside the skill root: {relative}",
            details={"path": relative.as_posix(), "root": str(root)},
        )


def _describe_type(mode: int) -> str:
    if stat.S_ISDIR(mode):
        return "a directory"
    if stat.S_ISFIFO(mode):
        return "a FIFO"
    if stat.S_ISSOCK(mode):
        return "a socket"
    if stat.S_ISBLK(mode) or stat.S_ISCHR(mode):
        return "a device"
    return "something that is not a regular file"


def media_type_for(path: Path) -> str:
    media_type = MEDIA_TYPES.get(path.suffix.lower())
    if media_type is None:
        raise ValidationError(
            f"no media type is defined for this suffix: {path.name}",
            details={"suffix": path.suffix.lower()},
        )
    return media_type


def _decode_text(data: bytes, reported_path: str) -> str:
    if b"\x00" in data:
        raise ValidationError(
            f"skill file is binary, and an instruction skill is text: {reported_path}",
            details={"path": reported_path},
        )
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValidationError(
            f"skill file is not valid UTF-8 text: {reported_path}", details={"path": reported_path}
        ) from error


def scan_skill(path: Path) -> SkillScanResult:
    """Complete validation and scanning; a ValidationError names the first thing refused."""
    root = resolve_skill_root(path)
    if root.is_symlink():
        raise ValidationError(
            f"skill root is a symlink, which is never snapshotted: {root}",
            details={"root": str(root)},
        )
    candidates = enumerate_files(root)
    if len(candidates) > MAX_SKILL_FILES:
        raise ValidationError(
            f"skill contains {len(candidates)} files, more than the {MAX_SKILL_FILES} allowed",
            details={"count": len(candidates), "maximum_files": MAX_SKILL_FILES},
        )
    files: list[ScannedFile] = []
    total = 0
    for candidate in candidates:
        validate_file(candidate, root)
        relative = _relative_path(candidate, root)
        data = candidate.read_bytes()
        total += len(data)
        if total > MAX_SKILL_TOTAL_BYTES:
            raise ValidationError(
                f"skill is larger than the {MAX_SKILL_TOTAL_BYTES} byte total limit",
                details={"total_bytes": total, "maximum_total_bytes": MAX_SKILL_TOTAL_BYTES},
            )
        _decode_text(data, relative.as_posix())
        files.append(
            ScannedFile(
                source_path=candidate,
                relative_path=relative,
                size=len(data),
                media_type=media_type_for(candidate),
                digest=sha256_digest_bytes(data),
            )
        )
    if not any(item.relative_path == PurePosixPath(SKILL_ENTRY_FILE) for item in files):
        raise ValidationError(
            f"skill directory has no {SKILL_ENTRY_FILE} entrypoint: {root}",
            details={"root": str(root), "entrypoint": SKILL_ENTRY_FILE},
        )
    _reject_case_collisions(files)
    return SkillScanResult(
        root=root, files=sorted(files, key=lambda item: item.relative_path.as_posix())
    )


def _reject_case_collisions(files: list[ScannedFile]) -> None:
    """Two files here are one file on a case-insensitive filesystem."""
    seen: dict[str, str] = {}
    for item in files:
        posix = item.relative_path.as_posix()
        existing = seen.get(posix.casefold())
        if existing is not None:
            raise ValidationError(
                "skill contains paths that differ only by case, which collide on a "
                f"case-insensitive filesystem: {existing} and {posix}",
                details={"paths": [existing, posix]},
            )
        seen[posix.casefold()] = posix
