"""The portable local proof: the subset of a run directory that may travel.

    runs/<run-id>/proof/
    ├── bundle.json                        signed manifest over everything below
    ├── executor-public.json               the key the participant signed with
    ├── campaign.json
    ├── execution-plan.json
    ├── data-policy.json
    ├── taskset-lock.json
    ├── taskset-validation-receipt.json
    ├── baseline-experiment.json / candidate-experiment.json
    ├── baseline-receipt-set.json / candidate-receipt-set.json
    ├── receipts/{baseline,candidate}/NNNN.json    signed EpisodeReceiptV2 envelopes
    ├── comparison-execution.json          signed ComparisonExecutionRecord, when recorded
    └── uplift-report.json                 the signed UpliftReportV2 envelope

Every file is canonical bytes, so the digest of a file and the digest of the object inside
it are the same number and verification hashes what is on disk. The manifest is signed too:
otherwise the one thing the artifact digests cannot protect is the artifact list itself. P1
is a conclusion, never an assumption: `P1_CONDITIONS` is evaluated by
`assess_local_attestation` before a report exists and re-derived from the written bytes by
the verifier afterwards.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal, Self

from pydantic import BaseModel, model_validator

from regents_cli.techtree.canonical import (
    canonical_json_bytes,
    digest_object,
    sha256_digest_bytes,
)
from regents_cli.techtree.fs import atomic_write_bytes, ensure_private_directory
from regents_cli.techtree.identity.models import ExecutorIdentity
from regents_cli.techtree.identity.service import IdentityService, verify_signed_object
from regents_cli.techtree.models.base import (
    ArtifactRef,
    Digest,
    NonEmptyString,
    ObjectEnvelope,
    ProtocolModel,
)
from regents_cli.techtree.models.campaign import CampaignSpecV2
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.episode_receipt import EpisodeReceiptV2, ScoreStatus
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import ExperimentManifestV2, ExperimentVariant
from regents_cli.techtree.models.uplift_report import ComparisonStatus, UpliftReportV2
from regents_cli.techtree.models.validation import TasksetLock, TasksetValidationReceipt
from regents_cli.techtree.receipts.execution import (
    EXECUTION_RECORD_FILENAME,
    ComparisonExecutionRecord,
)
from regents_cli.techtree.receipts.set import ReceiptSetManifest
from regents_cli.techtree.receipts.uplift import LocalAttestation

LOCAL_PROOF_BUNDLE_SCHEMA_VERSION: Final = "techtree.local-proof-bundle.v1alpha1"
PROOF_BUNDLE_INVALID: Final = "proof_bundle_invalid"

BUNDLE_DIRECTORY: Final = "proof"
BUNDLE_MANIFEST_FILENAME: Final = "bundle.json"
PUBLIC_IDENTITY_FILENAME: Final = "executor-public.json"
CAMPAIGN_FILENAME: Final = "campaign.json"
EXECUTION_PLAN_FILENAME: Final = "execution-plan.json"
DATA_POLICY_FILENAME: Final = "data-policy.json"
TASKSET_LOCK_FILENAME: Final = "taskset-lock.json"
VALIDATION_RECEIPT_FILENAME: Final = "taskset-validation-receipt.json"
REPORT_FILENAME: Final = "uplift-report.json"
RECEIPTS_DIRECTORY: Final = "receipts"
BUNDLE_MEDIA_TYPE: Final = "application/json"

#: Receipt filenames are positional, so name order is the Campaign's committed task order.
_POSITION_WIDTH: Final = 4

_VARIANT_ORDER: Final = (ExperimentVariant.BASELINE, ExperimentVariant.CANDIDATE)

P1_ARTIFACT_DIGESTS_VERIFY: Final = "artifact_digests_verify"
P1_RECEIPTS_SIGNED: Final = "receipts_signed"
P1_REPORT_SIGNED: Final = "report_signed"
P1_PUBLIC_KEY_PRESENT: Final = "public_key_in_bundle"
P1_COMPARISON_CONTROLLED: Final = "comparison_controlled"
P1_SCORE_VALID: Final = "score_valid"

#: Every one is a condition on stored bytes; none is satisfied by a document's claim about itself.
P1_CONDITIONS: Final = (
    P1_ARTIFACT_DIGESTS_VERIFY,
    P1_RECEIPTS_SIGNED,
    P1_REPORT_SIGNED,
    P1_PUBLIC_KEY_PRESENT,
    P1_COMPARISON_CONTROLLED,
    P1_SCORE_VALID,
)


class ProofCondition(ProtocolModel):
    """One P1 condition and whether it holds."""

    id: NonEmptyString
    status: Literal["passed", "failed"]
    detail: NonEmptyString


@dataclass(frozen=True)
class AttestationAssessment:
    """Whether this run may sign its report into a P1 grade, and why."""

    attestation: LocalAttestation
    conditions: list[ProofCondition]

    @property
    def failures(self) -> list[ProofCondition]:
        return [condition for condition in self.conditions if condition.status == "failed"]


@dataclass(frozen=True)
class ReferencedObject:
    """One object a report cites, together with the digest it cites it under."""

    label: str
    value: BaseModel
    expected: Digest


class LocalProofBundleManifest(ProtocolModel):
    """Everything one portable local proof carries, committed to by digest."""

    schema_version: Literal["techtree.local-proof-bundle.v1alpha1"]
    run_id: NonEmptyString
    campaign_spec_digest: Digest
    data_policy_digest: Digest
    executor_identity: ExecutorIdentity
    artifacts: list[ArtifactRef]
    root_report_digest: Digest

    @model_validator(mode="after")
    def _check_every_artifact_is_placed_once(self) -> Self:
        paths = [artifact.relative_path for artifact in self.artifacts]
        if not paths:
            raise ValueError("a proof bundle commits to at least one artifact")
        if any(path is None for path in paths):
            raise ValueError(
                "every artifact in a proof bundle is placed by relative path; a digest with "
                "nowhere to look is not checkable"
            )
        if len(set(paths)) != len(paths):
            raise ValueError("a proof bundle places each artifact exactly once")
        return self

    def artifact(self, relative_path: str) -> ArtifactRef | None:
        for reference in self.artifacts:
            if reference.relative_path == relative_path:
                return reference
        return None


@dataclass(frozen=True)
class LocalProofBundleContents:
    """The objects one bundle is written from; receipts and report arrive already signed."""

    identity: ExecutorIdentity
    campaign: CampaignSpecV2
    execution_plan: ResolvedExecutionPlan
    data_policy: DataPolicy
    taskset_lock: TasksetLock
    validation_receipt: TasksetValidationReceipt
    experiments: Mapping[ExperimentVariant, ExperimentManifestV2]
    receipt_sets: Mapping[ExperimentVariant, ReceiptSetManifest]
    receipts: Mapping[ExperimentVariant, Sequence[ObjectEnvelope[EpisodeReceiptV2]]]
    report: ObjectEnvelope[UpliftReportV2]
    execution_record: ObjectEnvelope[ComparisonExecutionRecord] | None = None


def proof_bundle_dir(run_root: Path) -> Path:
    return run_root / BUNDLE_DIRECTORY


def experiment_filename(variant: ExperimentVariant) -> str:
    return f"{variant.value}-experiment.json"


def receipt_set_filename(variant: ExperimentVariant) -> str:
    return f"{variant.value}-receipt-set.json"


def receipt_filename(variant: ExperimentVariant, position: int) -> str:
    return f"{RECEIPTS_DIRECTORY}/{variant.value}/{position:0{_POSITION_WIDTH}d}.json"


def bundle_files(contents: LocalProofBundleContents) -> dict[str, bytes]:
    """Every bundle file except the manifest, as canonical bytes."""
    files: dict[str, bytes] = {
        PUBLIC_IDENTITY_FILENAME: canonical_json_bytes(contents.identity),
        CAMPAIGN_FILENAME: canonical_json_bytes(contents.campaign),
        EXECUTION_PLAN_FILENAME: canonical_json_bytes(contents.execution_plan),
        DATA_POLICY_FILENAME: canonical_json_bytes(contents.data_policy),
        TASKSET_LOCK_FILENAME: canonical_json_bytes(contents.taskset_lock),
        VALIDATION_RECEIPT_FILENAME: canonical_json_bytes(contents.validation_receipt),
        REPORT_FILENAME: canonical_json_bytes(contents.report),
    }
    if contents.execution_record is not None:
        files[EXECUTION_RECORD_FILENAME] = canonical_json_bytes(contents.execution_record)
    for variant in _VARIANT_ORDER:
        files[experiment_filename(variant)] = canonical_json_bytes(contents.experiments[variant])
        files[receipt_set_filename(variant)] = canonical_json_bytes(contents.receipt_sets[variant])
        for position, envelope in enumerate(contents.receipts[variant]):
            files[receipt_filename(variant, position)] = canonical_json_bytes(envelope)
    return files


def build_local_bundle(
    *, run_id: str, contents: LocalProofBundleContents
) -> LocalProofBundleManifest:
    """The manifest committing to every file this bundle carries."""
    files = bundle_files(contents)
    return LocalProofBundleManifest(
        schema_version=LOCAL_PROOF_BUNDLE_SCHEMA_VERSION,
        run_id=run_id,
        campaign_spec_digest=digest_object(contents.campaign),
        data_policy_digest=digest_object(contents.data_policy),
        executor_identity=contents.identity,
        artifacts=[
            ArtifactRef(
                digest=sha256_digest_bytes(data),
                media_type=BUNDLE_MEDIA_TYPE,
                size=len(data),
                relative_path=relative_path,
            )
            for relative_path, data in sorted(files.items())
        ],
        root_report_digest=contents.report.payload_digest,
    )


def write_local_bundle(
    *, run_root: Path, contents: LocalProofBundleContents, identity_service: IdentityService
) -> Path:
    """Write the bundle and, last, its signed manifest; return the directory.

    A bundle interrupted halfway has no manifest and is therefore not a bundle.
    """
    directory = proof_bundle_dir(run_root)
    ensure_private_directory(directory)
    for relative_path, data in sorted(bundle_files(contents).items()):
        destination = directory / relative_path
        ensure_private_directory(destination.parent)
        atomic_write_bytes(destination, data)
    manifest = build_local_bundle(run_id=contents.report.payload.run_id, contents=contents)
    sealed = identity_service.sign_object(manifest)
    atomic_write_bytes(directory / BUNDLE_MANIFEST_FILENAME, canonical_json_bytes(sealed))
    return directory


def assess_local_attestation(
    *,
    identity: ExecutorIdentity | None,
    identity_self_check: bool,
    referenced_objects: Sequence[ReferencedObject],
    signed_receipts: Mapping[ExperimentVariant, Sequence[ObjectEnvelope[EpisodeReceiptV2]]],
    comparison: ComparisonStatus,
    score: ScoreStatus,
) -> AttestationAssessment:
    """Decide, before the report exists, whether it may be signed into a P1 grade.

    The report's own signature is the one condition that cannot be checked yet; it is settled
    by verifying the written bundle before the report is recorded.
    """
    conditions = [
        _artifact_digests_condition(referenced_objects),
        _receipts_signed_condition(identity, signed_receipts),
        _report_signed_condition(identity, identity_self_check),
        _public_key_condition(identity, identity_self_check),
        _condition(
            P1_COMPARISON_CONTROLLED,
            comparison in (ComparisonStatus.CONTROLLED, ComparisonStatus.CONTROLLED_WITH_WARNINGS),
            f"the comparison is {comparison.value}",
        ),
        _condition(
            P1_SCORE_VALID,
            score is ScoreStatus.VALID,
            f"the recorded score status is {score.value}",
        ),
    ]
    failed = [condition for condition in conditions if condition.status == "failed"]
    return AttestationAssessment(
        attestation=LocalAttestation.UNATTESTED if failed else LocalAttestation.LOCAL_ED25519,
        conditions=conditions,
    )


def _artifact_digests_condition(referenced: Sequence[ReferencedObject]) -> ProofCondition:
    if not referenced:
        return _condition(
            P1_ARTIFACT_DIGESTS_VERIFY, False, "no referenced artifact was offered for checking"
        )
    broken = [item.label for item in referenced if digest_object(item.value) != item.expected]
    if broken:
        return _condition(
            P1_ARTIFACT_DIGESTS_VERIFY,
            False,
            "these objects no longer match the digests this run cites them under: "
            + ", ".join(sorted(broken)),
        )
    return _condition(
        P1_ARTIFACT_DIGESTS_VERIFY,
        True,
        f"{len(referenced)} referenced artifact digests recomputed and matched",
    )


def _receipts_signed_condition(
    identity: ExecutorIdentity | None,
    signed_receipts: Mapping[ExperimentVariant, Sequence[ObjectEnvelope[EpisodeReceiptV2]]],
) -> ProofCondition:
    if identity is None:
        return _condition(
            P1_RECEIPTS_SIGNED, False, "there is no local identity, so no receipt is signed"
        )
    total = 0
    unverified: list[str] = []
    for variant in _VARIANT_ORDER:
        for position, envelope in enumerate(signed_receipts.get(variant, ())):
            total += 1
            if not verify_signed_object(identity=identity, envelope=envelope).verified:
                unverified.append(f"{variant.value}/{position}")
    if not total:
        return _condition(P1_RECEIPTS_SIGNED, False, "this comparison has no receipts to sign")
    if unverified:
        return _condition(
            P1_RECEIPTS_SIGNED,
            False,
            "these receipts are not sealed by a verifying signature: " + ", ".join(unverified),
        )
    return _condition(
        P1_RECEIPTS_SIGNED, True, f"{total} receipts travel in signed envelopes that verify"
    )


def _report_signed_condition(identity: ExecutorIdentity | None, self_check: bool) -> ProofCondition:
    if identity is None or not self_check:
        return _condition(
            P1_REPORT_SIGNED,
            False,
            "no usable local identity is available to sign this run's report",
        )
    return _condition(
        P1_REPORT_SIGNED,
        True,
        f"the report is signed under key {identity.key_id}, and the written bundle is "
        "verified before the report is recorded",
    )


def _public_key_condition(identity: ExecutorIdentity | None, self_check: bool) -> ProofCondition:
    if identity is None:
        return _condition(
            P1_PUBLIC_KEY_PRESENT,
            False,
            "this machine has no local identity to include in a bundle",
        )
    if not self_check:
        return _condition(
            P1_PUBLIC_KEY_PRESENT,
            False,
            "the stored public key does not describe the key that would sign",
        )
    return _condition(
        P1_PUBLIC_KEY_PRESENT, True, f"public key {identity.key_id} travels with the proof"
    )


def _condition(identifier: str, holds: bool, detail: str) -> ProofCondition:
    return ProofCondition(id=identifier, status="passed" if holds else "failed", detail=detail)
