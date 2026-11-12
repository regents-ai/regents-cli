"""Digests over an open-weights checkpoint's files.

Every digest is a root over a named set of regular files directly in one folder (Techtree's
model substitution spec, section 3): each file is digested on its exact bytes, the entries are
sorted by UTF-8 path, and the root is the digest of their canonical JSON. Techtree never reads
model files, so these roots are the only thing that ties a run to the weights it served.

When the folder has `model.safetensors.index.json`, its `.safetensors` files must be exactly
the ones the index lists: a missing shard would make a root over part of the weights, and an
unlisted one is a file vLLM never loads.

Links are refused, with one exception: in a Hugging Face cache snapshot
(`<hub>/models--<org>--<name>/snapshots/<40 hex>`) every file is a link to a blob directly in
that repository's `blobs/` folder, named by its content's hash (git's blob hash, or SHA-256 for
large files). huggingface_hub 2.3 links on from there into the cache's shared
`<hub>/blobs/<xx>/<name>`. So there a link is followed along exactly that path, neither blobs
folder may itself be a link, and the bytes must have the hash the blob is named by. A plain file
in a snapshot is one replaced after download, and refuses.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Collection
from dataclasses import dataclass
from pathlib import Path
from typing import Final, NoReturn

from pydantic import BaseModel, ConfigDict
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object, sha256_digest_bytes
from regents_cli.techtree.constants import DIGEST_PREFIX
from regents_cli.techtree.errors import NotFoundError, ValidationError
from regents_cli.techtree.models.base import Digest, JsonValue

WEIGHTS_SUFFIX: Final = ".safetensors"
WEIGHTS_INDEX_FILE: Final = "model.safetensors.index.json"
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
CONFIG_FILE: Final = "config.json"
GENERATION_CONFIG_FILE: Final = "generation_config.json"
CHAT_TEMPLATE_FILE: Final = "chat_template.jinja"
TOKENIZER_CONFIG_FILE: Final = "tokenizer_config.json"
MODEL_FILES_REFUSED: Final = "model_files_refused"

_COMMIT_RE: Final = re.compile(r"^[0-9a-f]{40}$")
_BLOB_NAME_RE: Final = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
_CACHE_PREFIX: Final = "models--"
_CHUNK_BYTES: Final = 1024 * 1024


@dataclass(frozen=True)
class CacheSnapshot:
    """A Hugging Face cache snapshot folder: the repository and commit its path names."""

    repo: str
    revision: str
    blobs: Path
    shared_blobs: Path


@dataclass(frozen=True)
class _File:
    """A regular file to digest; `blob_name` is the hash a cache blob's bytes must have."""

    path: Path
    blob_name: str | None


class _WeightsIndex(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore", frozen=True)

    weight_map: dict[str, str]


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
    return CacheSnapshot(
        repo="/".join(parts),
        revision=directory.name,
        blobs=repo_folder / "blobs",
        shared_blobs=repo_folder.parent / "blobs",
    )


def file_root(directory: Path, names: Collection[str]) -> Digest:
    """The root over the regular files directly in `directory` whose names are in `names`."""
    entries = [
        {"path": entry.name, "digest": _file_digest(entry, directory)}
        for entry in _entries(directory)
        if entry.name in names
    ]
    if not entries:
        _refuse(
            f"{directory} has none of the files this digest covers",
            directory=str(directory),
            names=sorted(names),
        )
    entries.sort(key=lambda item: item["path"].encode())
    return digest_object(entries)


def weights_root(directory: Path) -> Digest:
    """The root over every `.safetensors` file directly in `directory`."""
    entries = {entry.name: entry for entry in _entries(directory)}
    names = {name for name in entries if name.endswith(WEIGHTS_SUFFIX)}
    if WEIGHTS_INDEX_FILE in entries:
        try:
            index = _WeightsIndex.model_validate_json(
                _file_bytes(entries[WEIGHTS_INDEX_FILE], directory)
            )
        except PydanticValidationError:
            _refuse(
                f"{directory}'s {WEIGHTS_INDEX_FILE} has no weight_map of tensor names to files",
                directory=str(directory),
            )
        listed = set(index.weight_map.values())
        if listed != names:
            _refuse(
                f"{directory}'s .safetensors files are not the ones its {WEIGHTS_INDEX_FILE} "
                "lists: a missing file means an incomplete download, and an unlisted one is "
                "never loaded",
                directory=str(directory),
                missing=sorted(listed - names),
                unlisted=sorted(names - listed),
            )
    return file_root(directory, names)


def tokenizer_digest(directory: Path) -> Digest:
    """The root over the tokenizer files the checkpoint has."""
    return file_root(directory, TOKENIZER_FILES)


def config_digest(directory: Path) -> Digest:
    """The root over `config.json` and, when present, `generation_config.json`, whose sampling
    defaults vLLM applies."""
    if not (directory / CONFIG_FILE).exists(follow_symlinks=False):
        _refuse(f"{directory} has no {CONFIG_FILE}", directory=str(directory))
    return file_root(directory, {CONFIG_FILE, GENERATION_CONFIG_FILE})


def chat_template_digest(directory: Path) -> Digest:
    """The digest of `chat_template.jinja`, else of `tokenizer_config.json`'s `chat_template`."""
    entries = {entry.name: entry for entry in _entries(directory)}
    if CHAT_TEMPLATE_FILE in entries:
        return sha256_digest_bytes(_file_bytes(entries[CHAT_TEMPLATE_FILE], directory))
    config = (
        _json_file(entries[TOKENIZER_CONFIG_FILE], directory)
        if TOKENIZER_CONFIG_FILE in entries
        else None
    )
    template = config.get("chat_template") if isinstance(config, dict) else None
    if isinstance(template, str):
        return sha256_digest_bytes(template.encode("utf-8"))
    if isinstance(template, list):
        return sha256_digest_bytes(canonical_json_bytes(template))
    _refuse(
        f"{directory} has no chat template: no {CHAT_TEMPLATE_FILE} and no chat_template in "
        f"{TOKENIZER_CONFIG_FILE}",
        directory=str(directory),
    )


def _entries(directory: Path) -> list[os.DirEntry[str]]:
    try:
        with os.scandir(directory) as scan:
            return list(scan)
    except (FileNotFoundError, NotADirectoryError) as error:
        raise NotFoundError(
            f"no such checkpoint folder: {directory}", details={"directory": str(directory)}
        ) from error


def _file_digest(entry: os.DirEntry[str], directory: Path) -> Digest:
    file = _regular_file(entry, directory)
    sha256 = hashlib.sha256()
    git = _git_blob_hash(file)
    with file.path.open("rb") as stream:
        while chunk := stream.read(_CHUNK_BYTES):
            sha256.update(chunk)
            if git is not None:
                git.update(chunk)
    _check_blob_name(file, entry, (git or sha256).hexdigest())
    return f"{DIGEST_PREFIX}{sha256.hexdigest()}"


def _file_bytes(entry: os.DirEntry[str], directory: Path) -> bytes:
    file = _regular_file(entry, directory)
    content = file.path.read_bytes()
    git = _git_blob_hash(file)
    if git is not None:
        git.update(content)
    _check_blob_name(file, entry, (git or hashlib.sha256(content)).hexdigest())
    return content


def _json_file(entry: os.DirEntry[str], directory: Path) -> JsonValue:
    try:
        return json.loads(_file_bytes(entry, directory))  # type: ignore[no-any-return]
    except (ValueError, RecursionError):
        _refuse(f"{entry.path} is not JSON this reader can hold", path=entry.path)


def _git_blob_hash(file: _File) -> hashlib._Hash | None:
    """git's blob hash, begun with its header, when the blob is named by one."""
    if file.blob_name is None or len(file.blob_name) != 40:
        return None
    header = f"blob {file.path.stat().st_size}\0".encode()
    return hashlib.sha1(header, usedforsecurity=False)


def _check_blob_name(file: _File, entry: os.DirEntry[str], content_hash: str) -> None:
    if file.blob_name is not None and content_hash != file.blob_name:
        _refuse(
            f"{entry.path}'s bytes do not have the hash the cache names them by, so the file "
            "was changed or only partly downloaded; download it again",
            path=entry.path,
        )


def _regular_file(entry: os.DirEntry[str], directory: Path) -> _File:
    """The regular file an entry names: itself, or in a cache snapshot the blob it links to.
    In a cache snapshot every file is a link; one that is not was replaced in place."""
    snapshot = cache_snapshot(directory)
    if entry.is_file(follow_symlinks=False):
        if snapshot is None:
            return _File(path=Path(entry.path), blob_name=None)
        _refuse(
            f"{entry.path} is a plain file inside a Hugging Face cache snapshot, where every file "
            "is a link to its blob, so it was replaced after download; download it again",
            path=entry.path,
        )
    if entry.is_symlink() and snapshot is not None:
        blob = _cache_blob(Path(entry.path), snapshot)
        if blob is not None:
            return blob
    _refuse(
        f"{entry.path} is not a regular file; model digests cover regular files, and links only "
        "into a Hugging Face cache's own blobs folders",
        path=entry.path,
    )


def _cache_blob(link: Path, snapshot: CacheSnapshot) -> _File | None:
    """The blob a snapshot's link names: a file directly in the repository's blobs folder, or
    that file's own link into the shared `<hub>/blobs/<xx>/`."""
    if snapshot.blobs.is_symlink() or snapshot.shared_blobs.is_symlink():
        return None
    blob = link.parent / os.readlink(link)
    if _BLOB_NAME_RE.fullmatch(blob.name) is None:
        return None
    if blob.parent.resolve() != snapshot.blobs.resolve():
        return None
    if not blob.is_symlink():
        return _File(path=blob, blob_name=blob.name) if blob.is_file() else None
    target = blob.resolve()
    if not target.is_file() or target.parent.parent != snapshot.shared_blobs.resolve():
        return None
    return _File(path=target, blob_name=blob.name)


def _refuse(message: str, **details: object) -> NoReturn:
    raise ValidationError(message, code=MODEL_FILES_REFUSED, details=dict(details))
