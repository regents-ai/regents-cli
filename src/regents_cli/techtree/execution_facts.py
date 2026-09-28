"""Projecting a bound execution plan onto the receipt and the report.

Every projection re-derives the plan's digest and refuses a plan the Campaign is not bound
to: a projection taken from an unbound plan would state facts about a run that never
happened, in a document nobody could tell was wrong.
"""

from __future__ import annotations

from dataclasses import dataclass

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.campaign import CampaignSpecV2
from regents_cli.techtree.models.episode_receipt import ExecutionLocation
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan


def bound_execution_plan_digest(campaign: CampaignSpecV2, plan: ResolvedExecutionPlan) -> Digest:
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


@dataclass(frozen=True, slots=True)
class EpisodeReceiptExecutionFacts:
    """What an `EpisodeReceiptV2` owes to the plan."""

    execution_plan_digest: Digest
    execution_location: ExecutionLocation


@dataclass(frozen=True, slots=True)
class UpliftReportExecutionFacts:
    """What an `UpliftReportV2` owes to the plan."""

    execution_plan_digest: Digest
    execution_location: ExecutionLocation


def episode_receipt_execution_facts(
    campaign: CampaignSpecV2, plan: ResolvedExecutionPlan
) -> EpisodeReceiptExecutionFacts:
    return EpisodeReceiptExecutionFacts(
        execution_plan_digest=bound_execution_plan_digest(campaign, plan),
        execution_location=ExecutionLocation(kind=plan.execution.kind),
    )


def uplift_report_execution_facts(
    campaign: CampaignSpecV2, plan: ResolvedExecutionPlan
) -> UpliftReportExecutionFacts:
    return UpliftReportExecutionFacts(
        execution_plan_digest=bound_execution_plan_digest(campaign, plan),
        execution_location=ExecutionLocation(kind=plan.execution.kind),
    )
