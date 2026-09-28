"""The `regents techtree` group."""

from __future__ import annotations

import click

from regents_cli.techtree.commands.climb import CLIMB
from regents_cli.techtree.commands.doctor import DOCTOR
from regents_cli.techtree.commands.engine import ENGINE
from regents_cli.techtree.commands.internal import SUPERVISE, WORKER
from regents_cli.techtree.commands.run import RUN
from regents_cli.techtree.commands.setup import SETUP
from regents_cli.techtree.commands.skill import SKILL


def techtree_group() -> click.Group:
    group = click.Group(
        "techtree",
        help="Run Climbs, build and compare tasks from a Skill, and verify and publish proofs. "
        "State lives in ~/.regents/techtree.",
        no_args_is_help=True,
    )
    for command in (SETUP, DOCTOR, ENGINE, SKILL, CLIMB, RUN, WORKER, SUPERVISE):
        group.add_command(command)
    return group
