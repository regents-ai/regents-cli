"""How far one variant has got, read from the file the engine is already writing.

`traces.jsonl` is append-only and every record ends with a newline, so counting complete
records is an exact read-only measurement, provided an unterminated final line is ignored and
the file is never "repaired". Line position is never task position: records land in
completion order, and pairing happens later by task hash.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Final, Literal

from regents_cli.techtree.models.run import VariantProgress
from regents_cli.techtree.verifiers.child import CANCELLATION_EXIT_CODE
from regents_cli.techtree.verifiers.models import VariantName

_READ_CHUNK_BYTES: Final = 1 << 20

type _VariantLiteral = Literal["baseline", "candidate"]
type _StateLiteral = Literal["pending", "running", "completed", "failed", "cancelled"]

_VARIANT_LITERALS: Final[dict[VariantName, _VariantLiteral]] = {
    VariantName.BASELINE: "baseline",
    VariantName.CANDIDATE: "candidate",
}


def count_complete_jsonl_records(path: Path) -> int:
    """The whole, valid JSON object records in an append-only JSONL file; a missing file is 0."""
    try:
        handle = path.open("rb")
    except OSError:
        return 0
    complete = 0
    remainder = b""
    with handle:
        while chunk := handle.read(_READ_CHUNK_BYTES):
            remainder += chunk
            *lines, remainder = remainder.split(b"\n")
            complete += sum(1 for line in lines if _is_complete_record(line))
    return complete


def _is_complete_record(line: bytes) -> bool:
    if not line.strip():
        return False
    try:
        return isinstance(json.loads(line), dict)
    except (ValueError, UnicodeDecodeError):
        return False


def pending_progress(variant: VariantName, total: int) -> VariantProgress:
    return VariantProgress(
        variant=_VARIANT_LITERALS[variant],
        completed=0,
        total=total,
        running=0,
        errored=0,
        state="pending",
    )


def inspect_progress(
    *,
    variant: VariantName,
    traces_path: Path,
    total: int,
    child_exit_code: int | None,
    max_concurrent: int = 1,
) -> VariantProgress:
    """Measure one variant without interpreting any reward; `errored` stays zero here because
    whether an episode is usable is settled later against the normalized projection."""
    completed = min(count_complete_jsonl_records(traces_path), total)
    remaining = max(total - completed, 0)

    state: _StateLiteral
    if child_exit_code is None:
        state = "running" if traces_path.exists() else "pending"
        running = min(remaining, max(max_concurrent, 0))
    elif child_exit_code == CANCELLATION_EXIT_CODE:
        state, running = "cancelled", 0
    elif child_exit_code == 0 and remaining == 0:
        state, running = "completed", 0
    else:
        state, running = "failed", 0

    return VariantProgress(
        variant=_VARIANT_LITERALS[variant],
        completed=completed,
        total=total,
        running=running,
        errored=0,
        state=state,
    )
