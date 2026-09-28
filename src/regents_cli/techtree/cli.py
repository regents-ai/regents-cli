"""The `regents techtree` group."""

from __future__ import annotations

import click

from regents_cli.techtree.commands.proof import PROOF
from regents_cli.techtree.commands.publish import PUBLISH
from regents_cli.techtree.commands.release import RELEASE
from regents_cli.techtree.commands.withdraw import WITHDRAW


def techtree_group() -> click.Group:
    group = click.Group(
        "techtree",
        help="Run Climbs, build and compare tasks from a Skill, and verify and publish proofs. "
        "State lives in ~/.regents/techtree.",
        no_args_is_help=True,
    )
    for command in (PUBLISH, WITHDRAW, PROOF, RELEASE):
        group.add_command(command)
    return group
