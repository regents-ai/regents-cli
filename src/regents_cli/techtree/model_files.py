"""Digests over an open-weights checkpoint's files.

Every digest is a root over a named set of regular files directly in one folder (Techtree's
model substitution spec, section 3): each file is digested on its exact bytes, the entries are
sorted by UTF-8 path, and the root is the digest of their canonical JSON. Techtree never reads
model files, so these roots are the only thing that ties a run to the weights it served.

Links are refused, with one exception: in a Hugging Face cache snapshot
(`.../models--<org>--<name>/snapshots/<40 hex>`) every file is a link into that repository's
`blobs/` folder, so there a link is followed when it resolves to a regular file in that folder.
The bytes digested are the same either way.
"""

from __future__ import annotations

import os
import re
from collections.abc import Collection
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from regents_cli.techtree.canonical import (
    canonical_json_bytes,
    digest_object,
    sha256_digest_bytes,
    sha256_digest_stream,
)
from regents_cli.techtree.errors import NotFoundError, ValidationError
from regents_cli.techtree.fs import read_json
from regents_cli.techtree.models.base import Digest

WEIGHTS_SUFFIX: Final = ".safetensors"
TOKENIZER_FILES: Final = frozenset(
    {
        "tokenizer.json",
        "tokenizer.model",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "added_tokens.json",
        "vocab.json",
        "vocab.txt",
        "merges.txt",
    }
)
CHAT_TEMPLATE_FILE: Final = "chat_template.jinja"
TOKENIZER_CONFIG_FILE: Final = "tokenizer_config.json"
MODEL_FILES_REFUSED: Final = "model_files_refused"

_COMMIT_RE: Final = re.compile(r"^[0-9a-f]{40}$")
_CACHE_PREFIX: Final = "models--"


@dataclass(frozen=True)
class CacheSnapshot:
    """A Hugging Face cache snapshot folder: the repository and commit its path names."""

    repo: str
    revision: str
    blobs: Path


def cache_snapshot(directory: Path) -> CacheSnapshot | None:
    """The repository and commit `directory` names when it is a Hugging Face cache snapshot."""
    repo_folder = directory.parent.parent
    if directory.parent.name != "snapshots" or _COMMIT_RE.fullmatch(directory.name) is None:
        return None
    if not repo_folder.name.startswith(_CACHE_PREFIX):
        return None
    parts = repo_folder.name.removeprefix(_CACHE_PREFIX).split("--")
    if len(parts) != 2 or not all(parts):
        return None
    return CacheSnapshot(repo="/".join(parts), revision=directory.name, blobs=repo_folder / "blobs")


def file_root(directory: Path, names: Collection[str]) -> Digest:
    """The root over the regular files directly in `directory` whose names are in `names`."""
    entries: list[dict[str, str]] = []
    for entry in _entries(directory):
        if entry.name not in names:
            continue
        path = _regular_file(entry, directory)
        with path.open("rb") as stream:
            entries.append({"path": entry.name, "digest": sha256_digest_stream(stream)})
    if not entries:
        raise ValidationError(
            f"{directory} has none of the files this digest covers",
            code=MODEL_FILES_REFUSED,
            details={"directory": str(directory), "names": sorted(names)},
        )
    entries.sort(key=lambda item: item["path"].encode())
    return digest_object(entries)


def weights_root(directory: Path) -> Digest:
    """The root over every `.safetensors` file directly in `directory`."""
    names = {entry.name for entry in _entries(directory) if entry.name.endswith(WEIGHTS_SUFFIX)}
    return file_root(directory, names)


def tokenizer_digest(directory: Path) -> Digest:
    """The root over the tokenizer files the checkpoint has."""
    return file_root(directory, TOKENIZER_FILES)


def chat_template_digest(directory: Path) -> Digest:
    """The digest of `chat_template.jinja`, else of `tokenizer_config.json`'s `chat_template`."""
    entries = {entry.name: entry for entry in _entries(directory)}
    if CHAT_TEMPLATE_FILE in entries:
        return sha256_digest_bytes(
            _regular_file(entries[CHAT_TEMPLATE_FILE], directory).read_bytes()
        )
    config = (
        read_json(_regular_file(entries[TOKENIZER_CONFIG_FILE], directory))
        if TOKENIZER_CONFIG_FILE in entries
        else None
    )
    template = config.get("chat_template") if isinstance(config, dict) else None
    if isinstance(template, str):
        return sha256_digest_bytes(template.encode("utf-8"))
    if isinstance(template, list):
        return sha256_digest_bytes(canonical_json_bytes(template))
    raise ValidationError(
        f"{directory} has no chat template: no {CHAT_TEMPLATE_FILE} and no chat_template in "
        f"{TOKENIZER_CONFIG_FILE}",
        code=MODEL_FILES_REFUSED,
        details={"directory": str(directory)},
    )


def _entries(directory: Path) -> list[os.DirEntry[str]]:
    try:
        with os.scandir(directory) as scan:
            return list(scan)
    except (FileNotFoundError, NotADirectoryError) as error:
        raise NotFoundError(
            f"no such checkpoint folder: {directory}", details={"directory": str(directory)}
        ) from error


def _regular_file(entry: os.DirEntry[str], directory: Path) -> Path:
    """The regular file an entry names: itself, or in a cache snapshot the blob it links to."""
    if entry.is_file(follow_symlinks=False):
        return Path(entry.path)
    snapshot = cache_snapshot(directory)
    if entry.is_symlink() and snapshot is not None:
        target = Path(entry.path).resolve()
        if target.parent == snapshot.blobs.resolve() and target.is_file():
            return target
    raise ValidationError(
        f"{entry.path} is not a regular file; model digests cover regular files, and links only "
        "into a Hugging Face cache snapshot's own blobs folder",
        code=MODEL_FILES_REFUSED,
        details={"path": entry.path},
    )
