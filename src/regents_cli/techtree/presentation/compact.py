"""The one rendering: compact Markdown a terminal, a gateway or a phone can carry.

Bounded by construction: a headline, the counts, the qualifications, at most a few changed
task rows, and one line about what could happen next. Room is made by cutting the table, never
by cutting a caveat, and the proof grade travels in the same block as the scores.
"""

from __future__ import annotations

from typing import Final

from regents_cli.techtree.presentation.build import (
    HELD_FIXED_LINE,
    NOT_BROAD_CAPABILITY_LINE,
    VERIFICATION_NOT_VERIFIED,
    VERIFICATION_VERIFIED,
    cost_explanation,
    cost_summary,
    decision_headline,
    efficiency_sentence,
    solved_line,
    task_count_line,
)
from regents_cli.techtree.presentation.models import UpliftPresentationPayload, changed_task_rows

#: Enough rows to show a pattern, few enough to read on a phone.
DEFAULT_MAXIMUM_TASK_ROWS: Final = 5

_VERIFICATION_PHRASE: Final[dict[str, str]] = {
    VERIFICATION_VERIFIED: "signature verified offline",
    VERIFICATION_NOT_VERIFIED: "no proof to check",
}


def render_uplift_markdown(
    payload: UpliftPresentationPayload, *, maximum_task_rows: int = DEFAULT_MAXIMUM_TASK_ROWS
) -> str:
    """Compact Markdown: headline, counts, proof, cost, the changed rows, one next line."""
    lines = [
        f"**{decision_headline(payload)} — {solved_line(payload)}**",
        "",
        f"- {NOT_BROAD_CAPABILITY_LINE}",
        f"- {payload.campaign_title} — {payload.comparison_label}",
        f"- Changed: {payload.change_label}. {HELD_FIXED_LINE}",
        f"- Tasks: {_headline_numbers(payload)}",
        f"- Proof: local {payload.proof_grade}, "
        f"{_VERIFICATION_PHRASE[payload.verification_status]}",
        f"- Cost: {cost_summary(payload)}",
        *(f"- {line}" for line in cost_explanation(payload)),
        *_work(payload),
        "- Raw episodes: retained locally; not uploaded",
    ]
    lines += _table(payload, maximum_task_rows)
    qualifications = [caveat for caveat in payload.caveats if caveat.severity != "info"]
    if qualifications:
        lines.append("")
        lines.extend(f"- {caveat.text}" for caveat in qualifications)
    lines.append("")
    lines.append(_next_line(payload))
    return "\n".join(lines)


def _headline_numbers(payload: UpliftPresentationPayload) -> str:
    means = (
        f"{payload.baseline_score:.3f} → {payload.candidate_score:.3f} "
        f"({payload.absolute_delta:+.3f})"
    )
    counted = task_count_line(payload)
    if counted is None:
        return f"mean {means}"
    return f"{counted}, mean {means}"


def _work(payload: UpliftPresentationPayload) -> list[str]:
    sentence = efficiency_sentence(payload)
    if sentence is not None:
        return [f"- Work: {sentence}"]
    return [f"- Time: {_time(payload)}"]


def _time(payload: UpliftPresentationPayload) -> str:
    baseline = payload.baseline_seconds
    candidate = payload.candidate_seconds
    if baseline is None and candidate is None:
        return "not recorded for this run"
    return f"baseline {_seconds(baseline)}, candidate {_seconds(candidate)}"


def _seconds(value: float | None) -> str:
    return "unavailable" if value is None else f"{value:.1f}s"


def _next_line(payload: UpliftPresentationPayload) -> str:
    """A development-only result has no proof to check, so it is offered nothing but the table."""
    if payload.proof_grade == "development_only":
        return "Next: every task is in this answer's `presentation.task_rows`."
    return (
        "Next: every task is in this answer's `presentation.task_rows`; check this run's local "
        "proof offline with `regents techtree proof verify`."
    )


def _table(payload: UpliftPresentationPayload, maximum_task_rows: int) -> list[str]:
    """The changed rows under a heading that says when some were left out; none means no heading."""
    selected = changed_task_rows(payload.task_rows)
    shown = selected[:maximum_task_rows]
    if not shown:
        return []
    if len(shown) < len(selected):
        heading = f"Changed tasks ({len(shown)} of {len(selected)} shown):"
    else:
        heading = f"Changed tasks ({len(selected)} of {len(payload.task_rows)} tasks):"
    return [
        "",
        heading,
        *(
            f"- {row.task_label}: {row.baseline_score:.2f} → {row.candidate_score:.2f} "
            f"({row.outcome.upper()})"
            for row in shown
        ),
    ]
