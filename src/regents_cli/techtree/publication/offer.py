"""The offer to publish, written once for every surface that makes it."""

from __future__ import annotations

from typing import Final

from regents_cli.next_steps import Step, run

#: A publication whose answer was lost may already have been accepted, so "did that work?" is
#: answered from the log and the journal rather than by sending the proof again.
RECONCILE_FIRST: Final = "reconcile_first"


def publication_step(run_id: str) -> Step:
    """The step that would publish one verified run, and why it is worth taking."""
    return run(
        ["regents", "techtree", "publish", run_id],
        "Publish it, if you want it in the public log: the proof just verified, so the run's "
        "own evidence travels with it. It shows what would be sent and asks before sending.",
    )
