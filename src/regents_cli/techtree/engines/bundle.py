"""What the engine bundle is, and what it hashes to.

Files are enumerated deterministically, described by relative path, size and content digest,
sorted by path, and the canonical JSON manifest is digested. Whatever appears *because* an
engine was installed (a virtual environment, bytecode caches, `installed.json`) is excluded,
so an engine's digest does not change the moment it is used. The bytes hashed here are the
same bytes Techtree 0.3.0 hashes, so the two builds name the same engine.
"""

from __future__ import annotations

import re
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from functools import cache
from importlib.resources import files as resource_files
from importlib.resources.abc import Traversable
from pathlib import Path
from typing import Final

from regents_cli.techtree.canonical import digest_object, sha256_digest_bytes
from regents_cli.techtree.errors import EngineError, ValidationError
from regents_cli.techtree.fs import ensure_private_directory
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.models.engine import EngineDescriptor

#: Every engine this build ships, by resource directory: one per Climb, each pinned whole.
SHIPPED_ENGINES: Final[tuple[str, ...]] = (
    "default",
    "frontier-cs",
    "tasksmith",
    "au-bas-reconciliation",
)
DESCRIPTOR_FILENAME: Final = "engine.json"
#: Written by the installer when an installation is complete; never part of the digest.
INSTALLATION_FILENAME: Final = "installed.json"
PACKAGES_DIRECTORY: Final = "packages"
TOOLS_DIRECTORY: Final = "tools"

#: The helpers that run inside the engine: shipped, hashed and copied unchanged, so the code
#: that reads a taskset is pinned as tightly as the library it reads it with.
ENGINE_TOOLS: Final[tuple[str, ...]] = (
    "inspect_taskset.py",
    "normalize_eval_output.py",
    "normalize_validation.py",
)

#: Part of the hashed bytes, so a bundle digest and a package-tree digest differ by construction.
BUNDLE_MANIFEST_SCHEMA: Final = "techtree.engine-bundle.v1"
PACKAGE_MANIFEST_SCHEMA: Final = "techtree.package-content.v1"

_EXCLUDED_DIRECTORIES: Final[frozenset[str]] = frozenset(
    {".git", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".venv", "__pycache__"}
)
_EXCLUDED_FILENAMES: Final[frozenset[str]] = frozenset({".DS_Store", INSTALLATION_FILENAME})
_EXCLUDED_SUFFIXES: Final[tuple[str, ...]] = (".pyc", ".pyo", ".tmp")

#: An engine name becomes a resource path segment, so it cannot escape the resources directory.
_ENGINE_NAME_RE: Final = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


@dataclass(frozen=True)
class BundleFile:
    """One file in a hashed tree, described by content rather than by mtime."""

    relative_path: str
    size: int
    digest: Digest


def embedded_engine_root(name: str) -> Traversable:
    """Locate one packaged engine bundle inside the installed distribution."""
    if _ENGINE_NAME_RE.fullmatch(name) is None:
        raise ValidationError(f"{name!r} is not a valid engine name", details={"name": name})
    root = resource_files("regents_cli.techtree") / "resources" / "engines" / name
    if not root.is_dir():
        raise EngineError(
            f"this build does not ship an engine named {name!r}",
            code="engine_bundle_missing",
            details={"name": name},
        )
    return root


def enumerate_bundle_files(root: Traversable) -> list[BundleFile]:
    """Enumerate a tree by POSIX relative path, so the order owes nothing to the filesystem."""
    return sorted(_walk(root, prefix=""), key=lambda entry: entry.relative_path)


def content_manifest(schema_version: str, files: Sequence[BundleFile]) -> dict[str, JsonValue]:
    """The canonical manifest a tree digest is taken over."""
    return {
        "schema_version": schema_version,
        "files": [
            {"path": entry.relative_path, "size": entry.size, "digest": entry.digest}
            for entry in files
        ],
    }


def engine_bundle_digest(root: Traversable) -> Digest:
    """The digest of one engine bundle's static contents."""
    return digest_object(content_manifest(BUNDLE_MANIFEST_SCHEMA, enumerate_bundle_files(root)))


def read_engine_descriptor(root: Traversable) -> EngineDescriptor:
    """Load and validate `engine.json` from a bundle."""
    descriptor = root / DESCRIPTOR_FILENAME
    if not descriptor.is_file():
        raise EngineError(
            f"engine bundle has no {DESCRIPTOR_FILENAME}",
            code="engine_descriptor_missing",
            details={"file": DESCRIPTOR_FILENAME},
        )
    try:
        return EngineDescriptor.model_validate_json(descriptor.read_bytes())
    except ValueError as error:
        raise ValidationError(
            f"engine descriptor is not a valid EngineDescriptor: {error}",
            details={"file": DESCRIPTOR_FILENAME},
        ) from error


def copy_engine_bundle(root: Traversable, destination: Path) -> None:
    """Copy exactly the hashed files of a bundle into an empty directory, as content, not links."""
    if destination.is_dir() and any(destination.iterdir()):
        raise EngineError(
            f"refusing to copy an engine bundle into a non-empty directory: {destination}",
            code="engine_destination_not_empty",
            details={"path": str(destination)},
        )
    ensure_private_directory(destination)
    for entry in enumerate_bundle_files(root):
        target = destination / entry.relative_path
        ensure_private_directory(target.parent)
        source: Traversable = root
        for segment in entry.relative_path.split("/"):
            source = source / segment
        target.write_bytes(source.read_bytes())


@cache
def shipped_engines() -> dict[Digest, str]:
    """Every engine bundle this build ships, digest to name, in `SHIPPED_ENGINES` order."""
    return {engine_bundle_digest(embedded_engine_root(name)): name for name in SHIPPED_ENGINES}


def shipped_engine_root(digest: Digest) -> Traversable:
    """The packaged bundle that hashes to `digest`."""
    name = shipped_engines().get(digest)
    if name is None:
        raise EngineError(
            f"this build does not ship engine {digest}",
            code="engine_digest_unknown",
            details={"requested": digest, "available": list(shipped_engines())},
        )
    return embedded_engine_root(name)


def _walk(root: Traversable, *, prefix: str) -> Iterator[BundleFile]:
    for entry in root.iterdir():
        name = entry.name
        relative = f"{prefix}{name}"
        if entry.is_dir():
            if name in _EXCLUDED_DIRECTORIES:
                continue
            yield from _walk(entry, prefix=f"{relative}/")
            continue
        if name in _EXCLUDED_FILENAMES or name.endswith(_EXCLUDED_SUFFIXES):
            continue
        content = entry.read_bytes()
        yield BundleFile(
            relative_path=relative, size=len(content), digest=sha256_digest_bytes(content)
        )
