"""Model file digests match Techtree's model substitution spec byte for byte.

The costly failure: a root that differs from Techtree's own makes every model substitution run
fail to verify, or worse, lets two different checkpoints share a root.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from regents_cli.techtree.canonical import canonical_json_bytes, sha256_digest_bytes
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.model_files import (
    cache_snapshot,
    chat_template_digest,
    file_root,
    tokenizer_digest,
    weights_root,
)

SPEC_ROOT = "sha256:4e70f644497973aaaf7a6870ac92f125a87ad4a5017e714291de392629d5918a"


def _spec_checkpoint(directory: Path) -> Path:
    (directory / "model-00002-of-00002.safetensors").write_bytes(b"world")
    (directory / "model-00001-of-00002.safetensors").write_bytes(b"hello")
    return directory


def test_the_spec_vector(tmp_path: Path) -> None:
    checkpoint = _spec_checkpoint(tmp_path)
    assert weights_root(checkpoint) == SPEC_ROOT


def test_weights_root_covers_only_safetensors_directly_in_the_folder(tmp_path: Path) -> None:
    checkpoint = _spec_checkpoint(tmp_path)
    (checkpoint / "model.safetensors.index.json").write_text("{}")
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


def _cache_snapshot(root: Path, repo_folder: str = "models--Qwen--Qwen3-8B") -> Path:
    """A Hugging Face cache snapshot of the spec's two files, each a link into blobs/."""
    blobs = root / repo_folder / "blobs"
    snapshot = root / repo_folder / "snapshots" / ("b" * 40)
    blobs.mkdir(parents=True)
    snapshot.mkdir(parents=True)
    for name, content in (
        ("model-00001-of-00002.safetensors", b"hello"),
        ("model-00002-of-00002.safetensors", b"world"),
    ):
        (blobs / name.split("-")[1]).write_bytes(content)
        (snapshot / name).symlink_to(Path("../../blobs") / name.split("-")[1])
    return snapshot


def test_a_cache_snapshot_follows_links_into_its_own_blobs(tmp_path: Path) -> None:
    snapshot = _cache_snapshot(tmp_path)
    assert weights_root(snapshot) == SPEC_ROOT
    named = cache_snapshot(snapshot)
    assert named is not None
    assert (named.repo, named.revision) == ("Qwen/Qwen3-8B", "b" * 40)


def test_a_cache_snapshot_follows_a_second_link_into_the_shared_blobs(tmp_path: Path) -> None:
    """huggingface_hub 2.3 links snapshot -> repository blobs -> <hub>/blobs/<xx>/<hash>."""
    hub = tmp_path / "hub"
    snapshot = _cache_snapshot(hub)
    for name in ("00001", "00002"):
        repo_blob = hub / "models--Qwen--Qwen3-8B" / "blobs" / name
        shared = hub / "blobs" / "ab" / f"hash{name}"
        shared.parent.mkdir(parents=True, exist_ok=True)
        shared.write_bytes(repo_blob.read_bytes())
        repo_blob.unlink()
        repo_blob.symlink_to(Path("../../blobs/ab") / shared.name)
    assert weights_root(snapshot) == SPEC_ROOT


def test_a_cache_snapshot_refuses_a_second_link_out_of_the_cache(tmp_path: Path) -> None:
    hub = tmp_path / "hub"
    snapshot = _cache_snapshot(hub)
    outside = tmp_path / "outside"
    outside.write_bytes(b"hello")
    repo_blob = hub / "models--Qwen--Qwen3-8B" / "blobs" / "00001"
    repo_blob.unlink()
    repo_blob.symlink_to(outside)
    with pytest.raises(ValidationError, match="not a regular file"):
        weights_root(snapshot)


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
