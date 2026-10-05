"""Run-owned inputs and execution outputs.

A run never reads the draft it came from. Everything the executor needs is copied into
``runs/<run-id>/inputs/`` before the worker is launched, verified there against the run's own
immutable request, and read back from that copy. The tree is assembled under a staging name
and renamed into place, so a crash leaves either no ``inputs/`` or a complete, checked one.
Bytes are copied, never linked: a hard link to a user-controlled file is the same file.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object, sha256_digest_bytes
from regents_cli.techtree.drafts.source import CampaignSource, StagedSkill
from regents_cli.techtree.drafts.store import DraftSnapshot, verify_staged_skill
from regents_cli.techtree.errors import NotFoundError, ValidationError, VerificationError
from regents_cli.techtree.fs import (
    ensure_private_directory,
    fsync_directory,
    open_exclusive,
    remove_tree,
)
from regents_cli.techtree.models.base import ArtifactRef, Digest, JsonValue
from regents_cli.techtree.models.campaign import CampaignSpecV4
from regents_cli.techtree.models.climb import ClimbManifest, ResolvedClimb
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.episode_receipt import EpisodeReceiptV3
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import (
    ExperimentManifestV4,
    ExperimentVariant,
    ManifestComparison,
)
from regents_cli.techtree.models.run import RunRequestV2
from regents_cli.techtree.models.skill import SkillArtifact, SubmissionDraft
from regents_cli.techtree.models.validation import TasksetValidationReceipt, ValidationEvidence
from regents_cli.techtree.paths import TechtreePaths

RUN_INPUT_STAGING_FAILED: Final = "run_input_staging_failed"
VALIDATION_MARKER_SCHEMA_VERSION: Final = "techtree.taskset-validation-outcome.v1"

_JSON_MEDIA_TYPE: Final = "application/json"
_INPUTS_DIR: Final = "inputs"
_STAGING_PREFIX: Final = ".staging-inputs-"
_DRAFT_FILE: Final = "draft.json"
_COMPARISON_FILE: Final = "comparison.json"
_PUBLIC_DIR: Final = "public"
_CLIMB_FILE: Final = "climb.json"
_CAMPAIGN_FILE: Final = "campaign.json"
_DATA_POLICY_FILE: Final = "data-policy.json"
_VALIDATION_RECEIPT_FILE: Final = "publisher-validation.json"
_EVIDENCE_FILE: Final = "publisher-validation-evidence.json"
_EXECUTION_PLAN_FILE: Final = "execution-plan.json"
_MANIFESTS_DIR: Final = "manifests"
_BASELINE_FILE: Final = "baseline.json"
_CANDIDATE_FILE: Final = "candidate.json"
_SKILL_DIR: Final = "skill"
_ARTIFACT_FILE: Final = "artifact.json"
_FILES_DIR: Final = "files"
_VALIDATION_DIR: Final = "validation"
_VALIDATION_MARKER_FILE: Final = "development.json"
_RECEIPTS_DIR: Final = "receipts"
#: Four digits order a run's receipts lexicographically for every permitted task count.
_POSITION_WIDTH: Final = 4
_FILE_MODE: Final = 0o600


@dataclass(frozen=True)
class RunInputBundle:
    """Everything one run executes, loaded from the run's own copies."""

    request: RunRequestV2
    draft: SubmissionDraft
    source: CampaignSource
    validation_evidence: ValidationEvidence
    baseline: ExperimentManifestV4
    candidate: ExperimentManifestV4
    comparison: ManifestComparison
    candidate_skill: StagedSkill

    @property
    def campaign(self) -> CampaignSpecV4:
        return self.source.campaign

    @property
    def execution_plan(self) -> ResolvedExecutionPlan:
        return self.source.execution_plan

    @property
    def ordered_task_hashes(self) -> list[Digest]:
        return list(self.campaign.taskset.membership.ordered_task_hashes)


class RunArtifactStore:
    """Stages a run's immutable inputs and persists its execution outputs."""

    def __init__(self, paths: TechtreePaths) -> None:
        self._paths = paths

    def stage_inputs(
        self, *, run_id: str, request: RunRequestV2, snapshot: DraftSnapshot
    ) -> RunInputBundle:
        """Copy the draft's graph into this run's ``inputs/``; a complete tree is reused."""
        inputs = self._inputs_dir(run_id)
        if inputs.exists():
            return self.load_inputs(run_id, request)
        ensure_private_directory(self._run_dir(run_id))
        staging = self._run_dir(run_id) / f"{_STAGING_PREFIX}{uuid.uuid4().hex}"
        try:
            self._assemble(staging, snapshot)
            self._verify(run_id, self._read_bundle(staging, request))
            os.rename(staging, inputs)
        except BaseException:
            remove_tree(staging)
            raise
        fsync_directory(self._run_dir(run_id))
        return self.load_inputs(run_id, request)

    def load_inputs(self, run_id: str, request: RunRequestV2) -> RunInputBundle:
        """Load and verify the run-owned inputs, consulting no draft."""
        root = self._inputs_dir(run_id)
        if not root.exists():
            raise NotFoundError(
                f"run {run_id} has no staged inputs",
                code=RUN_INPUT_STAGING_FAILED,
                details={"run_id": run_id},
            )
        bundle = self._read_bundle(root, request)
        self._verify(run_id, bundle)
        return bundle

    def write_validation_marker(self, run_id: str, marker: Mapping[str, JsonValue]) -> ArtifactRef:
        """Persist what the taskset validation answered."""
        directory = self._run_dir(run_id) / _VALIDATION_DIR
        ensure_private_directory(directory)
        return self._write_artifact(directory / _VALIDATION_MARKER_FILE, marker, run_id=run_id)

    def write_episode_receipt(
        self, run_id: str, *, position: int, receipt: EpisodeReceiptV3
    ) -> ArtifactRef:
        """Write one immutable receipt, named by its place in the committed task order."""
        directory = self._run_dir(run_id) / _RECEIPTS_DIR / receipt.variant.value
        ensure_private_directory(directory)
        return self._write_artifact(directory / _position_file(position), receipt, run_id=run_id)

    def episode_receipts(self, run_id: str, variant: ExperimentVariant) -> list[EpisodeReceiptV3]:
        """Load one variant's receipts in Campaign task order."""
        directory = self._run_dir(run_id) / _RECEIPTS_DIR / variant.value
        if not directory.exists():
            return []
        return [
            self._parse(path, EpisodeReceiptV3, run_id)
            for path in sorted(directory.iterdir())
            if path.is_file()
        ]

    def inputs_dir(self, run_id: str) -> Path:
        """Return the directory holding this run's own copy of its inputs."""
        return self._inputs_dir(run_id)

    def skill_files_dir(self, run_id: str) -> Path:
        """Return the run-owned expanded candidate skill directory."""
        return self._inputs_dir(run_id) / _SKILL_DIR / _FILES_DIR

    def _assemble(self, staging: Path, snapshot: DraftSnapshot) -> None:
        source = snapshot.source
        try:
            ensure_private_directory(staging)
            self._write_immutable(staging / _DRAFT_FILE, snapshot.draft)
            self._write_immutable(staging / _COMPARISON_FILE, snapshot.comparison)
            public = staging / _PUBLIC_DIR
            ensure_private_directory(public)
            self._write_immutable(public / _CLIMB_FILE, source.climb)
            self._write_immutable(public / _CAMPAIGN_FILE, source.campaign)
            self._write_immutable(public / _DATA_POLICY_FILE, source.data_policy)
            self._write_immutable(public / _VALIDATION_RECEIPT_FILE, source.publisher_validation)
            self._write_immutable(public / _EVIDENCE_FILE, snapshot.validation_evidence)
            self._write_immutable(public / _EXECUTION_PLAN_FILE, source.execution_plan)
            manifests = staging / _MANIFESTS_DIR
            ensure_private_directory(manifests)
            self._write_immutable(manifests / _BASELINE_FILE, snapshot.baseline)
            self._write_immutable(manifests / _CANDIDATE_FILE, snapshot.candidate)

            skill = staging / _SKILL_DIR
            ensure_private_directory(skill)
            staged = snapshot.candidate_skill
            self._write_immutable(skill / _ARTIFACT_FILE, staged.artifact)
            files = skill / _FILES_DIR
            ensure_private_directory(files)
            for entry in staged.artifact.files:
                target = files / entry.path
                ensure_private_directory(target.parent)
                self._write_bytes(target, (staged.files / entry.path).read_bytes())
        except OSError as error:
            raise ValidationError(
                f"this run's inputs could not be staged: {error.strerror or error}",
                code=RUN_INPUT_STAGING_FAILED,
            ) from error

    def _read_bundle(self, root: Path, request: RunRequestV2) -> RunInputBundle:
        run_id = request.run_id
        public = root / _PUBLIC_DIR
        campaign = self._parse(public / _CAMPAIGN_FILE, CampaignSpecV4, run_id)
        data_policy = self._parse(public / _DATA_POLICY_FILE, DataPolicy, run_id)
        receipt = self._parse(public / _VALIDATION_RECEIPT_FILE, TasksetValidationReceipt, run_id)
        plan = self._parse(public / _EXECUTION_PLAN_FILE, ResolvedExecutionPlan, run_id)
        climb = self._parse(public / _CLIMB_FILE, ClimbManifest, run_id)
        try:
            resolved = ResolvedClimb(
                climb=climb,
                climb_digest=digest_object(climb),
                campaign=campaign,
                campaign_digest=digest_object(campaign),
                data_policy=data_policy,
                data_policy_digest=digest_object(data_policy),
                publisher_validation=receipt,
                publisher_validation_digest=digest_object(receipt),
                execution_plan=plan,
                execution_plan_digest=digest_object(plan),
            )
        except PydanticValidationError as error:
            raise VerificationError(
                "the public objects this run owns no longer describe each other: "
                f"{error.errors()[0]['msg']}",
                code=RUN_INPUT_STAGING_FAILED,
                details={"run_id": run_id},
            ) from error
        skill = root / _SKILL_DIR
        return RunInputBundle(
            request=request,
            draft=self._parse(root / _DRAFT_FILE, SubmissionDraft, run_id),
            source=CampaignSource.from_climb(resolved),
            validation_evidence=self._parse(public / _EVIDENCE_FILE, ValidationEvidence, run_id),
            baseline=self._parse(
                root / _MANIFESTS_DIR / _BASELINE_FILE, ExperimentManifestV4, run_id
            ),
            candidate=self._parse(
                root / _MANIFESTS_DIR / _CANDIDATE_FILE, ExperimentManifestV4, run_id
            ),
            comparison=self._parse(root / _COMPARISON_FILE, ManifestComparison, run_id),
            candidate_skill=StagedSkill(
                artifact=self._parse(skill / _ARTIFACT_FILE, SkillArtifact, run_id),
                files=skill / _FILES_DIR,
            ),
        )

    def _verify(self, run_id: str, bundle: RunInputBundle) -> None:
        """Prove the staged bytes are the ones this run's request names."""
        request = bundle.request
        draft = bundle.draft
        source = bundle.source
        campaign = source.campaign

        _require(
            digest_object(draft) == request.draft_digest and draft.id == request.draft_id,
            "the staged draft is not the draft this run was created from",
            run_id,
            expected=request.draft_digest,
            computed=digest_object(draft),
        )
        _require(
            source.campaign_digest == request.campaign_spec_digest == draft.campaign_spec_digest
            and source.campaign_digest in source.climb.campaign_digests,
            "the staged Campaign is not the Campaign this run executes",
            run_id,
            expected=request.campaign_spec_digest,
            computed=source.campaign_digest,
        )
        _require(
            source.data_policy_digest
            == request.data_policy_digest
            == draft.data_policy_digest
            == campaign.data_policy_digest,
            "the staged DataPolicy is not the one this run executes under",
            run_id,
            expected=request.data_policy_digest,
            computed=source.data_policy_digest,
        )
        _require(
            draft.public_context == request.public_context == source.public_context
            and draft.program_ref == request.program_ref
            and draft.outcome_contract_digest == request.outcome_contract_digest,
            "the staged draft names a different public context, improvement program, or "
            "OutcomeContract than the request",
            run_id,
        )
        _require(
            source.execution_plan_digest
            == request.execution_plan_digest
            == campaign.execution_plan_digest,
            "the staged execution plan is not the one this run executes under",
            run_id,
            expected=request.execution_plan_digest,
            computed=source.execution_plan_digest,
        )
        _require(
            source.publisher_validation_digest == campaign.taskset.validation_receipt_digest,
            "the staged publisher validation is not the one the Campaign commits to",
            run_id,
            expected=campaign.taskset.validation_receipt_digest,
            computed=source.publisher_validation_digest,
        )
        reference = source.publisher_validation.normalized_evidence
        if reference is None:
            raise VerificationError(
                "the publisher's validation receipt names no normalized evidence, so this "
                "run could not be checked offline",
                code=RUN_INPUT_STAGING_FAILED,
                details={"run_id": run_id},
            )
        evidence_digest = digest_object(bundle.validation_evidence)
        _require(
            evidence_digest == reference.digest,
            "the staged validation evidence is not what the publisher's receipt was issued from",
            run_id,
            expected=reference.digest,
            computed=evidence_digest,
        )

        baseline_digest = digest_object(bundle.baseline)
        candidate_digest = digest_object(bundle.candidate)
        _require(
            baseline_digest == request.baseline_manifest_digest == draft.baseline_manifest_digest
            and candidate_digest
            == request.candidate_manifest_digest
            == draft.candidate_manifest_digest,
            "the staged manifests are not the ones this run compares",
            run_id,
        )
        comparison = bundle.comparison
        _require(
            comparison.baseline_configuration_digest == bundle.baseline.configuration_digest
            and comparison.candidate_configuration_digest == bundle.candidate.configuration_digest,
            "the staged comparison was made between different configurations than the "
            "staged manifests",
            run_id,
        )
        _require(
            comparison.controlled,
            "the staged comparison says this candidate differs from its baseline somewhere "
            "the Campaign does not permit",
            run_id,
            violations=list(comparison.violations),
        )
        _require(
            digest_object(bundle.candidate_skill.artifact) == digest_object(draft.skill_artifact),
            "the staged skill artifact is not the one the staged draft names",
            run_id,
        )
        verify_staged_skill(bundle.candidate_skill, code=RUN_INPUT_STAGING_FAILED)

    def _write_artifact(self, path: Path, value: object, *, run_id: str) -> ArtifactRef:
        data = canonical_json_bytes(value)
        self._write_bytes(path, data)
        return ArtifactRef(
            digest=sha256_digest_bytes(data),
            media_type=_JSON_MEDIA_TYPE,
            size=len(data),
            relative_path=path.relative_to(self._run_dir(run_id)).as_posix(),
        )

    def _write_immutable(self, path: Path, value: object) -> None:
        self._write_bytes(path, canonical_json_bytes(value))

    def _write_bytes(self, path: Path, data: bytes) -> None:
        with open_exclusive(path, _FILE_MODE) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        fsync_directory(path.parent)

    def _parse[ModelT: BaseModel](self, path: Path, model: type[ModelT], run_id: str) -> ModelT:
        try:
            raw = path.read_bytes()
        except FileNotFoundError as error:
            raise NotFoundError(
                f"run {run_id} is missing {path.name}",
                code=RUN_INPUT_STAGING_FAILED,
                details={"run_id": run_id, "file": path.name},
            ) from error
        try:
            return model.model_validate_json(raw)
        except PydanticValidationError as error:
            raise ValidationError(
                f"run {run_id} holds an invalid {path.name}: {error.errors()[0]['msg']}",
                code=RUN_INPUT_STAGING_FAILED,
                details={"run_id": run_id, "file": path.name},
            ) from error

    def _run_dir(self, run_id: str) -> Path:
        return self._paths.run_dir(run_id)

    def _inputs_dir(self, run_id: str) -> Path:
        return self._run_dir(run_id) / _INPUTS_DIR


def _position_file(position: int) -> str:
    if position < 0:
        raise ValidationError(
            f"a task position is not negative, and this one is {position}",
            code=RUN_INPUT_STAGING_FAILED,
            details={"position": position},
        )
    return f"{position:0{_POSITION_WIDTH}d}.json"


def _require(condition: bool, message: str, run_id: str, **details: object) -> None:
    if condition:
        return
    reported: dict[str, JsonValue] = {"run_id": run_id}
    for key, value in details.items():
        reported[key] = [str(item) for item in value] if isinstance(value, list) else str(value)
    raise VerificationError(message, code=RUN_INPUT_STAGING_FAILED, details=reported)
