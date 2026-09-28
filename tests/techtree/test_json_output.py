"""`--json` puts exactly one JSON document on stdout, and nothing else, even at a terminal.

The costly failure: the readable layer leaks into `--json` output, as styling, a blank line or
a block meant for a person, and every site and the Techtree plugin stop being able to read
the answer.
"""

from __future__ import annotations

import json

import pytest

from regents_cli.app import main
from tests.techtree.run_log import at_a_terminal


@pytest.mark.parametrize(
    ("argv", "exit_code"),
    [
        (["techtree", "release", "info", "--json"], 0),
        (["techtree", "run", "status", "run_doesnotexist", "--json"], 1),
    ],
)
def test_json_is_the_whole_of_stdout_even_at_a_terminal(
    monkeypatch: pytest.MonkeyPatch, argv: list[str], exit_code: int
) -> None:
    _, stdout = at_a_terminal(monkeypatch, "")

    assert main(argv) == exit_code

    text = stdout.getvalue()
    assert "\x1b" not in text
    assert text.endswith("\n") and "\n" not in text[:-1]
    assert isinstance(json.loads(text), dict)
