"""Turning one signed report into one neutral payload.

The report decides, the builder describes: no score is recomputed, no verdict re-derived, no
status interpreted. Warnings are carried, never smoothed. A rejected candidate is a
measurement, not a failed run.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from regents_cli.techtree.errors import PrerequisiteError
from regents_cli.techtree.identity.models import VerificationResult
from regents_cli.techtree.models.campaign import CampaignSpecV2
from regents_cli.techtree.models.episode_receipt import EpisodeReceiptV2
from regents_cli.techtree.models.skill import SkillArtifact
from regents_cli.techtree.models.uplift_report import (
    ComparisonStatus,
    TaskDelta,
    UpliftDecision,
    UpliftReportV2,
)
from regents_cli.techtree.presentation.evidence import RecordedEvidence
from regents_cli.techtree.presentation.models import (
    PRESENTATION_SCHEMA_VERSION,
    DerivedCost,
    EconomicsSource,
    PresentationCaveat,
    SkillSummary,
    TaskOutcome,
    TaskResultRow,
    UpliftPresentationPayload,
)
from regents_cli.techtree.presentation.sanitize import (
    ensure_no_hidden_task_material,
    sanitize_label,
)
from regents_cli.techtree.receipts.compare import (
    MODEL_REVISION_UNDISCOVERABLE,
    weaker_claim_warnings,
)
from regents_cli.techtree.receipts.execution import ComparisonExecutionRecord, VariantUsage
from regents_cli.techtree.verifiers.budget import price_profile_for

#: What a Skill-insertion comparison measures against: a role, not an absent value.
BASELINE_SKILL_LABEL: Final = "No tested Skill"

FIRST_RESULT_LABEL: Final = "Hello World Uplift Receipt"
SECOND_RESULT_LABEL: Final = "Hello World — Iteration 2"
LATER_RESULT_LABEL: Final = "Hello World — A Later Iteration"

HELD_FIXED_LINE: Final = (
    "Everything else was the same on both sides: the same model sampled the same way, the "
    "same harness and tools, the same runtime image, the same tasks in the same order, the "
    "same reward, and the same declared limits."
)

FIRST_CHANGE_LABEL: Final = "No tested Skill → Skill v1"
SECOND_CHANGE_LABEL: Final = "Skill v1 → Skill v2"

#: The only words this build explains ``P1`` with.
P1_MEANING: Final = "integrity-bound, participant-attested local execution"

#: What each decision established, said as what was measured rather than as a verdict won.
DECISION_HEADLINE: Final[dict[str, str]] = {
    "accepted": "Improved on this development task family",
    "rejected": "Did not clear the bar this Climb declared",
    "inconclusive": "Not decided: this Climb declared no rule that could decide it",
    "invalid": "Not valid: this comparison cannot carry a result",
    "development_only": "Development-only: this report states no verdict",
}

#: Stops any headline being read as a claim about what the Skill can do in general.
NOT_BROAD_CAPABILITY_LINE: Final = "Not broad-capability evidence"

#: A graded report reaches a rendering only after its proof verified; a development-only report
#: has no proof and is never checked.
VERIFICATION_VERIFIED: Final = "verified_offline"
VERIFICATION_NOT_VERIFIED: Final = "not_verified"

#: A headline count is only offered for an all-or-nothing reward.
_FULL_SCORE: Final = 1.0
_TOKENS_PER_MILLION: Final = 1_000_000.0


def build_uplift_presentation(
    *,
    report: UpliftReportV2,
    campaign: CampaignSpecV2,
    baseline_receipts: Sequence[EpisodeReceiptV2],
    candidate_receipts: Sequence[EpisodeReceiptV2],
    campaign_title: str,
    baseline_skill: SkillArtifact | None,
    candidate_skill: SkillArtifact,
    verification: VerificationResult | None,
    execution_record: ComparisonExecutionRecord | None = None,
    recorded_evidence: RecordedEvidence | None = None,
) -> UpliftPresentationPayload:
    """Build a channel-neutral payload; `verification` is None for a development-only report."""
    economics = _economics(execution_record, baseline_receipts, candidate_receipts)
    task_rows = _task_rows(report.task_deltas)
    scored_full = _tasks_scored_full(task_rows)
    seen = recorded_evidence
    baseline_seen = None if seen is None else seen.baseline
    candidate_seen = None if seen is None else seen.candidate
    derived = _derived_cost(campaign, execution_record)
    generation = _generation(baseline_skill)
    primary = report.primary_result
    payload = UpliftPresentationPayload(
        schema_version=PRESENTATION_SCHEMA_VERSION,
        run_id=report.run_id,
        campaign_title=sanitize_label(campaign_title),
        comparison_label=_comparison_label(generation),
        change_label=_change_label(generation, baseline_skill, candidate_skill),
        baseline_skill=_skill_summary(baseline_skill, _baseline_label(baseline_skill)),
        candidate_skill=_skill_summary(candidate_skill, candidate_skill.name),
        baseline_score=primary.baseline_mean,
        candidate_score=primary.candidate_mean,
        absolute_delta=primary.absolute_delta,
        relative_delta=primary.relative_delta,
        wins=primary.wins,
        losses=primary.losses,
        ties=primary.ties,
        task_rows=task_rows,
        baseline_tasks_scored_full=scored_full[0],
        candidate_tasks_scored_full=scored_full[1],
        baseline_tokens=economics.baseline_tokens,
        candidate_tokens=economics.candidate_tokens,
        baseline_seconds=economics.baseline_seconds,
        candidate_seconds=economics.candidate_seconds,
        baseline_model_turns=None if baseline_seen is None else baseline_seen.model_turns,
        candidate_model_turns=None if candidate_seen is None else candidate_seen.model_turns,
        baseline_rate_limited_calls=(
            None if baseline_seen is None else baseline_seen.rate_limited_calls
        ),
        candidate_rate_limited_calls=(
            None if candidate_seen is None else candidate_seen.rate_limited_calls
        ),
        every_rollout_completed=None if seen is None else seen.every_rollout_completed,
        economics_source=economics.source,
        derived_cost=derived,
        cost_unavailable_reason=(
            None if derived is not None else _cost_unavailable_reason(campaign, execution_record)
        ),
        decision=report.decision.value,
        proof_grade=report.proof_grade,
        verification_status=_verification_status(verification),
        caveats=_caveats(
            report=report,
            campaign=campaign,
            economics=economics,
            recorded_evidence=recorded_evidence,
            derived=derived,
        ),
    )
    ensure_no_hidden_task_material(payload)
    return payload


def task_counts(payload: UpliftPresentationPayload) -> tuple[int, int, int] | None:
    """Each side's count and the total, only for an all-or-nothing reward."""
    baseline = payload.baseline_tasks_scored_full
    candidate = payload.candidate_tasks_scored_full
    if baseline is None or candidate is None:
        return None
    return baseline, candidate, len(payload.task_rows)


def task_count_line(payload: UpliftPresentationPayload) -> str | None:
    counted = task_counts(payload)
    if counted is None:
        return None
    baseline, candidate, total = counted
    return f"{baseline} of {total} → {candidate} of {total} ({candidate - baseline:+d})"


def decision_headline(payload: UpliftPresentationPayload) -> str:
    return DECISION_HEADLINE[payload.decision]


def solved_line(payload: UpliftPresentationPayload) -> str:
    """Solved, still failing, regressed: in a Skill-insertion comparison a tie means both failed."""
    regressions = f"{payload.losses} regression{'' if payload.losses == 1 else 's'}"
    counted = task_counts(payload)
    if counted is None:
        return regressions
    _, candidate, total = counted
    return f"Solved {candidate} of {total} · {total - candidate} still failing · {regressions}"


def efficiency_sentence(payload: UpliftPresentationPayload) -> str | None:
    """What the candidate saved against the baseline on this run; every figure needs both sides."""
    turns = _saving(
        payload.baseline_model_turns,
        payload.candidate_model_turns,
        fewer="took {count} fewer model turn{s}",
        more="took {count} more model turn{s}",
    )
    tokens = _saving(
        payload.baseline_tokens,
        payload.candidate_tokens,
        fewer="used {count} fewer token{s}",
        more="used {count} more token{s}",
    )
    clock = _saving(
        payload.baseline_seconds,
        payload.candidate_seconds,
        fewer="finished {count} seconds sooner",
        more="finished {count} seconds later",
    )
    savings = [phrase for phrase in (turns, tokens, clock) if phrase is not None]
    if not savings:
        return None
    counted = turns is not None or tokens is not None
    return (
        f"On this controlled run the Skill {_listed(savings)}. "
        f"{_WORK_OR_WEATHER[counted, clock is not None]}"
    )


#: Turn and token counts are properties of the work; a clock also reads this machine.
_WORK_OR_WEATHER: Final[dict[tuple[bool, bool], str]] = {
    (True, True): (
        "Those counts are properties of the work; how long each side took also depends on "
        "this machine and on how busy the provider was."
    ),
    (True, False): "Those counts are properties of the work.",
    (False, True): (
        "How long each side took depends on this machine and on how busy the provider was, "
        "as well as on the work."
    ),
}


def _saving(
    baseline: float | int | None, candidate: float | int | None, *, fewer: str, more: str
) -> str | None:
    if baseline is None or candidate is None or baseline == candidate:
        return None
    difference = abs(baseline - candidate)
    count = f"{difference:,.1f}" if isinstance(difference, float) else f"{difference:,}"
    phrase = (fewer if candidate < baseline else more).format(
        count=count, s="" if difference == 1 else "s"
    )
    if not baseline:
        return phrase
    return f"{phrase} ({difference / baseline:.0%})"


def _listed(phrases: list[str]) -> str:
    if len(phrases) == 1:
        return phrases[0]
    if len(phrases) == 2:
        return f"{phrases[0]} and {phrases[1]}"
    return f"{', '.join(phrases[:-1])}, and {phrases[-1]}"


def _calls(count: int) -> str:
    return f"{count:,} model call" if count == 1 else f"{count:,} model calls"


def cost_summary(payload: UpliftPresentationPayload) -> str:
    """The figure and, in the same breath, that it was worked out rather than billed."""
    if payload.derived_cost is not None:
        return f"about ${payload.derived_cost.usd:.2f}, worked out here, not billed"
    return "unavailable"


def cost_explanation(payload: UpliftPresentationPayload) -> list[str]:
    """What a reader needs in order to judge the figure above it."""
    derived = payload.derived_cost
    if derived is None:
        assert payload.cost_unavailable_reason is not None
        return [payload.cost_unavailable_reason]
    lines = [
        f"Computed from {derived.input_tokens:,} input and {derived.output_tokens:,} output "
        "tokens at the prices this release recorded. Your provider's bill is what you "
        "actually pay."
    ]
    cached = derived.cached_input_tokens
    if cached and not derived.prices_name_a_cached_rate:
        lines.append(
            f"{cached:,} of those input tokens came back from the provider's cache. The "
            "recorded prices name no separate rate for those, so every token is priced at the "
            "full rate and the figure above is on the high side."
        )
    return lines


def _generation(baseline_skill: SkillArtifact | None) -> int | None:
    """Which comparison in the chain this is: a baseline with no Skill is the first, one whose
    Skill revised nothing is the second, and a deeper chain is not counted rather than guessed."""
    if baseline_skill is None:
        return 1
    if baseline_skill.parent_skill_digest is None:
        return 2
    return None


def _comparison_label(generation: int | None) -> str:
    if generation == 1:
        return FIRST_RESULT_LABEL
    if generation == 2:
        return SECOND_RESULT_LABEL
    return LATER_RESULT_LABEL


def _change_label(
    generation: int | None, baseline_skill: SkillArtifact | None, candidate_skill: SkillArtifact
) -> str:
    if generation == 1:
        return FIRST_CHANGE_LABEL
    if generation == 2:
        return SECOND_CHANGE_LABEL
    assert baseline_skill is not None
    return f"{sanitize_label(baseline_skill.name)} → {sanitize_label(candidate_skill.name)}"


def _baseline_label(baseline_skill: SkillArtifact | None) -> str:
    return BASELINE_SKILL_LABEL if baseline_skill is None else baseline_skill.name


def _skill_summary(skill: SkillArtifact | None, label: str) -> SkillSummary:
    if skill is None:
        return SkillSummary(
            label=sanitize_label(label), root_digest=None, file_count=0, total_bytes=0
        )
    return SkillSummary(
        label=sanitize_label(label),
        root_digest=skill.root_digest,
        file_count=len(skill.files),
        total_bytes=sum(file.size for file in skill.files),
    )


def _task_rows(deltas: Sequence[TaskDelta]) -> list[TaskResultRow]:
    return [
        TaskResultRow(
            position=position,
            task_label=_task_label(position, delta.task_hash),
            baseline_score=delta.baseline_reward,
            candidate_score=delta.candidate_reward,
            delta=delta.delta,
            outcome=_outcome(delta),
        )
        for position, delta in enumerate(deltas)
    ]


def _task_label(position: int, task_hash: str) -> str:
    """A task by its place and the first cell of its hash, which the TasksetLock also commits to."""
    _, _, hexadecimal = task_hash.partition(":")
    return f"task {position + 1:02d} · {hexadecimal[:8]}"


def _outcome(delta: TaskDelta) -> TaskOutcome:
    if delta.candidate_reward > delta.baseline_reward:
        return "win"
    if delta.candidate_reward < delta.baseline_reward:
        return "loss"
    return "tie"


def _tasks_scored_full(rows: Sequence[TaskResultRow]) -> tuple[int | None, int | None]:
    """How many tasks each side got right, only when every score is exactly zero or full."""
    if not rows:
        return None, None
    scores = [(row.baseline_score, row.candidate_score) for row in rows]
    if any(value not in (0.0, _FULL_SCORE) for pair in scores for value in pair):
        return None, None
    return (
        sum(1 for baseline, _ in scores if baseline == _FULL_SCORE),
        sum(1 for _, candidate in scores if candidate == _FULL_SCORE),
    )


@dataclass(frozen=True)
class _Economics:
    """What a payload can honestly say about time and tokens, and from where."""

    source: EconomicsSource
    baseline_tokens: int | None
    candidate_tokens: int | None
    baseline_seconds: float | None
    candidate_seconds: float | None


def _economics(
    record: ComparisonExecutionRecord | None,
    baseline_receipts: Sequence[EpisodeReceiptV2],
    candidate_receipts: Sequence[EpisodeReceiptV2],
) -> _Economics:
    """The signed execution record when there is one; otherwise only what the receipts carry."""
    if record is not None:
        return _Economics(
            source="comparison_execution_record",
            baseline_tokens=record.baseline.usage.total_tokens,
            candidate_tokens=record.candidate.usage.total_tokens,
            baseline_seconds=record.baseline.elapsed_seconds,
            candidate_seconds=record.candidate.elapsed_seconds,
        )
    baseline_tokens = _tokens(baseline_receipts)
    candidate_tokens = _tokens(candidate_receipts)
    recorded = baseline_tokens is not None or candidate_tokens is not None
    return _Economics(
        source="episode_receipts" if recorded else "unavailable",
        baseline_tokens=baseline_tokens,
        candidate_tokens=candidate_tokens,
        baseline_seconds=None,
        candidate_seconds=None,
    )


def _derived_cost(
    campaign: CampaignSpecV2, record: ComparisonExecutionRecord | None
) -> DerivedCost | None:
    """Multiplication over the record's token counts and this release's prices, never written."""
    if record is None:
        return None
    usage = (record.baseline.usage, record.candidate.usage)
    input_tokens = _summed(usage, "input_tokens")
    output_tokens = _summed(usage, "output_tokens")
    if input_tokens is None or output_tokens is None:
        return None
    try:
        prices = price_profile_for(campaign.subject.model.model_id)
    except PrerequisiteError:
        return None
    cached = _summed(usage, "cached_input_tokens")
    return DerivedCost(
        usd=(input_tokens * prices.input_usd_per_mtok + output_tokens * prices.output_usd_per_mtok)
        / _TOKENS_PER_MILLION,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        # More cached input than input describes no cache this can price around.
        cached_input_tokens=None if cached is None or cached > input_tokens else cached,
        # The recorded profile quotes one rate per direction, the highest uncached one.
        prices_name_a_cached_rate=False,
        model_id=sanitize_label(prices.model_id),
        input_usd_per_mtok=prices.input_usd_per_mtok,
        output_usd_per_mtok=prices.output_usd_per_mtok,
        prices_recorded_on=sanitize_label(prices.recorded_on),
    )


def _summed(usage: tuple[VariantUsage, VariantUsage], field: str) -> int | None:
    total = 0
    for side in usage:
        recorded = getattr(side, field)
        if recorded is None:
            return None
        total += int(recorded)
    return total


def _tokens(receipts: Sequence[EpisodeReceiptV2]) -> int | None:
    """One side's token total when the receipts carry one as a metric; this build's do not."""
    totals: list[float] = []
    for receipt in receipts:
        for traces in receipt.named_traces.values():
            for trace in traces:
                recorded = trace.metrics.get("total_tokens")
                if recorded is None:
                    return None
                totals.append(recorded)
    return int(sum(totals)) if totals else None


def _verification_status(verification: VerificationResult | None) -> str:
    return VERIFICATION_NOT_VERIFIED if verification is None else VERIFICATION_VERIFIED


def _caveats(
    *,
    report: UpliftReportV2,
    campaign: CampaignSpecV2,
    economics: _Economics,
    recorded_evidence: RecordedEvidence | None,
    derived: DerivedCost | None,
) -> list[PresentationCaveat]:
    """What would invalidate the result first, then what bounds it, then the standing facts."""
    caveats: list[PresentationCaveat] = []
    if report.proof_grade == "development_only":
        caveats.append(
            PresentationCaveat(
                code="development_only_result",
                severity="error",
                text="This report is development-only. Its numbers are not evidence and it "
                "withholds a verdict.",
            )
        )
    if report.statuses.comparison is ComparisonStatus.CONTROLLED_WITH_WARNINGS:
        caveats.append(
            PresentationCaveat(
                code="comparison_controlled_with_warnings",
                severity="warning",
                text=_weak_attestation_text(campaign),
            )
        )
    if report.proof_grade == "P1":
        caveats.append(
            PresentationCaveat(
                code="local_participant_attestation",
                severity="warning",
                text=f"Proof grade P1 means {P1_MEANING}. Your own local key vouches for bytes "
                "that verify against each other — not for who ran them.",
            )
        )
    caveats.append(
        PresentationCaveat(
            code="no_independent_reproduction",
            severity="warning",
            text="Nobody has independently reproduced this comparison, and no platform "
            "witnessed it.",
        )
    )
    caveats.append(
        PresentationCaveat(
            code="introductory_task_family",
            severity="warning",
            text="This is a toy introductory Climb. Its task family is synthetic and "
            "demonstrates the mechanism; it measures no broad capability.",
        )
    )
    caveats.append(
        PresentationCaveat(
            code="no_server_upload",
            severity="info",
            text="The raw episodes stay on this machine. They are not in the proof directory "
            "and nothing sends them: publishing a run sends its proof and never its episodes, "
            "and nothing is published unless you publish this run yourself. Model inference "
            "was still sent to the model provider this run used, under that provider's "
            "policies.",
        )
    )
    caveats.append(
        PresentationCaveat(
            code="no_external_evidence_service",
            severity="info",
            text="No external evidence service is required, used, or contacted.",
        )
    )
    throttling = _throttling_caveat(recorded_evidence)
    if throttling is not None:
        caveats.append(throttling)
    caveats.append(_economics_caveat(economics, derived))
    if report.decision is UpliftDecision.REJECTED:
        caveats.append(
            PresentationCaveat(
                code="rejected_is_evidence",
                severity="info",
                text="A rejected candidate is a measurement, not a failed run: this Skill did "
                "not meet the threshold the Campaign declared in advance.",
            )
        )
    return caveats


def _weak_attestation_text(campaign: CampaignSpecV2) -> str:
    """Name the coordinate the run could not confirm, asking the same check the comparison used."""
    coordinates = {check.id for check in weaker_claim_warnings(campaign)}
    if coordinates == {MODEL_REVISION_UNDISCOVERABLE}:
        named = (
            "Your provider publishes no immutable build identifier for "
            f"{sanitize_label(campaign.subject.model.model_id)}, so both sides provably used "
            "the same model name but not provably the same model build."
        )
    else:
        named = (
            "At least one declared coordinate could not be confirmed from what the run "
            "observed, and this build has no plainer name for it."
        )
    return (
        "The comparison is controlled with warnings, which means one coordinate is attested "
        f"more weakly than the rest. {named} No mismatch was found; a mismatch would have made "
        "the comparison invalid."
    )


def _throttling_caveat(recorded_evidence: RecordedEvidence | None) -> PresentationCaveat | None:
    """An uneven refusal count is part of how much the comparison proves; an even one is a note."""
    if recorded_evidence is None:
        return None
    baseline = recorded_evidence.baseline.rate_limited_calls
    candidate = recorded_evidence.candidate.rate_limited_calls
    if baseline == candidate == 0:
        text = "The provider refused no model call on either side."
    else:
        text = (
            f"The provider refused {_calls(baseline)} with a rate limit on the baseline side "
            f"and {candidate:,} on the candidate side."
        )
    if recorded_evidence.every_rollout_completed:
        text = f"{text} Every rollout still ran to completion."
    return PresentationCaveat(
        code="provider_rate_limiting",
        severity="warning" if baseline != candidate else "info",
        text=text,
    )


def _cost_unavailable_reason(
    campaign: CampaignSpecV2, record: ComparisonExecutionRecord | None
) -> str:
    """Name whichever of the two things a cost needs this run is missing."""
    if record is None:
        return (
            "This run wrote no signed execution record, so there is no signed token total to "
            "work a cost out from."
        )
    model_id = campaign.subject.model.model_id
    try:
        price_profile_for(model_id)
    except PrerequisiteError:
        return (
            f"This release recorded no provider prices for {sanitize_label(model_id)}, so the "
            "tokens this run recorded cannot be turned into a cost."
        )
    return (
        "Neither side of this comparison reported how many tokens it used, and the provider "
        "reported no cost of its own."
    )


def _economics_caveat(economics: _Economics, derived: DerivedCost | None) -> PresentationCaveat:
    """Missing economics is a warning about what is unknown, never a finding about the result."""
    if economics.source == "comparison_execution_record":
        if derived is not None:
            return PresentationCaveat(
                code="cost_derived_while_rendering",
                severity="info",
                text="Timing and token counts come from this run's signed execution record. "
                "The provider reported no figure for what it charged, so the one shown was "
                "worked out from those token counts and the prices this release recorded. It "
                "was not written into anything this run signed, and what the comparison "
                "measured is unaffected.",
            )
        return PresentationCaveat(
            code="cost_unavailable",
            severity="warning",
            text="Timing and token counts come from this run's signed execution record. No "
            "cost was reported for it and none could be worked out from what it recorded. "
            "What the comparison measured is unaffected.",
        )
    if economics.source == "episode_receipts":
        return PresentationCaveat(
            code="operational_evidence_unavailable",
            severity="warning",
            text="This run has no signed execution record, so its timing and cost are "
            "unavailable; the token count shown comes from the receipts. What the comparison "
            "measured is unaffected.",
        )
    return PresentationCaveat(
        code="operational_evidence_unavailable",
        severity="warning",
        text="This run has no signed execution record, so how long it took, how many tokens "
        "it used and what it cost are all unavailable. What the comparison measured is "
        "unaffected.",
    )
