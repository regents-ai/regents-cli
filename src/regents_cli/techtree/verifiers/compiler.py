"""One resolved experiment becomes one Verifiers configuration.

Compilation is a translation with no judgement in it: if a manifest and its Campaign disagree
about anything, the answer is a named error, never a document that splits the difference. The
same manifest, run paths and variant always produce byte-identical JSON.
"""

from __future__ import annotations

import math
import os
from collections.abc import Mapping
from pathlib import Path
from typing import Final, NoReturn

from regents_cli.techtree.canonical import digest_object, sha256_digest_bytes
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.execution_facts import bound_execution_plan_digest
from regents_cli.techtree.fs import ensure_private_directory, fsync_directory, open_exclusive
from regents_cli.techtree.models.base import ArtifactRef, Digest
from regents_cli.techtree.models.campaign import (
    SUBJECT_AGENT,
    AgentSpecV2,
    CampaignImageRuntime,
    CampaignSpecV3,
    CampaignTaskset,
)
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import ExperimentManifestV3, ExperimentVariant
from regents_cli.techtree.verifiers.config import (
    DockerRuntimeToml,
    EnvToml,
    EvalClientToml,
    EvalToml,
    HarborEnvToml,
    HermesHarnessToml,
    SamplingToml,
    SingleAgentEnvToml,
    SubjectAgentToml,
    TaskImagesToml,
    TasksetToml,
    TimeoutToml,
    config_to_json_bytes,
    egress_for,
)
from regents_cli.techtree.verifiers.models import VariantExecutionPlan, VariantName
from regents_cli.techtree.verifiers.paths import EVAL_RUN_NAME, RunPaths

MANIFEST_NOT_COMPILABLE: Final = "manifest_not_compilable"
REFERENCE_HARNESS_ID: Final = "hermes-agent"
EVAL_CONFIG_MEDIA_TYPE: Final = "application/json"

#: One permit each, and no variant may be starved to zero.
_MINIMUM_PARALLEL_CONCURRENCY: Final = 2

_VARIANTS: Final[dict[ExperimentVariant, VariantName]] = {
    ExperimentVariant.BASELINE: VariantName.BASELINE,
    ExperimentVariant.CANDIDATE: VariantName.CANDIDATE,
}


def _refuse(message: str, **details: str | int | bool | None) -> NoReturn:
    raise ValidationError(message, code=MANIFEST_NOT_COMPILABLE, details=dict(details))


def skill_directory_name(digest: Digest) -> str:
    """The run-owned directory one skill's tree occupies; the folder name is part of what the
    subject sees, so it is a property of the skill's content."""
    return digest.replace(":", "-", 1)


def compile_variant_config(
    *,
    campaign: CampaignSpecV3,
    plan: ResolvedExecutionPlan,
    experiment: ExperimentManifestV3,
    run_paths: RunPaths,
    variant: VariantName,
    variant_max_concurrent: int,
) -> EvalToml:
    """Translate one resolved experiment into the strict config, refusing any disagreement."""
    campaign_digest = digest_object(campaign)
    bound_execution_plan_digest(campaign, plan)
    _check_manifest_derives_from(experiment, campaign, campaign_digest)
    _check_variant_matches(experiment, variant)

    subject = _subject_of(experiment)
    _check_subject_is_executable(subject, plan)
    skill_paths = _resolve_skill_paths(subject, run_paths)

    output_dir = run_paths.variant_output_group_dir(variant)
    taskset = experiment.configuration.taskset
    allow, block = egress_for(subject.runtime.network_policy)

    # Every limit the Campaign declares is compiled into the place the engine reads it; a
    # declared budget the engine never sees is decorative. One Verifiers model turn is the
    # model-call budget unit, so maximum_model_calls compiles to max_turns, and the total is
    # the sum of the two declared token allowances rather than a fourth decision.
    maximum_input = campaign.budgets.maximum_input_tokens
    maximum_output = campaign.budgets.maximum_output_tokens
    maximum_turns = campaign.budgets.maximum_model_calls
    maximum_total = (
        maximum_input + maximum_output
        if maximum_input is not None and maximum_output is not None
        else None
    )

    if variant_max_concurrent < 1:
        _refuse(
            "a variant needs at least one concurrency permit",
            variant=variant.value,
            variant_max_concurrent=variant_max_concurrent,
        )

    seat = SubjectAgentToml(
        harness=HermesHarnessToml(version=plan.subject.harness_version, skills=skill_paths),
        runtime=DockerRuntimeToml(
            image=subject.runtime.image
            if isinstance(subject.runtime, CampaignImageRuntime)
            else None,
            allow=allow,
            block=block,
            cpu=subject.runtime.cpu,
            memory=subject.runtime.memory_gb,
        ),
        max_turns=maximum_turns,
        max_input_tokens=maximum_input,
        max_output_tokens=maximum_output,
        max_total_tokens=maximum_total,
        # timeout_seconds bounds one subject rollout; the variant's own bound is the
        # supervisor's hard deadline.
        timeout=TimeoutToml(rollout=float(campaign.execution.timeout_seconds)),
    )
    env: EnvToml
    if experiment.configuration.environment.id == "single-agent":
        env = SingleAgentEnvToml(
            taskset=taskset_toml(taskset), subject=seat, max_concurrent_agents=1
        )
    else:
        env = HarborEnvToml(taskset=taskset_toml(taskset), agent=seat, max_concurrent_agents=1)

    return EvalToml(
        model=subject.model.model_id,
        client=EvalClientToml(api_key_var=subject.model.credential_env),
        sampling=SamplingToml(
            temperature=subject.sampling.temperature,
            max_tokens=subject.sampling.max_tokens,
            reasoning_effort=subject.sampling.reasoning_effort,
        ),
        env=env,
        num_tasks=taskset.selection.num_tasks,
        max_concurrent=variant_max_concurrent,
        output_dir=str(output_dir),
    )


def taskset_toml(taskset: CampaignTaskset) -> TasksetToml:
    """The taskset as the engine loads it: its id, and the task images the Campaign pins."""
    if taskset.task_images is None:
        return TasksetToml(id=taskset.ref.id)
    return TasksetToml(
        id=taskset.ref.id,
        images={
            entry.task_id: TaskImagesToml(agent=entry.agent.image, grader=entry.grader.image)
            for entry in taskset.task_images
        },
    )


def _subject_of(experiment: ExperimentManifestV3) -> AgentSpecV2:
    subject = experiment.configuration.agents.get(SUBJECT_AGENT)
    if subject is None:
        _refuse(
            f"an experiment configuration defines a {SUBJECT_AGENT!r} agent",
            manifest_id=experiment.id,
        )
    return subject


def _check_manifest_derives_from(
    experiment: ExperimentManifestV3, campaign: CampaignSpecV3, campaign_digest: Digest
) -> None:
    if experiment.campaign_spec_digest != campaign_digest:
        _refuse(
            "the experiment manifest was derived from a different Campaign",
            manifest_id=experiment.id,
            declared=experiment.campaign_spec_digest,
            actual=campaign_digest,
        )
    if digest_object(experiment.configuration) != experiment.configuration_digest:
        _refuse(
            "the experiment configuration does not hash to its own digest",
            manifest_id=experiment.id,
        )
    configuration = experiment.configuration
    if configuration.data_policy_digest != campaign.data_policy_digest:
        _refuse(
            "the experiment and its Campaign disagree about the data policy",
            manifest_id=experiment.id,
        )
    if configuration.execution_plan_digest != campaign.execution_plan_digest:
        _refuse(
            "the experiment and its Campaign name different execution plans",
            manifest_id=experiment.id,
        )
    if configuration.taskset.ref != campaign.taskset.ref:
        _refuse(
            "the experiment and its Campaign point at different tasksets",
            manifest_id=experiment.id,
        )
    if configuration.taskset.membership != campaign.taskset.membership:
        _refuse(
            "the experiment and its Campaign commit different task membership",
            manifest_id=experiment.id,
        )
    committed = len(configuration.taskset.membership.ordered_task_hashes)
    if committed != configuration.taskset.selection.num_tasks:
        _refuse(
            "the experiment commits a task count its selection does not ask for",
            manifest_id=experiment.id,
            committed=committed,
            selected=configuration.taskset.selection.num_tasks,
        )


def _check_variant_matches(experiment: ExperimentManifestV3, variant: VariantName) -> None:
    if _VARIANTS[experiment.variant] is not variant:
        _refuse(
            "the experiment manifest describes the other variant",
            manifest_id=experiment.id,
            manifest_variant=experiment.variant.value,
            requested=variant.value,
        )


def _check_subject_is_executable(subject: AgentSpecV2, plan: ResolvedExecutionPlan) -> None:
    if plan.subject.harness_id != REFERENCE_HARNESS_ID:
        _refuse(
            f"only the {REFERENCE_HARNESS_ID!r} harness is executed",
            harness_id=plan.subject.harness_id,
        )
    if subject.harness.use_bundled_skill:
        _refuse(
            "a bundled skill catalogue is an uncontrolled second difference",
            harness_id=plan.subject.harness_id,
        )
    if subject.runtime.type != "docker":
        _refuse("the subject runtime is Docker", runtime_type=subject.runtime.type)
    if subject.trainable:
        _refuse("the subject is evaluated, never trained", harness_id=plan.subject.harness_id)


def _resolve_skill_paths(subject: AgentSpecV2, run_paths: RunPaths) -> list[str]:
    paths: list[str] = []
    for skill in subject.harness.skills:
        directory = run_paths.skill_files_dir / skill_directory_name(skill.digest)
        if not run_paths.owns(directory):
            _refuse("a skill must be mounted from the run's own input tree", path=str(directory))
        paths.append(str(directory))
    return paths


def write_variant_config(config: EvalToml, destination: Path) -> ArtifactRef:
    """Write deterministic JSON exclusively: a compiled config is an input to exactly one run."""
    data = config_to_json_bytes(config)
    ensure_private_directory(destination.parent)
    with open_exclusive(destination) as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    fsync_directory(destination.parent)
    return ArtifactRef(
        digest=sha256_digest_bytes(data),
        media_type=EVAL_CONFIG_MEDIA_TYPE,
        size=len(data),
        relative_path=None,
    )


def divide_concurrency(max_concurrent: int) -> tuple[int, int]:
    """Split the Campaign-wide bound between the two variants running side by side."""
    if max_concurrent < _MINIMUM_PARALLEL_CONCURRENCY:
        _refuse(
            "a parallel schedule needs at least two concurrency permits, one for each variant",
            max_concurrent=max_concurrent,
        )
    baseline = max(1, math.floor(max_concurrent / 2))
    return baseline, max(1, max_concurrent - baseline)


def compile_plans(
    *,
    campaign: CampaignSpecV3,
    plan: ResolvedExecutionPlan,
    baseline: ExperimentManifestV3,
    candidate: ExperimentManifestV3,
    run_paths: RunPaths,
) -> tuple[VariantExecutionPlan, VariantExecutionPlan]:
    """Both variants' plans, with the Campaign's concurrency divided between them."""
    baseline_permits, candidate_permits = divide_concurrency(campaign.execution.max_concurrent)
    manifests: Mapping[VariantName, tuple[ExperimentManifestV3, int]] = {
        VariantName.BASELINE: (baseline, baseline_permits),
        VariantName.CANDIDATE: (candidate, candidate_permits),
    }
    plans: dict[VariantName, VariantExecutionPlan] = {}
    for variant, (manifest, permits) in manifests.items():
        config = compile_variant_config(
            campaign=campaign,
            plan=plan,
            experiment=manifest,
            run_paths=run_paths,
            variant=variant,
            variant_max_concurrent=permits,
        )
        plans[variant] = VariantExecutionPlan(
            variant=variant,
            experiment_manifest_digest=digest_object(manifest),
            experiment_manifest_path=str(run_paths.manifest_path(variant)),
            verifiers_input_config_path=str(run_paths.variant_input_config(variant)),
            verifiers_output_dir=str(Path(config.output_dir) / EVAL_RUN_NAME),
            skill_paths=list(config.env.seat.harness.skills),
            task_count=config.num_tasks,
            max_concurrent=config.max_concurrent,
        )
    return plans[VariantName.BASELINE], plans[VariantName.CANDIDATE]
