"""Deriving the two experiment variants from one Campaign.

A manifest is the Campaign with one choice made: which Skill the subject harness carries.
Every scientific field is copied out deeply and never re-derived, the candidate is built by
replacing exactly one field of the baseline, and the Skill enters as its content-tree digest
rather than its archive digest, because two archives of the same tree are the same science.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Final

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.constants import EXPERIMENT_V3_SCHEMA_VERSION
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import ArtifactRef, Digest
from regents_cli.techtree.models.campaign import (
    AgentSpecV2,
    CampaignSpecV3,
    HarnessSpecV2,
    MutationKind,
    PublicContext,
)
from regents_cli.techtree.models.experiment import (
    ExperimentConfigurationV3,
    ExperimentManifestV3,
    ExperimentVariant,
)
from regents_cli.techtree.models.skill import SkillArtifact, SkillFile

#: The media type of a Skill's canonical content tree, not of the tar that may carry it.
SKILL_MEDIA_TYPE: Final = "application/vnd.techtree.instruction-skill.v1"

#: Manifest identifiers derive from the configuration digest, so two derivations of one
#: experiment name it the same way.
MANIFEST_ID_PREFIX: Final = "experiment"
MANIFEST_BUILD_FAILED: Final = "manifest_build_failed"
_ID_HEX_LENGTH: Final = 24


def build_experiment_configuration(campaign: CampaignSpecV3) -> ExperimentConfigurationV3:
    """Copy the Campaign's scientific fields; this is the baseline configuration."""
    return ExperimentConfigurationV3(
        taskset=campaign.taskset.model_copy(deep=True),
        environment=campaign.environment.model_copy(deep=True),
        agents={name: agent.model_copy(deep=True) for name, agent in campaign.agents.items()},
        mutation_contract=campaign.mutation_contract.model_copy(deep=True),
        execution_plan_digest=campaign.execution_plan_digest,
        execution=campaign.execution.model_copy(deep=True),
        scoring=campaign.scoring.model_copy(deep=True),
        evidence=campaign.evidence.model_copy(deep=True),
        budgets=campaign.budgets.model_copy(deep=True),
        data_policy_digest=campaign.data_policy_digest,
        outcome_contract_digest=campaign.context.outcome_contract_digest,
    )


def skill_content_digest(files: Sequence[SkillFile]) -> Digest:
    """The digest of a Skill's sorted file list: every path, media type, size and content."""
    return digest_object(list(files))


def build_skill_reference(skill: SkillArtifact) -> ArtifactRef:
    """The harness-facing reference to canonical Skill content."""
    total = sum(file.size for file in skill.files)
    if total <= 0:
        raise ValidationError(
            "the candidate skill has no content to insert, so there is nothing for the "
            "experiment to measure",
            code=MANIFEST_BUILD_FAILED,
            details={"file_count": len(skill.files), "total_bytes": total},
        )
    recomputed = skill_content_digest(skill.files)
    if recomputed != skill.root_digest:
        raise ValidationError(
            "the candidate skill's root digest does not describe the files it lists",
            code=MANIFEST_BUILD_FAILED,
            details={"stated_root_digest": skill.root_digest, "computed_root_digest": recomputed},
        )
    return ArtifactRef(
        digest=skill.root_digest, media_type=SKILL_MEDIA_TYPE, size=total, relative_path=None
    )


def build_baseline_manifest(
    *,
    campaign: CampaignSpecV3,
    campaign_digest: Digest,
    public_context: PublicContext | None,
    created_at: datetime | None = None,
    manifest_id: str | None = None,
) -> ExperimentManifestV3:
    configuration = build_experiment_configuration(campaign)
    _require_campaign_baseline(configuration, campaign)
    return finalize_manifest(
        campaign=campaign,
        campaign_digest=campaign_digest,
        public_context=public_context,
        variant=ExperimentVariant.BASELINE,
        configuration=configuration,
        created_at=created_at,
        manifest_id=manifest_id,
    )


def build_candidate_manifest(
    *,
    campaign: CampaignSpecV3,
    campaign_digest: Digest,
    skill: SkillArtifact,
    public_context: PublicContext | None,
    created_at: datetime | None = None,
    manifest_id: str | None = None,
) -> ExperimentManifestV3:
    """The baseline configuration with the subject harness's Skill list replaced."""
    configuration = build_experiment_configuration(campaign)
    baseline_subject = _require_campaign_baseline(configuration, campaign)
    reference = build_skill_reference(skill)
    mutation = campaign.mutation_contract
    if mutation.kind is MutationKind.SKILL_REPLACEMENT:
        replaced = baseline_subject.harness.skills[0]
        if replaced.digest == reference.digest:
            raise ValidationError(
                "the replacement skill has the same content tree as the skill it replaces, "
                "so the pair would measure nothing",
                code=MANIFEST_BUILD_FAILED,
                details={
                    "baseline_root_digest": replaced.digest,
                    "candidate_root_digest": reference.digest,
                },
            )
    if not mutation.minimum_skills <= 1 <= mutation.maximum_skills:
        raise ValidationError(
            "this Campaign's mutation contract does not permit a single candidate skill; it "
            f"allows {mutation.minimum_skills} to {mutation.maximum_skills}",
            code=MANIFEST_BUILD_FAILED,
            details={
                "minimum_skills": mutation.minimum_skills,
                "maximum_skills": mutation.maximum_skills,
            },
        )
    target = mutation.target_agent
    subject = configuration.agents[target]
    with_skill = AgentSpecV2(
        model=subject.model,
        sampling=subject.sampling,
        harness=HarnessSpecV2(
            use_bundled_skill=subject.harness.use_bundled_skill, skills=[reference]
        ),
        runtime=subject.runtime,
        trainable=subject.trainable,
    )
    return finalize_manifest(
        campaign=campaign,
        campaign_digest=campaign_digest,
        public_context=public_context,
        variant=ExperimentVariant.CANDIDATE,
        configuration=configuration.model_copy(
            update={"agents": {**configuration.agents, target: with_skill}}
        ),
        created_at=created_at,
        manifest_id=manifest_id,
    )


def finalize_manifest(
    *,
    campaign: CampaignSpecV3,
    campaign_digest: Digest,
    public_context: PublicContext | None,
    variant: ExperimentVariant,
    configuration: ExperimentConfigurationV3,
    created_at: datetime | None,
    manifest_id: str | None,
) -> ExperimentManifestV3:
    """Check lineage, compute `configuration_digest`, and construct the manifest."""
    if digest_object(campaign) != campaign_digest:
        raise ValidationError(
            "the Campaign digest a manifest was asked to carry is not the digest of the "
            "Campaign it was built from",
            code=MANIFEST_BUILD_FAILED,
            details={
                "stated_campaign_digest": campaign_digest,
                "computed_campaign_digest": digest_object(campaign),
            },
        )
    configuration_digest = digest_object(configuration)
    manifest = ExperimentManifestV3(
        schema_version=EXPERIMENT_V3_SCHEMA_VERSION,
        id=manifest_id or manifest_id_for(configuration_digest),
        campaign_spec_digest=campaign_digest,
        program_ref=(
            None
            if campaign.context.program_ref is None
            else campaign.context.program_ref.model_copy(deep=True)
        ),
        public_context=None if public_context is None else public_context.model_copy(deep=True),
        variant=variant,
        configuration=configuration,
        configuration_digest=configuration_digest,
        created_at=created_at or datetime.now(UTC),
    )
    assert_manifest_matches_campaign(manifest, campaign, campaign_digest)
    return manifest


def assert_manifest_matches_campaign(
    manifest: ExperimentManifestV3, campaign: CampaignSpecV3, campaign_digest: Digest
) -> None:
    """Check, after the fact, that a manifest is the Campaign it claims to be.

    True by construction for a manifest this module built; checked again because a manifest
    can also arrive from disk.
    """
    configuration = manifest.configuration
    for label, expected, found in (
        ("Campaign digest", campaign_digest, manifest.campaign_spec_digest),
        ("improvement program", campaign.context.program_ref, manifest.program_ref),
        (
            "OutcomeContract digest",
            campaign.context.outcome_contract_digest,
            configuration.outcome_contract_digest,
        ),
        ("DataPolicy digest", campaign.data_policy_digest, configuration.data_policy_digest),
        ("execution plan", campaign.execution_plan_digest, configuration.execution_plan_digest),
        ("taskset", campaign.taskset, configuration.taskset),
        ("environment", campaign.environment, configuration.environment),
        ("mutation contract", campaign.mutation_contract, configuration.mutation_contract),
        ("execution schedule", campaign.execution, configuration.execution),
        ("scoring rule", campaign.scoring, configuration.scoring),
        ("evidence requirement", campaign.evidence, configuration.evidence),
        ("budget", campaign.budgets, configuration.budgets),
    ):
        if expected != found:
            raise ValidationError(
                f"the manifest's {label} is not the Campaign's",
                code=MANIFEST_BUILD_FAILED,
                details={"field": label},
            )
    if set(configuration.agents) != set(campaign.agents):
        agents: dict[str, object] = {
            "campaign_agents": sorted(campaign.agents),
            "manifest_agents": sorted(configuration.agents),
        }
        raise ValidationError(
            "the manifest names different agents than the Campaign",
            code=MANIFEST_BUILD_FAILED,
            details=agents,
        )
    target = campaign.mutation_contract.target_agent
    for name, agent in configuration.agents.items():
        expected_agent = campaign.agents[name]
        compared = agent
        if name == target:
            # The skill list is the one field allowed to differ, so it is set aside.
            compared = agent.model_copy(
                update={
                    "harness": agent.harness.model_copy(
                        update={"skills": list(expected_agent.harness.skills)}
                    )
                }
            )
        if compared != expected_agent:
            raise ValidationError(
                f"the manifest's {name} agent differs from the Campaign's outside the skill list",
                code=MANIFEST_BUILD_FAILED,
                details={"agent": name},
            )


def manifest_id_for(configuration_digest: Digest) -> str:
    """The display identifier one configuration digest implies."""
    hexadecimal = configuration_digest.split(":", 1)[1]
    return f"{MANIFEST_ID_PREFIX}_{hexadecimal[:_ID_HEX_LENGTH]}"


def _require_campaign_baseline(
    configuration: ExperimentConfigurationV3, campaign: CampaignSpecV3
) -> AgentSpecV2:
    """Refuse a Campaign whose subject is not the baseline its mutation kind needs."""
    target = campaign.mutation_contract.target_agent
    subject = configuration.agents.get(target)
    if subject is None:
        missing: dict[str, object] = {
            "target_agent": target,
            "agents": sorted(configuration.agents),
        }
        raise ValidationError(
            f"the Campaign defines no {target} agent for the mutation contract to target",
            code=MANIFEST_BUILD_FAILED,
            details=missing,
        )
    skills = subject.harness.skills
    if campaign.mutation_contract.kind is MutationKind.SKILL_INSERTION:
        if skills:
            raise ValidationError(
                "the Campaign's own subject already carries a skill, so there is no baseline "
                "to compare a candidate against",
                code=MANIFEST_BUILD_FAILED,
                details={"skill_count": len(skills)},
            )
    elif len(skills) != 1:
        raise ValidationError(
            "a skill_replacement Campaign's subject carries exactly the one skill the "
            "candidate replaces, so there is no baseline to compare a candidate against",
            code=MANIFEST_BUILD_FAILED,
            details={"skill_count": len(skills)},
        )
    return subject
