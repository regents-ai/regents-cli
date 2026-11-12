"""Model file digests match Techtree's model substitution spec byte for byte.

The costly failure: a root that differs from Techtree's own makes every model substitution run
fail to verify, or worse, lets two different checkpoints share a root.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from regents_cli.techtree.canonical import canonical_json_bytes, sha256_digest_bytes
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.model_files import (
    cache_snapshot,
    chat_template_digest,
    config_digest,
    file_root,
    tokenizer_digest,
    weights_root,
)

SPEC_ROOT = "sha256:4e70f644497973aaaf7a6870ac92f125a87ad4a5017e714291de392629d5918a"
SPEC_FILES = {
    "model-00001-of-00002.safetensors": b"hello",
    "model-00002-of-00002.safetensors": b"world",
}


def _spec_checkpoint(directory: Path) -> Path:
    (directory / "model-00002-of-00002.safetensors").write_bytes(b"world")
    (directory / "model-00001-of-00002.safetensors").write_bytes(b"hello")
    return directory


def test_the_spec_vector(tmp_path: Path) -> None:
    checkpoint = _spec_checkpoint(tmp_path)
    assert weights_root(checkpoint) == SPEC_ROOT


def test_weights_root_covers_only_safetensors_directly_in_the_folder(tmp_path: Path) -> None:
    checkpoint = _spec_checkpoint(tmp_path)
    (checkpoint / "model.safetensors.index.json").write_text(_index(*SPEC_FILES))
    (checkpoint / "config.json").write_text("{}")
    (checkpoint / "repair_adapter").mkdir()
    (checkpoint / "repair_adapter" / "adapter.safetensors").write_bytes(b"lora")
    assert weights_root(checkpoint) == SPEC_ROOT


def test_one_changed_byte_changes_the_root(tmp_path: Path) -> None:
    checkpoint = _spec_checkpoint(tmp_path)
    (checkpoint / "model-00002-of-00002.safetensors").write_bytes(b"worle")
    assert weights_root(checkpoint) != SPEC_ROOT


def test_a_linked_weights_file_is_refused(tmp_path: Path) -> None:
    (tmp_path / "checkpoint").mkdir()
    checkpoint = _spec_checkpoint(tmp_path / "checkpoint")
    elsewhere = tmp_path / "blob"
    elsewhere.write_bytes(b"third")
    (checkpoint / "model-extra.safetensors").symlink_to(elsewhere)
    with pytest.raises(ValidationError, match="not a regular file"):
        weights_root(checkpoint)


def _index(*names: str) -> str:
    return json.dumps({"weight_map": {f"tensor.{name}": name for name in names}})


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _git_blob(content: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(content) + content, usedforsecurity=False).hexdigest()


def _cache_snapshot(root: Path, repo_folder: str = "models--Qwen--Qwen3-8B") -> Path:
    """A Hugging Face cache snapshot of the spec's two files, each a link to a blob in blobs/
    named by its SHA-256, and a config.json named by its git blob hash."""
    blobs = root / repo_folder / "blobs"
    snapshot = root / repo_folder / "snapshots" / ("b" * 40)
    blobs.mkdir(parents=True)
    snapshot.mkdir(parents=True)
    for name, content in SPEC_FILES.items():
        (blobs / _sha256(content)).write_bytes(content)
        (snapshot / name).symlink_to(Path("../../blobs") / _sha256(content))
    config = b'{"model_type": "qwen3"}'
    (blobs / _git_blob(config)).write_bytes(config)
    (snapshot / "config.json").symlink_to(Path("../../blobs") / _git_blob(config))
    return snapshot


def _share(hub: Path, content: bytes) -> Path:
    """Move a repository blob into the shared <hub>/blobs/<xx>/, as huggingface_hub 2.3 does,
    under a name of the shared store's own."""
    repo_blob = hub / "models--Qwen--Qwen3-8B" / "blobs" / _sha256(content)
    shared = hub / "blobs" / "ab" / ("ab" + "0" * 62)
    shared.parent.mkdir(parents=True, exist_ok=True)
    repo_blob.rename(shared)
    repo_blob.symlink_to(Path("../../blobs/ab") / shared.name)
    return shared


def test_a_cache_snapshot_follows_links_into_its_own_blobs(tmp_path: Path) -> None:
    snapshot = _cache_snapshot(tmp_path)
    assert weights_root(snapshot) == SPEC_ROOT
    named = cache_snapshot(snapshot)
    assert named is not None
    assert (named.repo, named.revision) == ("Qwen/Qwen3-8B", "b" * 40)


def test_a_cache_snapshot_follows_a_second_link_into_the_shared_blobs(tmp_path: Path) -> None:
    """huggingface_hub 2.3 links snapshot -> repository blobs -> <hub>/blobs/<xx>/<name>."""
    hub = tmp_path / "hub"
    snapshot = _cache_snapshot(hub)
    _share(hub, b"hello")
    assert weights_root(snapshot) == SPEC_ROOT
    assert config_digest(snapshot) == file_root(snapshot, {"config.json"})


def test_a_cache_snapshot_refuses_a_second_link_out_of_the_cache(tmp_path: Path) -> None:
    hub = tmp_path / "hub"
    snapshot = _cache_snapshot(hub)
    outside = tmp_path / "outside"
    outside.write_bytes(b"hello")
    repo_blob = hub / "models--Qwen--Qwen3-8B" / "blobs" / _sha256(b"hello")
    repo_blob.unlink()
    repo_blob.symlink_to(outside)
    with pytest.raises(ValidationError, match="not a regular file"):
        weights_root(snapshot)


@pytest.mark.parametrize("folder", ["models--Qwen--Qwen3-8B/blobs", "blobs"])
def test_a_cache_whose_blobs_folder_is_a_link_is_refused(tmp_path: Path, folder: str) -> None:
    hub = tmp_path / "hub"
    snapshot = _cache_snapshot(hub)
    _share(hub, b"hello")
    real = tmp_path / "elsewhere"
    (hub / folder).rename(real)
    (hub / folder).symlink_to(real)
    with pytest.raises(ValidationError, match="not a regular file"):
        weights_root(snapshot)


@pytest.mark.parametrize("shared", [False, True], ids=["repository blob", "shared blob"])
def test_a_cache_blob_whose_bytes_do_not_match_its_name_is_refused(
    tmp_path: Path, shared: bool
) -> None:
    hub = tmp_path / "hub"
    snapshot = _cache_snapshot(hub)
    blob = (
        _share(hub, b"hello")
        if shared
        else hub / "models--Qwen--Qwen3-8B" / "blobs" / _sha256(b"hello")
    )
    blob.write_bytes(b"jello")
    with pytest.raises(ValidationError, match="download it again"):
        weights_root(snapshot)


def test_a_cache_config_whose_bytes_do_not_match_its_git_name_is_refused(tmp_path: Path) -> None:
    snapshot = _cache_snapshot(tmp_path)
    (snapshot / "config.json").resolve().write_bytes(b'{"model_type": "llama"}')
    with pytest.raises(ValidationError, match="download it again"):
        config_digest(snapshot)


def test_a_cache_snapshot_refuses_a_link_out_of_its_blobs(tmp_path: Path) -> None:
    snapshot = _cache_snapshot(tmp_path)
    outside = tmp_path / "outside"
    outside.write_bytes(b"third")
    (snapshot / "model-extra.safetensors").symlink_to(outside)
    with pytest.raises(ValidationError, match="not a regular file"):
        weights_root(snapshot)


def test_links_are_followed_only_in_a_folder_shaped_like_a_snapshot(tmp_path: Path) -> None:
    snapshot = _cache_snapshot(tmp_path, repo_folder="models--not-a-repo")
    assert cache_snapshot(snapshot) is None
    with pytest.raises(ValidationError, match="not a regular file"):
        weights_root(snapshot)


def test_a_folder_with_none_of_the_files_is_refused(tmp_path: Path) -> None:
    (tmp_path / "config.json").write_text("{}")
    with pytest.raises(ValidationError):
        weights_root(tmp_path)
    with pytest.raises(ValidationError):
        file_root(tmp_path, set())


def test_tokenizer_digest_covers_the_tokenizer_files_present(tmp_path: Path) -> None:
    (tmp_path / "tokenizer.json").write_bytes(b"{}")
    (tmp_path / "merges.txt").write_bytes(b"a b")
    (tmp_path / "config.json").write_bytes(b"{}")
    assert tokenizer_digest(tmp_path) == file_root(tmp_path, {"tokenizer.json", "merges.txt"})


def test_chat_template_prefers_the_jinja_file(tmp_path: Path) -> None:
    (tmp_path / "chat_template.jinja").write_bytes(b"{{ messages }}")
    (tmp_path / "tokenizer_config.json").write_text(json.dumps({"chat_template": "other"}))
    assert chat_template_digest(tmp_path) == sha256_digest_bytes(b"{{ messages }}")


def test_chat_template_from_tokenizer_config(tmp_path: Path) -> None:
    config = tmp_path / "tokenizer_config.json"
    config.write_text(json.dumps({"chat_template": "{{ messages }}"}))
    assert chat_template_digest(tmp_path) == sha256_digest_bytes(b"{{ messages }}")
    named = [{"name": "default", "template": "{{ messages }}"}]
    config.write_text(json.dumps({"chat_template": named}))
    assert chat_template_digest(tmp_path) == sha256_digest_bytes(canonical_json_bytes(named))


def test_a_checkpoint_with_no_chat_template_is_refused(tmp_path: Path) -> None:
    (tmp_path / "tokenizer_config.json").write_text("{}")
    with pytest.raises(ValidationError, match="no chat template"):
        chat_template_digest(tmp_path)


@pytest.mark.parametrize(
    "files",
    [("model-00001-of-00002.safetensors",), (*SPEC_FILES, "model-extra.safetensors")],
    ids=["a listed file missing", "a file the index does not list"],
)
def test_weights_that_are_not_the_ones_the_index_lists_are_refused(
    tmp_path: Path, files: tuple[str, ...]
) -> None:
    for name in files:
        (tmp_path / name).write_bytes(SPEC_FILES.get(name, b"extra"))
    (tmp_path / "model.safetensors.index.json").write_text(_index(*SPEC_FILES))
    with pytest.raises(ValidationError, match="index"):
        weights_root(tmp_path)


def test_config_digest_covers_the_generation_config_when_present(tmp_path: Path) -> None:
    (tmp_path / "config.json").write_bytes(b"{}")
    alone = config_digest(tmp_path)
    (tmp_path / "generation_config.json").write_bytes(b'{"temperature": 0.6}')
    assert config_digest(tmp_path) == file_root(tmp_path, {"config.json", "generation_config.json"})
    assert config_digest(tmp_path) != alone
    (tmp_path / "config.json").unlink()
    with pytest.raises(ValidationError, match=r"no config\.json"):
        config_digest(tmp_path)


def test_a_snapshot_file_replaced_in_place_is_refused(tmp_path: Path) -> None:
    """Editors and `sed -i` save by replacing the snapshot's link with a plain file."""
    snapshot = _cache_snapshot(tmp_path)
    config = snapshot / "config.json"
    config.unlink()
    config.write_bytes(b'{"model_type": "qwen3", "max_position_embeddings": 131072}')
    with pytest.raises(ValidationError, match="download it again"):
        config_digest(snapshot)


@pytest.mark.parametrize(
    "content",
    ['{"chat_template": ' + "9" * 5000 + "}", "[" * 100_000 + "]" * 100_000],
    ids=["a number too long", "nesting too deep"],
)
def test_a_tokenizer_config_this_reader_cannot_hold_is_refused(
    tmp_path: Path, content: str
) -> None:
    (tmp_path / "tokenizer_config.json").write_text(content)
    with pytest.raises(ValidationError, match="not JSON this reader can hold"):
        chat_template_digest(tmp_path)
