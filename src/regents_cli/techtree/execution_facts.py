"""Projecting a bound execution plan onto the receipt and the report.

Every projection re-derives the plan's digest and refuses a plan the Campaign is not bound
to: a projection taken from an unbound plan would state facts about a run that never
happened, in a document nobody could tell was wrong.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.campaign import CampaignSpecV3
from regents_cli.techtree.models.episode_receipt import ExecutionLocation
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan

EXECUTION_PLAN_UNSUPPORTED: Final = "execution_plan_unsupported"


def bound_execution_plan_digest(campaign: CampaignSpecV3, plan: ResolvedExecutionPlan) -> Digest:
    """The plan's digest, refusing a plan this Campaign is not bound to."""
    digest = digest_object(plan)
    if digest != campaign.execution_plan_digest:
        raise ValidationError(
            "this execution plan is not the one the Campaign binds",
            details={
                "campaign_execution_plan_digest": campaign.execution_plan_digest,
                "plan_digest": digest,
            },
        )
    return digest


def require_executable_execution_plan(
    campaign: CampaignSpecV3, plan: ResolvedExecutionPlan
) -> Digest:
    """The bound plan's digest, refusing a plan this build cannot run.

    The plan's backend kinds are typed to the one local, direct pair this build runs, so the
    only plan that parses and still cannot run is one asking for trace coverage.
    """
    digest = bound_execution_plan_digest(campaign, plan)
    if plan.evidence.trace_coverage != "not_requested":
        raise ValidationError(
            "this Campaign requests trace coverage, which this build cannot produce",
            code=EXECUTION_PLAN_UNSUPPORTED,
            details={
                "execution_plan_digest": digest,
                "trace_coverage": plan.evidence.trace_coverage,
            },
        )
    return digest


@dataclass(frozen=True, slots=True)
class RunRequestExecutionFacts:
    """What a `RunRequestV2` owes to the plan."""

    execution_plan_digest: Digest


@dataclass(frozen=True, slots=True)
class ClimbSummaryExecutionFacts:
    """What a `ClimbSummaryV2` owes to the plan: the subject harness and where it runs."""

    subject_harness: str
    subject_harness_version: str
    execution_backend_kind: Literal["local"]


@dataclass(frozen=True, slots=True)
class CompatibilityResultExecutionFacts:
    """What a `CompatibilityResultV2` owes to the plan."""

    execution_plan_digest: Digest
    evaluation_engine_source_commit: str
    evaluation_engine_digest: Digest
    execution_backend_kind: Literal["local"]
    execution_backend_supported: bool
    subject_backend_kind: Literal["direct"]
    subject_backend_supported: bool


@dataclass(frozen=True, slots=True)
class EpisodeReceiptExecutionFacts:
    """What an `EpisodeReceiptV3` owes to the plan."""

    execution_plan_digest: Digest
    execution_location: ExecutionLocation


@dataclass(frozen=True, slots=True)
class UpliftReportExecutionFacts:
    """What an `UpliftReportV3` owes to the plan."""

    execution_plan_digest: Digest
    execution_location: ExecutionLocation


def episode_receipt_execution_facts(
    campaign: CampaignSpecV3, plan: ResolvedExecutionPlan
) -> EpisodeReceiptExecutionFacts:
    return EpisodeReceiptExecutionFacts(
        execution_plan_digest=bound_execution_plan_digest(campaign, plan),
        execution_location=ExecutionLocation(kind=plan.execution.kind),
    )


def uplift_report_execution_facts(
    campaign: CampaignSpecV3, plan: ResolvedExecutionPlan
) -> UpliftReportExecutionFacts:
    return UpliftReportExecutionFacts(
        execution_plan_digest=bound_execution_plan_digest(campaign, plan),
        execution_location=ExecutionLocation(kind=plan.execution.kind),
    )


def run_request_execution_facts(
    campaign: CampaignSpecV3, plan: ResolvedExecutionPlan
) -> RunRequestExecutionFacts:
    return RunRequestExecutionFacts(
        execution_plan_digest=require_executable_execution_plan(campaign, plan)
    )


def climb_summary_execution_facts(
    campaign: CampaignSpecV3, plan: ResolvedExecutionPlan
) -> ClimbSummaryExecutionFacts:
    bound_execution_plan_digest(campaign, plan)
    return ClimbSummaryExecutionFacts(
        subject_harness=plan.subject.harness_id,
        subject_harness_version=plan.subject.harness_version,
        execution_backend_kind=plan.execution.kind,
    )


def compatibility_result_execution_facts(
    campaign: CampaignSpecV3, plan: ResolvedExecutionPlan
) -> CompatibilityResultExecutionFacts:
    return CompatibilityResultExecutionFacts(
        execution_plan_digest=bound_execution_plan_digest(campaign, plan),
        evaluation_engine_source_commit=plan.evaluation.source_commit,
        evaluation_engine_digest=plan.evaluation.engine_digest,
        execution_backend_kind=plan.execution.kind,
        execution_backend_supported=True,
        subject_backend_kind=plan.subject.kind,
        subject_backend_supported=True,
    )
