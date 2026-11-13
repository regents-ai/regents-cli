"""A yes/no flag reaches the site as the site reads it: `true` or `false` in the query, a JSON
boolean in the body, and nothing at all when it is left out, so the route's own default holds. A
`True` in the query, or a `false` sent for a flag nobody gave, would make the site answer for the
opposite of what was asked, and a next page that dropped the flag would page through other
records."""

from __future__ import annotations

import contextlib
import io
import json
import re
import shlex
from typing import Any

import click
import httpx
import pytest

from regents_cli import app, runner
from regents_cli.http import Request
from regents_cli.platforms import Platform

NEEDS_ANSWER = {
    "name": "needs-answer",
    "type": "boolean",
    "required": False,
    "description": "Only threads still waiting for an answer.",
}
BOARD = Platform.parse(
    {
        "format": "regents.commands.v1",
        "platform": "board",
        "base_url": "https://board.example",
        "commands": [
            {
                "command": "threads search",
                "description": "Search the threads.",
                "operation_id": "searchThreads",
                "method": "GET",
                "path": "/threads",
                "authority": "public",
                "effect": "read",
                "flags": [
                    NEEDS_ANSWER | {"in": "query", "field": "needs_answer"},
                    {
                        "name": "after",
                        "type": "string",
                        "in": "query",
                        "field": "after",
                        "description": "The page to start after.",
                    },
                ],
                "pagination": {"has_more": "has_more", "cursor": "next", "flag": "after"},
            },
            {
                "command": "threads mark <id>",
                "description": "Mark a thread.",
                "operation_id": "markThread",
                "method": "POST",
                "path": "/threads/{id}/mark",
                "authority": "public",
                "effect": "write",
                "arguments": [
                    {
                        "name": "id",
                        "type": "string",
                        "in": "path",
                        "field": "id",
                        "description": "The thread.",
                    }
                ],
                "flags": [NEEDS_ANSWER | {"in": "body", "field": "needs_answer"}],
            },
        ],
    }
)


@pytest.fixture
def board(monkeypatch: pytest.MonkeyPatch) -> list[Request]:
    """`regents` with the board as its one site, and each request it sends, which answers with
    the next page while the first is read."""
    monkeypatch.setattr(app, "pinned_platforms", lambda: [BOARD])
    sent: list[Request] = []

    def respond(base: str, request: Request, timeout_ms: int) -> httpx.Response:
        sent.append(request)
        first = "after" not in request.query
        return httpx.Response(200, json={"threads": [], "has_more": first, "next": "page-2"})

    monkeypatch.setattr(runner, "respond", respond)
    return sent


def regents(args: list[str]) -> dict[str, Any]:
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        code = app.main([*args, "--json"])
    assert code == 0, out.getvalue()
    answered: dict[str, Any] = json.loads(out.getvalue())
    return answered


GIVEN = [(["--needs-answer"], True), (["--no-needs-answer"], False), ([], None)]


@pytest.mark.parametrize(("typed", "value"), GIVEN)
def test_a_yes_no_flag_in_the_query_is_true_false_or_absent(
    board: list[Request], typed: list[str], value: bool | None
) -> None:
    regents(["board", "threads", "search", *typed])
    [request] = board
    sent = {
        True: "/threads?needs_answer=true",
        False: "/threads?needs_answer=false",
        None: "/threads",
    }
    assert request.target == sent[value]


@pytest.mark.parametrize(("typed", "value"), GIVEN)
def test_a_yes_no_flag_in_the_body_is_a_json_boolean_or_absent(
    board: list[Request], typed: list[str], value: bool | None
) -> None:
    regents(["board", "threads", "mark", *typed, "t1"])
    [request] = board
    sent = {True: b'{"needs_answer":true}', False: b'{"needs_answer":false}', None: b"{}"}
    assert (request.path, request.content) == ("/threads/t1/mark", sent[value])


@pytest.mark.parametrize(("typed", "value"), GIVEN)
def test_the_next_page_keeps_the_yes_no_flag_as_typed(
    board: list[Request], typed: list[str], value: bool | None
) -> None:
    answered = regents(["board", "threads", "search", *typed])
    [step] = answered["next_steps"]
    words = shlex.split(step["command"])
    assert words[0] == "regents"
    regents([word for word in words[1:] if word != "--json"])
    first, second = board
    assert second.query == {**first.query, "after": "page-2"}


def test_the_help_offers_the_pair(board: list[Request]) -> None:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        assert app.main(["board", "threads", "search", "--help"]) == 0
    [line] = [line for line in click.unstyle(out.getvalue()).splitlines() if "needs-" in line]
    assert re.split(r"[\s/]+", line.strip())[:2] == ["--needs-answer", "--no-needs-answer"]


@pytest.mark.parametrize("typed", ["--needs-answer=true", "--needs-answer=yes", "--needs-answer=1"])
def test_a_yes_no_flag_takes_no_value(board: list[Request], typed: str) -> None:
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        assert app.main(["board", "threads", "search", typed, "--json"]) == 2
    assert board == []
