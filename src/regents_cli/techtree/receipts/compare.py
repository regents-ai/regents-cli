"""Proving the two executions, not just the two documents, were one experiment.

The checks run over what was declared (the two manifests against the Campaign), what was
observed (one fingerprint per variant, against its manifest and against the other side), and
what was joined (one receipt per committed task on each side, paired by task hash in lock
order). Mounting a Skill changes the description of the harness's own skill-index tool, so
that one description may differ and nothing else on the tool surface may. A model whose
provider publishes no revision is a warning, never silence and never a failure. This module
reports; turning an invalid comparison into a refusal is the report builder's job.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final, Literal, Self

from pydantic import Field, model_validator

from regents_cli.techtree.canonical import digest_object, validate_digest
from regents_cli.techtree.manifests.compare import compare_manifests
from regents_cli.techtree.models.base import Digest, JsonValue, NonEmptyString, ProtocolModel
from regents_cli.techtree.models.campaign import (
    SUBJECT_AGENT,
    AgentSpecV2,
    CampaignSpecV4,
    MutationKind,
    VariantSchedule,
    pinned_task_images,
)
from regents_cli.techtree.models.episode_receipt import EpisodeReceiptV3
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import (
    ExperimentManifestV4,
    ExperimentVariant,
    ManifestComparison,
)
from regents_cli.techtree.models.uplift_report import ComparisonStatus
from regents_cli.techtree.models.validation import TasksetLock
from regents_cli.techtree.receipts.observed import (
    ObservedSubjectConfiguration,
    observed_from_episodes,
)
from regents_cli.techtree.tasksets.membership import membership_digest
from regents_cli.techtree.verifiers.models import (
    ChildProcessOutcome,
    NormalizedTool,
    VariantExecutionResult,
)

#: Raised by whoever turns an invalid comparison into a refusal, never by this module.
COMPARISON_INVALID: Final = "comparison_invalid"

#: The one tool whose description two controlled variants may disagree about: Hermes lists the
#: Skills visible to the subject inside it, so inserting a Skill necessarily changes it.
SKILL_INDEX_TOOL: Final = "skill_manage"
MODEL_REVISION_UNDISCOVERABLE: Final = "model_revision_discoverable"

type CheckStatus = Literal["passed", "failed", "warning"]


class ComparisonCheck(ProtocolModel):
    """One named question about a comparison, and its answer."""

    id: NonEmptyString
    status: CheckStatus
    detail: NonEmptyString


class ScheduleObservation(ProtocolModel):
    """How the two variants were placed in time; a number, not a verdict."""

    schedule: VariantSchedule
    start_skew_seconds: float = Field(ge=0.0)
    completion_window_seconds: float = Field(ge=0.0)
    overlapped: bool


class PairedReceiptRow(ProtocolModel):
    """One committed task, and the two receipts that scored it."""

    position: int = Field(ge=0)
    task_hash: Digest
    baseline_receipt_id: NonEmptyString
    baseline_receipt_digest: Digest
    candidate_receipt_id: NonEmptyString
    candidate_receipt_digest: Digest


class RealComparisonResult(ProtocolModel):
    """Whether the two executions were one experiment, and how it was checked."""

    status: ComparisonStatus
    mutation_kind: MutationKind
    manifest_comparison: ManifestComparison
    ordered_task_hashes: list[Digest]
    rows: list[PairedReceiptRow]
    checks: list[ComparisonCheck]
    schedule: ScheduleObservation
    baseline_observed: ObservedSubjectConfiguration
    candidate_observed: ObservedSubjectConfiguration

    @property
    def failures(self) -> list[ComparisonCheck]:
        return [check for check in self.checks if check.status == "failed"]

    @property
    def warnings(self) -> list[ComparisonCheck]:
        return [check for check in self.checks if check.status == "warning"]

    @property
    def controlled(self) -> bool:
        return self.status in (
            ComparisonStatus.CONTROLLED,
            ComparisonStatus.CONTROLLED_WITH_WARNINGS,
        )

    @model_validator(mode="after")
    def _check_the_status_is_the_one_the_checks_support(self) -> Self:
        expected = _status_for(self.checks)
        if self.status is not expected:
            raise ValueError(
                f"a comparison whose checks are {expected.value} cannot report {self.status.value}"
            )
        if self.status is not ComparisonStatus.INVALID and not self.rows:
            raise ValueError("a controlled comparison pairs at least one task")
        return self


@dataclass(frozen=True)
class ObservedVariant:
    """Everything about one variant that was measured rather than declared."""

    variant: ExperimentVariant
    configuration: ObservedSubjectConfiguration
    tools: list[NormalizedTool]
    sampling: dict[str, JsonValue]
    ordered_task_hashes: list[Digest]
    episode_count: int
    child_outcome: ChildProcessOutcome


def observe_variant(
    *,
    result: VariantExecutionResult,
    resolved_config: Mapping[str, Any],
    campaign: CampaignSpecV4,
) -> ObservedVariant:
    """Fingerprint one executed variant from its own evidence."""
    configuration = observed_from_episodes(
        result.episodes,
        resolved_config=resolved_config,
        image_resolution=result.image_resolution,
        runtime=campaign.subject.runtime,
        taskset=campaign.taskset,
        seat=campaign.environment.engine_seat,
    )
    # Every rollout has already been required to agree, so the first describes all of them.
    reference = next(trace for episode in result.episodes for trace in episode.traces)
    return ObservedVariant(
        variant=ExperimentVariant(result.variant.value),
        configuration=configuration,
        tools=sorted(reference.tools, key=lambda tool: tool.name),
        sampling=dict(reference.sampling),
        ordered_task_hashes=[validate_digest(episode.task_hash) for episode in result.episodes],
        episode_count=len(result.episodes),
        child_outcome=result.child_outcome,
    )


def compare_real_variants(
    *,
    campaign: CampaignSpecV4,
    plan: ResolvedExecutionPlan,
    baseline_manifest: ExperimentManifestV4,
    candidate_manifest: ExperimentManifestV4,
    prepared_manifest_comparison: ManifestComparison,
    baseline_receipts: Sequence[EpisodeReceiptV3],
    candidate_receipts: Sequence[EpisodeReceiptV3],
    taskset_lock: TasksetLock,
    baseline_observed: ObservedVariant,
    candidate_observed: ObservedVariant,
    schedule: VariantSchedule,
) -> RealComparisonResult:
    """Verify declared and observed control and return the paired rows."""
    committed = [validate_digest(value) for value in taskset_lock.ordered_task_hashes]
    recomputed = compare_manifests(
        baseline_manifest, candidate_manifest, campaign.mutation_contract
    )
    checks = [
        *_declared_checks(
            campaign=campaign,
            baseline=baseline_manifest,
            candidate=candidate_manifest,
            prepared=prepared_manifest_comparison,
            recomputed=recomputed,
            taskset_lock=taskset_lock,
        ),
        *_observed_checks(
            campaign=campaign,
            plan=plan,
            baseline_manifest=baseline_manifest,
            candidate_manifest=candidate_manifest,
            baseline=baseline_observed,
            candidate=candidate_observed,
            committed=committed,
        ),
    ]
    rows, pairing = _pair_receipts(
        baseline_receipts=baseline_receipts,
        candidate_receipts=candidate_receipts,
        committed=committed,
    )
    checks.append(pairing)
    observation = _observe_schedule(
        schedule=schedule,
        baseline=baseline_observed.child_outcome,
        candidate=candidate_observed.child_outcome,
    )
    checks.append(
        ComparisonCheck(
            id="schedule_recorded",
            status="passed",
            detail=f"the variants ran under {schedule.value}, launched "
            f"{observation.start_skew_seconds:.3f}s apart and completed within "
            f"{observation.completion_window_seconds:.3f}s",
        )
    )
    status = _status_for(checks)
    return RealComparisonResult(
        status=status,
        mutation_kind=campaign.mutation_contract.kind,
        manifest_comparison=recomputed,
        ordered_task_hashes=committed,
        rows=[] if status is ComparisonStatus.INVALID else rows,
        checks=checks,
        schedule=observation,
        baseline_observed=baseline_observed.configuration,
        candidate_observed=candidate_observed.configuration,
    )


def weaker_claim_warnings(campaign: CampaignSpecV4) -> list[ComparisonCheck]:
    """A model with no published revision is known by identifier, not by build."""
    if campaign.subject.model.revision is not None:
        return []
    return [
        ComparisonCheck(
            id=MODEL_REVISION_UNDISCOVERABLE,
            status="warning",
            detail=f"the provider publishes no revision for {campaign.subject.model.model_id}, "
            "so both variants are known to have used the same model identifier and not the "
            "same model build",
        )
    ]


def _declared_checks(
    *,
    campaign: CampaignSpecV4,
    baseline: ExperimentManifestV4,
    candidate: ExperimentManifestV4,
    prepared: ManifestComparison,
    recomputed: ManifestComparison,
    taskset_lock: TasksetLock,
) -> list[ComparisonCheck]:
    """Named checks over what the whole-configuration diff also covers, for readable verdicts."""
    left = baseline.configuration
    right = candidate.configuration
    subject_left = _subject(baseline)
    subject_right = _subject(candidate)
    return [
        _same(
            "declared_campaign",
            "Campaign",
            baseline.campaign_spec_digest,
            candidate.campaign_spec_digest,
        ),
        _same(
            "declared_data_policy", "DataPolicy", left.data_policy_digest, right.data_policy_digest
        ),
        _same(
            "declared_program_and_context",
            "improvement program or public context",
            (baseline.program_ref, baseline.public_context),
            (candidate.program_ref, candidate.public_context),
        ),
        _same(
            "declared_outcome_contract",
            "OutcomeContract",
            left.outcome_contract_digest,
            right.outcome_contract_digest,
        ),
        _same(
            "declared_execution_plan",
            "execution plan",
            left.execution_plan_digest,
            right.execution_plan_digest,
        ),
        _same("declared_environment", "environment", left.environment, right.environment),
        _same("declared_model", "subject model", subject_left.model, subject_right.model),
        _same("declared_sampling", "sampling", subject_left.sampling, subject_right.sampling),
        _same(
            "declared_harness",
            "bundled-Skill setting",
            subject_left.harness.use_bundled_skill,
            subject_right.harness.use_bundled_skill,
        ),
        _same(
            "declared_runtime",
            "subject runtime or image",
            subject_left.runtime,
            subject_right.runtime,
        ),
        _same(
            "declared_execution_contract",
            "execution, scoring, evidence or budget contract",
            (left.execution, left.scoring, left.evidence, left.budgets),
            (right.execution, right.scoring, right.evidence, right.budgets),
        ),
        *_taskset_checks(campaign, baseline, candidate, taskset_lock),
        _verdict(
            "declared_only_skill_differs",
            recomputed.controlled,
            "the candidate configuration differs from the baseline only where the mutation "
            "contract permits",
            "; ".join(recomputed.violations),
        ),
        _verdict(
            "declared_comparison_unchanged",
            recomputed == prepared,
            "the comparison recomputed from the executed manifests is the one the run was "
            "prepared with",
            "the executed manifests do not produce the comparison this run was prepared with",
        ),
        _mutation_check(campaign, subject_left, subject_right),
    ]


def _taskset_checks(
    campaign: CampaignSpecV4,
    baseline: ExperimentManifestV4,
    candidate: ExperimentManifestV4,
    lock: TasksetLock,
) -> list[ComparisonCheck]:
    committed = list(campaign.taskset.membership.ordered_task_hashes)
    return [
        _verdict(
            "declared_taskset",
            baseline.configuration.taskset == campaign.taskset
            and candidate.configuration.taskset == campaign.taskset,
            "both variants commit to the Campaign's taskset and membership",
            "a variant commits to a different taskset or membership than the Campaign",
        ),
        _verdict(
            "declared_taskset_lock",
            list(lock.ordered_task_hashes) == committed
            and lock.membership_digest == campaign.taskset.membership.membership_digest
            and lock.membership_digest == membership_digest(committed)
            and lock.taskset_ref == campaign.taskset.ref
            and lock.task_count == len(committed),
            f"the lock pins the {len(committed)} tasks the Campaign commits to",
            "the taskset lock does not pin the tasks, the membership digest or the taskset "
            "the Campaign commits to",
        ),
    ]


def _mutation_check(
    campaign: CampaignSpecV4, baseline: AgentSpecV2, candidate: AgentSpecV2
) -> ComparisonCheck:
    kind = campaign.mutation_contract.kind
    left = [reference.digest for reference in baseline.harness.skills]
    right = [reference.digest for reference in candidate.harness.skills]
    if kind is MutationKind.SKILL_INSERTION:
        return _verdict(
            f"declared_mutation_{kind.value}",
            not left and len(right) == 1,
            "the baseline declares no Skill and the candidate declares one",
            f"a skill_insertion declares 0 then 1 Skill; got {len(left)} then {len(right)}",
        )
    return _verdict(
        f"declared_mutation_{kind.value}",
        len(left) == 1 and len(right) == 1 and left != right,
        "the baseline and the candidate each declare one Skill, and they are different Skills",
        "a skill_replacement declares one differing Skill on each side",
    )


def _observed_checks(
    *,
    campaign: CampaignSpecV4,
    plan: ResolvedExecutionPlan,
    baseline_manifest: ExperimentManifestV4,
    candidate_manifest: ExperimentManifestV4,
    baseline: ObservedVariant,
    candidate: ObservedVariant,
    committed: Sequence[Digest],
) -> list[ComparisonCheck]:
    left = baseline.configuration
    right = candidate.configuration
    return [
        _verdict(
            "observed_task_order",
            baseline.ordered_task_hashes == candidate.ordered_task_hashes == list(committed),
            "both variants scored the committed tasks in committed order",
            "a variant scored a different set of tasks, or scored them in an order the "
            "Campaign did not commit to",
        ),
        _verdict(
            "observed_episode_count",
            baseline.episode_count == candidate.episode_count == len(committed),
            f"both variants recorded {len(committed)} episodes",
            f"the variants recorded {baseline.episode_count} and {candidate.episode_count} "
            f"episodes for {len(committed)} tasks",
        ),
        _same("observed_model", "model", left.model_id, right.model_id),
        _same(
            "observed_sampling", "effective sampling", left.sampling_digest, right.sampling_digest
        ),
        _same(
            "observed_harness",
            "harness",
            (left.harness_id, left.harness_version),
            (right.harness_id, right.harness_version),
        ),
        _same(
            "observed_bundled_skill",
            "bundled-Skill setting",
            left.use_bundled_skill,
            right.use_bundled_skill,
        ),
        _same(
            "observed_runtime_image",
            "runtime or task images",
            (left.runtime_kind, left.images),
            (right.runtime_kind, right.images),
        ),
        _same(
            "observed_runtime_platform_digest",
            "platform the images were served on",
            left.runtime_platform,
            right.runtime_platform,
        ),
        *_runtime_pin_checks(campaign, baseline, candidate),
        _tool_surface_check(baseline, candidate),
        _same(
            "observed_reward_contract",
            "reward names or weights",
            left.reward_contract_digest,
            right.reward_contract_digest,
        ),
        _same(
            "observed_verifiers_build",
            "Verifiers build",
            (left.verifiers_version, left.verifiers_revision),
            (right.verifiers_version, right.verifiers_revision),
        ),
        _declared_to_observed(baseline_manifest, baseline, plan),
        _declared_to_observed(candidate_manifest, candidate, plan),
        *weaker_claim_warnings(campaign),
    ]


def _tool_surface_check(baseline: ObservedVariant, candidate: ObservedVariant) -> ComparisonCheck:
    """Permit the Skill-index description delta and nothing else."""
    left = {tool.name: tool for tool in baseline.tools}
    right = {tool.name: tool for tool in candidate.tools}
    if (
        not left
        or not right
        or len(left) != len(baseline.tools)
        or len(right) != len(candidate.tools)
    ):
        return _failed(
            "observed_tool_inventory",
            "each variant must record a nonempty tool inventory with unique names",
        )
    if set(left) != set(right):
        added = sorted(set(right) - set(left))
        removed = sorted(set(left) - set(right))
        return _failed(
            "observed_tool_inventory",
            "the two variants were offered different tools "
            f"(added {added or 'nothing'}, removed {removed or 'nothing'})",
        )
    schemas = sorted(
        name for name in left if left[name].parameters_digest != right[name].parameters_digest
    )
    if schemas:
        return _failed(
            "observed_tool_inventory",
            f"the parameter schema of {', '.join(schemas)} differs between the two variants",
        )
    descriptions = sorted(
        name for name in left if left[name].description_digest != right[name].description_digest
    )
    if not descriptions:
        return ComparisonCheck(
            id="observed_tool_inventory",
            status="passed",
            detail=f"both variants were offered the same {len(left)} tools, described identically",
        )
    if descriptions == [SKILL_INDEX_TOOL] and (
        baseline.configuration.harness_id == candidate.configuration.harness_id == "hermes-agent"
    ):
        return ComparisonCheck(
            id="observed_tool_inventory",
            status="passed",
            detail=f"both variants were offered the same {len(left)} tools with the same "
            f"schemas; only {SKILL_INDEX_TOOL}'s description differs, which is where the "
            "harness lists the Skills the subject can see",
        )
    return _failed(
        "observed_tool_inventory",
        f"the description of {', '.join(descriptions)} differs between the two variants; "
        f"only {SKILL_INDEX_TOOL}'s may",
    )


def _declared_to_observed(
    manifest: ExperimentManifestV4, observed: ObservedVariant, plan: ResolvedExecutionPlan
) -> ComparisonCheck:
    """One variant's execution against its manifest; the harness is held to the plan."""
    subject = _subject(manifest)
    configuration = observed.configuration
    # A null setting is never sent, so it is not among the ones the engine records.
    declared_sampling: dict[str, JsonValue] = {
        key: value for key, value in subject.sampling.model_dump().items() if value is not None
    }
    mismatches = [
        label
        for label, declared, seen in (
            ("model", subject.model.model_id, configuration.model_id),
            ("harness", plan.subject.harness_id, configuration.harness_id),
            ("harness version", plan.subject.harness_version, configuration.harness_version),
            (
                "bundled-Skill setting",
                subject.harness.use_bundled_skill,
                configuration.use_bundled_skill,
            ),
            ("runtime", subject.runtime.type, configuration.runtime_kind),
            (
                "runtime images",
                [
                    (pin.task_hash, pin.agent.image, pin.grader and pin.grader.image)
                    for pin in pinned_task_images(subject.runtime, manifest.configuration.taskset)
                ],
                [
                    (row.task_hash, row.agent.image, row.grader and row.grader.image)
                    for row in configuration.images
                ],
            ),
            (
                "Skill list",
                [reference.digest for reference in subject.harness.skills],
                list(configuration.skill_root_digests),
            ),
            # Every parameter the engine resolved and none it did not: an undeclared sampling
            # key is a difference the manifest never authorized.
            ("sampling", declared_sampling, dict(observed.sampling)),
        )
        if declared != seen
    ]
    variant = observed.variant.value
    return _verdict(
        f"observed_matches_declared_{variant}",
        not mismatches,
        f"the {variant} executed the subject its manifest declares",
        f"the {variant} executed a different {', '.join(mismatches)} than its manifest declares",
    )


def _runtime_pin_checks(
    campaign: CampaignSpecV4, baseline: ObservedVariant, candidate: ObservedVariant
) -> list[ComparisonCheck]:
    """Both executions are held to the images the Campaign pinned, per platform."""
    pins = pinned_task_images(campaign.subject.runtime, campaign.taskset)
    expected = [
        (pin.task_hash, pin.agent.index_digest, pin.grader and pin.grader.index_digest)
        for pin in pins
    ]
    both = all(
        [
            (row.task_hash, row.agent.index_digest, row.grader and row.grader.index_digest)
            for row in observed.configuration.images
        ]
        == expected
        for observed in (baseline, candidate)
    )
    platforms = sorted(
        {observed.configuration.runtime_platform for observed in (baseline, candidate)}
    )
    pinned_platform = len(platforms) == 1 and all(
        platforms[0] in image.platform_digests
        for pin in pins
        for image in (pin.agent, pin.grader)
        if image is not None
    )
    return [
        _verdict(
            "observed_runtime_image_pinned",
            both,
            "the daemon confirmed both variants ran the image content the Campaign pinned",
            "the images the daemon holds are not the ones the Campaign pinned",
        ),
        _verdict(
            "observed_runtime_platform_pinned",
            pinned_platform,
            f"both variants were served on {platforms[0]}, a platform the Campaign pins "
            "manifest digests for",
            "the variants were served on platforms the Campaign does not pin one manifest "
            "digest for",
        ),
    ]


def _pair_receipts(
    *,
    baseline_receipts: Sequence[EpisodeReceiptV3],
    candidate_receipts: Sequence[EpisodeReceiptV3],
    committed: Sequence[Digest],
) -> tuple[list[PairedReceiptRow], ComparisonCheck]:
    """Join the two sides task by task, in committed order; faults are findings, not raises."""
    left, left_faults = _by_task(baseline_receipts, committed, "baseline")
    right, right_faults = _by_task(candidate_receipts, committed, "candidate")
    faults = [*left_faults, *right_faults]
    if faults:
        return [], _failed("paired_task_rewards", "; ".join(faults))
    rows = [
        PairedReceiptRow(
            position=position,
            task_hash=task_hash,
            baseline_receipt_id=left[task_hash].id,
            baseline_receipt_digest=digest_object(left[task_hash]),
            candidate_receipt_id=right[task_hash].id,
            candidate_receipt_digest=digest_object(right[task_hash]),
        )
        for position, task_hash in enumerate(committed)
    ]
    return rows, ComparisonCheck(
        id="paired_task_rewards",
        status="passed",
        detail=f"every one of the {len(rows)} committed tasks is scored exactly once on each side",
    )


def _by_task(
    receipts: Sequence[EpisodeReceiptV3], committed: Sequence[Digest], label: str
) -> tuple[dict[Digest, EpisodeReceiptV3], list[str]]:
    by_task: dict[Digest, EpisodeReceiptV3] = {}
    faults: list[str] = []
    for receipt in receipts:
        if receipt.task_hash in by_task:
            faults.append(f"the {label} scored {receipt.task_hash} twice")
            continue
        by_task[receipt.task_hash] = receipt
    missing = [value for value in committed if value not in by_task]
    unexpected = sorted(set(by_task) - set(committed))
    if missing:
        faults.append(f"the {label} did not score {len(missing)} committed task(s)")
    if unexpected:
        faults.append(
            f"the {label} scored {len(unexpected)} task(s) the Campaign does not commit to"
        )
    return by_task, faults


def _observe_schedule(
    *, schedule: VariantSchedule, baseline: ChildProcessOutcome, candidate: ChildProcessOutcome
) -> ScheduleObservation:
    started = (baseline.started_at, candidate.started_at)
    finished = (baseline.finished_at, candidate.finished_at)
    return ScheduleObservation(
        schedule=schedule,
        start_skew_seconds=abs((started[1] - started[0]).total_seconds()),
        completion_window_seconds=(max(finished) - min(started)).total_seconds(),
        overlapped=max(started) < min(finished),
    )


def _status_for(checks: Sequence[ComparisonCheck]) -> ComparisonStatus:
    if any(check.status == "failed" for check in checks):
        return ComparisonStatus.INVALID
    if any(check.status == "warning" for check in checks):
        return ComparisonStatus.CONTROLLED_WITH_WARNINGS
    return ComparisonStatus.CONTROLLED


def _verdict(identifier: str, ok: bool, ok_detail: str, fail_detail: str) -> ComparisonCheck:
    return ComparisonCheck(
        id=identifier,
        status="passed" if ok else "failed",
        detail=ok_detail if ok else fail_detail,
    )


def _failed(identifier: str, detail: str) -> ComparisonCheck:
    return ComparisonCheck(id=identifier, status="failed", detail=detail)


def _same(identifier: str, label: str, left: object, right: object) -> ComparisonCheck:
    """Report whether two sides agree without printing what they hold, so nothing can leak."""
    return _verdict(
        identifier,
        left == right,
        f"the baseline and the candidate share one {label}",
        f"the baseline and the candidate do not share one {label}",
    )


def _subject(manifest: ExperimentManifestV4) -> AgentSpecV2:
    return manifest.configuration.agents[SUBJECT_AGENT]
