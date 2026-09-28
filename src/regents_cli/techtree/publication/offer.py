"""The offer to publish, written once for every surface that makes it."""

from __future__ import annotations

import shlex
from typing import Final

#: A publication whose answer was lost may already have been accepted, so "did that work?" is
#: answered from the log and the journal rather than by sending the proof again.
RECONCILE_FIRST: Final = "reconcile_first"


def publication_offer(run_id: str) -> dict[str, str]:
    """The command that would publish one verified run, and why it is worth offering."""
    return {
        "command": shlex.join(["regents", "techtree", "publish", run_id]),
        "reason": "The proof just verified, so the run's own evidence travels with it. It shows "
        "what would be sent and asks before sending anything.",
        "retry": RECONCILE_FIRST,
    }
