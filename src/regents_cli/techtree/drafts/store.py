"""The draft directory, and the only way anything writes to it.

A draft is a self-contained claim: the Climb, Campaign, DataPolicy, publisher receipt and
evidence, execution plan, both manifests, the comparison and the candidate Skill's files are
all copied in at prepare time, assembled under a staging name, verified there and renamed
into place. Immutable files are written once with ``O_EXCL``; ``start.json`` is replaced whole
under the draft's lock, and the start is claimed exactly once.
"""

from __future__ import annotations

import os
import shutil
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Final

from filelock import FileLock, Timeout
from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object, sha256_digest_bytes
from regents_cli.techtree.drafts.source import CampaignSource, StagedSkill
from regents_cli.techtree.errors import (
    ConflictError,
    NotFoundError,
    ValidationError,
    VerificationError,
)
from regents_cli.techtree.fs import (
    atomic_write_bytes,
    ensure_private_directory,
    fsync_directory,
    open_exclusive,
    remove_tree,
)
from regents_cli.techtree.ids import validate_id
from regents_cli.techtree.manifests.builder import skill_content_digest
from regents_cli.techtree.models.base import JsonValue, StateModel, UtcDateTime
from regents_cli.techtree.models.campaign import CampaignSpecV2
from regents_cli.techtree.models.climb import ClimbManifest, ResolvedClimb
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import ExperimentManifestV2, ManifestComparison
from regents_cli.techtree.models.skill import SkillArtifact, SubmissionDraft
from regents_cli.techtree.models.validation import TasksetValidationReceipt, ValidationEvidence
from regents_cli.techtree.paths import TechtreePaths

DRAFT_ALREADY_EXISTS: Final = "draft_already_exists"
DRAFT_WRITE_FAILED: Final = "draft_write_failed"
_CATALOG_GRAPH_INVALID: Final = "catalog_graph_invalid"
_CAMPAIGN_DIGEST_MISMATCH: Final = "campaign_digest_mismatch"
_DATA_POLICY_DIGEST_MISMATCH: Final = "data_policy_digest_mismatch"
_PUBLISHER_VALIDATION_MISSING: Final = "publisher_validation_missing"
_PUBLISHER_EVIDENCE_MISSING: Final = "publisher_validation_evidence_missing"
_EXECUTION_PLAN_MISMATCH: Final = "execution_plan_mismatch"
_SKILL_INVALID: Final = "skill_invalid"
_MANIFEST_BUILD_FAILED: Final = "manifest_build_failed"
_MANIFEST_COMPARISON_INVALID: Final = "manifest_comparison_invalid"
_DRAFT_NOT_FOUND: Final = "draft_not_found"
_DRAFT_START_CONFLICT: Final = "draft_start_conflict"
_DRAFT_NOT_STARTED: Final = "draft_not_started"

LOCK_TIMEOUT_SECONDS: Final = 30.0

_LOCK_FILE: Final = ".lock"
_DRAFT_FILE: Final = "draft.json"
_COMPARISON_FILE: Final = "comparison.json"
_START_FILE: Final = "start.json"
_PUBLIC_DIR: Final = "public"
_CLIMB_FILE: Final = "climb.json"
_CAMPAIGN_FILE: Final = "campaign.json"
_DATA_POLICY_FILE: Final = "data-policy.json"
_VALIDATION_FILE: Final = "publisher-validation.json"
_EVIDENCE_FILE: Final = "publisher-validation-evidence.json"
_EXECUTION_PLAN_FILE: Final = "execution-plan.json"
_MANIFESTS_DIR: Final = "manifests"
_BASELINE_FILE: Final = "baseline.json"
_CANDIDATE_FILE: Final = "candidate.json"
_SKILL_DIR: Final = "skill"
_ARTIFACT_FILE: Final = "artifact.json"
_FILES_DIR: Final = "files"
_STAGING_PREFIX: Final = ".staging-"
_FILE_MODE: Final = 0o600


def utc_now() -> datetime:
    """Return the current instant in UTC."""
    return datetime.now(UTC)


class DraftStartStatus(StrEnum):
    """How far the one-time handover from a draft to a run has got."""

    CLAIMED = "claimed"
    LAUNCHED = "launched"
    LAUNCH_FAILED = "launch_failed"


class DraftStartRecord(StateModel):
    """The single run this draft was spent on, and what became of the launch."""

    draft_id: str
    run_id: str
    status: DraftStartStatus
    claimed_at: UtcDateTime
    launched_at: UtcDateTime | None = None
    launch_error_code: str | None = None


@dataclass(frozen=True)
class DraftSnapshot:
    """Everything one draft holds, loaded and ready to be checked together."""

    draft: SubmissionDraft
    source: CampaignSource
    validation_evidence: ValidationEvidence
    baseline: ExperimentManifestV2
    candidate: ExperimentManifestV2
    comparison: ManifestComparison
    candidate_skill: StagedSkill


class DraftStore:
    """Persists and independently verifies complete draft graphs."""

    def __init__(self, paths: TechtreePaths) -> None:
        self._paths = paths

    def draft_dir(self, draft_id: str) -> Path:
        """Return the directory one draft occupies."""
        return self._paths.draft_dir(draft_id)

    def create(
        self,
        *,
        draft: SubmissionDraft,
        baseline: ExperimentManifestV2,
        candidate: ExperimentManifestV2,
        comparison: ManifestComparison,
        source: CampaignSource,
        validation_evidence: ValidationEvidence,
        staged_candidate_skill: StagedSkill,
    ) -> None:
        """Write a new draft graph atomically, or write nothing at all."""
        final = self.draft_dir(draft.id)
        if final.exists():
            raise ConflictError(
                f"a draft called {draft.id} already exists",
                code=DRAFT_ALREADY_EXISTS,
                details={"draft_id": draft.id},
            )
        ensure_private_directory(self._paths.drafts_dir)
        staging = self._paths.drafts_dir / f"{_STAGING_PREFIX}{uuid.uuid4().hex}"
        try:
            self._assemble(
                staging,
                draft=draft,
                baseline=baseline,
                candidate=candidate,
                comparison=comparison,
                source=source,
                validation_evidence=validation_evidence,
                skill_files=staged_candidate_skill.files,
            )
            self.verify_snapshot(
                DraftSnapshot(
                    draft=draft,
                    source=source,
                    validation_evidence=validation_evidence,
                    baseline=baseline,
                    candidate=candidate,
                    comparison=comparison,
                    candidate_skill=StagedSkill(
                        artifact=draft.skill_artifact, files=staging / _SKILL_DIR / _FILES_DIR
                    ),
                )
            )
            try:
                os.rename(staging, final)
            except OSError as error:
                raise ConflictError(
                    f"a draft called {draft.id} already exists",
                    code=DRAFT_ALREADY_EXISTS,
                    details={"draft_id": draft.id},
                ) from error
            fsync_directory(self._paths.drafts_dir)
        except BaseException:
            remove_tree(staging)
            raise

    def _assemble(
        self,
        staging: Path,
        *,
        draft: SubmissionDraft,
        baseline: ExperimentManifestV2,
        candidate: ExperimentManifestV2,
        comparison: ManifestComparison,
        source: CampaignSource,
        validation_evidence: ValidationEvidence,
        skill_files: Path,
    ) -> None:
        if source.publisher_validation.normalized_evidence is None:
            raise VerificationError(
                "the publisher's validation receipt names no normalized evidence, so this "
                "draft could not be checked offline",
                code=_PUBLISHER_EVIDENCE_MISSING,
                details={"draft_id": draft.id},
            )
        try:
            ensure_private_directory(staging)
            self._write_immutable(staging / _DRAFT_FILE, draft)
            self._write_immutable(staging / _COMPARISON_FILE, comparison)
            public = staging / _PUBLIC_DIR
            ensure_private_directory(public)
            self._write_immutable(public / _CLIMB_FILE, source.climb)
            self._write_immutable(public / _CAMPAIGN_FILE, source.campaign)
            self._write_immutable(public / _DATA_POLICY_FILE, source.data_policy)
            self._write_immutable(public / _VALIDATION_FILE, source.publisher_validation)
            self._write_immutable(public / _EVIDENCE_FILE, validation_evidence)
            self._write_immutable(public / _EXECUTION_PLAN_FILE, source.execution_plan)
            manifests = staging / _MANIFESTS_DIR
            ensure_private_directory(manifests)
            self._write_immutable(manifests / _BASELINE_FILE, baseline)
            self._write_immutable(manifests / _CANDIDATE_FILE, candidate)

            # The artifact document is written from the object the draft commits to, and only
            # the files it lists are copied, so the draft holds exactly what its digest covers.
            skill = staging / _SKILL_DIR
            ensure_private_directory(skill)
            self._write_immutable(skill / _ARTIFACT_FILE, draft.skill_artifact)
            files = skill / _FILES_DIR
            ensure_private_directory(files)
            for entry in draft.skill_artifact.files:
                target = files / entry.path
                ensure_private_directory(target.parent)
                shutil.copyfile(skill_files / entry.path, target)
                os.chmod(target, _FILE_MODE)
        except OSError as error:
            raise ValidationError(
                f"the draft could not be written: {error.strerror or error}",
                code=DRAFT_WRITE_FAILED,
                details={"draft_id": draft.id},
            ) from error

    def get(self, draft_id: str) -> SubmissionDraft:
        """Load and validate ``draft.json``."""
        return self._load(draft_id, _DRAFT_FILE, SubmissionDraft)

    def get_source(self, draft_id: str) -> CampaignSource:
        """Reassemble the snapshotted Climb graph, so its own validator runs on these bytes."""
        public = f"{_PUBLIC_DIR}/"
        campaign = self._load(draft_id, public + _CAMPAIGN_FILE, CampaignSpecV2)
        data_policy = self._load(draft_id, public + _DATA_POLICY_FILE, DataPolicy)
        receipt = self._load(draft_id, public + _VALIDATION_FILE, TasksetValidationReceipt)
        plan = self._load(draft_id, public + _EXECUTION_PLAN_FILE, ResolvedExecutionPlan)
        climb = self._load(draft_id, public + _CLIMB_FILE, ClimbManifest)
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
                "the public objects snapshotted in this draft no longer describe each other: "
                f"{_first_problem(error)}",
                code=_CATALOG_GRAPH_INVALID,
                details={"draft_id": draft_id},
            ) from error
        return CampaignSource.from_climb(resolved)

    def load_snapshot(self, draft_id: str) -> DraftSnapshot:
        """Load the complete graph and verify it before returning it."""
        snapshot = DraftSnapshot(
            draft=self.get(draft_id),
            source=self.get_source(draft_id),
            validation_evidence=self._load(
                draft_id, f"{_PUBLIC_DIR}/{_EVIDENCE_FILE}", ValidationEvidence
            ),
            baseline=self._load(
                draft_id, f"{_MANIFESTS_DIR}/{_BASELINE_FILE}", ExperimentManifestV2
            ),
            candidate=self._load(
                draft_id, f"{_MANIFESTS_DIR}/{_CANDIDATE_FILE}", ExperimentManifestV2
            ),
            comparison=self._load(draft_id, _COMPARISON_FILE, ManifestComparison),
            candidate_skill=StagedSkill(
                artifact=self._load(draft_id, f"{_SKILL_DIR}/{_ARTIFACT_FILE}", SkillArtifact),
                files=self.draft_dir(draft_id) / _SKILL_DIR / _FILES_DIR,
            ),
        )
        self.verify_snapshot(snapshot)
        return snapshot

    def verify_snapshot(self, snapshot: DraftSnapshot) -> None:
        """Verify every digest and cross-object edge, offline."""
        draft = snapshot.draft
        source = snapshot.source
        campaign = source.campaign
        receipt = source.publisher_validation

        climb_digest = digest_object(source.climb)
        _require(
            climb_digest == draft.public_context.climb_digest == source.climb_digest,
            "the snapshotted Climb is not the Climb this draft was prepared for",
            _CATALOG_GRAPH_INVALID,
            expected=draft.public_context.climb_digest,
            computed=climb_digest,
        )
        campaign_digest = digest_object(campaign)
        _require(
            campaign_digest == draft.campaign_spec_digest == source.climb.campaign_spec_digest,
            "this draft was prepared against a different Campaign than the one it snapshotted",
            _CAMPAIGN_DIGEST_MISMATCH,
            expected=draft.campaign_spec_digest,
            computed=campaign_digest,
        )
        policy_digest = digest_object(source.data_policy)
        _require(
            policy_digest
            == campaign.data_policy_digest
            == draft.data_policy_digest
            == draft.policy_acceptance.data_policy_digest,
            "the snapshotted DataPolicy is not the one the Campaign and this draft run under",
            _DATA_POLICY_DIGEST_MISMATCH,
            expected=campaign.data_policy_digest,
            computed=policy_digest,
        )
        receipt_digest = digest_object(receipt)
        _require(
            receipt_digest == campaign.taskset.validation_receipt_digest,
            "the snapshotted publisher validation is not the one the Campaign commits to",
            _PUBLISHER_VALIDATION_MISSING,
            expected=campaign.taskset.validation_receipt_digest,
            computed=receipt_digest,
        )
        plan_digest = digest_object(source.execution_plan)
        _require(
            plan_digest == campaign.execution_plan_digest == source.execution_plan_digest,
            "the snapshotted execution plan is not the one the Campaign binds",
            _EXECUTION_PLAN_MISMATCH,
            expected=campaign.execution_plan_digest,
            computed=plan_digest,
        )
        reference = receipt.normalized_evidence
        if reference is None:
            raise VerificationError(
                "the publisher's validation receipt names no normalized evidence, so this "
                "draft cannot be checked offline",
                code=_PUBLISHER_EVIDENCE_MISSING,
                details={"draft_id": draft.id},
            )
        evidence_digest = digest_object(snapshot.validation_evidence)
        _require(
            evidence_digest == reference.digest,
            "the snapshotted validation evidence is not what the publisher's receipt was "
            "issued from",
            _PUBLISHER_EVIDENCE_MISSING,
            expected=reference.digest,
            computed=evidence_digest,
        )
        _require(
            draft.outcome_contract_digest == campaign.context.outcome_contract_digest
            and draft.program_ref == campaign.context.program_ref,
            "this draft names a different OutcomeContract or improvement program than the Campaign",
            _CATALOG_GRAPH_INVALID,
        )

        baseline_digest = digest_object(snapshot.baseline)
        candidate_digest = digest_object(snapshot.candidate)
        _require(
            baseline_digest == draft.baseline_manifest_digest
            and candidate_digest == draft.candidate_manifest_digest,
            "the snapshotted manifests are not the ones this draft names",
            _MANIFEST_BUILD_FAILED,
        )
        comparison = snapshot.comparison
        _require(
            comparison.baseline_configuration_digest == snapshot.baseline.configuration_digest
            and comparison.candidate_configuration_digest
            == snapshot.candidate.configuration_digest,
            "the stored comparison was made between different configurations than the "
            "manifests in this draft",
            _MANIFEST_COMPARISON_INVALID,
        )
        _require(
            comparison.controlled,
            "the stored comparison says this candidate differs from its baseline somewhere "
            "the Campaign does not permit",
            _MANIFEST_COMPARISON_INVALID,
            violations=list(comparison.violations),
        )

        verify_staged_skill(snapshot.candidate_skill, code=_SKILL_INVALID)
        artifact = snapshot.candidate_skill.artifact
        _require(
            list(draft.included_files) == [file.path for file in artifact.files]
            and digest_object(draft.skill_artifact) == digest_object(artifact),
            "this draft carries a different skill artifact than the one snapshotted beside it",
            _SKILL_INVALID,
        )

    def claim_start(self, *, draft_id: str, run_id: str) -> DraftStartRecord:
        """Spend this draft on exactly one run, or return the run it was spent on."""
        validate_id(run_id, "run")
        self._require_draft(draft_id)
        with self._lock(draft_id):
            existing = self._read_start_record(draft_id)
            if existing is not None:
                return existing
            self.load_snapshot(draft_id)
            record = DraftStartRecord(
                draft_id=draft_id,
                run_id=run_id,
                status=DraftStartStatus.CLAIMED,
                claimed_at=utc_now(),
            )
            self._write_immutable(self.draft_dir(draft_id) / _START_FILE, record)
            return record

    def mark_launched(self, *, draft_id: str, run_id: str, launched_at: datetime) -> None:
        """Record that the claimed run is now running."""
        self._update_start(draft_id, run_id, DraftStartStatus.LAUNCHED, launched_at, None)

    def mark_launch_failed(self, *, draft_id: str, run_id: str, error_code: str) -> None:
        """Record that the claimed run could not be launched."""
        self._update_start(draft_id, run_id, DraftStartStatus.LAUNCH_FAILED, None, error_code)

    def _update_start(
        self,
        draft_id: str,
        run_id: str,
        status: DraftStartStatus,
        launched_at: datetime | None,
        launch_error_code: str | None,
    ) -> None:
        self._require_draft(draft_id)
        with self._lock(draft_id):
            record = self._read_start_record(draft_id)
            if record is None:
                raise NotFoundError(
                    f"draft {draft_id} has not been started, so there is no claim to update",
                    code=_DRAFT_NOT_STARTED,
                    details={"draft_id": draft_id},
                )
            if record.run_id != run_id:
                raise ConflictError(
                    f"draft {draft_id} was already claimed by run {record.run_id}",
                    code=_DRAFT_START_CONFLICT,
                    details={
                        "draft_id": draft_id,
                        "claimed_run_id": record.run_id,
                        "requested_run_id": run_id,
                    },
                )
            updated = DraftStartRecord(
                draft_id=record.draft_id,
                run_id=record.run_id,
                status=status,
                claimed_at=record.claimed_at,
                launched_at=launched_at or record.launched_at,
                launch_error_code=launch_error_code,
            )
            atomic_write_bytes(
                self.draft_dir(draft_id) / _START_FILE,
                canonical_json_bytes(updated),
                mode=_FILE_MODE,
            )

    def _read_start_record(self, draft_id: str) -> DraftStartRecord | None:
        path = self.draft_dir(draft_id) / _START_FILE
        if not path.exists():
            return None
        return self._parse(path, DraftStartRecord, draft_id)

    def _load[ModelT: BaseModel](self, draft_id: str, relative: str, model: type[ModelT]) -> ModelT:
        self._require_draft(draft_id)
        return self._parse(self.draft_dir(draft_id) / relative, model, draft_id)

    def _parse[ModelT: BaseModel](self, path: Path, model: type[ModelT], draft_id: str) -> ModelT:
        try:
            raw = path.read_bytes()
        except FileNotFoundError as error:
            raise NotFoundError(
                f"draft {draft_id} is missing {path.name}",
                code=_DRAFT_NOT_FOUND,
                details={"draft_id": draft_id, "file": path.name},
            ) from error
        try:
            return model.model_validate_json(raw)
        except PydanticValidationError as error:
            raise ValidationError(
                f"draft {draft_id} holds an invalid {path.name}: {_first_problem(error)}",
                code=_CATALOG_GRAPH_INVALID,
                details={"draft_id": draft_id, "file": path.name},
            ) from error

    def _require_draft(self, draft_id: str) -> None:
        if not (self.draft_dir(draft_id) / _DRAFT_FILE).exists():
            raise NotFoundError(
                f"no such draft: {draft_id}",
                code=_DRAFT_NOT_FOUND,
                details={"draft_id": draft_id},
            )

    def _write_immutable(self, path: Path, value: object) -> None:
        data = canonical_json_bytes(value)
        with open_exclusive(path, _FILE_MODE) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        fsync_directory(path.parent)

    @contextmanager
    def _lock(self, draft_id: str) -> Iterator[None]:
        lock = FileLock(
            self.draft_dir(draft_id) / _LOCK_FILE, timeout=LOCK_TIMEOUT_SECONDS, mode=_FILE_MODE
        )
        try:
            lock.acquire()
        except Timeout as error:
            raise ConflictError(
                f"another process is holding the lock on draft {draft_id}",
                details={"draft_id": draft_id, "waited_seconds": LOCK_TIMEOUT_SECONDS},
            ) from error
        try:
            yield
        finally:
            lock.release()


def verify_staged_skill(staged: StagedSkill, *, code: str) -> None:
    """Check one Skill's artifact against the bytes stored beside it, file by file."""
    artifact = staged.artifact
    recomputed = skill_content_digest(artifact.files)
    _require(
        recomputed == artifact.root_digest,
        "the skill's root digest does not describe the files it lists",
        code,
        expected=artifact.root_digest,
        computed=recomputed,
    )
    for entry in artifact.files:
        try:
            data = (staged.files / entry.path).read_bytes()
        except OSError as error:
            raise VerificationError(
                f"the skill is missing {entry.path}", code=code, details={"path": entry.path}
            ) from error
        _require(
            len(data) == entry.size and sha256_digest_bytes(data) == entry.digest,
            f"the skill file {entry.path} is not what the artifact says it is",
            code,
            path=entry.path,
        )


def _require(condition: bool, message: str, code: str, **details: object) -> None:
    if condition:
        return
    reported: dict[str, JsonValue] = {}
    for key, value in details.items():
        reported[key] = [str(item) for item in value] if isinstance(value, list) else str(value)
    raise VerificationError(message, code=code, details=reported)


def _first_problem(error: PydanticValidationError) -> str:
    first = error.errors()[0]
    location = ".".join(str(part) for part in first["loc"])
    return f"{location}: {first['msg']}" if location else str(first["msg"])
