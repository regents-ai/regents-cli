"""The Campaign graph a draft is prepared against, and a Skill as a draft or run owns it."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.campaign import CampaignSpecV2, PublicContext
from regents_cli.techtree.models.climb import ClimbManifest, ResolvedClimb
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.skill import SkillArtifact
from regents_cli.techtree.models.validation import TasksetValidationReceipt


@dataclass(frozen=True)
class StagedSkill:
    """One Skill's artifact and the directory holding exactly the files it lists."""

    artifact: SkillArtifact
    files: Path


@dataclass(frozen=True)
class CampaignSource:
    """The public Climb a draft was prepared under and the four objects it resolves to."""

    climb: ClimbManifest
    climb_digest: Digest
    campaign: CampaignSpecV2
    campaign_digest: Digest
    data_policy: DataPolicy
    data_policy_digest: Digest
    publisher_validation: TasksetValidationReceipt
    publisher_validation_digest: Digest
    execution_plan: ResolvedExecutionPlan
    execution_plan_digest: Digest

    @classmethod
    def from_climb(cls, resolved: ResolvedClimb) -> CampaignSource:
        """Return the source one resolved public Climb describes."""
        return cls(
            climb=resolved.climb,
            climb_digest=resolved.climb_digest,
            campaign=resolved.campaign,
            campaign_digest=resolved.campaign_digest,
            data_policy=resolved.data_policy,
            data_policy_digest=resolved.data_policy_digest,
            publisher_validation=resolved.publisher_validation,
            publisher_validation_digest=resolved.publisher_validation_digest,
            execution_plan=resolved.execution_plan,
            execution_plan_digest=resolved.execution_plan_digest,
        )

    @property
    def public_context(self) -> PublicContext:
        """Return the public context artifacts built from this source carry."""
        return PublicContext(kind="climb", climb_digest=self.climb_digest)

    @property
    def title(self) -> str:
        """Return what to call this comparison in a result a person reads."""
        return self.climb.metadata.title
