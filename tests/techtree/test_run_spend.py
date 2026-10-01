"""A run's spend is added up from exactly what the provider reported, as tasks finish.

The costly failures: the total a run is stopped at reads low, so the run keeps spending past the
maximum its Campaign declares, or a call whose cost the provider left out is counted as free,
either while the run is under way or in the cost its finished result shows.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from regents_cli.techtree.errors import RunError
from regents_cli.techtree.runs.spend import RUN_SPEND_UNREPORTED, SpendMeter, reported_cost


def _task(*calls: dict[str, object]) -> bytes:
    return json.dumps({"traces": [{"calls": list(calls)}]}).encode() + b"\n"


def _billed(cost: float) -> dict[str, object]:
    return {"model": "openai/gpt-6-luna", "usage": {"cost": cost, "prompt_tokens": 10}}


def test_spend_counts_each_finished_task_once_across_both_sides(tmp_path: Path) -> None:
    """Records are counted as they land, never twice; a half-written line waits for its end,
    and a call that ended in a provider error, which carries no usage, adds nothing."""
    baseline, candidate = tmp_path / "baseline.jsonl", tmp_path / "candidate.jsonl"
    meter = SpendMeter([baseline, candidate])
    assert meter.read() == 0.0

    baseline.write_bytes(_task(_billed(0.25), {"model": "m", "error": {"type": "ProviderError"}}))
    second = _task(_billed(0.5), _billed(0.125))
    candidate.write_bytes(second[:10])
    assert meter.read() == pytest.approx(0.25)

    with candidate.open("ab") as handle:
        handle.write(second[10:])
    assert meter.read() == pytest.approx(0.875)
    assert meter.read() == pytest.approx(0.875)


def test_a_call_the_provider_reported_no_cost_for_stops_the_count(tmp_path: Path) -> None:
    traces = tmp_path / "traces.jsonl"
    traces.write_bytes(_task(_billed(0.1), {"model": "m", "usage": {"prompt_tokens": 10}}))

    with pytest.raises(RunError) as caught:
        SpendMeter([traces]).read()

    assert caught.value.code == RUN_SPEND_UNREPORTED


def test_a_finished_side_shows_its_reported_total_or_none_when_a_call_has_no_cost() -> None:
    error: dict[str, object] = {"model": "m", "error": {"type": "ProviderError"}}
    assert reported_cost(_task(_billed(0.25), error) + _task(_billed(0.5))) == pytest.approx(0.75)
    assert (
        reported_cost(_task(_billed(0.25), {"model": "m", "usage": {"prompt_tokens": 1}})) is None
    )
