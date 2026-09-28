"""Private, atomic, write-once files.

Files are 0600 and every directory made here is 0700, parents included. Writes go to a
temporary file beside the target, are fsynced, and replace it atomically, so no reader sees
half a file. Evidence is created with O_EXCL, so writing it twice is a conflict, and nothing
follows a symlink the caller did not name.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from contextlib import suppress
from pathlib import Path
from typing import BinaryIO, cast

from regents_cli.techtree.canonical import to_json_value
from regents_cli.techtree.errors import ConflictError, NotFoundError, ValidationError
from regents_cli.techtree.models.base import JsonValue

_FILE_MODE = 0o600
_DIRECTORY_MODE = 0o700


def _make_private_directory(path: Path) -> None:
    """Create `path` and each missing parent at 0700; directories already there are left alone."""
    missing: list[Path] = []
    current = path
    while not current.is_dir():
        missing.append(current)
        if current.parent == current:
            break
        current = current.parent
    for directory in reversed(missing):
        try:
            directory.mkdir(mode=_DIRECTORY_MODE)
        except FileExistsError:
            if directory.is_dir():
                continue  # another process made it first
            raise
        with suppress(NotImplementedError, OSError):
            os.chmod(directory, _DIRECTORY_MODE)


def atomic_write_bytes(path: Path, data: bytes, *, mode: int = _FILE_MODE) -> None:
    """Write, fsync, chmod, and atomically replace."""
    directory = path.parent
    _make_private_directory(directory)
    handle, temporary_name = tempfile.mkstemp(dir=directory, prefix=f".{path.name}.", suffix=".tmp")
    temporary = Path(temporary_name)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    fsync_directory(directory)


def atomic_write_text(path: Path, text: str, *, mode: int = _FILE_MODE) -> None:
    atomic_write_bytes(path, text.encode("utf-8"), mode=mode)


def atomic_write_json(path: Path, value: object, *, mode: int = _FILE_MODE) -> None:
    """Readable JSON (indented, sorted). Anything hashed uses canonical_json_bytes instead."""
    rendered = json.dumps(to_json_value(value), indent=2, sort_keys=True, ensure_ascii=False)
    atomic_write_text(path, f"{rendered}\n", mode=mode)


def read_json(path: Path) -> JsonValue:
    """Read UTF-8 JSON, with a typed error for a missing or malformed file."""
    try:
        raw = path.read_bytes()
    except FileNotFoundError as error:
        raise NotFoundError(f"no such file: {path}", details={"path": str(path)}) from error
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValidationError(
            f"file is not valid UTF-8: {path}", details={"path": str(path)}
        ) from error
    try:
        return cast(JsonValue, json.loads(text))
    except json.JSONDecodeError as error:
        raise ValidationError(
            f"file is not valid JSON: {path} ({error.msg} at line {error.lineno})",
            details={"path": str(path), "line": error.lineno},
        ) from error


def ensure_private_directory(path: Path) -> None:
    """Create a directory and its parents at 0700, and make an existing one 0700."""
    if path.is_symlink():
        raise ValidationError(
            f"refusing to use a symlinked directory: {path}", details={"path": str(path)}
        )
    _make_private_directory(path)
    with suppress(NotImplementedError, OSError):
        os.chmod(path, _DIRECTORY_MODE)


def fsync_directory(path: Path) -> None:
    """Fsync a directory where the platform allows it."""
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


def remove_tree(path: Path) -> None:
    """Remove a file or tree; a symlink is unlinked, never followed."""
    if path.is_symlink():
        path.unlink()
        return
    if not path.exists():
        return
    if path.is_dir():
        shutil.rmtree(path)
        return
    path.unlink()


def realpath_within(path: Path, root: Path) -> bool:
    """Whether `path`, resolved, lies inside `root`."""
    return path.resolve().is_relative_to(root.resolve())


def open_exclusive(path: Path, mode: int = _FILE_MODE) -> BinaryIO:
    """Create a write-once file (O_EXCL, O_NOFOLLOW)."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags, mode)
    except FileExistsError as error:
        raise ConflictError(
            f"refusing to overwrite an immutable artifact: {path}", details={"path": str(path)}
        ) from error
    return cast(BinaryIO, os.fdopen(descriptor, "wb"))
