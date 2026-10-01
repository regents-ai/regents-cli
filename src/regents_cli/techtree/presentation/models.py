"""The channel-neutral shape of a result: derived from the signed report, frozen, nothing hidden.

Every score, status and digest here is copied out of a signed UpliftReport; nothing downstream
is given the chance to compute one. The models are frozen so two renderings of one report
cannot disagree, and `ensure_no_hidden_task_material` checks the free text they still allow.
"""

from __future__ import annotations

from typing import Final, Literal, Self

from pydantic import Field, model_validator

from regents_cli.techtree.models.base import Digest, NonEmptyString, ProtocolModel

#: A presentation payload is a view, not a protocol object, so its version lives here.
PRESENTATION_SCHEMA_VERSION: Final = "techtree.presentation.uplift.v1"

type TaskOutcome = Literal["win", "loss", "tie"]

#: Where the timing and token counts on a payload came from, if anywhere.
type EconomicsSource = Literal["comparison_execution_record", "episode_receipts", "unavailable"]


class TaskResultRow(ProtocolModel):
    """What one committed task contributed to the comparison."""

    position: int = Field(ge=0)
    task_label: NonEmptyString
    baseline_score: float
    candidate_score: float
    delta: float
    outcome: TaskOutcome


#: Losses first, then wins, then ties. Within a group, committed task order.
_OUTCOME_RANK: Final[dict[str, int]] = {"loss": 0, "win": 1, "tie": 2}


def changed_task_rows(rows: list[TaskResultRow]) -> list[TaskResultRow]:
    """The rows that moved, worst first; selecting rows never changes a count."""
    chosen = [row for row in rows if row.outcome != "tie"]
    return sorted(chosen, key=lambda row: (_OUTCOME_RANK[row.outcome], row.position))


class SkillSummary(ProtocolModel):
    """One side's Skill by size and content address; a baseline with no Skill has no digest."""

    label: NonEmptyString
    root_digest: Digest | None
    file_count: int = Field(ge=0)
    total_bytes: int = Field(ge=0)


class PresentationCaveat(ProtocolModel):
    """One thing a reader must know before believing what they just read."""

    code: NonEmptyString
    severity: Literal["info", "warning", "error"]
    text: NonEmptyString


class UpliftPresentationPayload(ProtocolModel):
    """One comparison, ready to be shown anywhere.

    `comparison_label` names which result in the chain this is; `change_label` names the one
    thing that differed between the two sides.
    """

    schema_version: Literal["techtree.presentation.uplift.v1"]
    run_id: NonEmptyString
    campaign_title: NonEmptyString
    comparison_label: NonEmptyString
    change_label: NonEmptyString
    baseline_skill: SkillSummary
    candidate_skill: SkillSummary
    baseline_score: float
    candidate_score: float
    absolute_delta: float
    relative_delta: float | None
    wins: int = Field(ge=0)
    losses: int = Field(ge=0)
    ties: int = Field(ge=0)
    task_rows: list[TaskResultRow]
    baseline_tasks_scored_full: int | None
    candidate_tasks_scored_full: int | None
    baseline_tokens: int | None
    candidate_tokens: int | None
    baseline_seconds: float | None
    candidate_seconds: float | None
    baseline_model_turns: int | None
    candidate_model_turns: int | None
    baseline_rate_limited_calls: int | None
    candidate_rate_limited_calls: int | None
    every_rollout_completed: bool | None
    economics_source: EconomicsSource
    cost_usd: float | None = Field(default=None, ge=0.0)
    cost_provenance: Literal["provider_reported", "unavailable"]
    cost_unavailable_reason: NonEmptyString | None = None
    decision: NonEmptyString
    proof_grade: NonEmptyString
    verification_status: NonEmptyString
    caveats: list[PresentationCaveat]

    @model_validator(mode="after")
    def _check_the_rows_and_the_counts_describe_one_comparison(self) -> Self:
        outcomes = [row.outcome for row in self.task_rows]
        counts: tuple[tuple[TaskOutcome, int], ...] = (
            ("win", self.wins),
            ("loss", self.losses),
            ("tie", self.ties),
        )
        for outcome, count in counts:
            if outcomes.count(outcome) != count:
                raise ValueError(
                    f"the payload reports {count} {outcome} rows and carries "
                    f"{outcomes.count(outcome)}"
                )
        positions = [row.position for row in self.task_rows]
        if positions != sorted(positions) or len(set(positions)) != len(positions):
            raise ValueError("task rows are carried in committed task order, each position once")
        return self

    @model_validator(mode="after")
    def _check_a_missing_cost_says_what_is_missing(self) -> Self:
        reported = self.cost_provenance == "provider_reported"
        if (self.cost_usd is not None) != reported:
            raise ValueError("a cost figure is present exactly when the provider reported one")
        if reported == (self.cost_unavailable_reason is not None):
            raise ValueError(
                "a payload with no cost figure says what is missing, and one with a figure "
                "has nothing to explain away"
            )
        if reported and self.economics_source != "comparison_execution_record":
            raise ValueError("a cost is read from the signed execution record and nothing else")
        return self

    @model_validator(mode="after")
    def _check_the_counts_read_from_the_run_arrive_together(self) -> Self:
        read = (
            self.baseline_model_turns,
            self.candidate_model_turns,
            self.baseline_rate_limited_calls,
            self.candidate_rate_limited_calls,
            self.every_rollout_completed,
        )
        if None in read and any(value is not None for value in read):
            raise ValueError(
                "the counts read from a run's recorded traces are all present or all absent; "
                f"got {read}"
            )
        return self

    @model_validator(mode="after")
    def _check_the_task_counts_fit_the_table(self) -> Self:
        baseline = self.baseline_tasks_scored_full
        candidate = self.candidate_tasks_scored_full
        if baseline is None or candidate is None:
            if baseline is not candidate:
                raise ValueError(
                    f"both sides carry a task count or neither does; got {(baseline, candidate)}"
                )
            return self
        for count in (baseline, candidate):
            if not 0 <= count <= len(self.task_rows):
                raise ValueError(
                    f"a side scored between 0 and {len(self.task_rows)} of the comparison's "
                    f"tasks; got {count}"
                )
        return self
