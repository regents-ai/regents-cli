"""Every site's public reads, replayed offline from what the live site did (tests/replays/, written
by scripts/record_replays.py).

For each recorded read, readable and with --json:
- `regents` sends exactly the recorded request, so a pin that moves a route or its query, while the
  live site still answers the recorded one, fails here;
- the live answer still has the shape the pinned description gives that route and status;
- the answer reaches the agent whole: the site's own fields with the next steps beside them, or,
  for a refusal, its code with the exit status it maps to.
"""

from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from check_live import answer_shapes, mismatches
from regents_cli import app
from regents_cli.http import exit_code_for
from regents_cli.platforms import pinned_platforms

REPLAYS = Path(__file__).parent / "replays"
CASES = [
    (path.stem, case)
    for path in sorted(REPLAYS.glob("*.json"))
    for case in json.loads(path.read_text("utf-8"))
]
PLATFORMS = {platform.name: platform for platform in pinned_platforms()}


def test_every_site_with_public_reads_has_replays() -> None:
    described = {
        name
        for name, platform in PLATFORMS.items()
        if any(not command.signed and command.effect == "read" for command in platform.commands)
    }
    assert {site for site, _ in CASES} == described


@pytest.mark.parametrize("as_json", [True, False], ids=["json", "readable"])
@pytest.mark.parametrize("site, case", CASES, ids=[f"{s} {' '.join(c['words'])}" for s, c in CASES])
def test_a_recorded_read_replays(
    site: str,
    case: dict[str, Any],
    as_json: bool,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorded, answered = case["request"], case["response"]
    status, body = answered["status"], answered["body"]
    platform = PLATFORMS[site]
    [command] = [c for c in platform.commands if " ".join(c.words) == case["command"]]

    route = answer_shapes(site)[(command.method, command.path)]
    assert not mismatches(route["success" if status < 300 else str(status)], body)

    for each in PLATFORMS.values():
        monkeypatch.delenv(each.env_var, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("SIWA_AGENT_HOME", str(tmp_path))
    sent: list[dict[str, Any]] = []

    def request(method: str, url: str, **sending: Any) -> httpx.Response:
        content = sending["content"]
        sent.append({"method": method, "url": url, "content": content and content.decode()})
        return httpx.Response(
            status,
            content=json.dumps(body).encode("utf-8"),
            headers={"content-type": answered["content_type"]},
        )

    monkeypatch.setattr(httpx, "request", request)
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = app.main([site, *case["words"], *(["--json"] if as_json else [])])

    assert sent == [recorded]
    assert code == (0 if status < 300 else exit_code_for(status))
    if not as_json:
        assert (out.getvalue() if status < 300 else err.getvalue()).strip()
        return
    told = json.loads(out.getvalue())
    assert told.pop("next_steps")
    if status < 300:
        assert told == body
    else:
        assert (told["error"]["code"], told["error"]["status"]) == (body["error"]["code"], status)
