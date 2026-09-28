"""Candidate Skills and the draft that submits them.

A `SkillArtifact` is the content-addressed description of what a participant wrote; no local
path ever enters it. A `SubmissionDraft` states what will have to be accepted; recording that
it was accepted is the run request's job.
"""

from __future__ import annotations

from typing import Final, Literal, Self

from pydantic import Field, model_validator

from regents_cli.techtree.models.base import Digest, NonEmptyString, ProtocolModel, UtcDateTime
from regents_cli.techtree.models.campaign import ProgramRef, PublicContext

#: The one file every instruction Skill must contain.
SKILL_ENTRY_FILE: Final = "SKILL.md"


def check_relative_posix_path(value: str) -> None:
    """Raise when a path is absolute, escaping, or not POSIX-spelled."""
    if value != value.strip():
        raise ValueError(f"path has surrounding whitespace: {value!r}")
    if value.startswith("/") or (len(value) > 1 and value[1] == ":"):
        raise ValueError(f"paths are relative; got {value!r}")
    if "\\" in value:
        raise ValueError(f"paths use forward slashes; got {value!r}")
    if any(segment in ("", ".", "..") for segment in value.split("/")):
        raise ValueError(f"path is not a normalized relative path: {value!r}")


class SkillFile(ProtocolModel):
    """One file inside a Skill, addressed by content."""

    path: NonEmptyString
    media_type: NonEmptyString
    size: int = Field(ge=0)
    digest: Digest

    @model_validator(mode="after")
    def _check_path(self) -> Self:
        check_relative_posix_path(self.path)
        return self


class SkillArtifact(ProtocolModel):
    """A complete candidate Skill, addressed by content."""

    schema_version: Literal["techtree.skill.v1alpha1"]
    name: NonEmptyString
    root_digest: Digest
    files: list[SkillFile]
    source_kind: Literal["manual"]
    parent_skill_digest: Digest | None

    @model_validator(mode="after")
    def _check_file_list(self) -> Self:
        """Require the entry file, a stable order, and no repeated path."""
        paths = [file.path for file in self.files]
        if SKILL_ENTRY_FILE not in paths:
            raise ValueError(f"a skill must contain {SKILL_ENTRY_FILE}")
        if len(set(paths)) != len(paths):
            raise ValueError("a skill lists each path exactly once")
        if paths != sorted(paths):
            raise ValueError("skill files are sorted by path so the same tree has one digest")
        return self


class PolicyAcceptanceRequirement(ProtocolModel):
    """The rights policy a participant is being asked to accept."""

    data_policy_digest: Digest
    required: bool
    summary: NonEmptyString


class SubmissionDraft(ProtocolModel):
    """Everything a participant is about to commit to, in one object."""

    schema_version: Literal["techtree.submission-draft.v1alpha1"]
    id: NonEmptyString
    campaign_spec_digest: Digest
    program_ref: ProgramRef | None
    public_context: PublicContext
    data_policy_digest: Digest
    outcome_contract_digest: Digest | None
    skill_artifact: SkillArtifact
    baseline_manifest_digest: Digest
    candidate_manifest_digest: Digest
    included_files: list[NonEmptyString]
    estimated_episodes: int = Field(ge=1)
    policy_acceptance: PolicyAcceptanceRequirement
    warnings: list[NonEmptyString]
    created_at: UtcDateTime

    @model_validator(mode="after")
    def _check_draft(self) -> Self:
        """Keep the draft self-consistent about rights, files, and variants."""
        if self.policy_acceptance.data_policy_digest != self.data_policy_digest:
            raise ValueError("the draft asks for acceptance of a different DataPolicy")
        if self.baseline_manifest_digest == self.candidate_manifest_digest:
            raise ValueError("baseline and candidate manifests must differ")
        for path in self.included_files:
            check_relative_posix_path(path)
        if self.included_files != sorted(self.included_files):
            raise ValueError("included_files is sorted")
        if len(set(self.included_files)) != len(self.included_files):
            raise ValueError("included_files lists each path exactly once")
        if self.included_files != [file.path for file in self.skill_artifact.files]:
            raise ValueError("included_files must be exactly the files in the skill artifact")
        return self
