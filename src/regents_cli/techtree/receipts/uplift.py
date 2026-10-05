"""Reward aggregation, the verdict, and the report.

Nothing here scores anything: every number is arithmetic over rewards the receipts hold. A
task's score is the Campaign rubric's weighted total of its rewards, worked in decimal and
rounded once to a double; a receipt that lacks one of the rubric's rewards, or carries one the
rubric does not list, is refused. The join is by task hash in TasksetLock order, one receipt
per task per variant or nothing. The verdict is exact: each score is read as the shortest
decimal that reads back as it (the number the report's JSON writes), sums and the rule are
worked in decimal with no rounding, and the means are rounded once to a double, so a Campaign
asking for a tenth is not turned down over a binary hair. A relative delta over a zero
baseline is null. A tie is exact equality.

An unattested real report withholds the verdict (`development_only`) because the frozen model
ties the verdict to the P1 grade; an attested one carries P1 and the decision the Campaign's
own predeclared rules reach.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from datetime import datetime
from decimal import Context, Decimal, Inexact, localcontext
from enum import StrEnum
from typing import Literal

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.constants import UPLIFT_V3_SCHEMA_VERSION
from regents_cli.techtree.errors import VerificationError
from regents_cli.techtree.execution_facts import UpliftReportExecutionFacts
from regents_cli.techtree.ids import new_id
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.campaign import SUBJECT_AGENT, CampaignSpecV4, Rubric
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.episode_receipt import (
    EpisodeReceiptV3,
    EvidenceStatus,
    ScoreStatus,
)
from regents_cli.techtree.models.experiment import ExperimentManifestV4, ExperimentVariant
from regents_cli.techtree.models.run import RunRequestV2
from regents_cli.techtree.models.uplift_report import (
    ComparisonStatus,
    ExecutionStatus,
    PrimaryUpliftResult,
    PublicationStatus,
    TaskDelta,
    UpliftDecision,
    UpliftReportV3,
    UpliftStatuses,
)
from regents_cli.techtree.receipts.compare import COMPARISON_INVALID, RealComparisonResult
from regents_cli.techtree.receipts.episode import (
    REWARD_MISSING,
    REWARD_NON_FINITE,
    REWARD_RUBRIC_MISMATCH,
    TASK_MEMBERSHIP_MISMATCH,
)
from regents_cli.techtree.receipts.set import ReceiptSetManifest
from regents_cli.techtree.tasksets.membership import membership_digest

#: Wide enough that adding scores written as shortest decimals never rounds (a double spans
#: about 650 decimal digits); any rounding raises rather than passing unnoticed.
_EXACT = Context(prec=1000, traps=[Inexact])
_DIVIDE = Context(prec=1000)


class LocalAttestation(StrEnum):
    """Whether the local executor identity binds this report's evidence."""

    UNATTESTED = "unattested"
    LOCAL_ED25519 = "local_ed25519"


def pair_task_rewards(
    *,
    baseline_receipts: Sequence[EpisodeReceiptV3],
    candidate_receipts: Sequence[EpisodeReceiptV3],
    ordered_task_hashes: Sequence[Digest],
    rubric: Rubric,
) -> list[TaskDelta]:
    """Join the two variants by task hash and return rows in TasksetLock order."""
    committed = list(ordered_task_hashes)
    if not committed:
        raise VerificationError(
            "a comparison covers at least one committed task, and this one covers none",
            code=TASK_MEMBERSHIP_MISMATCH,
            details={"task_count": 0},
        )
    if len(set(committed)) != len(committed):
        raise VerificationError(
            "the committed membership names the same task twice, so a pair could be built "
            "from either of two receipts",
            code=TASK_MEMBERSHIP_MISMATCH,
            details={"task_count": len(committed)},
        )
    baseline = _scores_by_task(baseline_receipts, rubric, committed, "baseline")
    candidate = _scores_by_task(candidate_receipts, rubric, committed, "candidate")
    return [
        TaskDelta(
            task_hash=task_hash,
            baseline_reward=baseline[task_hash],
            candidate_reward=candidate[task_hash],
            delta=candidate[task_hash] - baseline[task_hash],
        )
        for task_hash in committed
    ]


def aggregate_primary_result(deltas: Sequence[TaskDelta]) -> PrimaryUpliftResult:
    """The headline result from the paired rows and nothing else."""
    if not deltas:
        raise VerificationError(
            "an uplift result summarizes at least one paired task",
            code=TASK_MEMBERSHIP_MISMATCH,
            details={"task_count": 0},
        )
    for delta in deltas:
        _require_finite(delta.baseline_reward, "baseline", delta.task_hash)
        _require_finite(delta.candidate_reward, "candidate", delta.task_hash)
    baseline_total, candidate_total = _totals(deltas)
    baseline_mean = _mean(baseline_total, len(deltas))
    candidate_mean = _mean(candidate_total, len(deltas))
    absolute = _mean(candidate_total - baseline_total, len(deltas))
    for value, label in (
        (baseline_mean, "baseline mean"),
        (candidate_mean, "candidate mean"),
        (absolute, "absolute delta"),
    ):
        if not math.isfinite(value):
            raise VerificationError(
                f"the {label} over these task scores is not a finite number",
                code=REWARD_NON_FINITE,
                details={"task_count": len(deltas)},
            )
    return PrimaryUpliftResult(
        baseline_mean=baseline_mean,
        candidate_mean=candidate_mean,
        absolute_delta=absolute,
        relative_delta=None if baseline_mean == 0.0 else absolute / baseline_mean,
        wins=sum(1 for delta in deltas if delta.candidate_reward > delta.baseline_reward),
        losses=sum(1 for delta in deltas if delta.candidate_reward < delta.baseline_reward),
        ties=sum(1 for delta in deltas if delta.candidate_reward == delta.baseline_reward),
    )


def decide_uplift(
    *, campaign: CampaignSpecV4, comparison: RealComparisonResult, deltas: Sequence[TaskDelta]
) -> UpliftDecision:
    """Apply the Campaign's own acceptance rules, and no others.

    The change in the mean clears the minimum exactly when the gap between the two exact totals
    clears the minimum times the number of tasks, so no division or rounding happens anywhere.
    """
    if not comparison.controlled:
        return UpliftDecision.INVALID
    scoring = campaign.scoring
    minimum = _exact(scoring.minimum_absolute_delta)
    if not scoring.require_candidate_above_baseline and minimum == 0:
        return UpliftDecision.INCONCLUSIVE
    baseline_total, candidate_total = _totals(deltas)
    with localcontext(_EXACT):
        gap = candidate_total - baseline_total
        required = minimum * len(deltas)
    if scoring.require_candidate_above_baseline and gap <= 0:
        return UpliftDecision.REJECTED
    if gap < required:
        return UpliftDecision.REJECTED
    return UpliftDecision.ACCEPTED


def summarize_receipts(
    baseline_receipts: Sequence[EpisodeReceiptV3], candidate_receipts: Sequence[EpisodeReceiptV3]
) -> tuple[ScoreStatus, EvidenceStatus]:
    """The comparison's score and evidence statuses: as good as its weakest receipt."""
    receipts = [*baseline_receipts, *candidate_receipts]
    if not receipts:
        return ScoreStatus.MISSING, EvidenceStatus.NOT_COLLECTED
    score = (
        ScoreStatus.VALID
        if all(receipt.score_status is ScoreStatus.VALID for receipt in receipts)
        else ScoreStatus.INVALID
    )
    evidence = (
        EvidenceStatus.COMPLETE
        if all(receipt.evidence_status is EvidenceStatus.COMPLETE for receipt in receipts)
        else EvidenceStatus.PARTIAL
    )
    return score, evidence


def publication_status_for(data_policy: DataPolicy) -> PublicationStatus:
    """A policy that does not make the report public blocks publication before anyone asks."""
    if data_policy.derived_artifacts.uplift_report == "public":
        return PublicationStatus.NOT_REQUESTED
    return PublicationStatus.BLOCKED


def publication_eligible_for(
    *, grade: Literal["development_only", "P1"], publication: PublicationStatus
) -> bool:
    return grade == "P1" and publication is not PublicationStatus.BLOCKED


def proof_grade_for(
    *, attestation: LocalAttestation, comparison: ComparisonStatus, score: ScoreStatus
) -> Literal["development_only", "P1"]:
    """The strongest grade this report may claim; the signature conditions are the caller's."""
    controlled = comparison in (
        ComparisonStatus.CONTROLLED,
        ComparisonStatus.CONTROLLED_WITH_WARNINGS,
    )
    if attestation is LocalAttestation.LOCAL_ED25519 and controlled and score is ScoreStatus.VALID:
        return "P1"
    return "development_only"


def build_uplift_report(
    *,
    run_request: RunRequestV2,
    campaign: CampaignSpecV4,
    execution: UpliftReportExecutionFacts,
    data_policy: DataPolicy,
    taskset_validation_receipt_digest: Digest,
    baseline_manifest: ExperimentManifestV4,
    candidate_manifest: ExperimentManifestV4,
    baseline_receipt_set: ReceiptSetManifest,
    candidate_receipt_set: ReceiptSetManifest,
    comparison: RealComparisonResult,
    task_deltas: Sequence[TaskDelta],
    primary: PrimaryUpliftResult,
    score: ScoreStatus,
    evidence: EvidenceStatus,
    attestation: LocalAttestation,
    rerun_of: Digest | None,
    created_at: datetime,
) -> UpliftReportV3:
    """Construct the report, or refuse when the evidence decided nothing.

    An uncontrolled comparison or an invalid score is a refusal rather than a status, because
    the frozen model cannot carry an `invalid` verdict without also claiming the P1 grade.
    """
    _require_reportable(comparison, score, run_request)
    _require_lineage(
        run_request=run_request,
        campaign=campaign,
        execution=execution,
        data_policy=data_policy,
        baseline_manifest=baseline_manifest,
        candidate_manifest=candidate_manifest,
        baseline_receipt_set=baseline_receipt_set,
        candidate_receipt_set=candidate_receipt_set,
        comparison=comparison,
    )
    grade = proof_grade_for(attestation=attestation, comparison=comparison.status, score=score)
    publication = publication_status_for(data_policy)
    decision = (
        decide_uplift(campaign=campaign, comparison=comparison, deltas=task_deltas)
        if grade == "P1"
        else UpliftDecision.DEVELOPMENT_ONLY
    )
    return UpliftReportV3(
        schema_version=UPLIFT_V3_SCHEMA_VERSION,
        id=new_id("uplift"),
        run_id=run_request.run_id,
        campaign_spec_digest=run_request.campaign_spec_digest,
        program_ref=run_request.program_ref,
        public_context=run_request.public_context,
        data_policy_digest=run_request.data_policy_digest,
        outcome_contract_digest=run_request.outcome_contract_digest,
        execution_plan_digest=execution.execution_plan_digest,
        execution_location=execution.execution_location,
        taskset_validation_receipt_digest=taskset_validation_receipt_digest,
        baseline_manifest_digest=run_request.baseline_manifest_digest,
        candidate_manifest_digest=run_request.candidate_manifest_digest,
        statuses=UpliftStatuses(
            execution=ExecutionStatus.COMPLETED,
            score=score,
            evidence=evidence,
            comparison=comparison.status,
            publication=publication,
        ),
        manifest_comparison=comparison.manifest_comparison,
        primary_result=primary,
        task_deltas=list(task_deltas),
        decision=decision,
        proof_grade=grade,
        publication_eligible=publication_eligible_for(grade=grade, publication=publication),
        rerun_of=rerun_of,
        created_at=created_at,
    )


def _scores_by_task(
    receipts: Sequence[EpisodeReceiptV3],
    rubric: Rubric,
    committed: Sequence[Digest],
    label: str,
) -> dict[Digest, float]:
    rewards: dict[Digest, float] = {}
    for receipt in receipts:
        traces = receipt.named_traces.get(SUBJECT_AGENT, [])
        if len(traces) != 1:
            raise VerificationError(
                f"a {label} receipt carries {len(traces)} subject traces; one episode has "
                "exactly one",
                code=TASK_MEMBERSHIP_MISMATCH,
                details={"task_hash": receipt.task_hash, "traces": len(traces)},
            )
        if receipt.task_hash in rewards:
            raise VerificationError(
                f"the {label} variant scored task {receipt.task_hash} twice, so one of the "
                "two rewards would have to be discarded",
                code=TASK_MEMBERSHIP_MISMATCH,
                details={"variant": label, "task_hash": receipt.task_hash},
            )
        reward = task_score(traces[0].rewards, rubric, label=label, task_hash=receipt.task_hash)
        _require_finite(reward, label, receipt.task_hash)
        rewards[receipt.task_hash] = reward
    missing: list[str] = [value for value in committed if value not in rewards]
    unexpected: list[str] = sorted(set(rewards) - set(committed))
    if missing or unexpected:
        raise VerificationError(
            f"the {label} variant scored a different set of tasks than the Campaign commits to",
            code=TASK_MEMBERSHIP_MISMATCH,
            details={"variant": label, "missing": missing, "unexpected": unexpected},
        )
    return rewards


def _require_finite(value: float, label: str, task_hash: Digest) -> None:
    if math.isfinite(value):
        return
    raise VerificationError(
        f"the {label} reward recorded for task {task_hash} is not finite, so it is not a "
        "measurement",
        code=REWARD_NON_FINITE,
        details={"variant": label, "task_hash": task_hash, "value": repr(value)},
    )


def task_score(
    scores: Mapping[str, float], rubric: Rubric, *, label: str, task_hash: Digest
) -> float:
    """The rubric's weighted total of one task's reward scores, worked exactly, rounded once."""
    weights = rubric.weights
    missing = sorted(set(weights) - set(scores))
    if missing:
        raise VerificationError(
            f"a {label} receipt records no {', '.join(map(repr, missing))} reward, and the "
            "Campaign's rubric scores every task on it",
            code=REWARD_MISSING,
            details={"task_hash": task_hash, "rewards": missing},
        )
    unexpected = sorted(set(scores) - set(weights))
    if unexpected:
        raise VerificationError(
            f"a {label} receipt records {', '.join(map(repr, unexpected))}, which the "
            "Campaign's rubric does not list, so its task score is not the scorer's",
            code=REWARD_RUBRIC_MISMATCH,
            details={"task_hash": task_hash, "rewards": unexpected},
        )
    for name, score in scores.items():
        _require_finite(score, f"{label} {name!r}", task_hash)
    with localcontext(_EXACT):
        total = sum(
            (_exact(scores[name]) * _exact(weight) for name, weight in weights.items()),
            Decimal(0),
        )
    return float(total)


def _exact(value: float) -> Decimal:
    """The shortest decimal that reads back as this score."""
    return Decimal(repr(float(value)))


def _totals(deltas: Sequence[TaskDelta]) -> tuple[Decimal, Decimal]:
    with localcontext(_EXACT):
        baseline = sum((_exact(delta.baseline_reward) for delta in deltas), Decimal(0))
        candidate = sum((_exact(delta.candidate_reward) for delta in deltas), Decimal(0))
    return baseline, candidate


def _mean(total: Decimal, count: int) -> float:
    """An exact total over `count` tasks, rounded once to a double."""
    with localcontext(_DIVIDE):
        return float(total / count)


def _require_reportable(
    comparison: RealComparisonResult, score: ScoreStatus, run_request: RunRequestV2
) -> None:
    if not comparison.controlled:
        raise VerificationError(
            "this run's two variants were not one controlled experiment, so there is no "
            "uplift to report: " + "; ".join(check.detail for check in comparison.failures),
            code=COMPARISON_INVALID,
            details={
                "run_id": run_request.run_id,
                "comparison": comparison.status.value,
                "failed_checks": [check.id for check in comparison.failures],
            },
        )
    if score is not ScoreStatus.VALID:
        raise VerificationError(
            f"this run's recorded scores are {score.value}, so the comparison measured nothing "
            "that may be reported",
            code=COMPARISON_INVALID,
            details={"run_id": run_request.run_id, "score": score.value},
        )


def _require_lineage(
    *,
    run_request: RunRequestV2,
    campaign: CampaignSpecV4,
    execution: UpliftReportExecutionFacts,
    data_policy: DataPolicy,
    baseline_manifest: ExperimentManifestV4,
    candidate_manifest: ExperimentManifestV4,
    baseline_receipt_set: ReceiptSetManifest,
    candidate_receipt_set: ReceiptSetManifest,
    comparison: RealComparisonResult,
) -> None:
    """Every object the report cites must belong to the same run."""
    for label, expected, found in (
        ("Campaign", run_request.campaign_spec_digest, digest_object(campaign)),
        ("execution plan", run_request.execution_plan_digest, execution.execution_plan_digest),
        (
            "baseline manifest",
            run_request.baseline_manifest_digest,
            digest_object(baseline_manifest),
        ),
        (
            "candidate manifest",
            run_request.candidate_manifest_digest,
            digest_object(candidate_manifest),
        ),
        ("DataPolicy", run_request.data_policy_digest, campaign.data_policy_digest),
        # The document itself, not only its digest: eligibility is read off these terms.
        ("DataPolicy document", run_request.data_policy_digest, digest_object(data_policy)),
    ):
        if expected != found:
            raise VerificationError(
                f"the {label} this report would cite is not the one the run's request names",
                code=COMPARISON_INVALID,
                details={"run_id": run_request.run_id, "expected": expected, "found": found},
            )
    committed = list(comparison.ordered_task_hashes)
    for manifest_set, variant, manifest_digest in (
        (baseline_receipt_set, ExperimentVariant.BASELINE, run_request.baseline_manifest_digest),
        (
            candidate_receipt_set,
            ExperimentVariant.CANDIDATE,
            run_request.candidate_manifest_digest,
        ),
    ):
        if (
            manifest_set.run_id == run_request.run_id
            and manifest_set.variant is variant
            and manifest_set.experiment_manifest_digest == manifest_digest
            and manifest_set.receipt_count == len(committed)
            and manifest_set.task_membership_digest == membership_digest(committed)
        ):
            continue
        raise VerificationError(
            f"the {variant.value} receipt set does not commit to this run's {variant.value} "
            "receipts",
            code=COMPARISON_INVALID,
            details={
                "run_id": run_request.run_id,
                "variant": variant.value,
                "receipt_set_run_id": manifest_set.run_id,
                "receipt_count": manifest_set.receipt_count,
                "committed": len(committed),
            },
        )
