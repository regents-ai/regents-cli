"""The open-weights model block a model substitution Campaign names its subject model by.

Techtree's model substitution spec, section 2: the weights by repository, commit and file
root, the tokenizer and chat template by digest, how the weights are served, and, on the
candidate, how its weights were derived from the baseline's.
"""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import PositiveInt, StringConstraints, model_validator

from regents_cli.techtree.models.base import Digest, NonEmptyString, ProtocolModel

#: A full git commit: 40 lowercase hexadecimal characters.
type GitCommit = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{40}$")]


class WeightsRef(ProtocolModel):
    """The weights: a repository and commit, or neither for weights kept on the operator's
    machine, and the root over their files."""

    repo: NonEmptyString | None
    revision: GitCommit | None
    weights_root: Digest

    @model_validator(mode="after")
    def _check_a_revision_names_its_repo(self) -> Self:
        if self.revision is not None and self.repo is None:
            raise ValueError("a weights revision names the repository it is a commit of")
        return self


class ServingSpec(ProtocolModel):
    """How the weights are served, the same on both sides."""

    engine: Literal["vllm"]
    version: NonEmptyString
    dtype: NonEmptyString
    quantization: NonEmptyString | None
    max_model_len: PositiveInt


class SourceRef(ProtocolModel):
    """The baseline weights a derivation started from."""

    repo: NonEmptyString
    revision: GitCommit


class Derivation(ProtocolModel):
    """How the candidate's weights were made from the baseline's."""

    tool: Literal["obliteratus"]
    tool_commit: GitCommit
    source: SourceRef
    method: NonEmptyString
    method_config_digest: Digest
    seed: int | None
    weights_root: Digest


class OpenWeightsModel(ProtocolModel):
    """The subject model of a model substitution Campaign."""

    weights: WeightsRef
    tokenizer_digest: Digest
    chat_template_digest: Digest
    serving: ServingSpec
    derivation: Derivation | None

    @model_validator(mode="after")
    def _check_the_derivation_names_these_weights(self) -> Self:
        if (
            self.derivation is not None
            and self.derivation.weights_root != self.weights.weights_root
        ):
            raise ValueError("a derivation record names the weights it describes")
        return self
