"""What one comparison cost to run: timing, tokens and outcome, beside the report.

Operational evidence, orthogonal to reward truth: nothing here feeds a score, a decision or
a comparison status, and a missing record leaves the measurement as it was. Usage is summed
from the engine's normalized per-trace usage, and traces that report none are counted rather
than read as zero, so a partial record is visible as partial. A side's cost is the sum of what
the provider reported for each of its model calls, counted from its raw traces by the rule the
spend stop uses, and is recorded as unavailable when any call carries no figure: nothing here
prices tokens. No wall clock is read here, so building the record twice from one run produces
identical bytes.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Final, Literal, Self

from pydantic import Field, model_validator
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.models.base import (
    Digest,
    NonEmptyString,
    ObjectEnvelope,
    ProtocolModel,
    UtcDateTime,
)
from regents_cli.techtree.models.campaign import ModelAccess, VariantSchedule
from regents_cli.techtree.models.experiment import ExperimentVariant
from regents_cli.techtree.runs.spend import reported_cost
from regents_cli.techtree.verifiers.models import (
    RealExecutionResult,
    VariantExecutionResult,
)

COMPARISON_EXECUTION_SCHEMA_VERSION: Final = "techtree.comparison-execution.v1alpha1"
COMPARISON_EXECUTION_RECORD_INVALID: Final = "comparison_execution_record_invalid"
OPERATIONAL_EVIDENCE_UNAVAILABLE: Final = "operational_evidence_unavailable"
EXECUTION_RECORD_FILENAME: Final = "comparison-execution.json"


class UsageProvenance(StrEnum):
    """Where token counts came from."""

    NORMALIZED_TRACES = "normalized_traces"
    UNAVAILABLE = "unavailable"


class PairOutcome(StrEnum):
    """How the pair of children ended."""

    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


class VariantCost(ProtocolModel):
    """One side's cost as Prime reported it, the plan it ran on, or the sentence saying why
    there is none."""

    provenance: Literal["provider_reported", "plan_included", "unavailable"]
    cost_usd: float | None = Field(default=None, ge=0.0)
    detail: NonEmptyString

    @model_validator(mode="after")
    def _check_a_figure_is_exactly_a_reported_one(self) -> Self:
        if (self.cost_usd is not None) != (self.provenance == "provider_reported"):
            raise ValueError(
                f"a cost figure is present exactly when the provider reported one; got "
                f"{self.cost_usd!r} as {self.provenance}"
            )
        return self


class VariantUsage(ProtocolModel):
    """What one side consumed, with the coverage that says how complete the count is."""

    provenance: UsageProvenance
    model_calls: int | None = Field(default=None, ge=0)
    input_tokens: int | None = Field(default=None, ge=0)
    cached_input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)
    total_tokens: int | None = Field(default=None, ge=0)
    traces_total: int = Field(ge=0)
    traces_with_usage: int = Field(ge=0)

    @model_validator(mode="after")
    def _check_the_counts_and_the_provenance_agree(self) -> Self:
        if self.traces_with_usage > self.traces_total:
            raise ValueError("a variant cannot have more traces reporting usage than traces")
        reported = self.provenance is UsageProvenance.NORMALIZED_TRACES
        if reported != (self.total_tokens is not None):
            raise ValueError(
                "token totals are present exactly when usage was reported; got "
                f"{self.total_tokens!r} as {self.provenance.value}"
            )
        if reported and self.traces_with_usage == 0:
            raise ValueError("usage cannot come from normalized traces when no trace reported any")
        return self


class VariantExecutionSummary(ProtocolModel):
    """Everything one side of the comparison did, operationally."""

    variant: ExperimentVariant
    started_at: UtcDateTime
    finished_at: UtcDateTime
    elapsed_seconds: float = Field(ge=0.0)
    exit_code: int
    cancelled: bool
    episode_count: int = Field(ge=0)
    max_concurrent: int = Field(ge=1)
    usage: VariantUsage
    cost: VariantCost
    experiment_manifest_digest: Digest
    argv_digest: Digest
    normalized_episodes_digest: Digest
    raw_traces_digest: Digest
    resolved_config_digest: Digest

    @model_validator(mode="after")
    def _check_the_clock_moves_forward(self) -> Self:
        if self.finished_at < self.started_at:
            raise ValueError("a variant cannot finish before it starts")
        return self


class ComparisonExecutionRecord(ProtocolModel):
    """One comparison's operational record."""

    schema_version: Literal["techtree.comparison-execution.v1alpha1"]
    run_id: NonEmptyString
    campaign_spec_digest: Digest
    engine_digest: Digest
    execution_backend: Literal["verifiers"]
    schedule: VariantSchedule
    started_at: UtcDateTime
    finished_at: UtcDateTime
    elapsed_seconds: float = Field(ge=0.0)
    launch_skew_seconds: float | None = Field(default=None, ge=0.0)
    first_launched: ExperimentVariant | None
    overlap_seconds: float = Field(ge=0.0)
    campaign_max_concurrent: int = Field(ge=1)
    outcome: PairOutcome
    baseline: VariantExecutionSummary
    candidate: VariantExecutionSummary

    @model_validator(mode="after")
    def _check_each_side_is_the_side_it_claims(self) -> Self:
        if self.baseline.variant is not ExperimentVariant.BASELINE:
            raise ValueError("the baseline slot holds the baseline variant")
        if self.candidate.variant is not ExperimentVariant.CANDIDATE:
            raise ValueError("the candidate slot holds the candidate variant")
        if (self.launch_skew_seconds is None) != (self.first_launched is None):
            raise ValueError(
                "a launch skew names which side went first, and a side that went first "
                "implies a skew"
            )
        return self

    def side(self, variant: ExperimentVariant) -> VariantExecutionSummary:
        return self.baseline if variant is ExperimentVariant.BASELINE else self.candidate


def build_comparison_execution_record(
    *,
    run_id: str,
    campaign_spec_digest: Digest,
    campaign_max_concurrent: int,
    access: ModelAccess,
    execution: RealExecutionResult,
    launch: tuple[float, ExperimentVariant] | None,
    concurrency: tuple[int, int],
    raw_traces: tuple[bytes, bytes],
) -> ComparisonExecutionRecord:
    """Assemble the record from what the run already recorded.

    `launch` is the skew and first-launched side the scheduler observed (see
    `read_children_record`), or None when the schedule recorded none. `concurrency` is the
    (baseline, candidate) permit split the scheduler ran under, and `raw_traces` the (baseline,
    candidate) bytes of each side's raw traces, which carry the provider's cost for every call.
    """
    baseline_permits, candidate_permits = concurrency
    baseline_traces, candidate_traces = raw_traces
    baseline = _summary(
        execution.baseline, max_concurrent=baseline_permits, traces=baseline_traces, access=access
    )
    candidate = _summary(
        execution.candidate,
        max_concurrent=candidate_permits,
        traces=candidate_traces,
        access=access,
    )
    started_at = min(baseline.started_at, candidate.started_at)
    finished_at = max(baseline.finished_at, candidate.finished_at)
    return ComparisonExecutionRecord(
        schema_version=COMPARISON_EXECUTION_SCHEMA_VERSION,
        run_id=run_id,
        campaign_spec_digest=campaign_spec_digest,
        engine_digest=execution.engine_digest,
        execution_backend=execution.execution_backend,
        schedule=execution.schedule,
        started_at=started_at,
        finished_at=finished_at,
        elapsed_seconds=_seconds(started_at, finished_at),
        launch_skew_seconds=None if launch is None else launch[0],
        first_launched=None if launch is None else launch[1],
        overlap_seconds=_overlap(baseline, candidate),
        campaign_max_concurrent=campaign_max_concurrent,
        outcome=_outcome(baseline, candidate),
        baseline=baseline,
        candidate=candidate,
    )


def read_execution_record(bundle_dir: Path) -> ComparisonExecutionRecord | None:
    """The record a proof bundle carries, or None; the verifier is what checks it."""
    path = bundle_dir / EXECUTION_RECORD_FILENAME
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    try:
        envelope = ObjectEnvelope[ComparisonExecutionRecord].model_validate_json(raw)
    except PydanticValidationError:
        return None
    return envelope.payload


def read_children_record(path: Path) -> tuple[float, ExperimentVariant] | None:
    """The launch skew and first-launched side the scheduler wrote, if it wrote them.

    Only the scheduler can observe these, at the moment the children start; a run without
    the file reports none rather than reconstructing one from timestamps taken for something
    else.
    """
    try:
        document = json.loads(path.read_bytes())
    except (OSError, ValueError):
        return None
    if not isinstance(document, dict):
        return None
    skew = document.get("launch_skew_seconds")
    if not isinstance(skew, int | float) or isinstance(skew, bool) or skew < 0:
        return None
    started = [
        (row.get("started_at"), row.get("variant"))
        for row in document.get("children", [])
        if isinstance(row, dict)
    ]
    first = _first_launched(started)
    if first is None:
        return None
    return float(skew), first


def _summary(
    result: VariantExecutionResult, *, max_concurrent: int, traces: bytes, access: ModelAccess
) -> VariantExecutionSummary:
    outcome = result.child_outcome
    return VariantExecutionSummary(
        variant=ExperimentVariant(result.variant.value),
        started_at=outcome.started_at,
        finished_at=outcome.finished_at,
        elapsed_seconds=_seconds(outcome.started_at, outcome.finished_at),
        exit_code=outcome.exit_code,
        cancelled=outcome.cancelled,
        episode_count=len(result.episodes),
        max_concurrent=max_concurrent,
        usage=_usage(result),
        cost=_cost(traces, access),
        experiment_manifest_digest=result.experiment_manifest_digest,
        argv_digest=outcome.argv_digest,
        normalized_episodes_digest=result.normalized_episodes.digest,
        raw_traces_digest=result.raw_traces.digest,
        resolved_config_digest=result.resolved_verifiers_config.digest,
    )


def _cost(traces: bytes, access: ModelAccess) -> VariantCost:
    """Prime's figures summed over every model call, or unavailable when any has none; on the
    ChatGPT plan, the plan, which reports tokens and no dollar figure."""
    if access == "chatgpt_plan":
        return VariantCost(
            provenance="plan_included",
            detail="this side ran on the person's ChatGPT plan, which counts tokens and gives "
            "no dollar figure",
        )
    cost_usd = reported_cost(traces)
    if cost_usd is None:
        return VariantCost(
            provenance="unavailable",
            detail="Prime did not report what at least one of this side's model calls "
            "cost, so its total is unknown",
        )
    return VariantCost(
        provenance="provider_reported",
        cost_usd=cost_usd,
        detail="the sum of what Prime reported for every model call this side made",
    )


def _usage(result: VariantExecutionResult) -> VariantUsage:
    """Model calls are known from every trace; tokens only from the traces that report them."""
    traces_total = 0
    traces_with_usage = 0
    model_calls = 0
    totals = {"input": 0, "cached": 0, "output": 0, "total": 0}
    for episode in result.episodes:
        for trace in episode.traces:
            traces_total += 1
            model_calls += trace.model_calls
            usage = trace.usage
            if usage is None:
                continue
            traces_with_usage += 1
            totals["input"] += usage.input_tokens
            totals["cached"] += usage.cached_input_tokens or 0
            totals["output"] += usage.output_tokens
            totals["total"] += usage.total_tokens
    counted = None if traces_total == 0 else model_calls
    if traces_with_usage == 0:
        return VariantUsage(
            provenance=UsageProvenance.UNAVAILABLE,
            model_calls=counted,
            traces_total=traces_total,
            traces_with_usage=0,
        )
    return VariantUsage(
        provenance=UsageProvenance.NORMALIZED_TRACES,
        model_calls=counted,
        input_tokens=totals["input"],
        cached_input_tokens=totals["cached"],
        output_tokens=totals["output"],
        total_tokens=totals["total"],
        traces_total=traces_total,
        traces_with_usage=traces_with_usage,
    )


def _overlap(baseline: VariantExecutionSummary, candidate: VariantExecutionSummary) -> float:
    start = max(baseline.started_at, candidate.started_at)
    finish = min(baseline.finished_at, candidate.finished_at)
    return _seconds(start, finish) if finish > start else 0.0


def _outcome(baseline: VariantExecutionSummary, candidate: VariantExecutionSummary) -> PairOutcome:
    if baseline.cancelled or candidate.cancelled:
        return PairOutcome.CANCELLED
    if baseline.exit_code != 0 or candidate.exit_code != 0:
        return PairOutcome.FAILED
    return PairOutcome.COMPLETED


def _first_launched(started: Sequence[tuple[object, object]]) -> ExperimentVariant | None:
    parsed: list[tuple[datetime, ExperimentVariant]] = []
    for stamp, variant in started:
        if not isinstance(stamp, str) or not isinstance(variant, str):
            return None
        try:
            when = datetime.fromisoformat(stamp)
            side = ExperimentVariant(variant)
        except ValueError:
            return None
        parsed.append((when, side))
    if len(parsed) != 2:
        return None
    return min(parsed, key=lambda item: item[0])[1]


def _seconds(start: datetime, finish: datetime) -> float:
    return max(0.0, (finish - start).total_seconds())
