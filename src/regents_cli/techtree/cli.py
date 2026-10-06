"""The `regents techtree` group."""

from __future__ import annotations

import click

from regents_cli.techtree.commands.climb import CLIMB
from regents_cli.techtree.commands.doctor import DOCTOR
from regents_cli.techtree.commands.engine import ENGINE
from regents_cli.techtree.commands.forge import FORGE
from regents_cli.techtree.commands.internal import SUPERVISE, WORKER
from regents_cli.techtree.commands.model import MODEL
from regents_cli.techtree.commands.proof import PROOF
from regents_cli.techtree.commands.publish import PUBLISH
from regents_cli.techtree.commands.release import RELEASE
from regents_cli.techtree.commands.run import RUN
from regents_cli.techtree.commands.setup import SETUP
from regents_cli.techtree.commands.skill import SKILL
from regents_cli.techtree.commands.uplift import UPLIFT
from regents_cli.techtree.commands.withdraw import WITHDRAW


def techtree_group() -> click.Group:
    group = click.Group(
        "techtree",
        help="Run Climbs, build and compare tasks from a Skill, and verify and publish proofs. "
        "State lives in ~/.regents/techtree.",
        no_args_is_help=True,
    )
    for command in (
        SETUP,
        DOCTOR,
        ENGINE,
        SKILL,
        CLIMB,
        MODEL,
        FORGE,
        UPLIFT,
        RUN,
        PROOF,
        PUBLISH,
        WITHDRAW,
        RELEASE,
        WORKER,
        SUPERVISE,
    ):
        group.add_command(command)
    return group
