"""One receipt per committed task, from one variant's normalized episodes.

Every hash that enters is revalidated as a digest before it is compared to anything, and
every reference a receipt copies is required to agree with every other before it is built.
A failed episode still gets a receipt whose `score_status` says so; refusals are for evidence
that cannot be joined onto the Campaign's commitment at all.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Final

from regents_cli.techtree.canonical import (
    canonical_json_bytes,
    digest_object,
    sha256_digest_bytes,
    validate_digest,
)
from regents_cli.techtree.constants import EPISODE_RECEIPT_V2_SCHEMA_VERSION
from regents_cli.techtree.errors import VerificationError
from regents_cli.techtree.execution_facts import EpisodeReceiptExecutionFacts
from regents_cli.techtree.models.base import ArtifactRef, Digest
from regents_cli.techtree.models.campaign import SUBJECT_AGENT, EvidenceRequirementsV2
from regents_cli.techtree.models.episode_receipt import (
    EpisodeReceiptV2,
    EvidenceStatus,
    NamedTraceReceipt,
    ScoreStatus,
    SubjectRuntimeReceipt,
)
from regents_cli.techtree.models.experiment import ExperimentManifestV2, ExperimentVariant
from regents_cli.techtree.models.run import RunRequestV2
from regents_cli.techtree.verifiers.models import (
    NormalizedEpisode,
    NormalizedTrace,
    VariantExecutionResult,
    VariantName,
)

EVALUATION_OUTPUT_CORRUPT: Final = "evaluation_output_corrupt"
EPISODE_COUNT_MISMATCH: Final = "episode_count_mismatch"
TASK_MEMBERSHIP_MISMATCH: Final = "task_membership_mismatch"
TRACE_ROLE_MISMATCH: Final = "trace_role_mismatch"
REWARD_MISSING: Final = "reward_missing"
REWARD_NON_FINITE: Final = "reward_non_finite"
EPISODE_RECEIPT_INVALID: Final = "episode_receipt_invalid"

#: Derived identifiers carry the 32 hexadecimal characters `ids.new_id` issues.
_DERIVED_ID_LENGTH: Final = 32


def experiment_variant_of(variant: VariantName) -> ExperimentVariant:
    """The protocol variant one execution-local variant names."""
    return ExperimentVariant(variant.value)


def build_episode_receipt(
    *,
    run_request: RunRequestV2,
    variant: VariantName,
    experiment: ExperimentManifestV2,
    episode: NormalizedEpisode,
    raw_artifacts: VariantExecutionResult,
    execution: EpisodeReceiptExecutionFacts,
    primary_reward: str,
    evidence: EvidenceRequirementsV2,
) -> EpisodeReceiptV2:
    """Construct one receipt from one normalized episode and the run's lineage."""
    _require_lineage(
        run_request=run_request,
        variant=variant,
        experiment=experiment,
        raw_artifacts=raw_artifacts,
        execution=execution,
    )
    trace = _subject_trace(episode, variant)
    task_hash = validate_digest(episode.task_hash)
    if validate_digest(trace.task_hash) != task_hash:
        raise VerificationError(
            "this episode's subject trace scored a different task than the episode it belongs to",
            code=TASK_MEMBERSHIP_MISMATCH,
            details={"episode": episode.task_hash, "trace": trace.task_hash},
        )
    episode_digest = validate_digest(episode.raw_episode_digest)
    return EpisodeReceiptV2(
        schema_version=EPISODE_RECEIPT_V2_SCHEMA_VERSION,
        id=_receipt_id(run_id=run_request.run_id, variant=variant, episode_digest=episode_digest),
        run_id=run_request.run_id,
        campaign_spec_digest=run_request.campaign_spec_digest,
        program_ref=run_request.program_ref,
        public_context=run_request.public_context,
        data_policy_digest=run_request.data_policy_digest,
        outcome_contract_digest=run_request.outcome_contract_digest,
        execution_plan_digest=execution.execution_plan_digest,
        execution_location=execution.execution_location,
        subject_runtime=_subject_runtime(trace),
        variant=experiment_variant_of(variant),
        experiment_manifest_digest=raw_artifacts.experiment_manifest_digest,
        episode_id=episode.episode_id,
        episode_digest=episode_digest,
        task_hash=task_hash,
        named_traces={
            SUBJECT_AGENT: [
                NamedTraceReceipt(
                    role=SUBJECT_AGENT,
                    trace_id=trace.trace_id,
                    trace_digest=validate_digest(trace.raw_trace_digest),
                    task_hash=task_hash,
                    rewards=_recorded_rewards(trace),
                    metrics=_recorded_metrics(trace),
                    ok=trace.ok,
                )
            ]
        },
        score_status=_score_status(episode, trace, primary_reward),
        evidence_status=_evidence_status(trace, evidence),
        executor_kind="verifiers",
        artifacts=_variant_artifacts(raw_artifacts),
    )


def build_variant_receipts(
    *,
    run_request: RunRequestV2,
    variant: VariantName,
    experiment: ExperimentManifestV2,
    result: VariantExecutionResult,
    execution: EpisodeReceiptExecutionFacts,
    ordered_task_hashes: Sequence[Digest],
    primary_reward: str,
    evidence: EvidenceRequirementsV2,
) -> list[EpisodeReceiptV2]:
    """Exactly one receipt per committed task, in committed order, joined by task hash.

    A variant with an unscored task is refused: a comparison over the tasks that happened to
    score would be over a taskset the Campaign never committed to.
    """
    _require_lineage(
        run_request=run_request,
        variant=variant,
        experiment=experiment,
        raw_artifacts=result,
        execution=execution,
    )
    committed = _committed_membership(ordered_task_hashes)
    episodes = _episodes_by_task(result, committed, variant)
    receipts = [
        build_episode_receipt(
            run_request=run_request,
            variant=variant,
            experiment=experiment,
            episode=episodes[task_hash],
            raw_artifacts=result,
            execution=execution,
            primary_reward=primary_reward,
            evidence=evidence,
        )
        for task_hash in committed
    ]
    _require_every_task_scored(receipts, primary_reward, variant)
    return receipts


def _require_lineage(
    *,
    run_request: RunRequestV2,
    variant: VariantName,
    experiment: ExperimentManifestV2,
    raw_artifacts: VariantExecutionResult,
    execution: EpisodeReceiptExecutionFacts,
) -> None:
    expected_variant = experiment_variant_of(variant)
    configuration = experiment.configuration
    declared_manifest = (
        run_request.baseline_manifest_digest
        if expected_variant is ExperimentVariant.BASELINE
        else run_request.candidate_manifest_digest
    )
    manifest_digest = digest_object(experiment)
    _require(
        raw_artifacts.variant is variant,
        f"a {variant.value} receipt cannot be built from a {raw_artifacts.variant.value} execution",
        variant=variant.value,
    )
    _require(
        experiment.variant is expected_variant,
        f"a {variant.value} receipt cannot be built from a {experiment.variant.value} manifest",
        variant=variant.value,
    )
    _require(
        manifest_digest == raw_artifacts.experiment_manifest_digest,
        "this execution was produced from a different experiment manifest than the one the "
        "receipt is being built against",
        expected=raw_artifacts.experiment_manifest_digest,
        computed=manifest_digest,
    )
    _require(
        manifest_digest == declared_manifest,
        f"the staged {variant.value} manifest is not the one this run's request names",
        expected=declared_manifest,
        computed=manifest_digest,
    )
    _require(
        experiment.campaign_spec_digest == run_request.campaign_spec_digest,
        "the manifest and the run's request name different Campaigns",
        expected=run_request.campaign_spec_digest,
        computed=experiment.campaign_spec_digest,
    )
    _require(
        configuration.data_policy_digest == run_request.data_policy_digest,
        "the manifest and the run's request name different DataPolicies",
        expected=run_request.data_policy_digest,
        computed=configuration.data_policy_digest,
    )
    _require(
        configuration.outcome_contract_digest == run_request.outcome_contract_digest,
        "the manifest and the run's request name different OutcomeContracts",
    )
    _require(
        experiment.program_ref == run_request.program_ref
        and experiment.public_context == run_request.public_context,
        "the manifest and the run's request name a different improvement program or public context",
    )
    _require(
        execution.execution_plan_digest == run_request.execution_plan_digest
        and execution.execution_plan_digest == configuration.execution_plan_digest,
        "the execution plan this receipt would carry is not the one the run's request and "
        "manifest were executed under",
        expected=run_request.execution_plan_digest,
        computed=execution.execution_plan_digest,
    )


def _require(condition: bool, message: str, **details: str) -> None:
    if condition:
        return
    raise VerificationError(message, code=EPISODE_RECEIPT_INVALID, details=details)


def _subject_trace(episode: NormalizedEpisode, variant: VariantName) -> NormalizedTrace:
    """The one subject rollout an episode carries; anything else is refused."""
    traces = [trace for trace in episode.traces if trace.agent_role == SUBJECT_AGENT]
    if len(traces) == 1 and len(episode.traces) == 1:
        return traces[0]
    raise VerificationError(
        f"episode {episode.episode_id} carries {len(episode.traces)} trace(s), {len(traces)} "
        f"of them in the {SUBJECT_AGENT!r} seat; an episode carries exactly one subject trace "
        "and nothing else",
        code=TRACE_ROLE_MISMATCH,
        details={
            "variant": variant.value,
            "episode_id": episode.episode_id,
            "traces": len(episode.traces),
            "subject_traces": len(traces),
        },
    )


def _recorded_rewards(trace: NormalizedTrace) -> dict[str, float]:
    """The score, not the weighted value: a receipt records the measurement."""
    rewards: dict[str, float] = {}
    for reward in trace.rewards:
        _require_finite(reward.score, f"reward {reward.name!r}", trace)
        rewards[reward.name] = reward.score
    return rewards


def _recorded_metrics(trace: NormalizedTrace) -> dict[str, float | None]:
    for name, value in trace.metrics.items():
        if value is not None:
            _require_finite(value, f"metric {name!r}", trace, reward=False)
    return dict(trace.metrics)


def _require_finite(
    value: float, label: str, trace: NormalizedTrace, *, reward: bool = True
) -> None:
    if math.isfinite(value):
        return
    raise VerificationError(
        f"the {label} recorded on trace {trace.trace_id} is not finite, so it is not a measurement",
        code=REWARD_NON_FINITE if reward else EVALUATION_OUTPUT_CORRUPT,
        details={"trace_id": trace.trace_id, "value": repr(value)},
    )


def _subject_runtime(trace: NormalizedTrace) -> SubjectRuntimeReceipt:
    """The platform is a fact about the machine, so it lives in the comparison, not here."""
    return SubjectRuntimeReceipt(
        kind="docker",
        resolved_image_digest=validate_digest(trace.runtime.image_index_digest),
        platform=None,
    )


def _score_status(
    episode: NormalizedEpisode, trace: NormalizedTrace, primary_reward: str
) -> ScoreStatus:
    if not episode.ok or not trace.ok or episode.errors or trace.errors:
        return ScoreStatus.ERRORED
    if trace.reward(primary_reward) is None:
        return ScoreStatus.MISSING
    return ScoreStatus.VALID


def _evidence_status(trace: NormalizedTrace, evidence: EvidenceRequirementsV2) -> EvidenceStatus:
    configured = bool(trace.model_id and trace.harness_id and trace.tools)
    if configured and evidence.runtime_evidence != "required":
        return EvidenceStatus.COMPLETE
    return EvidenceStatus.PARTIAL


def _variant_artifacts(result: VariantExecutionResult) -> list[ArtifactRef]:
    return [
        result.resolved_verifiers_config,
        result.raw_traces,
        result.eval_log,
        result.normalized_episodes,
    ]


def _receipt_id(*, run_id: str, variant: VariantName, episode_digest: Digest) -> str:
    """Derived, not random, so a rebuild from the same evidence names the same receipt."""
    digest = sha256_digest_bytes(
        canonical_json_bytes(
            {"run_id": run_id, "variant": variant.value, "episode_digest": episode_digest}
        )
    )
    _, _, hexadecimal = digest.partition(":")
    return f"receipt_{hexadecimal[:_DERIVED_ID_LENGTH]}"


def _committed_membership(ordered_task_hashes: Sequence[Digest]) -> list[Digest]:
    committed = [validate_digest(value) for value in ordered_task_hashes]
    if not committed:
        raise VerificationError(
            "a Campaign commits to at least one task, and this one commits to none, so there "
            "is nothing to build receipts for",
            code=TASK_MEMBERSHIP_MISMATCH,
            details={"task_count": 0},
        )
    if len(set(committed)) != len(committed):
        raise VerificationError(
            "the committed membership names the same task twice, so a receipt could be "
            "attributed to either position",
            code=TASK_MEMBERSHIP_MISMATCH,
            details={"task_count": len(committed)},
        )
    return committed


def _episodes_by_task(
    result: VariantExecutionResult, committed: Sequence[Digest], variant: VariantName
) -> dict[Digest, NormalizedEpisode]:
    if len(result.episodes) != len(committed):
        raise VerificationError(
            f"the {variant.value} variant recorded {len(result.episodes)} episodes for "
            f"{len(committed)} committed tasks",
            code=EPISODE_COUNT_MISMATCH,
            details={
                "variant": variant.value,
                "recorded": len(result.episodes),
                "committed": len(committed),
            },
        )
    by_task: dict[Digest, NormalizedEpisode] = {}
    for episode in result.episodes:
        task_hash = validate_digest(episode.task_hash)
        if task_hash in by_task:
            raise VerificationError(
                f"the {variant.value} variant scored task {task_hash} twice, so one of the "
                "two results would have to be discarded",
                code=TASK_MEMBERSHIP_MISMATCH,
                details={"variant": variant.value, "task_hash": task_hash},
            )
        by_task[task_hash] = episode
    missing: list[str] = [value for value in committed if value not in by_task]
    unexpected: list[str] = sorted(set(by_task) - set(committed))
    if missing or unexpected:
        raise VerificationError(
            f"the {variant.value} variant scored a different set of tasks than the Campaign "
            "commits to",
            code=TASK_MEMBERSHIP_MISMATCH,
            details={"variant": variant.value, "missing": missing, "unexpected": unexpected},
        )
    return by_task


def _require_every_task_scored(
    receipts: Sequence[EpisodeReceiptV2], primary_reward: str, variant: VariantName
) -> None:
    unscored = [
        receipt.task_hash for receipt in receipts if receipt.score_status is ScoreStatus.MISSING
    ]
    if not unscored:
        return
    raise VerificationError(
        f"{len(unscored)} {variant.value} rollout(s) completed without scoring "
        f"{primary_reward!r}, which is the reward this comparison is decided on",
        code=REWARD_MISSING,
        details={"variant": variant.value, "reward": primary_reward, "task_hashes": unscored},
    )
