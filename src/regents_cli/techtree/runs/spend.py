"""What a run has spent so far, added up from the costs the provider reports.

Each finished task appends one record to its variant's `traces.jsonl`. Every model call in a
record carries either the provider's `usage.cost` for that call or the error that ended it, and
a call that ended in an error has no usage to bill. The meter reads only the lines added since
its last reading, so watching a run costs about one read of its traces. A task still under way
is counted once it finishes. A finished run's execution record sums the same figures with the
same rule (`reported_cost`), so what stopped a run and what its result shows never disagree.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable, Iterable, Iterator, Mapping
from pathlib import Path
from typing import Final

from regents_cli.techtree.errors import RunError

RUN_SPEND_UNREPORTED: Final = "run_spend_unreported"
RUN_SPEND_LIMIT_REACHED: Final = "run_spend_limit_reached"

_READ_CHUNK_BYTES: Final = 1 << 20


class SpendMeter:
    """The provider-reported cost of every finished task in the given trace files."""

    def __init__(self, traces_paths: Iterable[Path]) -> None:
        self._offsets = dict.fromkeys(traces_paths, 0)
        self._spent_usd = 0.0

    def read(self) -> float:
        """The total so far, after counting every record finished since the last reading."""
        for path, offset in self._offsets.items():
            self._offsets[path] = self._count_from(path, offset)
        return self._spent_usd

    def _count_from(self, path: Path, offset: int) -> int:
        try:
            handle = path.open("rb")
        except FileNotFoundError:
            return offset
        with handle:
            handle.seek(offset)
            pending = b""
            while chunk := handle.read(_READ_CHUNK_BYTES):
                pending += chunk
                *lines, pending = pending.split(b"\n")
                for line in lines:
                    offset += len(line) + 1
                    if line.strip():
                        self._spent_usd += record_cost(json.loads(line), source=path)
        return offset


def spend_guard(
    run_id: str, traces_paths: Iterable[Path], maximum_usd: float
) -> Callable[[], None]:
    """A check, called on every poll of a run on the person's own Prime key, that stops the run
    once what Prime reported for its finished tasks reaches the Campaign's maximum."""
    meter = SpendMeter(traces_paths)

    def guard() -> None:
        spent_usd = meter.read()
        if spent_usd < maximum_usd:
            return
        raise RunError(
            f"this run's model calls cost ${spent_usd:.2f}, as Prime reported them, which "
            f"reached the ${maximum_usd:.2f} maximum its Campaign declares, so Techtree stopped "
            "both sides; a stopped run has no score, and the partial evidence was kept",
            code=RUN_SPEND_LIMIT_REACHED,
            details={"run_id": run_id, "spent_usd": spent_usd, "maximum_usd": maximum_usd},
        )

    return guard


def record_cost(record: Mapping[str, object], *, source: Path) -> float:
    """What the provider reported for every model call in one finished task."""
    total = 0.0
    for model, cost in _call_costs(record):
        if cost is None:
            raise RunError(
                "the provider did not report what one of this run's model calls cost, so "
                "its spend cannot be added up against the Campaign's maximum; Techtree "
                "stopped the run",
                code=RUN_SPEND_UNREPORTED,
                details={"traces": str(source), "model": model},
            )
        total += cost
    return total


def reported_cost(traces: bytes) -> float | None:
    """What the provider reported for every model call in one side's traces, or None when any
    call carries no figure."""
    costs: list[float] = []
    for line in traces.splitlines():
        if not line.strip():
            continue
        for _, cost in _call_costs(json.loads(line)):
            if cost is None:
                return None
            costs.append(cost)
    return math.fsum(costs)


def _call_costs(record: Mapping[str, object]) -> Iterator[tuple[str, float | None]]:
    """Each billed call's model and reported cost; a call that ended in an error bills nothing."""
    for trace in _mappings(record.get("traces")):
        for call in _mappings(trace.get("calls")):
            usage = call.get("usage")
            if usage is None and call.get("error") is not None:
                continue
            cost = usage.get("cost") if isinstance(usage, Mapping) else None
            yield str(call.get("model")), float(cost) if isinstance(cost, int | float) else None


def _mappings(value: object) -> list[Mapping[str, object]]:
    return [item for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []
