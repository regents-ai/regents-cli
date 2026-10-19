"""Record every site's public reads from the live sites into tests/replays/<site>.json: the
request `regents` sends and the site's answer, byte for byte as JSON reads it. tests/test_replays.py
replays them offline, so a pin whose routes or answers no longer fit what the live site does fails
`make check`.

The reads are the ones scripts/check_live.py runs, in its order, each `<input>` taken from an
earlier read's live answer. They run in this process with an empty home and agent home, so
nothing is signed, paid or changed. Record again after moving a pin, then read what changed.

    uv run scripts/record_replays.py              # every site
    uv run scripts/record_replays.py keyfleet     # one site
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import httpx
from rich.console import Console
from rich.markup import escape

from check_live import PLATFORMS, RUNS, command_for, words_for
from regents_cli import app
from regents_cli.platforms import pinned_platforms

ROOT = Path(__file__).resolve().parent.parent
REPLAYS = ROOT / "tests/replays"

console = Console(highlight=False)


def record(site: str) -> list[dict[str, Any]]:
    """Each public read of `site`, run against the live site, with what it sent and got."""
    commands = [
        c["command"]
        for c in json.loads((PLATFORMS / site / "commands.json").read_text())["commands"]
    ]
    exchanges: list[tuple[httpx.Request, httpx.Response]] = []
    sending = httpx.request

    def request(method: str, url: str, **given: Any) -> httpx.Response:
        response = sending(method, url, **given)
        exchanges.append((httpx.Request(method, url, content=given["content"]), response))
        return response

    cases = []
    ran: dict[str, Any] = {}
    for run in RUNS[site]:
        name, words = command_for(run, commands), words_for(run, ran)
        if name is None or words is None:
            raise SystemExit(
                f"{site} {run.line}: not a described command, or no value to read with"
            )
        exchanges.clear()
        shown = io.StringIO()
        httpx.request = request  # type: ignore[assignment]
        try:
            with contextlib.redirect_stdout(shown), contextlib.redirect_stderr(io.StringIO()):
                app.main([site, *words, "--json"])
        finally:
            httpx.request = sending
        ran[run.line] = json.loads(shown.getvalue())
        [(sent, got)] = exchanges
        cases.append(
            {
                "command": name,
                "words": words,
                "request": {
                    "method": sent.method,
                    "url": str(sent.url),
                    "content": sent.content.decode("utf-8") or None,
                },
                "response": {
                    "status": got.status_code,
                    "content_type": got.headers.get("content-type"),
                    "body": got.json(),
                },
            }
        )
    return cases


def main(args: list[str]) -> int:
    sites = args or sorted(RUNS)
    unknown = [site for site in sites if site not in RUNS]
    if unknown:
        console.print(f"[red]No public reads for:[/red] {escape(', '.join(unknown))}")
        return 2
    with tempfile.TemporaryDirectory() as home:
        os.environ["HOME"] = os.environ["SIWA_AGENT_HOME"] = home
        for platform in pinned_platforms():
            os.environ.pop(platform.env_var, None)
        REPLAYS.mkdir(exist_ok=True)
        for site in sites:
            with console.status(f"Reading {site}"):
                cases = record(site)
            path = REPLAYS / f"{site}.json"
            path.write_text(json.dumps(cases, indent=2, ensure_ascii=False) + "\n", "utf-8")
            console.print(
                f"[green]✓[/green] {site}: {len(cases)} reads into {path.relative_to(ROOT)}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
