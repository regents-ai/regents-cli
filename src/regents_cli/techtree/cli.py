"""The `regents techtree` group."""

from __future__ import annotations

import click


def techtree_group() -> click.Group:
    return click.Group(
        "techtree",
        help="Run Climbs, build and compare tasks from a Skill, and verify and publish proofs. "
        "State lives in ~/.regents/techtree.",
        no_args_is_help=True,
    )
