"""What exactly a Skill directory holds, and which of its entries Techtree can carry.

One walk, one rule set. Every entry is listed and given a reason when it cannot be carried:
a hidden path is recorded and never opened (a hidden directory is one entry), a link is not
followed, anything that is not a regular file or readable directory is recorded as what it is,
and a regular file is carried only when it is UTF-8 text of a kind an instruction Skill is made
of, within the per-file limit. `scan_skill` refuses a Skill with any such entry; the forge's
`inspect-skill` records them and refuses only what the instructions need.
"""

from __future__ import annotations

import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final, Literal

from regents_cli.techtree.canonical import sha256_digest_bytes
from regents_cli.techtree.constants import (
    MAX_SKILL_FILE_BYTES,
    MAX_SKILL_FILES,
    MAX_SKILL_TOTAL_BYTES,
)
from regents_cli.techtree.errors import NotFoundError, ValidationError
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.skill import SKILL_ENTRY_FILE

MEDIA_TYPES: Final[dict[str, str]] = {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".json": "application/json",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
}

#: A directory holding more entries than this is not a Skill.
MAX_ENTRIES: Final = 4096

type EntryKind = Literal["file", "symlink", "directory", "special"]

#: Why one entry cannot be carried.
type UnsupportedReason = Literal[
    "hidden",
    "symlink",
    "special",
    "unreadable",
    "file_type",
    "not_text",
    "too_large",
    "case_collision",
]

#: What each reason says, completing "<path> …".
UNSUPPORTED_WORDS: Final[dict[UnsupportedReason, str]] = {
    "hidden": "is hidden, and Techtree never opens hidden files",
    "symlink": "is a link, and what a link points to depends on the machine",
    "special": "is not a regular file",
    "unreadable": "cannot be read",
    "file_type": (
        "is a kind of file Techtree does not carry; only "
        + ", ".join(sorted(MEDIA_TYPES))
        + " text is"
    ),
    "not_text": "is not UTF-8 text",
    "too_large": f"is larger than the {MAX_SKILL_FILE_BYTES} byte limit for one file",
    "case_collision": "differs from another path only by letter case",
}


@dataclass
class SkillEntry:
    """One entry under a Skill's root; `data` is kept exactly when it can be carried."""

    path: str
    kind: EntryKind
    size: int | None = None
    digest: Digest | None = None
    media_type: str | None = None
    data: bytes | None = None
    reason: UnsupportedReason | None = None


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
    """Accept SKILL.md or its directory; a linked root is refused."""
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
    if root.is_symlink():
        raise ValidationError(
            f"skill root is a symlink, which is never followed: {root}",
            details={"root": str(root)},
        )
    if not (root / SKILL_ENTRY_FILE).is_file():
        raise ValidationError(
            f"skill directory has no {SKILL_ENTRY_FILE} entrypoint: {root}",
            details={"root": str(root), "entrypoint": SKILL_ENTRY_FILE},
        )
    return root


def inventory(root: Path) -> list[SkillEntry]:
    """Every entry under `root`, in path order, each with its reason when it can't be carried."""
    listing = _listing(root)
    if listing is None:
        raise ValidationError(
            f"the Skill's directory cannot be read: {root}", details={"path": str(root)}
        )
    entries: list[SkillEntry] = []
    _walk(root, listing, entries)
    folded: dict[str, list[SkillEntry]] = {}
    for entry in entries:
        folded.setdefault(entry.path.casefold(), []).append(entry)
    for group in folded.values():
        if len(group) > 1:
            for entry in group:
                if entry.reason is None:
                    entry.reason, entry.data = "case_collision", None
    return entries


def scan_skill(path: Path) -> SkillScanResult:
    """The Skill's files when every entry can be carried; otherwise the first refusal."""
    root = resolve_skill_root(path)
    entries = inventory(root)
    for entry in entries:
        if entry.reason is not None:
            raise ValidationError(
                f"skill entry {entry.path} {UNSUPPORTED_WORDS[entry.reason]}",
                details={"path": entry.path, "reason": entry.reason},
            )
    if len(entries) > MAX_SKILL_FILES:
        raise ValidationError(
            f"skill contains {len(entries)} files, more than the {MAX_SKILL_FILES} allowed",
            details={"count": len(entries), "maximum_files": MAX_SKILL_FILES},
        )
    total = sum(entry.size or 0 for entry in entries)
    if total > MAX_SKILL_TOTAL_BYTES:
        raise ValidationError(
            f"skill is larger than the {MAX_SKILL_TOTAL_BYTES} byte total limit",
            details={"total_bytes": total, "maximum_total_bytes": MAX_SKILL_TOTAL_BYTES},
        )
    return SkillScanResult(
        root=root,
        files=[
            ScannedFile(
                source_path=root / entry.path,
                relative_path=PurePosixPath(entry.path),
                size=len(entry.data or b""),
                media_type=str(entry.media_type),
                digest=str(entry.digest),
            )
            for entry in entries
        ],
    )


def _listing(directory: Path) -> list[os.DirEntry[str]] | None:
    try:
        with os.scandir(directory) as found:
            return sorted(found, key=lambda child: child.name)
    except OSError:
        return None


def _walk(root: Path, listing: list[os.DirEntry[str]], entries: list[SkillEntry]) -> None:
    for child in listing:
        if len(entries) >= MAX_ENTRIES:
            raise ValidationError(
                f"the Skill's directory holds more than {MAX_ENTRIES} entries, "
                "which is more than a Skill is",
                details={"path": str(root), "maximum_entries": MAX_ENTRIES},
            )
        path = Path(child.path)
        relative = path.relative_to(root).as_posix()
        if child.name.startswith("."):
            entries.append(SkillEntry(relative, _kind(child), reason="hidden"))
        elif child.is_symlink():
            entries.append(SkillEntry(relative, "symlink", reason="symlink"))
        elif child.is_dir(follow_symlinks=False):
            nested = _listing(path)
            if nested is None:
                entries.append(SkillEntry(relative, "directory", reason="unreadable"))
            else:
                _walk(root, nested, entries)
        elif child.is_file(follow_symlinks=False):
            entries.append(_file(path, relative))
        else:
            entries.append(SkillEntry(relative, "special", reason="special"))


def _kind(child: os.DirEntry[str]) -> EntryKind:
    if child.is_symlink():
        return "symlink"
    if child.is_dir(follow_symlinks=False):
        return "directory"
    if child.is_file(follow_symlinks=False):
        return "file"
    return "special"


def _file(path: Path, relative: str) -> SkillEntry:
    """Hash one regular file, opened without following a link, and keep its bytes when it can
    be carried."""
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return SkillEntry(relative, "file", reason="unreadable")
    with os.fdopen(descriptor, "rb") as handle:
        status = os.fstat(handle.fileno())
        if not stat.S_ISREG(status.st_mode):
            return SkillEntry(relative, "special", reason="special")
        media_type = MEDIA_TYPES.get(path.suffix.lower())
        if media_type is None or status.st_size > MAX_SKILL_FILE_BYTES:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
            return SkillEntry(
                relative,
                "file",
                size=status.st_size,
                digest=f"sha256:{digest}",
                reason="file_type" if media_type is None else "too_large",
            )
        data = handle.read(MAX_SKILL_FILE_BYTES + 1)
    entry = SkillEntry(
        relative, "file", size=len(data), digest=sha256_digest_bytes(data), media_type=media_type
    )
    if len(data) > MAX_SKILL_FILE_BYTES:
        entry.reason = "too_large"
    elif not _is_text(data):
        entry.reason = "not_text"
    else:
        entry.data = data
    return entry


def _is_text(data: bytes) -> bool:
    if b"\x00" in data:
        return False
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True
