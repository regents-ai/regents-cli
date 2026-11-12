"""Help opens with the thing it names, never with a question word.

The costly failure: help that reads as a question ("Where a run is now") makes a person or an
agent parse it twice, and it drifts from the sites' own command help, which was reworded the
same way.
"""

from __future__ import annotations

import re
from collections.abc import Iterator

import click

from regents_cli.techtree.cli import techtree_group

QUESTION_WORD = re.compile(r"^(Who|What|Where|Why|When)\b")


def helps(command: click.Command, path: str) -> Iterator[tuple[str, str]]:
    yield path, command.help or ""
    for param in command.params:
        if isinstance(param, click.Option):
            yield f"{path} {param.opts[0]}", param.help or ""
    if isinstance(command, click.Group):
        for name, sub in command.commands.items():
            yield from helps(sub, f"{path} {name}")


def test_no_techtree_help_opens_with_a_question_word() -> None:
    opening = [
        (where, text)
        for where, text in helps(techtree_group(), "techtree")
        if QUESTION_WORD.match(text)
    ]

    assert opening == []
