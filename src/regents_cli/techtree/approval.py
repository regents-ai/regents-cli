"""The one way a Techtree command gets a person's agreement before it spends, sends or signs.

With `--yes` the command goes ahead, and `--reviewed-on` records where the person answered.
A person at a terminal is shown the review and asked, with no as the default. Anyone else —
an agent, a pipe, `--json` — gets `approval_required`: the review, and the exact command that
goes ahead once a person has agreed in the conversation. Nothing ever waits on a prompt that
nobody can see.
"""

from __future__ import annotations

import shlex
import sys
from collections.abc import Sequence
from typing import Literal

import click

from regents_cli import output
from regents_cli.errors import CommandError
from regents_cli.techtree.errors import TechtreeError, UsageError

type ReviewedOn = Literal["cli", "host-agent"]

YES = click.Option(
    ["--yes"],
    is_flag=True,
    help="Go ahead without asking: a person has already agreed to what the review shows.",
)
REVIEWED_ON = click.Option(
    ["--reviewed-on"],
    type=click.Choice(["cli", "host-agent"]),
    default="cli",
    show_default=True,
    help="Where the person agreed. host-agent: the review was shown and agreed in a "
    "conversation. Goes with --yes.",
)


class ApprovalRequiredError(CommandError):
    """Nobody here can be asked; the error carries `review` and `approval.command`.

    `approval.command` is shell text, quoted with `shlex.join`, so `shlex.split` gives back
    the exact arguments.
    """

    def __init__(self, message: str, *, review: Sequence[str], command: str) -> None:
        super().__init__(
            "approval_required", message, review=list(review), approval={"command": command}
        )


class NotApprovedError(TechtreeError):
    """The person was asked and did not say yes."""

    default_code = "not_approved"


def approve(
    *,
    yes: bool,
    reviewed_on: ReviewedOn,
    as_json: bool,
    review: Sequence[str],
    command: Sequence[str],
    question: str,
    why: str,
) -> ReviewedOn:
    """Return where the agreement was given, or raise without doing anything.

    `command` is the `regents techtree …` argument list that was run, less `--yes`,
    `--reviewed-on` and `--json`; `why` says what needs agreeing to.
    """
    if not yes:
        if reviewed_on != "cli":
            raise UsageError(
                "--reviewed-on says where an agreement was already given, so it goes with --yes."
            )
        if as_json or not (sys.stdin.isatty() and sys.stdout.isatty()):
            raise ApprovalRequiredError(
                f"{why} Show the person the review; once they agree, run approval.command.",
                review=review,
                command=shlex.join(
                    ["regents", "techtree", *command, "--yes", "--reviewed-on", "host-agent"]
                ),
            )
        for line in review:
            output.stdout.print(line, markup=False)
        if not asked(question):
            raise NotApprovedError("Nothing was done: the answer was not yes.")
    return reviewed_on


def asked(question: str) -> bool:
    """Ask a person a yes-or-no question; anything but an explicit yes is no."""
    try:
        return click.confirm(question, default=False)
    except click.Abort:
        return False
