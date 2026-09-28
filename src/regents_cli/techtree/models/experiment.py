"""One resolved variant of a Campaign, and the comparison of two.

Only `configuration` is compared: identifier, variant, creation time and public context all
differ between two correct manifests of the same experiment.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal, Self

from pydantic import model_validator

from regents_cli.techtree.models.base import (
    Digest,
    JsonValue,
    NonEmptyString,
    ProtocolModel,
    UtcDateTime,
)
from regents_cli.techtree.models.campaign import (
    SUBJECT_AGENT,
    AgentSpecV2,
    BudgetSpec,
    CampaignTaskset,
    EnvironmentSpec,
    EvidenceRequirementsV2,
    ExecutionSpec,
    MutationContract,
    MutationKind,
    ProgramRef,
    PublicContext,
    ScoringSpec,
)


class ExperimentVariant(StrEnum):
    """Which side of the comparison a manifest describes."""

    BASELINE = "baseline"
    CANDIDATE = "candidate"


class ExperimentConfigurationV2(ProtocolModel):
    """The part of a manifest that is compared: the Campaign's science with the choices made."""

    taskset: CampaignTaskset
    environment: EnvironmentSpec
    agents: dict[str, AgentSpecV2]
    mutation_contract: MutationContract
    execution_plan_digest: Digest
    execution: ExecutionSpec
    scoring: ScoringSpec
    evidence: EvidenceRequirementsV2
    budgets: BudgetSpec
    data_policy_digest: Digest
    outcome_contract_digest: Digest | None


class ExperimentManifestV2(ProtocolModel):
    """One fully resolved variant derived from a Campaign."""

    schema_version: Literal["techtree.experiment.v2"]
    id: NonEmptyString
    campaign_spec_digest: Digest
    program_ref: ProgramRef | None
    public_context: PublicContext | None
    variant: ExperimentVariant
    configuration: ExperimentConfigurationV2
    configuration_digest: Digest
    created_at: UtcDateTime

    @model_validator(mode="after")
    def _check_variant_skill_count(self) -> Self:
        """Hold each variant to the Skill count its mutation kind requires."""
        subject = self.configuration.agents.get(SUBJECT_AGENT)
        if subject is None:
            raise ValueError("an experiment configuration defines a subject agent")
        skills = len(subject.harness.skills)
        if self.variant is ExperimentVariant.CANDIDATE:
            if skills != 1:
                raise ValueError("the candidate variant carries exactly one skill")
        elif self.configuration.mutation_contract.kind is MutationKind.SKILL_INSERTION:
            if skills != 0:
                raise ValueError("the baseline variant carries no candidate skill")
        elif skills != 1:
            raise ValueError("the baseline of a skill_replacement carries exactly one skill")
        return self


class JsonDifference(ProtocolModel):
    """One JSON Pointer at which two configurations disagree."""

    pointer: NonEmptyString
    baseline: JsonValue | None
    candidate: JsonValue | None


class ManifestComparison(ProtocolModel):
    """Whether the candidate differs from the baseline only where permitted."""

    baseline_configuration_digest: Digest
    candidate_configuration_digest: Digest
    differences: list[JsonDifference]
    allowed_differences: list[NonEmptyString]
    controlled: bool
    violations: list[NonEmptyString]

    @model_validator(mode="after")
    def _check_control_agrees_with_violations(self) -> Self:
        if self.controlled and self.violations:
            raise ValueError("a controlled comparison has no violations")
        if not self.controlled and not self.violations:
            raise ValueError("an uncontrolled comparison must say which rule it broke")
        return self
