"""What a Climb is, whether its four objects tell one story, and whether this host could run it.

Validity and compatibility are answered separately: a well-formed Climb is listed and shown
even when the engine it needs is not installed here; only preparing a submission is blocked.
"""

from __future__ import annotations

import platform
import sys
from typing import Final

from regents_cli.techtree.catalog.repository import EmbeddedCatalogRepository, climb_reference
from regents_cli.techtree.engines.registry import EngineRegistry
from regents_cli.techtree.errors import NotFoundError, PolicyError, PrerequisiteError, UsageError
from regents_cli.techtree.execution_facts import (
    climb_summary_execution_facts,
    compatibility_result_execution_facts,
)
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.catalog import (
    ClimbSummaryV2,
    CompatibilityIssue,
    CompatibilityResultV2,
    DataPolicySummary,
    EngineCompatibilityStatus,
)
from regents_cli.techtree.models.climb import ResolvedClimb, check_climb_policy_consistency
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.engine import normalize_host_platform
from regents_cli.techtree.models.validation import ValidationEvidence
from regents_cli.techtree.paths import TechtreePaths

CLIMB_LIST_STATUSES: Final[frozenset[str]] = frozenset(
    {"available", "all", "open", "closed", "development"}
)
_AVAILABLE_STATUSES: Final[frozenset[str]] = frozenset({"open", "development"})


class CatalogService:
    """Resolves, checks, and summarizes the Climbs a build ships."""

    def __init__(self, paths: TechtreePaths) -> None:
        self._repository = EmbeddedCatalogRepository.packaged()
        self._paths = paths

    def list_climbs(self, *, status: str = "available") -> list[ClimbSummaryV2]:
        """One summary per Climb, in catalog order; every one is fully resolved first."""
        if status not in CLIMB_LIST_STATUSES:
            raise UsageError(
                f"unknown Climb status {status!r}; choose one of "
                + ", ".join(sorted(CLIMB_LIST_STATUSES)),
                code="unknown_climb_status",
                details={"status": status},
            )
        summaries: list[ClimbSummaryV2] = []
        for reference in self._repository.list_climb_references():
            resolved = self.get_climb(reference)
            if _status_matches(resolved.climb.metadata.status, status):
                summaries.append(self.climb_summary(resolved))
        return summaries

    def climb_for_campaign(self, campaign_digest: Digest) -> tuple[str, bool] | None:
        """The Climb whose Campaign this is, and whether it is the held-out one."""
        for reference in self._repository.list_climb_references():
            entry = self._repository.climb_entry(reference)
            climb = self._repository.load_climb(entry.reference)
            if climb.campaign_spec_digest == campaign_digest:
                return entry.reference, False
            if climb.held_out_campaign_spec_digest == campaign_digest:
                return entry.reference, True
        return None

    def get_climb(self, reference: str, *, held_out: bool = False) -> ResolvedClimb:
        """Resolve one Climb, with the Campaign every round runs or its held-out one, into its
        complete, cross-checked object graph."""
        entry = self._repository.climb_entry(reference)
        climb = self._repository.load_climb(entry.reference)
        campaign_digest = climb.campaign_spec_digest
        if held_out:
            if climb.held_out_campaign_spec_digest is None:
                raise UsageError(
                    f"{entry.reference} keeps no tasks apart, so it has no held-out Campaign",
                    code="climb_has_no_held_out_campaign",
                    details={"reference": entry.reference},
                )
            campaign_digest = climb.held_out_campaign_spec_digest
        campaign = self._repository.load_campaign(campaign_digest)
        resolved = ResolvedClimb(
            climb=climb,
            climb_digest=entry.digest,
            campaign=campaign,
            campaign_digest=campaign_digest,
            data_policy=self._repository.load_data_policy(campaign.data_policy_digest),
            data_policy_digest=campaign.data_policy_digest,
            publisher_validation=self._repository.load_validation_receipt(
                campaign.taskset.validation_receipt_digest
            ),
            publisher_validation_digest=campaign.taskset.validation_receipt_digest,
            execution_plan=self._repository.load_execution_plan(campaign.execution_plan_digest),
            execution_plan_digest=campaign.execution_plan_digest,
        )
        self._check_validation_evidence(resolved)
        self.validate_public_policy(resolved)
        return resolved

    def compatibility(self, resolved: ResolvedClimb) -> CompatibilityResultV2:
        """Whether this host could run this Climb, and what is missing."""
        issues: list[CompatibilityIssue] = []
        facts = compatibility_result_execution_facts(resolved.campaign, resolved.execution_plan)
        host_platform, host_supported = _host_platform()
        if not host_supported:
            issues.append(
                CompatibilityIssue(
                    code="host_unsupported",
                    severity="error",
                    message=(
                        f"Techtree does not support {host_platform}; it runs on macOS and "
                        "Linux, on arm64 and amd64."
                    ),
                    blocking=True,
                )
            )
        engine_digest = resolved.publisher_validation.engine_digest
        engine_status = self._engine_status(engine_digest)
        engine_issue = _engine_issue(engine_status)
        if engine_issue is not None:
            issues.append(engine_issue)
        if facts.evaluation_engine_digest != engine_digest:
            issues.append(
                CompatibilityIssue(
                    code="engine_plan_mismatch",
                    severity="error",
                    message=(
                        "This Climb's tasks were validated with a different evaluation engine "
                        "than the one its execution plan names, so a result could not be "
                        "scored by the engine that checked the tasks."
                    ),
                    blocking=True,
                )
            )
        if resolved.execution_plan.evidence.trace_coverage != "not_requested":
            issues.append(
                CompatibilityIssue(
                    code="evidence_backend_unsupported",
                    severity="error",
                    message=(
                        "This Climb requests trace coverage, which this version of Techtree "
                        "cannot produce."
                    ),
                    blocking=True,
                )
            )
        return CompatibilityResultV2(
            compatible=not any(issue.blocking for issue in issues),
            host_platform=host_platform,
            host_supported=host_supported,
            required_engine_digest=engine_digest,
            engine_status=engine_status,
            execution_plan_digest=facts.execution_plan_digest,
            evaluation_engine_source_commit=facts.evaluation_engine_source_commit,
            evaluation_engine_digest=facts.evaluation_engine_digest,
            execution_backend_kind=facts.execution_backend_kind,
            execution_backend_supported=facts.execution_backend_supported,
            subject_backend_kind=facts.subject_backend_kind,
            subject_backend_supported=facts.subject_backend_supported,
            issues=issues,
        )

    def validation_evidence(self, resolved: ResolvedClimb) -> ValidationEvidence:
        """The normalized evidence this Climb's receipt was issued from; a draft carries it."""
        reference = resolved.publisher_validation.normalized_evidence
        if reference is None:
            raise NotFoundError(
                "this Climb's publisher validation names no normalized evidence",
                code="publisher_validation_evidence_missing",
                details={"climb": climb_reference(resolved.climb)},
            )
        return self._repository.load_validation_evidence(reference.digest)

    def validate_public_policy(self, resolved: ResolvedClimb) -> None:
        """Reject contradictions among the Climb, Campaign, and DataPolicy."""
        check_climb_policy_consistency(resolved.climb, resolved.data_policy)
        status = resolved.climb.metadata.status
        proof_grade = resolved.climb.publication.proof_grade
        if (status == "development") != (proof_grade == "development_only"):
            raise PolicyError(
                f"this Climb is {status} and claims a {proof_grade} proof grade; a development "
                "Climb produces development-only results and nothing else does",
                code="proof_grade_contradiction",
                details={"status": status, "proof_grade": proof_grade},
            )

    def climb_summary(self, resolved: ResolvedClimb) -> ClimbSummaryV2:
        """Project a resolved graph into what `list` and `show` display."""
        campaign = resolved.campaign
        climb = resolved.climb
        facts = climb_summary_execution_facts(campaign, resolved.execution_plan)
        return ClimbSummaryV2(
            reference=climb_reference(climb),
            climb_digest=resolved.climb_digest,
            campaign_spec_digest=resolved.campaign_digest,
            title=climb.metadata.title,
            summary=climb.metadata.summary,
            status=climb.metadata.status,
            purpose=campaign.metadata.purpose,
            taskset_id=campaign.taskset.ref.id,
            task_count=campaign.taskset.selection.num_tasks,
            subject_harness=facts.subject_harness,
            subject_harness_version=facts.subject_harness_version,
            mutation_kind=climb.candidate_policy.required_mutation,
            candidate_skill_visibility=climb.candidate_policy.skill_visibility,
            execution_backend_kind=facts.execution_backend_kind,
            proof_grade=climb.publication.proof_grade,
            data_policy=data_policy_summary(resolved.data_policy),
            compatibility=self.compatibility(resolved),
        )

    def _engine_status(self, engine_digest: Digest) -> EngineCompatibilityStatus:
        """What the registry's own record proves about that engine on this host."""
        status = EngineRegistry(self._paths).status(engine_digest)
        if not status.installed:
            return EngineCompatibilityStatus.NOT_INSTALLED
        if status.verified:
            return EngineCompatibilityStatus.VERIFIED
        return EngineCompatibilityStatus.INSTALLED_UNVERIFIED

    def _check_validation_evidence(self, resolved: ResolvedClimb) -> None:
        """The receipt's evidence resolves to exactly the tasks the Campaign commits to."""
        reference = resolved.publisher_validation.normalized_evidence
        if reference is None:
            return
        evidence = self._repository.load_validation_evidence(reference.digest)
        if evidence.taskset_lock_digest != resolved.publisher_validation.taskset_lock_digest:
            raise PolicyError(
                "the shipped validation evidence was produced for a different taskset than "
                "the receipt it belongs to",
                code="validation_evidence_mismatch",
                details={
                    "receipt_taskset_lock_digest": (
                        resolved.publisher_validation.taskset_lock_digest
                    ),
                    "evidence_taskset_lock_digest": evidence.taskset_lock_digest,
                },
            )
        validated = [task.task_hash for task in evidence.tasks]
        committed = list(resolved.campaign.taskset.membership.ordered_task_hashes)
        if validated != committed:
            raise PolicyError(
                "the Campaign commits to different tasks than the ones the publisher validated",
                code="validated_membership_mismatch",
                details={
                    "committed_task_count": len(committed),
                    "validated_task_count": len(validated),
                },
            )


def data_policy_summary(data_policy: DataPolicy) -> DataPolicySummary:
    """The four rights a reader most needs."""
    return DataPolicySummary(
        raw_episode_server_upload=data_policy.raw_episodes.server_upload,
        raw_episode_training_use=data_policy.raw_episodes.training_use,
        candidate_skill_public_release=data_policy.candidate_skill.public_release,
        uplift_report_visibility=data_policy.derived_artifacts.uplift_report,
    )


def _host_platform() -> tuple[str, bool]:
    """The normalized host platform, or the raw pair and False."""
    try:
        return normalize_host_platform(sys.platform, platform.machine()), True
    except PrerequisiteError:
        return f"{sys.platform}/{platform.machine()}", False


def _status_matches(climb_status: str, requested: str) -> bool:
    if requested == "all":
        return True
    if requested == "available":
        return climb_status in _AVAILABLE_STATUSES
    return climb_status == requested


def _engine_issue(status: EngineCompatibilityStatus) -> CompatibilityIssue | None:
    if status is EngineCompatibilityStatus.VERIFIED:
        return None
    if status is EngineCompatibilityStatus.INSTALLED_UNVERIFIED:
        return CompatibilityIssue(
            code="engine_not_verified",
            severity="warning",
            message=(
                "The evaluation engine is installed but has not been checked since. Run "
                "`regents techtree engine verify` before you rely on a result."
            ),
            blocking=False,
        )
    return CompatibilityIssue(
        code="engine_not_installed",
        severity="error",
        message=(
            "The evaluation engine this Climb needs is not installed yet. Run "
            "`regents techtree engine install` before preparing a submission."
        ),
        blocking=True,
    )
