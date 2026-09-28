"""Checking a local proof, offline, from exactly the bytes it stored.

Nothing here reaches the network, the catalog, or this machine's own identity. The order is
fixed and each step depends on the one before:

     1. Validate the bundle manifest.
     2. Verify every artifact digest.
     3. Verify Campaign, execution-plan and policy linkage.
     4. Verify TasksetLock and validation-receipt linkage.
     5. Verify every EpisodeReceipt envelope signature.
     6. Verify the receipt sets.
     7. Verify the UpliftReport envelope signature.
     8. Recompute the paired aggregate from the receipts.
     9. Require the recomputed result to equal the report.
    10. Require the report's publication fields to hold together.

Every digest is taken again from the file's own bytes and every aggregate is recomputed from
the receipts; nothing raises past the first problem, every step records a named check, and
the verdict is computed from the collected checks.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import digest_object, sha256_digest_bytes
from regents_cli.techtree.errors import VerificationError
from regents_cli.techtree.identity.models import (
    LOCAL_IDENTITY_INVALID,
    SIGNATURE_VERIFICATION_FAILED,
    ExecutorIdentity,
    VerificationMessage,
    VerificationResult,
    VerificationStatus,
)
from regents_cli.techtree.identity.service import verify_signed_object
from regents_cli.techtree.models.base import Digest, ObjectEnvelope
from regents_cli.techtree.models.campaign import CampaignSpecV2
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.episode_receipt import (
    EpisodeReceiptV2,
    ExecutionLocation,
    ScoreStatus,
)
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import ExperimentManifestV2, ExperimentVariant
from regents_cli.techtree.models.uplift_report import (
    ComparisonStatus,
    PublicationStatus,
    UpliftReportV2,
)
from regents_cli.techtree.models.validation import TasksetLock, TasksetValidationReceipt
from regents_cli.techtree.receipts.bundle import (
    BUNDLE_MANIFEST_FILENAME,
    CAMPAIGN_FILENAME,
    DATA_POLICY_FILENAME,
    EXECUTION_PLAN_FILENAME,
    P1_ARTIFACT_DIGESTS_VERIFY,
    P1_COMPARISON_CONTROLLED,
    P1_PUBLIC_KEY_PRESENT,
    P1_RECEIPTS_SIGNED,
    P1_REPORT_SIGNED,
    P1_SCORE_VALID,
    PROOF_BUNDLE_INVALID,
    PUBLIC_IDENTITY_FILENAME,
    REPORT_FILENAME,
    TASKSET_LOCK_FILENAME,
    VALIDATION_RECEIPT_FILENAME,
    LocalProofBundleManifest,
    experiment_filename,
    receipt_filename,
    receipt_set_filename,
)
from regents_cli.techtree.receipts.compare import COMPARISON_INVALID
from regents_cli.techtree.receipts.execution import (
    COMPARISON_EXECUTION_RECORD_INVALID,
    EXECUTION_RECORD_FILENAME,
    OPERATIONAL_EVIDENCE_UNAVAILABLE,
    ComparisonExecutionRecord,
)
from regents_cli.techtree.receipts.set import (
    RECEIPT_SET_INVALID,
    ReceiptSetManifest,
    verify_receipt_set,
)
from regents_cli.techtree.receipts.uplift import (
    aggregate_primary_result,
    pair_task_rewards,
    publication_eligible_for,
)

_VARIANT_ORDER: Final = (ExperimentVariant.BASELINE, ExperimentVariant.CANDIDATE)

#: What a P1 report claims, and no more.
P1_MEANING: Final = "integrity-bound, participant-attested local execution"

_P1_STATEMENTS: Final = {
    P1_ARTIFACT_DIGESTS_VERIFY: "every referenced artifact digest verifies",
    P1_RECEIPTS_SIGNED: "every EpisodeReceipt travels in a signed envelope",
    P1_REPORT_SIGNED: "the UpliftReport travels in a signed envelope",
    P1_PUBLIC_KEY_PRESENT: "the local public key is included in the bundle",
    P1_COMPARISON_CONTROLLED: "the comparison is controlled",
    P1_SCORE_VALID: "the score status is valid",
}


class LocalProofVerifier:
    """Verifies local proofs without needing anything but their own bytes."""

    def verify_report(self, path: Path) -> VerificationResult:
        return verify_report_envelope(path)

    def verify_bundle(self, path: Path) -> VerificationResult:
        return verify_local_bundle(path)

    def explain(self, result: VerificationResult) -> list[VerificationMessage]:
        """Summarize a verification under the five headings a reader keeps apart."""
        return _explain(result)


def verify_report_envelope(path: Path) -> VerificationResult:
    """Verify a signed report envelope using the public key stored beside it."""
    checks = _Checks()
    envelope = _load_envelope(path, UpliftReportV2, checks, "uplift-report")
    identity = _load_identity(path.parent / PUBLIC_IDENTITY_FILENAME, checks)
    if envelope is None or identity is None:
        return checks.result()
    checks.extend(
        verify_signed_object(identity=identity, envelope=envelope, subject="uplift-report").messages
    )
    _check_publication(envelope.payload, checks)
    return checks.result()


def verify_local_bundle(path: Path) -> VerificationResult:
    """Verify one proof bundle offline and return every check it ran."""
    checks = _Checks()
    directory = path if path.is_dir() else path.parent
    sealed = _load_envelope(
        directory / BUNDLE_MANIFEST_FILENAME, LocalProofBundleManifest, checks, "bundle"
    )
    if sealed is None:
        return checks.result()
    manifest = sealed.payload
    identity = manifest.executor_identity
    checks.extend(
        verify_signed_object(identity=identity, envelope=sealed, subject="bundle").messages
    )
    _check_artifacts(directory, manifest, checks)
    # A plan file the signed index never named is not bound to this run by anything.
    checks.verdict(
        "bundle.execution_plan_committed",
        manifest.artifact(EXECUTION_PLAN_FILENAME) is not None,
        PROOF_BUNDLE_INVALID,
        f"the bundle manifest commits to {EXECUTION_PLAN_FILENAME}",
        f"the bundle manifest does not commit to {EXECUTION_PLAN_FILENAME}, so nothing binds "
        "an execution plan to this proof",
    )
    stored_identity = _load_identity(directory / PUBLIC_IDENTITY_FILENAME, checks)
    identity_matches = stored_identity == identity
    checks.verdict(
        "bundle.public_key",
        identity_matches,
        LOCAL_IDENTITY_INVALID,
        f"the bundle carries public key {identity.key_id}",
        "the stored public key is not the key the manifest names",
    )
    documents = _load_documents(directory, checks)
    if documents is None:
        return checks.result()
    _check_linkage(manifest, documents, checks)
    receipts = _check_receipts(directory, documents, identity, checks)
    checks.extend(
        verify_signed_object(
            identity=identity, envelope=documents.report, subject="uplift-report"
        ).messages
    )
    checks.verdict(
        "bundle.root_report_digest",
        manifest.root_report_digest == documents.report.payload_digest,
        PROOF_BUNDLE_INVALID,
        "the manifest's root report digest names the report it carries",
        "the manifest names a different report than the one it carries",
    )
    if receipts is not None:
        _check_aggregate(documents, receipts, checks)
    _check_publication(documents.report.payload, checks)
    _check_execution_record(directory, manifest, documents, identity, checks)
    _check_p1_conditions(
        manifest=manifest,
        documents=documents,
        receipts=receipts,
        identity_matches=identity_matches,
        checks=checks,
    )
    return checks.result()


@dataclass(frozen=True)
class _Documents:
    """Every parsed document one bundle carries."""

    campaign: CampaignSpecV2
    execution_plan: ResolvedExecutionPlan
    data_policy: DataPolicy
    taskset_lock: TasksetLock
    validation_receipt: TasksetValidationReceipt
    experiments: dict[ExperimentVariant, ExperimentManifestV2]
    receipt_sets: dict[ExperimentVariant, ReceiptSetManifest]
    report: ObjectEnvelope[UpliftReportV2]


def _load_documents(directory: Path, checks: _Checks) -> _Documents | None:
    campaign = _load_model(directory / CAMPAIGN_FILENAME, CampaignSpecV2, checks)
    plan = _load_model(directory / EXECUTION_PLAN_FILENAME, ResolvedExecutionPlan, checks)
    policy = _load_model(directory / DATA_POLICY_FILENAME, DataPolicy, checks)
    lock = _load_model(directory / TASKSET_LOCK_FILENAME, TasksetLock, checks)
    receipt = _load_model(directory / VALIDATION_RECEIPT_FILENAME, TasksetValidationReceipt, checks)
    report = _load_envelope(directory / REPORT_FILENAME, UpliftReportV2, checks, "uplift-report")
    experiments: dict[ExperimentVariant, ExperimentManifestV2] = {}
    receipt_sets: dict[ExperimentVariant, ReceiptSetManifest] = {}
    for variant in _VARIANT_ORDER:
        experiment = _load_model(
            directory / experiment_filename(variant), ExperimentManifestV2, checks
        )
        receipt_set = _load_model(
            directory / receipt_set_filename(variant), ReceiptSetManifest, checks
        )
        if experiment is not None:
            experiments[variant] = experiment
        if receipt_set is not None:
            receipt_sets[variant] = receipt_set
    if (
        campaign is None
        or plan is None
        or policy is None
        or lock is None
        or receipt is None
        or report is None
        or len(experiments) != len(_VARIANT_ORDER)
        or len(receipt_sets) != len(_VARIANT_ORDER)
    ):
        return None
    return _Documents(
        campaign=campaign,
        execution_plan=plan,
        data_policy=policy,
        taskset_lock=lock,
        validation_receipt=receipt,
        experiments=experiments,
        receipt_sets=receipt_sets,
        report=report,
    )


def _check_artifacts(directory: Path, manifest: LocalProofBundleManifest, checks: _Checks) -> None:
    """Recompute every placed artifact's digest and size from its own bytes."""
    for reference in manifest.artifacts:
        relative_path = reference.relative_path
        assert relative_path is not None  # the manifest's own validator requires it
        stored = directory / relative_path
        try:
            data = stored.read_bytes()
        except OSError:
            checks.record(
                f"artifact.{relative_path}",
                "failed",
                PROOF_BUNDLE_INVALID,
                f"the bundle names {relative_path}, which is not there",
            )
            continue
        digest = sha256_digest_bytes(data)
        checks.verdict(
            f"artifact.{relative_path}",
            digest == reference.digest and len(data) == reference.size,
            PROOF_BUNDLE_INVALID,
            f"{relative_path} matches the digest the bundle commits to",
            f"{relative_path} has changed since the bundle was written: committed "
            f"{reference.digest}, stored {digest}",
        )


def _check_linkage(
    manifest: LocalProofBundleManifest, documents: _Documents, checks: _Checks
) -> None:
    """Every edge between the documents, in both directions."""
    report = documents.report.payload
    campaign_digest = digest_object(documents.campaign)
    plan_digest = digest_object(documents.execution_plan)
    policy_digest = digest_object(documents.data_policy)
    lock_digest = digest_object(documents.taskset_lock)
    receipt_digest = digest_object(documents.validation_receipt)
    baseline = documents.experiments[ExperimentVariant.BASELINE]
    candidate = documents.experiments[ExperimentVariant.CANDIDATE]
    for identifier, expected, found, description in (
        (
            "linkage.manifest_campaign",
            manifest.campaign_spec_digest,
            campaign_digest,
            "the bundle manifest names the Campaign it carries",
        ),
        (
            "linkage.report_campaign",
            report.campaign_spec_digest,
            campaign_digest,
            "the report was produced under the Campaign the bundle carries",
        ),
        (
            "linkage.campaign_plan",
            documents.campaign.execution_plan_digest,
            plan_digest,
            "the Campaign binds the execution plan the bundle carries",
        ),
        (
            "linkage.report_plan",
            report.execution_plan_digest,
            plan_digest,
            "the report was produced under that same execution plan",
        ),
        (
            "linkage.baseline_plan",
            baseline.configuration.execution_plan_digest,
            plan_digest,
            "the baseline experiment was resolved under that same execution plan",
        ),
        (
            "linkage.candidate_plan",
            candidate.configuration.execution_plan_digest,
            plan_digest,
            "the candidate experiment was resolved under that same execution plan",
        ),
        (
            "linkage.plan_engine",
            documents.execution_plan.evaluation.engine_digest,
            documents.validation_receipt.engine_digest,
            "the execution plan names the engine the validation receipt was issued under",
        ),
        (
            "linkage.campaign_policy",
            documents.campaign.data_policy_digest,
            policy_digest,
            "the Campaign names the DataPolicy the bundle carries",
        ),
        (
            "linkage.report_policy",
            report.data_policy_digest,
            policy_digest,
            "the report was produced under that same DataPolicy",
        ),
        (
            "linkage.manifest_policy",
            manifest.data_policy_digest,
            policy_digest,
            "the bundle manifest names that same DataPolicy",
        ),
        (
            "linkage.validation_lock",
            documents.validation_receipt.taskset_lock_digest,
            lock_digest,
            "the validation receipt validates the TasksetLock the bundle carries",
        ),
        (
            "linkage.campaign_validation",
            documents.campaign.taskset.validation_receipt_digest,
            receipt_digest,
            "the Campaign commits to that validation receipt",
        ),
        (
            "linkage.report_validation",
            report.taskset_validation_receipt_digest,
            receipt_digest,
            "the report cites that validation receipt",
        ),
        (
            "linkage.baseline_manifest",
            report.baseline_manifest_digest,
            digest_object(baseline),
            "the report cites the baseline experiment the bundle carries",
        ),
        (
            "linkage.candidate_manifest",
            report.candidate_manifest_digest,
            digest_object(candidate),
            "the report cites the candidate experiment the bundle carries",
        ),
    ):
        checks.verdict(
            identifier,
            expected == found,
            COMPARISON_INVALID,
            description,
            f"{description} — but it names {expected} and this is {found}",
        )
    planned = _planned_location(documents.execution_plan)
    checks.verdict(
        "linkage.report_location",
        report.execution_location == planned,
        COMPARISON_INVALID,
        f"the report places the execution where the plan does: {planned.kind}",
        f"the report places the execution at {report.execution_location.kind} and the plan "
        f"fixes {planned.kind}",
    )
    committed = list(documents.campaign.taskset.membership.ordered_task_hashes)
    checks.verdict(
        "linkage.taskset_membership",
        committed == list(documents.taskset_lock.ordered_task_hashes),
        COMPARISON_INVALID,
        f"the lock holds the {len(committed)} tasks the Campaign commits to",
        "the lock does not hold the tasks the Campaign commits to",
    )
    checks.verdict(
        "linkage.run_id",
        manifest.run_id == report.run_id,
        PROOF_BUNDLE_INVALID,
        f"the bundle and the report describe run {report.run_id}",
        "the bundle and the report describe different runs",
    )


def _planned_location(plan: ResolvedExecutionPlan) -> ExecutionLocation:
    return ExecutionLocation(kind=plan.execution.kind)


def _check_receipts(
    directory: Path, documents: _Documents, identity: ExecutorIdentity, checks: _Checks
) -> dict[ExperimentVariant, list[EpisodeReceiptV2]] | None:
    """Every receipt's signature and every variant's commitment."""
    committed = list(documents.taskset_lock.ordered_task_hashes)
    plan_digest = digest_object(documents.execution_plan)
    planned = _planned_location(documents.execution_plan)
    loaded: dict[ExperimentVariant, list[EpisodeReceiptV2]] = {}
    for variant in _VARIANT_ORDER:
        receipt_set = documents.receipt_sets[variant]
        envelopes: list[ObjectEnvelope[EpisodeReceiptV2]] = []
        for position in range(receipt_set.receipt_count):
            relative_path = receipt_filename(variant, position)
            envelope = _load_envelope(
                directory / relative_path, EpisodeReceiptV2, checks, relative_path
            )
            if envelope is None:
                return None
            envelopes.append(envelope)
            checks.extend(
                verify_signed_object(
                    identity=identity, envelope=envelope, subject=relative_path
                ).messages
            )
        try:
            verify_receipt_set(
                manifest=receipt_set, signed_receipts=envelopes, ordered_task_hashes=committed
            )
        except VerificationError as error:
            checks.record(
                f"receipt_set.{variant.value}", "failed", RECEIPT_SET_INVALID, error.message
            )
            return None
        checks.record(
            f"receipt_set.{variant.value}",
            "passed",
            RECEIPT_SET_INVALID,
            f"the {variant.value} receipt set commits to its {receipt_set.receipt_count} "
            "receipts in committed task order",
        )
        checks.verdict(
            f"receipt_set.{variant.value}.experiment",
            receipt_set.experiment_manifest_digest == digest_object(documents.experiments[variant]),
            RECEIPT_SET_INVALID,
            f"the {variant.value} receipts were scored under the experiment manifest the "
            "bundle carries",
            f"the {variant.value} receipts were scored under a different experiment manifest "
            "than the one the bundle carries",
        )
        _check_receipts_plan(variant, envelopes, plan_digest, checks)
        _check_receipts_location(variant, envelopes, planned, checks)
        loaded[variant] = [envelope.payload for envelope in envelopes]
    return loaded


def _check_receipts_plan(
    variant: ExperimentVariant,
    envelopes: Sequence[ObjectEnvelope[EpisodeReceiptV2]],
    plan_digest: Digest,
    checks: _Checks,
) -> None:
    strayed = [
        str(position)
        for position, envelope in enumerate(envelopes)
        if envelope.payload.execution_plan_digest != plan_digest
    ]
    checks.verdict(
        f"receipt_set.{variant.value}.execution_plan",
        not strayed,
        RECEIPT_SET_INVALID,
        f"the {variant.value} receipts were scored under the execution plan the bundle carries",
        f"these {variant.value} receipts name a different execution plan than the one the "
        f"bundle carries: {', '.join(strayed)}",
    )


def _check_receipts_location(
    variant: ExperimentVariant,
    envelopes: Sequence[ObjectEnvelope[EpisodeReceiptV2]],
    planned: ExecutionLocation,
    checks: _Checks,
) -> None:
    """One episode scored on another plane is a comparison the plan did not describe."""
    strayed = [
        str(position)
        for position, envelope in enumerate(envelopes)
        if envelope.payload.execution_location != planned
    ]
    checks.verdict(
        f"receipt_set.{variant.value}.execution_location",
        not strayed,
        RECEIPT_SET_INVALID,
        f"the {variant.value} receipts place their episodes where the plan does: {planned.kind}",
        f"these {variant.value} receipts place their episodes elsewhere than the plan's "
        f"{planned.kind}: {', '.join(strayed)}",
    )


def _check_aggregate(
    documents: _Documents,
    receipts: dict[ExperimentVariant, list[EpisodeReceiptV2]],
    checks: _Checks,
) -> None:
    """Recompute the paired aggregate and require the report to equal it."""
    report = documents.report.payload
    reward = documents.campaign.scoring.primary_reward
    try:
        deltas = pair_task_rewards(
            baseline_receipts=receipts[ExperimentVariant.BASELINE],
            candidate_receipts=receipts[ExperimentVariant.CANDIDATE],
            ordered_task_hashes=list(documents.taskset_lock.ordered_task_hashes),
            reward_name=reward,
        )
        primary = aggregate_primary_result(deltas, reward)
    except VerificationError as error:
        checks.record(
            "aggregate.recomputed",
            "failed",
            COMPARISON_INVALID,
            f"the receipts cannot be paired into a comparison: {error.message}",
        )
        return
    checks.verdict(
        "aggregate.recomputed",
        list(deltas) == list(report.task_deltas) and primary == report.primary_result,
        COMPARISON_INVALID,
        f"the report's result is the one these receipts produce: {primary.baseline_mean:.4f} "
        f"against {primary.candidate_mean:.4f} on {reward}",
        "the report states a different result than the one its own receipts produce",
    )


def _check_execution_record(
    directory: Path,
    manifest: LocalProofBundleManifest,
    documents: _Documents,
    identity: ExecutorIdentity,
    checks: _Checks,
) -> None:
    """A committed record is held to the same standard as everything else.

    A record that is absent and unpromised is a warning about what is unknown, never a
    finding about what was measured; a file the signed index never named is a failure.
    """
    path = directory / EXECUTION_RECORD_FILENAME
    if manifest.artifact(EXECUTION_RECORD_FILENAME) is None:
        if path.is_file():
            checks.record(
                "execution_record.present",
                "failed",
                COMPARISON_EXECUTION_RECORD_INVALID,
                "this bundle holds a comparison execution record its signed manifest does not "
                "commit to, so nothing binds it to this run",
            )
        else:
            checks.record(
                "execution_record.present",
                "warning",
                OPERATIONAL_EVIDENCE_UNAVAILABLE,
                "this bundle carries no comparison execution record, so the cost and timing "
                "of this comparison are unavailable; what it measured is unaffected",
            )
        return
    envelope = _load_envelope(path, ComparisonExecutionRecord, checks, "execution-record")
    if envelope is None:
        return
    checks.extend(
        verify_signed_object(
            identity=identity, envelope=envelope, subject="execution-record"
        ).messages
    )
    record = envelope.payload
    checks.verdict(
        "execution_record.run",
        record.run_id == manifest.run_id
        and record.campaign_spec_digest == manifest.campaign_spec_digest,
        COMPARISON_EXECUTION_RECORD_INVALID,
        f"the execution record describes run {manifest.run_id}",
        "the execution record describes a different run or Campaign",
    )
    checks.verdict(
        "execution_record.experiments",
        all(
            record.side(variant).experiment_manifest_digest
            == digest_object(documents.experiments[variant])
            for variant in _VARIANT_ORDER
        ),
        COMPARISON_EXECUTION_RECORD_INVALID,
        "the execution record accounts for the two experiments this bundle carries",
        "the execution record accounts for different experiments than the ones this bundle carries",
    )


def _check_publication(report: UpliftReportV2, checks: _Checks) -> None:
    """A bundle is sealed before anyone could publish, and the report may not overclaim.

    Eligibility is checked in one direction only: the flag records what the build that wrote
    the report allowed, and any edit to it breaks the signature, so the proof only requires
    that the report not claim publishability its own grade or rights statement forbid.
    """
    status = report.statuses.publication
    checks.verdict(
        "publication.not_requested",
        status in (PublicationStatus.NOT_REQUESTED, PublicationStatus.BLOCKED),
        PROOF_BUNDLE_INVALID,
        f"nothing in this proof was published: publication is {status.value}",
        f"this report's publication status is {status.value}, and a proof bundle is written "
        "before anything could have been published",
    )
    overclaims = report.publication_eligible and not publication_eligible_for(
        grade=report.proof_grade, publication=status
    )
    checks.verdict(
        "publication.eligibility_not_overclaimed",
        not overclaims,
        PROOF_BUNDLE_INVALID,
        "the report claims no more about publishing than its own grade and rights statement allow",
        f"the report claims it may be published while its grade is {report.proof_grade} and "
        f"its publication status is {status.value}, which do not allow it",
    )


def _check_p1_conditions(
    *,
    manifest: LocalProofBundleManifest,
    documents: _Documents,
    receipts: dict[ExperimentVariant, list[EpisodeReceiptV2]] | None,
    identity_matches: bool,
    checks: _Checks,
) -> None:
    """Re-derive every P1 condition; a report claiming P1 fails each one it cannot re-establish."""
    report = documents.report.payload
    claimed = report.proof_grade == "P1"
    established = {
        P1_ARTIFACT_DIGESTS_VERIFY: not checks.failed_under("artifact."),
        P1_RECEIPTS_SIGNED: receipts is not None and not checks.failed_under("receipts/"),
        P1_REPORT_SIGNED: documents.report.signature is not None
        and not checks.failed_under("uplift-report."),
        P1_PUBLIC_KEY_PRESENT: identity_matches,
        P1_COMPARISON_CONTROLLED: report.statuses.comparison
        in (ComparisonStatus.CONTROLLED, ComparisonStatus.CONTROLLED_WITH_WARNINGS),
        P1_SCORE_VALID: report.statuses.score is ScoreStatus.VALID,
    }
    for condition, holds in established.items():
        statement = _P1_STATEMENTS[condition]
        if holds:
            status: VerificationStatus = "passed"
            detail = statement
        elif claimed:
            status = "failed"
            detail = f"this report claims P1 and {statement} does not hold"
        else:
            status = "warning"
            detail = f"{statement} does not hold, and this report does not claim P1"
        checks.record(f"p1.{condition}", status, PROOF_BUNDLE_INVALID, detail)
    checks.record(
        "p1.grade",
        "passed",
        PROOF_BUNDLE_INVALID,
        f"this report claims proof grade P1, which means {P1_MEANING}"
        if claimed
        else f"this report claims proof grade {report.proof_grade}, which is not evidence of "
        "anything",
    )
    checks.record(
        "p1.run",
        "passed",
        PROOF_BUNDLE_INVALID,
        f"these conditions were checked for run {manifest.run_id}",
    )


def _explain(result: VerificationResult) -> list[VerificationMessage]:
    integrity = _worst(
        result,
        lambda identifier: (
            identifier.startswith(("artifact.", "bundle."))
            or identifier.endswith((".signature", ".payload_digest", ".signature_present"))
        ),
    )
    science = _worst(
        result, lambda identifier: identifier.startswith(("linkage.", "aggregate.", "receipt_set."))
    )
    attestation = _worst(
        result, lambda identifier: identifier.startswith(("p1.", "uplift-report."))
    )
    publication = _worst(result, lambda identifier: identifier.startswith("publication."))
    return [
        VerificationMessage(
            id="integrity",
            status=integrity,
            code=SIGNATURE_VERIFICATION_FAILED,
            detail=(
                "Cryptographic integrity: every file still matches the digest it was committed "
                "under, and every signature verifies."
                if integrity == "passed"
                else "Cryptographic integrity: something in this proof no longer matches what "
                "was signed."
            ),
        ),
        VerificationMessage(
            id="comparison_validity",
            status=science,
            code=COMPARISON_INVALID,
            detail=(
                "Scientific comparison: the documents describe one controlled comparison, and "
                "the report's numbers are the ones its own receipts produce."
                if science == "passed"
                else "Scientific comparison: these documents do not describe one consistent "
                "comparison."
            ),
        ),
        VerificationMessage(
            id="participant_attestation",
            status=attestation,
            code=LOCAL_IDENTITY_INVALID,
            detail="Participant attestation: signed by the participant's own local key. "
            f"P1 means {P1_MEANING}.",
        ),
        VerificationMessage(
            id="independent_reproduction",
            status="warning",
            code=PROOF_BUNDLE_INVALID,
            detail="No independent reproduction: nobody else has run this comparison, and no "
            "platform witnessed it.",
        ),
        VerificationMessage(
            id="public_publication",
            status=publication,
            code=PROOF_BUNDLE_INVALID,
            detail="Publication was not requested when this proof was written, which is the "
            "only answer a bundle can give: it is sealed before anybody could have been asked. "
            "It is not a statement about whether the run was published afterwards. Whether it "
            "may be published is checked separately.",
        ),
    ]


def _worst(result: VerificationResult, selector: Callable[[str], bool]) -> VerificationStatus:
    statuses = [message.status for message in result.messages if selector(message.id)]
    if not statuses:
        return "failed"
    if "failed" in statuses:
        return "failed"
    if "warning" in statuses:
        return "warning"
    return "passed"


class _Checks:
    """Collects named checks and turns them into one verdict."""

    def __init__(self) -> None:
        self.messages: list[VerificationMessage] = []

    def record(self, identifier: str, status: VerificationStatus, code: str, detail: str) -> None:
        self.messages.append(
            VerificationMessage(id=identifier, status=status, code=code, detail=detail)
        )

    def verdict(
        self, identifier: str, ok: bool, code: str, ok_detail: str, fail_detail: str
    ) -> None:
        self.record(
            identifier, "passed" if ok else "failed", code, ok_detail if ok else fail_detail
        )

    def extend(self, messages: Sequence[VerificationMessage]) -> None:
        self.messages.extend(messages)

    def failed_under(self, prefix: str) -> bool:
        return any(
            message.id.startswith(prefix) and message.status == "failed"
            for message in self.messages
        )

    def result(self) -> VerificationResult:
        failed = any(message.status == "failed" for message in self.messages)
        return VerificationResult(verified=not failed, messages=self.messages)


def _load_model[ModelT: BaseModel](
    path: Path, model: type[ModelT], checks: _Checks
) -> ModelT | None:
    try:
        raw = path.read_bytes()
    except OSError:
        checks.record(
            f"document.{path.name}",
            "failed",
            PROOF_BUNDLE_INVALID,
            f"this bundle has no {path.name}",
        )
        return None
    try:
        return model.model_validate_json(raw)
    except PydanticValidationError as error:
        checks.record(
            f"document.{path.name}",
            "failed",
            PROOF_BUNDLE_INVALID,
            f"{path.name} is not a valid {model.__name__}: {error.errors()[0]['msg']}",
        )
        return None


def _load_envelope[ModelT: BaseModel](
    path: Path, model: type[ModelT], checks: _Checks, subject: str
) -> ObjectEnvelope[ModelT] | None:
    try:
        raw = path.read_bytes()
    except OSError:
        checks.record(
            f"{subject}.present", "failed", PROOF_BUNDLE_INVALID, f"this proof has no {path.name}"
        )
        return None
    try:
        return ObjectEnvelope[model].model_validate_json(raw)  # type: ignore[valid-type]
    except PydanticValidationError as error:
        checks.record(
            f"{subject}.present",
            "failed",
            PROOF_BUNDLE_INVALID,
            f"{path.name} is not a signed {model.__name__}: {error.errors()[0]['msg']}",
        )
        return None


def _load_identity(path: Path, checks: _Checks) -> ExecutorIdentity | None:
    try:
        raw = path.read_bytes()
    except OSError:
        checks.record(
            "identity.present",
            "failed",
            LOCAL_IDENTITY_INVALID,
            f"this proof carries no {path.name}, so there is no key to check its signatures "
            "against",
        )
        return None
    try:
        return ExecutorIdentity.model_validate_json(raw)
    except PydanticValidationError as error:
        checks.record(
            "identity.present",
            "failed",
            LOCAL_IDENTITY_INVALID,
            f"{path.name} is not a valid identity: {error.errors()[0]['msg']}",
        )
        return None
