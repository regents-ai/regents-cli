"""`regents techtree model import-obliteratus` writes a pair Techtree will accept, or refuses.

The costly failure: a model block whose digests were not computed from the files, or a pair
that changes more than the weights, is published as a controlled comparison of one change.
"""

from __future__ import annotations

import contextlib
import io
import json
from collections.abc import Callable
from pathlib import Path

import pytest

from regents_cli import app
from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.models.open_weights import OpenWeightsModel

REPO = "Qwen/Qwen3-8B"
REVISION = "b968826d9c46dd6066d109eabc6255188de91218"
TOOL_COMMIT = "43b5d6d" + "0" * 33
SPEC_ROOT = "sha256:4e70f644497973aaaf7a6870ac92f125a87ad4a5017e714291de392629d5918a"
METHOD_CONFIG = {"n_directions": 4, "norm_preserve": True, "regularization": 0.25}
SOURCE_FILES = {
    "model-00001-of-00002.safetensors": b"hello",
    "model-00002-of-00002.safetensors": b"world",
    "config.json": b'{"model_type": "qwen3"}',
    "tokenizer.json": b'{"vocab": {}}',
    "tokenizer_config.json": b'{"chat_template": "{{ messages }}"}',
}


def _snapshot(root: Path) -> Path:
    """A Hugging Face cache snapshot: every file a link into the repository's blobs/."""
    repo_folder = root / "hub" / "models--Qwen--Qwen3-8B"
    snapshot = repo_folder / "snapshots" / REVISION
    (repo_folder / "blobs").mkdir(parents=True)
    snapshot.mkdir(parents=True)
    for number, (name, content) in enumerate(SOURCE_FILES.items()):
        blob = repo_folder / "blobs" / f"blob{number}"
        blob.write_bytes(content)
        (snapshot / name).symlink_to(Path("../../blobs") / blob.name)
    return snapshot


def _metadata(**changes: object) -> dict[str, object]:
    metadata: dict[str, object] = {
        "source_model": REPO,
        "provenance": {
            "obliteratus_version": "0.9.0",
            "obliteratus_git_commit": TOOL_COMMIT,
            "obliteratus_git_dirty": False,
            "source_model_revision": REVISION,
        },
        "technique": "refusal_direction_ablation",
        "concept": {"id": "refusal", "version": "1", "seed": 7},
        "method": "advanced",
        "seed": 7,
        "method_config": METHOD_CONFIG,
    }
    metadata.update(changes)
    return metadata


def _checkpoint(root: Path, metadata: dict[str, object]) -> Path:
    """A pipeline export: the source's files with one shard changed, and its metadata."""
    checkpoint = root / "abliterated"
    checkpoint.mkdir()
    for name, content in SOURCE_FILES.items():
        (checkpoint / name).write_bytes(content)
    (checkpoint / "model-00001-of-00002.safetensors").write_bytes(b"HELLO")
    (checkpoint / "abliteration_metadata.json").write_text(json.dumps(metadata))
    return checkpoint


def _import(checkpoint: Path, source: Path) -> tuple[int, dict[str, object]]:
    shown = io.StringIO()
    with contextlib.redirect_stdout(shown), contextlib.redirect_stderr(io.StringIO()):
        exit_code = app.main(
            [
                "techtree",
                "model",
                "import-obliteratus",
                str(checkpoint),
                "--source",
                str(source),
                "--vllm-version",
                "0.11.0",
                "--dtype",
                "bfloat16",
                "--max-model-len",
                "32768",
                "--json",
            ]
        )
    return exit_code, json.loads(shown.getvalue())


def test_a_checkpoint_becomes_a_pair_that_differs_only_in_the_weights(tmp_path: Path) -> None:
    source = _snapshot(tmp_path)
    exit_code, answer = _import(_checkpoint(tmp_path, _metadata()), source)

    assert exit_code == 0, answer
    baseline = OpenWeightsModel.model_validate_json(json.dumps(answer["baseline"]))
    candidate = OpenWeightsModel.model_validate_json(json.dumps(answer["candidate"]))
    assert (baseline.weights.repo, baseline.weights.revision) == (REPO, REVISION)
    assert baseline.weights.weights_root == SPEC_ROOT
    assert baseline.derivation is None
    assert candidate.weights.repo is None and candidate.weights.revision is None
    assert candidate.weights.weights_root not in (SPEC_ROOT, None)
    assert candidate.derivation is not None
    assert candidate.derivation.source.repo == REPO
    assert candidate.derivation.source.revision == REVISION
    assert candidate.derivation.tool_commit == TOOL_COMMIT
    assert candidate.derivation.method_config_digest == digest_object(METHOD_CONFIG)
    assert candidate.derivation.seed == 7
    unchanged = {"weights", "derivation"}
    assert baseline.model_dump(exclude=unchanged) == candidate.model_dump(exclude=unchanged)
    assert str(tmp_path) not in json.dumps(answer)


def test_a_checkpoint_made_from_the_cache_snapshot_names_its_repository(tmp_path: Path) -> None:
    source = _snapshot(tmp_path)
    exit_code, answer = _import(_checkpoint(tmp_path, _metadata(source_model=str(source))), source)

    assert exit_code == 0, answer
    assert answer["baseline"]["weights"]["repo"] == REPO  # type: ignore[index]
    assert str(tmp_path) not in json.dumps(answer)


def _dirty(metadata: dict[str, object]) -> None:
    metadata["provenance"]["obliteratus_git_dirty"] = True  # type: ignore[index]


def _no_commit(metadata: dict[str, object]) -> None:
    metadata["provenance"]["obliteratus_git_commit"] = None  # type: ignore[index]


def _no_source_revision(metadata: dict[str, object]) -> None:
    metadata["provenance"]["source_model_revision"] = None  # type: ignore[index]


def _local_source(metadata: dict[str, object]) -> None:
    metadata["source_model"] = "/home/operator/models/qwen"


def _unmerged_repair(metadata: dict[str, object]) -> None:
    metadata["concept"]["repair_adapter"] = {  # type: ignore[index]
        "path": "repair_adapter",
        "merged": False,
        "base": "exported checkpoint",
        "base_verified": False,
    }


def _other_revision(metadata: dict[str, object]) -> None:
    metadata["provenance"]["source_model_revision"] = "a" * 40  # type: ignore[index]


def _not_a_pipeline_export(metadata: dict[str, object]) -> None:
    metadata.clear()
    metadata.update({"schema_version": 2, "checkpoint_provenance": "checkpoint-provenance.json"})


def _config_rewritten(checkpoint: Path) -> None:
    (checkpoint / "config.json").write_bytes(b'{"model_type": "qwen3", "torch_dtype": "float32"}')


def _tokenizer_rewritten(checkpoint: Path) -> None:
    (checkpoint / "tokenizer.json").write_bytes(b'{"vocab": {"a": 1}}')


def _template_changed(checkpoint: Path) -> None:
    (checkpoint / "chat_template.jinja").write_bytes(b"{{ other }}")


def _weights_unchanged(checkpoint: Path) -> None:
    (checkpoint / "model-00001-of-00002.safetensors").write_bytes(b"hello")


@pytest.mark.parametrize(
    "change_metadata",
    [
        _dirty,
        _no_commit,
        _no_source_revision,
        _local_source,
        _unmerged_repair,
        _other_revision,
        _not_a_pipeline_export,
    ],
)
def test_a_checkpoint_that_cannot_be_named_exactly_is_refused(
    tmp_path: Path, change_metadata: Callable[[dict[str, object]], None]
) -> None:
    metadata = _metadata()
    change_metadata(metadata)
    exit_code, answer = _import(_checkpoint(tmp_path, metadata), _snapshot(tmp_path))

    assert exit_code != 0
    assert answer["error"]["code"] == "obliteratus_checkpoint_refused"  # type: ignore[index]


@pytest.mark.parametrize(
    "change_files",
    [_config_rewritten, _tokenizer_rewritten, _template_changed, _weights_unchanged],
)
def test_a_pair_that_changes_more_or_less_than_the_weights_is_refused(
    tmp_path: Path, change_files: Callable[[Path], None]
) -> None:
    checkpoint = _checkpoint(tmp_path, _metadata())
    change_files(checkpoint)
    exit_code, answer = _import(checkpoint, _snapshot(tmp_path))

    assert exit_code != 0
    assert answer["error"]["code"] == "obliteratus_checkpoint_refused"  # type: ignore[index]
