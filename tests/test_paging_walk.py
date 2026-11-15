"""An agent reads every page of a paged list by running the next-page step `regents` prints,
exactly as printed, until none is printed. Keyfleet moved `notebooks list` to a signed POST whose
cursor rides in the JSON body (1.10.30); a next page that dropped or changed the cursor, sent it
anywhere else, or went unsigned would read the first page again, skip notebooks or be refused,
and a next-page step after the last page would send the agent round again."""

from __future__ import annotations

import contextlib
import io
import json
import shlex
from pathlib import Path
from typing import Any

import httpx
import pytest

from check_live import answer_shapes, mismatches
from regents_cli import app, runner
from regents_cli.http import Request
from regents_cli.platforms import pinned_platforms
from tests.signed_agent import ADDRESS, sign_in, signer_of

KEYFLEET = next(platform for platform in pinned_platforms() if platform.name == "keyfleet")
NAMES = ["notebooks", "list"]
LIST = next(c for c in KEYFLEET.commands if list(c.words[:2]) == NAMES)
FLEET, PROJECT = "fleet_tech_classic", "general"
PAGE = 50
#: The project's 120 notebooks, newest first.
NOTEBOOKS = [
    {
        "notebook_id": f"nb-{number:016x}",
        "title": f"Notebook {number}",
        "description": "",
        "created_at": f"2026-11-{15 - number // 24:02d}T{23 - number % 24:02d}:00:00Z",
        "locked": True,
        "scratchpad_key": None,
        "notebook_url": f"https://notebooks.keyfleet.ai/{FLEET}/{PROJECT}/nb-{number:016x}",
        "state": None,
    }
    for number in range(120)
]


@pytest.fixture
def site(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> list[Request]:
    """An agent signed in to Keyfleet, and Keyfleet on this machine holding the 120 notebooks,
    50 a page, each page answering the cursor of the next; each request it receives."""
    sign_in(tmp_path, monkeypatch, "keyfleet")
    monkeypatch.delenv("SIWA_BROKER", raising=False)
    monkeypatch.delenv(KEYFLEET.env_var, raising=False)
    listed = {"audiences": [{"audience": "keyfleet", "origin": KEYFLEET.base_url}]}
    monkeypatch.setattr(
        httpx,
        "get",
        lambda *_, **__: httpx.Response(200, json={"code": "audiences", "data": listed}),
    )
    #: Each cursor the site has answered, and where its page starts.
    cursors: dict[str, int] = {}
    received: list[Request] = []

    def respond(base: str, request: Request, timeout_ms: int) -> httpx.Response:
        assert base == KEYFLEET.base_url
        received.append(request)
        cursor = json.loads(request.content or b"{}").get("cursor")
        start = 0 if cursor is None else cursors[cursor]
        end = start + PAGE
        following = f"opaque-{len(cursors)}-{end}" if end < len(NOTEBOOKS) else None
        if following is not None:
            cursors[following] = end
        page = {
            "notebooks": NOTEBOOKS[start:end],
            "has_more": following is not None,
            "cursor": following,
        }
        return httpx.Response(200, json=page)

    monkeypatch.setattr(runner, "respond", respond)
    return received


def regents(args: list[str]) -> dict[str, Any]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = app.main(args)
    assert code == 0, out.getvalue() + err.getvalue()
    answered: dict[str, Any] = json.loads(out.getvalue())
    return answered


def test_every_notebook_is_read_once_in_order_by_following_the_printed_pages(
    site: list[Request],
) -> None:
    shape = answer_shapes("keyfleet")[(LIST.method, LIST.path)]["success"]
    answers: list[dict[str, Any]] = []
    args = ["keyfleet", "notebooks", "list", FLEET, PROJECT, "--json"]
    # More rounds than there are pages, so a next-page step that never ends fails here.
    for _ in range(len(NOTEBOOKS) // PAGE + 2):
        answered = regents(args)
        steps = answered.pop("next_steps")
        assert not mismatches(shape, answered)
        answers.append(answered)
        printed = [shlex.split(step["command"]) for step in steps if step["kind"] == "run"]
        pages = [words for words in printed if words[:4] == ["regents", "keyfleet", *NAMES]]
        if not pages:
            break
        [words] = pages
        args = words[1:]

    read = [notebook["notebook_id"] for answered in answers for notebook in answered["notebooks"]]
    assert read == [notebook["notebook_id"] for notebook in NOTEBOOKS]
    assert len(site) == len(answers) == 3
    assert (answers[-1]["has_more"], answers[-1]["cursor"]) == (False, None)
    path = f"/api/v1/agent/fleets/{FLEET}/projects/{PROJECT}/notebooks/list"
    bodies: list[dict[str, Any]] = [{}, *({"cursor": a["cursor"]} for a in answers[:-1])]
    for request, body in zip(site, bodies, strict=True):
        assert (request.method, request.target) == ("POST", path)
        assert json.loads(request.content or b"") == body
        signer = signer_of(
            request.method, request.target, request.content, request.headers, KEYFLEET.base_url
        )
        assert signer == ADDRESS
