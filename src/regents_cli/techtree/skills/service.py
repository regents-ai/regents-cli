"""Turning a directory into a prepared submission draft.

The order is the safety property. Nothing is written where a later command could find it until
every check has succeeded: the Climb is resolved, its status and this machine's compatibility
confirmed, the Skill scanned, the files copied into staging and re-verified against the scan,
both manifests derived, the comparison required to be controlled, the draft built and
digested, and only then is the tree renamed into place by the draft store.
"""

from __future__ import annotations

import importlib.util
import re
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object, sha256_digest_bytes
from regents_cli.techtree.catalog.service import CatalogService
from regents_cli.techtree.constants import (
    MAX_SKILL_FILES,
    SKILL_SCHEMA_VERSION,
    SUBMISSION_DRAFT_SCHEMA_VERSION,
)
from regents_cli.techtree.drafts.source import CampaignSource, StagedSkill
from regents_cli.techtree.drafts.store import DraftStore, utc_now
from regents_cli.techtree.engines.bundle import embedded_engine_root
from regents_cli.techtree.errors import (
    PolicyError,
    PrerequisiteError,
    ValidationError,
    VerificationError,
)
from regents_cli.techtree.fs import atomic_write_bytes, ensure_private_directory, remove_tree
from regents_cli.techtree.ids import new_id
from regents_cli.techtree.manifests.builder import (
    build_baseline_manifest,
    build_candidate_manifest,
    skill_content_digest,
)
from regents_cli.techtree.manifests.compare import assert_controlled_comparison, compare_manifests
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.models.campaign import CampaignSpecV3
from regents_cli.techtree.models.climb import ResolvedClimb
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.experiment import ManifestComparison
from regents_cli.techtree.models.skill import (
    PolicyAcceptanceRequirement,
    SkillArtifact,
    SkillFile,
    SubmissionDraft,
)
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.skills.scanner import ScannedFile, SkillScanResult, scan_skill

CLIMB_NOT_PREPARABLE: Final = "climb_not_preparable"
CANDIDATE_POLICY_VIOLATION: Final = "candidate_policy_violation"
SKILL_INVALID: Final = "skill_invalid"
SKILL_SNAPSHOT_FAILED: Final = "skill_snapshot_failed"
PUBLISHER_EVIDENCE_MISSING: Final = "publisher_validation_evidence_missing"

_PREPARABLE_STATUSES: Final[frozenset[str]] = frozenset({"open", "development"})
_VARIANTS: Final = 2
#: A label travels in a public artifact, so it is a name and never a path, a flag or markup.
_LABEL_PATTERN: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$")
_STAGING_PREFIX: Final = ".prepare-"
_SKILL_DIR: Final = "skill"
_ARTIFACT_FILE: Final = "artifact.json"
_FILES_DIR: Final = "files"

#: The one taskset this build knows the scored inputs of; its Skill may not name them.
_REFERENCE_TASKSET: Final = "procedure-transfer-v1"


@dataclass(frozen=True)
class PreparedDraft:
    """What preparation produced, and what it was prepared against."""

    draft: SubmissionDraft
    draft_digest: Digest
    manifest_comparison: ManifestComparison
    source: CampaignSource


class SkillPreparationService:
    """Builds one complete, immutable, offline-verifiable submission draft."""

    def __init__(self, paths: TechtreePaths) -> None:
        self._paths = paths
        self._catalog = CatalogService(paths)
        self._drafts = DraftStore(paths)

    def prepare(
        self,
        *,
        climb_reference: str,
        skill_path: Path,
        candidate_label: str | None = None,
        held_out: bool = False,
    ) -> PreparedDraft:
        """Resolve, snapshot, derive, compare, and persist one draft, against the Climb's
        Campaign or, with `held_out`, its held-out one."""
        created_at = utc_now()
        resolved = self._catalog.get_climb(climb_reference, held_out=held_out)
        if resolved.publisher_validation.normalized_evidence is None:
            raise VerificationError(
                "this Climb's publisher validation names no normalized evidence, so a draft "
                "prepared from it could not be checked offline",
                code=PUBLISHER_EVIDENCE_MISSING,
                details={"climb_reference": climb_reference},
            )
        validation_evidence = self._catalog.validation_evidence(resolved)
        self._require_preparable(resolved)
        scan = _scan(skill_path)
        _validate_candidate_policy(resolved, scan)
        _require_no_proving_inputs(resolved.campaign, scan)

        ensure_private_directory(self._paths.drafts_dir)
        staging = self._paths.drafts_dir / f"{_STAGING_PREFIX}{uuid.uuid4().hex}"
        source = CampaignSource.from_climb(resolved)
        try:
            ensure_private_directory(staging)
            staged = _snapshot_skill(
                skill_dir=staging / _SKILL_DIR, scan=scan, candidate_label=candidate_label
            )
            baseline = build_baseline_manifest(
                campaign=resolved.campaign,
                campaign_digest=resolved.campaign_digest,
                public_context=source.public_context,
                created_at=created_at,
            )
            candidate = build_candidate_manifest(
                campaign=resolved.campaign,
                campaign_digest=resolved.campaign_digest,
                skill=staged.artifact,
                public_context=source.public_context,
                created_at=created_at,
            )
            comparison = compare_manifests(baseline, candidate, resolved.campaign.mutation_contract)
            assert_controlled_comparison(comparison)
            draft = SubmissionDraft(
                schema_version=SUBMISSION_DRAFT_SCHEMA_VERSION,
                id=new_id("draft"),
                campaign_spec_digest=source.campaign_digest,
                program_ref=source.campaign.context.program_ref,
                public_context=source.public_context,
                data_policy_digest=source.data_policy_digest,
                outcome_contract_digest=source.campaign.context.outcome_contract_digest,
                skill_artifact=staged.artifact,
                baseline_manifest_digest=digest_object(baseline),
                candidate_manifest_digest=digest_object(candidate),
                included_files=[file.path for file in staged.artifact.files],
                estimated_episodes=_estimate_episodes(source.campaign),
                policy_acceptance=PolicyAcceptanceRequirement(
                    data_policy_digest=source.data_policy_digest,
                    required=True,
                    summary=rights_summary(resolved.data_policy),
                ),
                warnings=_warnings(resolved),
                created_at=created_at,
            )
            draft_digest = digest_object(draft)
            self._drafts.create(
                draft=draft,
                baseline=baseline,
                candidate=candidate,
                comparison=comparison,
                source=source,
                validation_evidence=validation_evidence,
                staged_candidate_skill=staged,
            )
        finally:
            remove_tree(staging)
        return PreparedDraft(
            draft=draft, draft_digest=draft_digest, manifest_comparison=comparison, source=source
        )

    def _require_preparable(self, resolved: ResolvedClimb) -> None:
        """Refuse a Climb that is closed, or that this machine cannot run."""
        status = resolved.climb.metadata.status
        if status not in _PREPARABLE_STATUSES:
            raise PolicyError(
                f"this Climb is {status}, so it is not accepting submissions",
                code=CLIMB_NOT_PREPARABLE,
                details={"status": status},
            )
        compatibility = self._catalog.compatibility(resolved)
        blocking = [issue for issue in compatibility.issues if issue.blocking]
        if blocking:
            raise PrerequisiteError(
                "this machine cannot run this Climb yet: "
                + " ".join(issue.message for issue in blocking),
                code=CLIMB_NOT_PREPARABLE,
                details={"blocking_issues": [issue.code for issue in blocking]},
            )


def _validate_candidate_policy(resolved: ResolvedClimb, scan: SkillScanResult) -> None:
    """Enforce the Climb's candidate constraints and its DataPolicy."""
    constraints = resolved.climb.candidate_policy.constraints
    if not constraints.min_skills <= 1 <= constraints.max_skills:
        raise PolicyError(
            "this Climb does not accept a single candidate skill; it asks for "
            f"{constraints.min_skills} to {constraints.max_skills}",
            code=CANDIDATE_POLICY_VIOLATION,
            details={"min_skills": constraints.min_skills, "max_skills": constraints.max_skills},
        )
    release = resolved.data_policy.candidate_skill.public_release
    if release == "prohibited":
        raise PolicyError(
            "this Climb's DataPolicy prohibits releasing a candidate skill, so there is "
            "nothing a submission could be entered as",
            code=CANDIDATE_POLICY_VIOLATION,
            details={"candidate_skill_public_release": release},
        )
    if len(scan.files) > MAX_SKILL_FILES:
        raise PolicyError(
            f"this candidate has {len(scan.files)} files and the limit is {MAX_SKILL_FILES}",
            code=CANDIDATE_POLICY_VIOLATION,
            details={"file_count": len(scan.files)},
        )


def _require_no_proving_inputs(campaign: CampaignSpecV3, scan: SkillScanResult) -> None:
    """Refuse a Skill naming the cases the Campaign scores it on: a lookup table, not a rule."""
    inputs = _proving_inputs_for(campaign)
    if not inputs:
        return
    patterns = {word: re.compile(rf"\b{re.escape(word)}\b", re.IGNORECASE) for word in inputs}
    found: dict[str, list[str]] = {}
    for item in scan.files:
        text = item.source_path.read_bytes().decode("utf-8")
        words = [word for word, pattern in patterns.items() if pattern.search(text)]
        if words:
            found[item.relative_path.as_posix()] = words
    if not found:
        return
    reported: dict[str, JsonValue] = {path: list(words) for path, words in found.items()}
    raise PolicyError(
        "this Skill names inputs the Climb scores it on, so it would be a lookup table rather "
        "than a procedure; describe the rule and leave the scored cases out: "
        + "; ".join(f"{path}: {', '.join(words)}" for path, words in found.items()),
        code=CANDIDATE_POLICY_VIOLATION,
        details={"proving_inputs_found": reported},
    )


def _proving_inputs_for(campaign: CampaignSpecV3) -> tuple[str, ...]:
    """The reference taskset's frozen public inputs, and nothing for a taskset without a policy."""
    reference = campaign.taskset.ref
    if reference.id != _REFERENCE_TASKSET or reference.package.name != _REFERENCE_TASKSET:
        return ()
    package_name = _REFERENCE_TASKSET.replace("-", "_")
    module_name = f"{package_name}.dataset"
    cached = sys.modules.get(module_name)
    if cached is not None:
        return tuple(cached.PROVING_INPUTS)
    # Loaded by path: the package's __init__ imports Verifiers, which lives in the engine's
    # own environment; only the pure input list is wanted.
    package = embedded_engine_root("default") / "packages" / _REFERENCE_TASKSET / package_name
    for name, filename in (
        (f"{package_name}.algorithm", "algorithm.py"),
        (module_name, "dataset.py"),
    ):
        if name in sys.modules:
            continue
        specification = importlib.util.spec_from_file_location(name, str(package / filename))
        if specification is None or specification.loader is None:
            raise ValidationError(
                "this build cannot read the reference taskset's public inputs",
                details={"module": name},
            )
        module = importlib.util.module_from_spec(specification)
        sys.modules[name] = module
        specification.loader.exec_module(module)
    return tuple(sys.modules[module_name].PROVING_INPUTS)


def _scan(skill_path: Path) -> SkillScanResult:
    try:
        return scan_skill(skill_path)
    except ValidationError as error:
        raise ValidationError(error.message, code=SKILL_INVALID, details=error.details) from error


def _snapshot_skill(
    *, skill_dir: Path, scan: SkillScanResult, candidate_label: str | None
) -> StagedSkill:
    """Write `artifact.json` and `files/` in staging, re-checking each file against the scan."""
    files_dir = skill_dir / _FILES_DIR
    ensure_private_directory(skill_dir)
    ensure_private_directory(files_dir)
    copied = [_copy_one(item, files_dir) for item in scan.files]
    entries = [
        SkillFile(
            path=item.relative_path.as_posix(),
            media_type=item.media_type,
            size=item.size,
            digest=item.digest,
        )
        for item in copied
    ]
    artifact = SkillArtifact(
        schema_version=SKILL_SCHEMA_VERSION,
        name=_candidate_name(candidate_label, scan.root),
        root_digest=skill_content_digest(entries),
        files=entries,
        source_kind="manual",
        parent_skill_digest=None,
    )
    atomic_write_bytes(skill_dir / _ARTIFACT_FILE, canonical_json_bytes(artifact))
    return StagedSkill(artifact=artifact, files=files_dir)


def _copy_one(item: ScannedFile, files_dir: Path) -> ScannedFile:
    try:
        data = item.source_path.read_bytes()
    except OSError as error:
        raise VerificationError(
            "a candidate skill file could not be read while it was being snapshotted: "
            f"{item.relative_path}",
            code=SKILL_SNAPSHOT_FAILED,
            details={"path": item.relative_path.as_posix()},
        ) from error
    if len(data) != item.size or sha256_digest_bytes(data) != item.digest:
        raise VerificationError(
            "a candidate skill file changed while it was being snapshotted, so the draft was "
            f"abandoned: {item.relative_path}",
            code=SKILL_SNAPSHOT_FAILED,
            details={"path": item.relative_path.as_posix()},
        )
    target = files_dir / item.relative_path
    ensure_private_directory(target.parent)
    atomic_write_bytes(target, data)
    return ScannedFile(
        source_path=target,
        relative_path=PurePosixPath(item.relative_path),
        size=item.size,
        media_type=item.media_type,
        digest=item.digest,
    )


def _estimate_episodes(campaign: CampaignSpecV3) -> int:
    selection = campaign.taskset.selection
    return selection.num_tasks * selection.num_rollouts * _VARIANTS


def _warnings(resolved: ResolvedClimb) -> list[str]:
    """Everything a participant should know before confirming."""
    warnings: list[str] = []
    if resolved.climb.publication.proof_grade == "development_only":
        warnings.append(
            "This is a development Climb. Its results are for trying the flow out and are not "
            "comparable evidence."
        )
    warnings.append(
        "Results are attested by this machine only. Nobody else has verified that this run "
        "happened as described."
    )
    warnings.append(
        "The baseline and the candidate launch in parallel against the same committed task "
        "set, under matched configuration, so the two are compared and not merely reported."
    )
    warnings.append(
        "Nothing produced here is a public proof. Starting this run evaluates the agent for "
        "real and spends model tokens on inference at the model provider you configured. A "
        "provider that charges for tokens bills that use to your own account; a model you run "
        "yourself sends no bill."
    )
    release = resolved.data_policy.candidate_skill.public_release
    if release == "required_for_climb":
        warnings.append("Entering this Climb requires releasing the candidate skill publicly.")
    elif release == "consent_required":
        warnings.append("Releasing the candidate skill publicly needs your separate consent.")
    return warnings


_PERMISSION_PHRASE: Final[dict[str, str]] = {
    "allowed": "allowed",
    "prohibited": "prohibited",
    "consent_required": "only with your separate consent",
}
_RELEASE_PHRASE: Final[dict[str, str]] = {
    "required_for_climb": "required in order to enter this Climb",
    "allowed": "allowed",
    "prohibited": "prohibited",
    "consent_required": "only with your separate consent",
}
_OWNER_PHRASE: Final[dict[str, str]] = {
    "participant": "You own",
    "account": "Your account owns",
    "shared": "You and Techtree jointly own",
}
_VISIBILITY_PHRASE: Final[dict[str, str]] = {
    "public": "published",
    "private": "kept private",
    "prohibited": "not produced",
}


def rights_summary(data_policy: DataPolicy) -> str:
    """The sentence-per-right summary shown before confirming; fixed phrases, so stable bytes."""
    owner = _OWNER_PHRASE[data_policy.owner.kind]
    raw = data_policy.raw_episodes
    return " ".join(
        [
            f"{owner} the candidate skill and everything this run produces.",
            "Publishing the candidate skill is "
            f"{_RELEASE_PHRASE[data_policy.candidate_skill.public_release]}.",
            f"Uploading raw episodes to a server is {_PERMISSION_PHRASE[raw.server_upload]}.",
            f"Training on raw episodes is {_PERMISSION_PHRASE[raw.training_use]}.",
            "The uplift report is "
            f"{_VISIBILITY_PHRASE[data_policy.derived_artifacts.uplift_report]}.",
            (
                "You can withdraw future uses later."
                if data_policy.revocation.future_use_revocable
                else "Future uses cannot be withdrawn later."
            ),
        ]
    )


def _candidate_name(candidate_label: str | None, root: Path) -> str:
    label = (candidate_label or root.name).strip()
    if _LABEL_PATTERN.fullmatch(label) is None:
        raise ValidationError(
            "a candidate label is up to 64 letters, digits, spaces, dots, dashes, or "
            "underscores, and starts with a letter or a digit",
            code=SKILL_INVALID,
            details={"label": label},
        )
    return label
