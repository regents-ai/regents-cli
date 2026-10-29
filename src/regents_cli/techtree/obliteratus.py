"""An OBLITERATUS checkpoint as the two model blocks of a model substitution pair.

Techtree's model substitution spec, section 6. This module reads files only: no OBLITERATUS
code is imported, vendored or run, which keeps regents-cli clear of OBLITERATUS's AGPL-3.0
terms. Every digest in a block is computed here from the files; none is taken from the
checkpoint's own records, and no local path is ever written into a block.

It reads the pipeline export's `abliteration_metadata.json` (OBLITERATUS `abliterate.py`,
`_build_metadata`, at 43b5d6d): `source_model`, `provenance`, `method`, `method_config`,
`seed` and `concept.repair_adapter`. The source model is a Hugging Face cache snapshot of
exactly the repository and commit the checkpoint names.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Final, NoReturn

from pydantic import BaseModel, ConfigDict
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.fs import read_json
from regents_cli.techtree.model_files import (
    cache_snapshot,
    chat_template_digest,
    config_digest,
    tokenizer_digest,
    weights_root,
)
from regents_cli.techtree.models.base import JsonValue, NonEmptyString
from regents_cli.techtree.models.open_weights import (
    Derivation,
    OpenWeightsModel,
    Seed,
    ServingSpec,
    SourceRef,
    WeightsRef,
)

METADATA_FILE: Final = "abliteration_metadata.json"
CHECKPOINT_REFUSED: Final = "obliteratus_checkpoint_refused"
_COMMIT_RE: Final = re.compile(r"^[0-9a-f]{40}$")
_LOCAL_PATH_STARTS: Final = ("/", "~", ".")


class _Upstream(BaseModel):
    """A record OBLITERATUS writes: only the members read here are checked."""

    model_config = ConfigDict(strict=True, extra="ignore", frozen=True)


class _ToolProvenance(_Upstream):
    obliteratus_git_commit: str | None
    obliteratus_git_dirty: bool | None
    source_model_revision: str | None


class _RepairAdapter(_Upstream):
    merged: bool


class _Concept(_Upstream):
    repair_adapter: _RepairAdapter | None = None


class _PipelineMetadata(_Upstream):
    source_model: NonEmptyString
    provenance: _ToolProvenance
    method: NonEmptyString
    method_config: dict[str, JsonValue]
    seed: Seed | None = None
    concept: _Concept


@dataclass(frozen=True)
class SubstitutionPair:
    """The baseline's model block, from the source snapshot, and the candidate's."""

    baseline: OpenWeightsModel
    candidate: OpenWeightsModel


def import_checkpoint(checkpoint: Path, source: Path, serving: ServingSpec) -> SubstitutionPair:
    """The two model blocks for `checkpoint`, abliterated from the snapshot at `source`."""
    metadata = _read_metadata(checkpoint)
    commit = _require_commit(
        metadata.provenance.obliteratus_git_commit,
        "the checkpoint names no OBLITERATUS commit, so the tool that made it cannot be named; "
        "run OBLITERATUS from a git checkout at a clean commit, since an installed copy records "
        "none",
    )
    if metadata.provenance.obliteratus_git_dirty is not False:
        _refuse(
            "OBLITERATUS ran from a checkout with uncommitted changes, or did not say, so its "
            "commit does not describe the code that made these weights",
            obliteratus_git_dirty=metadata.provenance.obliteratus_git_dirty,
        )
    if metadata.concept.repair_adapter is not None and not metadata.concept.repair_adapter.merged:
        _refuse(
            "the checkpoint carries a repair adapter that is not merged, so the served weights "
            "would not be the weights digested here"
        )
    named = _source_named_by(metadata)
    snapshot = cache_snapshot(source)
    if snapshot is None:
        _refuse(
            "the source must be a Hugging Face cache snapshot folder, "
            ".../models--<org>--<name>/snapshots/<commit>",
            source=str(source),
        )
    if (snapshot.repo, snapshot.revision) != (named.repo, named.revision):
        _refuse(
            f"the source snapshot is {snapshot.repo} at {snapshot.revision}, but the checkpoint "
            f"was made from {named.repo} at {named.revision}",
            snapshot_repo=snapshot.repo,
            snapshot_revision=snapshot.revision,
            checkpoint_repo=named.repo,
            checkpoint_revision=named.revision,
        )
    baseline_config, candidate_config = config_digest(source), config_digest(checkpoint)
    if baseline_config != candidate_config:
        _refuse(
            "the checkpoint's config.json or generation_config.json differs from the source's, "
            "so the pair would change more than the weights. If the export only rewrote them "
            "(their order, dtype or library version), copy the source snapshot's own into the "
            "checkpoint; the served dtype is the one --dtype names",
            baseline_config_digest=baseline_config,
            candidate_config_digest=candidate_config,
        )
    baseline_tokenizer, candidate_tokenizer = tokenizer_digest(source), tokenizer_digest(checkpoint)
    if baseline_tokenizer != candidate_tokenizer:
        _refuse(
            "the checkpoint's tokenizer files differ from the source's, so the pair would "
            "change more than the weights. If the export only re-saved the source's tokenizer, "
            "make the checkpoint's tokenizer files the source's own: copy each one in from the "
            "source snapshot and remove any the source does not have",
            baseline_tokenizer_digest=baseline_tokenizer,
            candidate_tokenizer_digest=candidate_tokenizer,
        )
    baseline_template, candidate_template = (
        chat_template_digest(source),
        chat_template_digest(checkpoint),
    )
    if baseline_template != candidate_template:
        _refuse(
            "the checkpoint's chat template differs from the source's, so the pair would "
            "change more than the weights",
            baseline_chat_template_digest=baseline_template,
            candidate_chat_template_digest=candidate_template,
        )
    baseline_root, candidate_root = weights_root(source), weights_root(checkpoint)
    if baseline_root == candidate_root:
        _refuse(
            "the checkpoint's weights are byte for byte the source's, so the pair would "
            "measure nothing",
            weights_root=baseline_root,
        )
    baseline = OpenWeightsModel(
        weights=WeightsRef(repo=named.repo, revision=named.revision, weights_root=baseline_root),
        config_digest=baseline_config,
        tokenizer_digest=baseline_tokenizer,
        chat_template_digest=baseline_template,
        serving=serving,
        derivation=None,
    )
    candidate = OpenWeightsModel(
        weights=WeightsRef(repo=None, revision=None, weights_root=candidate_root),
        config_digest=candidate_config,
        tokenizer_digest=candidate_tokenizer,
        chat_template_digest=candidate_template,
        serving=serving,
        derivation=Derivation(
            tool="obliteratus",
            tool_commit=commit,
            source=named,
            method=metadata.method,
            method_config_digest=digest_object(metadata.method_config),
            seed=metadata.seed,
            weights_root=candidate_root,
        ),
    )
    return SubstitutionPair(baseline=baseline, candidate=candidate)


def _read_metadata(checkpoint: Path) -> _PipelineMetadata:
    raw = read_json(checkpoint / METADATA_FILE)
    try:
        return _PipelineMetadata.model_validate(raw)
    except PydanticValidationError as error:
        problems = [
            f"{'.'.join(str(part) for part in issue['loc']) or 'the file'}: {issue['msg']}"
            for issue in error.errors()
        ]
        _refuse(
            f"{METADATA_FILE} is not an OBLITERATUS pipeline export: " + "; ".join(problems),
            problems=list(problems),
        )


def _source_named_by(metadata: _PipelineMetadata) -> SourceRef:
    """The repository and commit the checkpoint says it was made from."""
    revision = _require_commit(
        metadata.provenance.source_model_revision,
        "the checkpoint names no commit of its source model, so the original cannot be named "
        "exactly",
    )
    snapshot = cache_snapshot(Path(metadata.source_model))
    if snapshot is not None:
        if snapshot.revision != revision:
            _refuse(
                f"the checkpoint's source folder is commit {snapshot.revision}, but it names "
                f"commit {revision}",
                source_model_revision=revision,
            )
        return SourceRef(repo=snapshot.repo, revision=revision)
    if metadata.source_model.startswith(_LOCAL_PATH_STARTS):
        _refuse(
            "the checkpoint was made from a local folder that is not a Hugging Face cache "
            "snapshot, so its source has no repository to name"
        )
    return SourceRef(repo=metadata.source_model, revision=revision)


def _require_commit(value: str | None, message: str) -> str:
    """`value` when it is a full lowercase git commit; refused with `message` otherwise."""
    if value is None or _COMMIT_RE.fullmatch(value) is None:
        _refuse(message, named=value)
    return value


def _refuse(message: str, **details: JsonValue) -> NoReturn:
    raise ValidationError(message, code=CHECKPOINT_REFUSED, details=dict(details))
