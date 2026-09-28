"""Approval never waits on a prompt nobody can see, and never invents an agreement.

The costly failures: an agent hangs forever on a hidden prompt, or a command goes ahead that a
person never agreed to.
"""

from __future__ import annotations

import pytest

from regents_cli.techtree.approval import ApprovalRequiredError, approve
from regents_cli.techtree.errors import UsageError

REVIEW = ["Sends run_x's proof to techtree.sh."]
COMMAND = ["publish", "run_x"]


def test_nobody_to_ask_never_prompts_and_returns_the_command_to_approve() -> None:
    with pytest.raises(ApprovalRequiredError) as refused:
        approve(
            yes=False,
            reviewed_on="cli",
            as_json=False,
            review=REVIEW,
            command=COMMAND,
            question="Publish?",
            why="Publishing needs a person's agreement.",
        )
    error = refused.value.as_json()["error"]
    assert error["review"] == REVIEW
    assert error["approval"]["command"] == (
        "regents techtree publish run_x --yes --reviewed-on host-agent"
    )


def test_a_review_surface_without_yes_is_refused() -> None:
    with pytest.raises(UsageError):
        approve(
            yes=False,
            reviewed_on="host-agent",
            as_json=True,
            review=REVIEW,
            command=COMMAND,
            question="Publish?",
            why="Publishing needs a person's agreement.",
        )
