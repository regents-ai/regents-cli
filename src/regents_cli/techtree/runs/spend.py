"""What a run has spent so far, added up from the costs the provider reports.

Each finished task appends one record to its variant's `traces.jsonl`. Every model call in a
record carries either the provider's `usage.cost` for that call or the error that ended it, and
a call that ended in an error has no usage to bill. The meter reads only the lines added since
its last reading, so watching a run costs about one read of its traces. A task still under way
is counted once it finishes.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Final

from regents_cli.techtree.errors import RunError

RUN_SPEND_UNREPORTED: Final = "run_spend_unreported"

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


def record_cost(record: Mapping[str, object], *, source: Path) -> float:
    """What the provider reported for every model call in one finished task."""
    total = 0.0
    for trace in _mappings(record.get("traces")):
        for call in _mappings(trace.get("calls")):
            usage = call.get("usage")
            if usage is None and call.get("error") is not None:
                continue
            cost = usage.get("cost") if isinstance(usage, Mapping) else None
            if not isinstance(cost, int | float):
                raise RunError(
                    "the provider did not report what one of this run's model calls cost, so "
                    "its spend cannot be added up against the Campaign's maximum; Techtree "
                    "stopped the run",
                    code=RUN_SPEND_UNREPORTED,
                    details={"traces": str(source), "model": str(call.get("model"))},
                )
            total += float(cost)
    return total


def _mappings(value: object) -> list[Mapping[str, object]]:
    return [item for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []
