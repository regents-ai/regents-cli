"""The stage that closes a run: evidence into signed receipts, a checked comparison, a report.

Everything here is a pure function of files the run already owns; it spends nothing and starts
nothing. The receipts are written before the comparison is checked, because they are the paid
evaluation's only durable record. The proof bundle is verified from the bytes just written,
with the same verifier a stranger would use, before the report is recorded as a result.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.errors import ValidationError, VerificationError
from regents_cli.techtree.execution_facts import (
    episode_receipt_execution_facts,
    uplift_report_execution_facts,
)
from regents_cli.techtree.identity.models import ExecutorIdentity
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.models.base import ObjectEnvelope
from regents_cli.techtree.models.episode_receipt import EpisodeReceiptV3
from regents_cli.techtree.models.experiment import ExperimentVariant
from regents_cli.techtree.models.run import RunPhase, RunRequestV2
from regents_cli.techtree.models.uplift_report import UpliftReportV3
from regents_cli.techtree.models.validation import TasksetLock
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.receipts.bundle import (
    PROOF_BUNDLE_INVALID,
    LocalProofBundleContents,
    ReferencedObject,
    assess_local_attestation,
    write_local_bundle,
)
from regents_cli.techtree.receipts.compare import (
    COMPARISON_INVALID,
    ObservedVariant,
    RealComparisonResult,
    compare_real_variants,
    observe_variant,
)
from regents_cli.techtree.receipts.episode import build_variant_receipts, experiment_variant_of
from regents_cli.techtree.receipts.execution import (
    ComparisonExecutionRecord,
    build_comparison_execution_record,
    read_children_record,
)
from regents_cli.techtree.receipts.observed import read_resolved_config
from regents_cli.techtree.receipts.set import (
    ReceiptSetManifest,
    build_receipt_set,
    receipt_set_path,
    write_receipt_set,
)
from regents_cli.techtree.receipts.uplift import (
    aggregate_primary_result,
    build_uplift_report,
    pair_task_rewards,
    summarize_receipts,
)
from regents_cli.techtree.receipts.verify import verify_local_bundle
from regents_cli.techtree.runs.artifacts import RunArtifactStore, RunInputBundle
from regents_cli.techtree.runs.child_registry import children_record_path
from regents_cli.techtree.runs.events import DETAIL_RESULT_DIGEST, RUN_COMPLETED
from regents_cli.techtree.runs.executor import raise_if_cancel_requested
from regents_cli.techtree.runs.real import TASKSET_LOCK_FILENAME
from regents_cli.techtree.runs.store import RunStore
from regents_cli.techtree.verifiers.compiler import divide_concurrency
from regents_cli.techtree.verifiers.models import (
    RealExecutionResult,
    VariantExecutionResult,
    VariantName,
)
from regents_cli.techtree.verifiers.outputs import RESOLVED_CONFIG_PATH, TRACES_FILENAME
from regents_cli.techtree.verifiers.paths import RunPaths

REPORT_STAGE_FAILED: Final = "real_report_stage_failed"

_VARIANT_ORDER: Final[tuple[VariantName, ...]] = (VariantName.BASELINE, VariantName.CANDIDATE)


@dataclass(frozen=True)
class VariantReceipts:
    """One variant's signed receipts, its commitment over them, and what it ran."""

    receipts: list[EpisodeReceiptV3]
    signed_receipts: list[ObjectEnvelope[EpisodeReceiptV3]]
    receipt_set: ReceiptSetManifest
    observed: ObservedVariant


class RunReportService:
    """Completes a run by turning its evidence into a signed, proven UpliftReportV3."""

    def __init__(
        self,
        *,
        paths: TechtreePaths,
        run_store: RunStore,
        artifact_store: RunArtifactStore,
        identity: IdentityService,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._paths = paths
        self._run_store = run_store
        self._artifacts = artifact_store
        self._identity = identity
        self._clock = clock or _utc_now

    def complete(self, *, request: RunRequestV2, execution: RealExecutionResult) -> UpliftReportV3:
        """Build, check, aggregate, sign, prove and record this run's result."""
        run_id = request.run_id
        raise_if_cancel_requested(self._run_store, run_id)

        inputs = self._artifacts.load_inputs(run_id, request)
        run_paths = RunPaths.for_run(self._paths, run_id)
        lock = self._taskset_lock(run_paths, inputs)
        # Before anything is sealed, so a machine that cannot sign says so first.
        identity = self._identity.ensure()

        self._run_store.append(run_id, phase=RunPhase.BUILDING_RECEIPTS)
        sides = {
            variant: self._build_variant(
                request=request,
                inputs=inputs,
                run_paths=run_paths,
                lock=lock,
                variant=variant,
                result=_side(execution, variant),
            )
            for variant in _VARIANT_ORDER
        }
        baseline = sides[VariantName.BASELINE]
        candidate = sides[VariantName.CANDIDATE]

        self._run_store.append(run_id, phase=RunPhase.VERIFYING_COMPARISON)
        comparison = compare_real_variants(
            campaign=inputs.campaign,
            plan=inputs.execution_plan,
            baseline_manifest=inputs.baseline,
            candidate_manifest=inputs.candidate,
            prepared_manifest_comparison=inputs.comparison,
            baseline_receipts=baseline.receipts,
            candidate_receipts=candidate.receipts,
            taskset_lock=lock,
            baseline_observed=baseline.observed,
            candidate_observed=candidate.observed,
            schedule=execution.schedule,
        )

        self._run_store.append(run_id, phase=RunPhase.BUILDING_REPORT)
        report = self._report(
            request=request,
            inputs=inputs,
            lock=lock,
            identity=identity,
            comparison=comparison,
            baseline=baseline,
            candidate=candidate,
        )
        run_root = self._paths.run_dir(run_id)
        execution_record = build_comparison_execution_record(
            run_id=run_id,
            campaign_spec_digest=request.campaign_spec_digest,
            campaign_max_concurrent=inputs.campaign.execution.max_concurrent,
            execution=execution,
            launch=read_children_record(children_record_path(run_root)),
            concurrency=divide_concurrency(inputs.campaign.execution.max_concurrent),
            raw_traces=(
                (run_paths.variant_output_dir(VariantName.BASELINE) / TRACES_FILENAME).read_bytes(),
                (
                    run_paths.variant_output_dir(VariantName.CANDIDATE) / TRACES_FILENAME
                ).read_bytes(),
            ),
        )
        self._prove(
            request=request,
            inputs=inputs,
            lock=lock,
            identity=identity,
            report=report,
            baseline=baseline,
            candidate=candidate,
            execution_record=execution_record,
        )

        self._run_store.write_result(run_id, report)
        self._run_store.append(
            run_id,
            phase=RunPhase.COMPLETED,
            kind=RUN_COMPLETED,
            details={DETAIL_RESULT_DIGEST: digest_object(report)},
        )
        return report

    def _build_variant(
        self,
        *,
        request: RunRequestV2,
        inputs: RunInputBundle,
        run_paths: RunPaths,
        lock: TasksetLock,
        variant: VariantName,
        result: VariantExecutionResult,
    ) -> VariantReceipts:
        experiment = inputs.baseline if variant is VariantName.BASELINE else inputs.candidate
        campaign = inputs.campaign
        receipts = build_variant_receipts(
            run_request=request,
            variant=variant,
            experiment=experiment,
            result=result,
            execution=episode_receipt_execution_facts(campaign, inputs.execution_plan),
            ordered_task_hashes=lock.ordered_task_hashes,
            rubric=campaign.scoring.rubric,
            evidence=campaign.evidence,
        )
        for position, receipt in enumerate(receipts):
            self._artifacts.write_episode_receipt(
                request.run_id, position=position, receipt=receipt
            )

        # The receipt set commits to each receipt's payload digest, which signing does not move,
        # so the commitment and the signature are two independent seals over the same bytes.
        envelopes = [self._identity.sign_object(receipt) for receipt in receipts]
        protocol_variant = experiment_variant_of(variant)
        receipt_set = build_receipt_set(
            run_id=request.run_id,
            variant=protocol_variant,
            experiment_manifest_digest=result.experiment_manifest_digest,
            signed_receipts=envelopes,
            ordered_task_hashes=lock.ordered_task_hashes,
        )
        write_receipt_set(receipt_set, receipt_set_path(run_paths.root, protocol_variant))
        return VariantReceipts(
            receipts=receipts,
            signed_receipts=envelopes,
            receipt_set=receipt_set,
            observed=observe_variant(
                result=result,
                resolved_config=read_resolved_config(
                    run_paths.variant_output_dir(variant) / RESOLVED_CONFIG_PATH
                ),
                campaign=campaign,
            ),
        )

    def _report(
        self,
        *,
        request: RunRequestV2,
        inputs: RunInputBundle,
        lock: TasksetLock,
        identity: ExecutorIdentity,
        comparison: RealComparisonResult,
        baseline: VariantReceipts,
        candidate: VariantReceipts,
    ) -> UpliftReportV3:
        campaign = inputs.campaign
        deltas = pair_task_rewards(
            baseline_receipts=baseline.receipts,
            candidate_receipts=candidate.receipts,
            ordered_task_hashes=comparison.ordered_task_hashes,
            rubric=campaign.scoring.rubric,
        )
        primary = aggregate_primary_result(deltas)
        score, evidence = summarize_receipts(baseline.receipts, candidate.receipts)
        return build_uplift_report(
            run_request=request,
            campaign=campaign,
            execution=uplift_report_execution_facts(campaign, inputs.execution_plan),
            data_policy=inputs.source.data_policy,
            taskset_validation_receipt_digest=campaign.taskset.validation_receipt_digest,
            baseline_manifest=inputs.baseline,
            candidate_manifest=inputs.candidate,
            baseline_receipt_set=baseline.receipt_set,
            candidate_receipt_set=candidate.receipt_set,
            comparison=comparison,
            task_deltas=deltas,
            primary=primary,
            score=score,
            evidence=evidence,
            # The grade is decided by every attestation condition, never by the presence of a
            # key; any failure withholds the verdict rather than claiming a grade not earned.
            attestation=assess_local_attestation(
                identity=identity,
                identity_self_check=self._identity.store.verify_pair(),
                referenced_objects=_referenced_objects(request=request, inputs=inputs, lock=lock),
                signed_receipts={
                    ExperimentVariant.BASELINE: baseline.signed_receipts,
                    ExperimentVariant.CANDIDATE: candidate.signed_receipts,
                },
                comparison=comparison.status,
                score=score,
            ).attestation,
            created_at=self._clock(),
        )

    def _prove(
        self,
        *,
        request: RunRequestV2,
        inputs: RunInputBundle,
        lock: TasksetLock,
        identity: ExecutorIdentity,
        report: UpliftReportV3,
        baseline: VariantReceipts,
        candidate: VariantReceipts,
        execution_record: ComparisonExecutionRecord,
    ) -> Path:
        """Sign the report, write the portable proof, and verify it offline before recording."""
        directory = write_local_bundle(
            run_root=self._paths.run_dir(request.run_id),
            contents=LocalProofBundleContents(
                identity=identity,
                campaign=inputs.campaign,
                execution_plan=inputs.execution_plan,
                data_policy=inputs.source.data_policy,
                taskset_lock=lock,
                validation_receipt=inputs.source.publisher_validation,
                experiments={
                    ExperimentVariant.BASELINE: inputs.baseline,
                    ExperimentVariant.CANDIDATE: inputs.candidate,
                },
                receipt_sets={
                    ExperimentVariant.BASELINE: baseline.receipt_set,
                    ExperimentVariant.CANDIDATE: candidate.receipt_set,
                },
                receipts={
                    ExperimentVariant.BASELINE: baseline.signed_receipts,
                    ExperimentVariant.CANDIDATE: candidate.signed_receipts,
                },
                report=self._identity.sign_object(report),
                execution_record=self._identity.sign_object(execution_record),
            ),
            identity_service=self._identity,
        )
        verification = verify_local_bundle(directory)
        if verification.verified:
            return directory
        raise VerificationError(
            "this run's local proof does not verify from the bytes it just wrote, so its "
            "report is not recorded as a result",
            code=PROOF_BUNDLE_INVALID,
            details={
                "run_id": request.run_id,
                "proof_grade": report.proof_grade,
                "failed_checks": [message.id for message in verification.failures],
            },
        )

    def _taskset_lock(self, run_paths: RunPaths, inputs: RunInputBundle) -> TasksetLock:
        """Read the lock the executor wrote, so receipts are ordered as the normalizer joined."""
        path = run_paths.inputs_dir / TASKSET_LOCK_FILENAME
        try:
            lock = TasksetLock.model_validate_json(path.read_bytes())
        except OSError as error:
            raise ValidationError(
                "this run recorded no validated taskset lock, so its episodes cannot be ordered "
                "by the membership they were scored under",
                code=REPORT_STAGE_FAILED,
                details={"run_id": inputs.request.run_id, "path": str(path)},
            ) from error
        except PydanticValidationError as error:
            raise ValidationError(
                f"this run's taskset lock cannot be read: {error.errors()[0]['msg']}",
                code=REPORT_STAGE_FAILED,
                details={"run_id": inputs.request.run_id, "path": str(path)},
            ) from error
        committed = list(inputs.campaign.taskset.membership.ordered_task_hashes)
        if list(lock.ordered_task_hashes) != committed:
            raise ValidationError(
                "this run's taskset lock does not hold the tasks its Campaign commits to",
                code=COMPARISON_INVALID,
                details={
                    "run_id": inputs.request.run_id,
                    "locked": len(lock.ordered_task_hashes),
                    "committed": len(committed),
                },
            )
        return lock


def _referenced_objects(
    *, request: RunRequestV2, inputs: RunInputBundle, lock: TasksetLock
) -> list[ReferencedObject]:
    """Every object the report cites, each checked against the digest another document names."""
    campaign = inputs.campaign
    publisher_validation = inputs.source.publisher_validation
    return [
        ReferencedObject("campaign", campaign, request.campaign_spec_digest),
        ReferencedObject("execution-plan", inputs.execution_plan, campaign.execution_plan_digest),
        ReferencedObject("data-policy", inputs.source.data_policy, campaign.data_policy_digest),
        ReferencedObject(
            "taskset-validation-receipt",
            publisher_validation,
            campaign.taskset.validation_receipt_digest,
        ),
        ReferencedObject("taskset-lock", lock, publisher_validation.taskset_lock_digest),
        ReferencedObject("baseline-experiment", inputs.baseline, request.baseline_manifest_digest),
        ReferencedObject(
            "candidate-experiment", inputs.candidate, request.candidate_manifest_digest
        ),
    ]


def _side(execution: RealExecutionResult, variant: VariantName) -> VariantExecutionResult:
    return execution.baseline if variant is VariantName.BASELINE else execution.candidate


def _utc_now() -> datetime:
    return datetime.now(UTC)
