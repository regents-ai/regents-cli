"""Install the wheel this tree builds into a new, empty environment, and run every site's public
reads from it against the live sites.

Each public read runs twice, readable and with --json, and both must exit as expected. A --json
answer must have the shape every pinned OpenAPI document gives its route's success answer, with
`next_steps` beside it; an expected refusal must be one error with its code and status, in the
shape the documents give that status. Reads that take an id take it from an earlier read's answer,
so they follow live records. Every command's --help must print, and the Touch ID page the wheel
serves must be the live sign-in server's own, byte for byte (the page its agent client,
/agent/siwa_agent.py, serves). The check fails when a site's description has a public read
with no run here, so a new read is checked from the release that adds it. A read whose pinned
shape accepts any object is shown as unchecked, by name.

Nothing signed runs: `regents` runs with only PATH, an empty home and an empty agent home, so
nothing is signed, paid or changed, and nothing of this machine's own setup reaches it. It reads
the live sites, so it runs before each release, not in the publish workflow.

    uv run scripts/check_live.py
"""

from __future__ import annotations

import ast
import json
import os
import re
import subprocess
import sys
import tempfile
import tomllib
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote

import httpx
import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012
from rich.console import Console
from rich.markup import escape
from rich.table import Table

from regents_cli.check_commands import METHODS
from regents_cli.http import exit_code_for
from regents_cli.siwa import BROKER

ROOT = Path(__file__).resolve().parent.parent
PLATFORMS = ROOT / "src/regents_cli/platforms"
PLACEHOLDER = re.compile(r"<([^>]+)>")

console = Console(highlight=False)


@dataclass(frozen=True)
class Run:
    """One public read: the command line after `regents <site>`, each `<input>` in it taken from
    an earlier run's answer (that run's line, and a dotted path into its answer) or given as it
    is, and the error code and status it answers with when it is expected to refuse."""

    line: str
    inputs: dict[str, tuple[str, str] | str] = field(default_factory=dict)
    refuses: tuple[str, int] | None = None


THREADS = "threads search --sort recent"

RUNS: dict[str, list[Run]] = {
    "ash-template": [
        Run("health"),
        Run("rooms list"),
        Run("rooms messages <room>", {"room": ("rooms list", "rooms.0.slug")}),
        Run(
            "rooms message <room> <id>",
            {
                "room": ("rooms list", "rooms.0.slug"),
                "id": ("rooms messages <room>", "messages.0.id"),
            },
        ),
        Run("agents get <id>", {"id": ("rooms messages <room>", "messages.0.agent_id")}),
        Run("about"),
        Run("docs"),
        Run("siwa help"),
        Run("sites tools <site>", {"site": "patchbay"}),
        Run("polls list"),
        # Polls come and go, so this reads the not-found answer.
        Run(
            "polls show <poll>",
            {"poll": "00000000-0000-0000-0000-000000000000"},
            refuses=("poll_not_found", 404),
        ),
    ],
    "autolaunch": [
        Run("auctions list"),
        Run("auctions counts"),
        Run("tokens list"),
        Run("auction <id>", {"id": ("auctions list", "data.0.id")}),
        Run("token <id>", {"id": ("tokens list", "data.0.id")}),
        # No launch has a treasury yet, so this reads the not-found answer.
        Run(
            "treasury security <address>",
            {"address": ("auctions list", "data.0.address")},
            refuses=("not_found", 404),
        ),
    ],
    "keyfleet": [
        Run("fleets list"),
        Run("fleets get <fleet>", {"fleet": ("fleets list", "fleets.0.id")}),
        # The one fleet with Keys sold; a fleet still to come has no treasury, pulse or proposals.
        Run("treasury get <fleet>", {"fleet": "regents_club"}),
        Run("workspace pulse <fleet>", {"fleet": "regents_club"}),
        Run("proposals list <fleet>", {"fleet": "regents_club"}),
    ],
    "patchbay": [
        Run("health"),
        Run("sites list"),
        Run("offers slots"),
        Run("bench matrix"),
        Run(THREADS),
        Run("threads get <id>", {"id": (THREADS, "results.0.id")}),
        Run("agents get <public-id>", {"public-id": (THREADS, "results.0.author.profile_id")}),
        # Patchbay's own tool, always listed; the newest thread may name no tool.
        Run(
            "tools history --origin <origin> --tool-name <tool>",
            {"origin": "patchbay.help", "tool": "agent_whoami"},
        ),
        Run("tools catalog <host> <name>", {"host": "patchbay.help", "name": "agent_whoami"}),
        # Patchbay always knows fixes for its own site.
        Run("known-fixes find --site <site>", {"site": "patchbay.help"}),
        Run(
            "known-fixes get <fix-id>",
            {"fix-id": ("known-fixes find --site <site>", "known_fixes.0.fix_id")},
        ),
        Run(
            "bench pair <harness-id> <wallet-id>",
            {
                "harness-id": ("bench matrix", "squares.0.harness_id"),
                "wallet-id": ("bench matrix", "squares.0.wallet_id"),
            },
        ),
    ],
    "protocol": [
        Run("products list"),
        Run("products get <product>", {"product": ("products list", "products.0.slug")}),
        Run("articles list"),
        Run("articles show <slug>", {"slug": ("articles list", "articles.0.slug")}),
        Run("literature list"),
        Run("research list"),
        Run("research show <id>", {"id": ("research list", "papers.0.id")}),
        # There is no list of profiles, so this reads the not-found answer.
        Run(
            "profiles show <slug>",
            {"slug": "no-such-profile"},
            refuses=("profile_not_found", 404),
        ),
    ],
    "techtree": [
        Run("results list"),
        Run(
            "results show <bundle-digest>",
            {"bundle-digest": ("results list", "entries.0.bundle_digest")},
        ),
    ],
}

#: Run inside the new environment: every command's --help, one process for all of them.
HELP_WALK = """
import contextlib, io, json, click
from regents_cli.app import main, root
def walk(command, words):
    yield words
    if isinstance(command, click.Group):
        for name, child in command.commands.items():
            yield from walk(child, [*words, name])
lines = list(walk(root(), []))
failed = []
for words in lines:
    shown = io.StringIO()
    with contextlib.redirect_stdout(shown), contextlib.redirect_stderr(shown):
        code = main([*words, "--help"])
    if code != 0 or not shown.getvalue().strip():
        failed.append(" ".join(["regents", *words]))
print(json.dumps({"commands": len(lines), "failed": failed}))
"""


def dig(value: Any, dotted: str) -> Any:
    for key in dotted.split("."):
        if isinstance(value, list) and key.isdigit() and int(key) < len(value):
            value = value[int(key)]
        elif isinstance(value, dict):
            value = value.get(key)
        else:
            return None
    return value


def words_for(run: Run, ran: dict[str, Any]) -> list[str] | None:
    """The words of `run` after `regents <site>`, each `<input>` filled in from `ran`, the earlier
    runs' answers by line; None when an earlier answer has no value for one."""
    values = {
        key: given if isinstance(given, str) else dig(ran.get(given[0]), given[1])
        for key, given in run.inputs.items()
    }
    if any(
        isinstance(v, bool) or not isinstance(v, str | int) or not str(v) for v in values.values()
    ):
        return None
    return [
        str(values[word[1:-1]]) if PLACEHOLDER.fullmatch(word) else word
        for word in run.line.split(" ")
    ]


def command_for(run: Run, commands: Iterable[str]) -> str | None:
    """The described command `run` runs: its line, or the start of it."""
    return next((n for n in commands if run.line == n or run.line.startswith(n + " ")), None)


def read_document(path: Path) -> Any:
    text = path.read_text("utf-8")
    return yaml.safe_load(text) if path.suffix == ".yaml" else json.loads(text)


def pointer(*parts: str) -> str:
    return "".join("/" + part.replace("~", "~0").replace("/", "~1") for part in parts)


def referred(document: Any, node: Any, where: tuple[str, ...]) -> tuple[Any, tuple[str, ...]]:
    """`node` at `where`, or what its local `$ref` points to, followed to the end."""
    while "$ref" in node:
        where = tuple(
            unquote(part).replace("~1", "/").replace("~0", "~")
            for part in node["$ref"].removeprefix("#/").split("/")
        )
        node = document
        for part in where:
            node = node[part]
    return node, where


#: A route's answers by status ("success" is its first 2xx), each a validator per pinned document.
Shapes = dict[tuple[str, str], dict[str, list[Draft202012Validator]]]


def answer_shapes(site: str) -> Shapes:
    """For each route, the JSON schema every pinned OpenAPI document gives each of its answers,
    with the document's own references."""
    shapes: Shapes = {}
    for path in sorted((PLATFORMS / site).iterdir()):
        if path.name == "commands.json" or path.suffix not in (".json", ".yaml"):
            continue
        document = read_document(path)
        uri = f"urn:regents-cli:{site}:{path.name}"
        registry = Registry().with_resource(
            uri, Resource.from_contents(document, default_specification=DRAFT202012)
        )
        for route, item in (document.get("paths") or {}).items():
            for method in METHODS:
                responses = ((item or {}).get(method) or {}).get("responses") or {}
                success = min((code for code in responses if code.startswith("2")), default=None)
                for code, response in responses.items():
                    if code.startswith("2") and code != success:
                        continue
                    where: tuple[str, ...] = ("paths", route, method, "responses", code)
                    response, where = referred(document, response, where)
                    if "application/json" not in (response.get("content") or {}):
                        continue
                    at = pointer(*where, "content", "application/json", "schema")
                    validator = Draft202012Validator(
                        {"$ref": f"{uri}#{quote(at, safe='/~')}"}, registry=registry
                    )
                    kind = "success" if code == success else code
                    shapes.setdefault((method.upper(), route), {}).setdefault(kind, []).append(
                        validator
                    )
    return shapes


def bare(home: Path) -> dict[str, str]:
    """All `regents` runs with: PATH, and an empty home and agent home."""
    return {"PATH": os.environ["PATH"], "HOME": str(home), "SIWA_AGENT_HOME": str(home)}


def regents(venv: Path, home: Path, words: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(venv / "bin/regents"), *words],
        capture_output=True,
        text=True,
        cwd=home,
        env=bare(home),
        timeout=120,
        check=False,
    )


def mismatches(validators: list[Draft202012Validator], value: Any) -> list[str]:
    found = []
    for validator in validators:
        for error in sorted(validator.iter_errors(value), key=lambda e: list(e.absolute_path))[:3]:
            at = ".".join(map(str, error.absolute_path)) or "the answer"
            found.append(f"{at}: {error.message[:160]}")
    return found


def problems_with(run: Run, route: dict[str, list[Draft202012Validator]], told: Any) -> list[str]:
    if not isinstance(told, dict) or not isinstance(told.get("next_steps"), list):
        return ["the answer has no next_steps"]
    if not told["next_steps"]:
        return ["next_steps is empty"]
    error = told.get("error")
    if run.refuses is not None:
        code, status = run.refuses
        if not isinstance(error, dict) or (error.get("code"), error.get("status")) != run.refuses:
            return [f"expected the {code} refusal ({status})"]
        if str(status) not in route:
            return [f"no pinned document describes this route's {status} answer"]
        # The site's own body: the error, less the status and wait regents adds to it.
        said = {key: value for key, value in error.items() if key not in ("status", "retry_after")}
        return mismatches(route[str(status)], {"error": said})
    if error is not None:
        return [f"refused: {error.get('code')}: {error.get('message')}"]
    if "success" not in route:
        return ["no pinned document describes this route's answer"]
    return mismatches(route["success"], {k: v for k, v in told.items() if k != "next_steps"})


def check_site(site: str, venv: Path, home: Path) -> tuple[Table, int, list[str]]:
    description = json.loads((PLATFORMS / site / "commands.json").read_text("utf-8"))
    commands = {c["command"]: c for c in description["commands"]}
    public_reads = {
        name for name, c in commands.items() if c["authority"] == "public" and c["effect"] == "read"
    }
    runs = RUNS.get(site, [])
    table = Table(title=site, title_justify="left")
    for column in ("Read", "Answer", "Shape"):
        table.add_column(column)
    failures = 0
    unchecked = []
    ran: dict[str, Any] = {}
    covered = set()
    shapes = answer_shapes(site)
    for run in runs:
        name = command_for(run, commands)
        if name is None or name not in public_reads:
            table.add_row(run.line, "[red]✗ not a public read in the pinned description[/red]", "")
            failures += 1
            continue
        covered.add(name)
        words = words_for(run, ran)
        if words is None:
            table.add_row(run.line, "[red]✗ an earlier answer had no value to read with[/red]", "")
            failures += 1
            continue
        expected = exit_code_for(run.refuses[1]) if run.refuses else 0
        readable = regents(venv, home, [site, *words])
        machine = regents(venv, home, [site, *words, "--json"])
        try:
            told = json.loads(machine.stdout)
        except json.JSONDecodeError:
            told = None
        ran[run.line] = told
        exits = [
            f"{how} exited {done.returncode}, not {expected}"
            for how, done in (("readable", readable), ("--json", machine))
            if done.returncode != expected
        ]
        if not (readable.stderr if run.refuses else readable.stdout).strip():
            exits.append("the readable answer printed nothing")
        route = shapes.get((commands[name]["method"], commands[name]["path"]), {})
        found = exits + problems_with(run, route, told)
        shown = " ".join(words)
        if found:
            failures += 1
            table.add_row(shown, "[red]✗[/red] " + escape("; ".join(found)), "")
        elif run.refuses:
            table.add_row(
                shown,
                f"[green]✓[/green] refused {run.refuses[0]} ({run.refuses[1]}), as expected",
                "[green]✓[/green] refusal as pinned; no live record has an answer to read",
            )
        elif all(validator.is_valid({}) for validator in route["success"]):
            unchecked.append(f"{site} {name}")
            table.add_row(
                shown,
                "[green]✓[/green] answered",
                "[yellow]! the site pins no shape for it[/yellow]",
            )
        else:
            table.add_row(shown, "[green]✓[/green] answered", "[green]✓[/green] as pinned")
    for name in sorted(public_reads - covered):
        table.add_row(name, "[red]✗ public read with no run in scripts/check_live.py[/red]", "")
        failures += 1
    return table, failures, unchecked


def live_touch_id_page() -> str:
    """The Touch ID page the live sign-in server's agent client serves, read from its source
    without running it."""
    source = httpx.get(f"{BROKER}/agent/siwa_agent.py", timeout=30).raise_for_status().text
    [page] = [
        node.value.value
        for node in ast.parse(source).body
        if isinstance(node, ast.Assign)
        and [target.id for target in node.targets if isinstance(target, ast.Name)]
        == ["PASSKEY_PAGE"]
        and isinstance(node.value, ast.Constant)
    ]
    assert isinstance(page, str)
    return page


def main() -> int:
    version = tomllib.loads((ROOT / "pyproject.toml").read_text("utf-8"))["project"]["version"]
    git = ["git", "-C", str(ROOT)]
    head = subprocess.run([*git, "rev-parse", "HEAD"], capture_output=True, text=True, check=True)
    changed = subprocess.run(
        [*git, "status", "--porcelain"], capture_output=True, text=True, check=True
    ).stdout.splitlines()
    console.print(f"Commit {head.stdout.strip()}")
    console.print(
        "[green]✓[/green] The tree is clean."
        if not changed
        else "[yellow]! The tree has changes:[/yellow] " + escape(", ".join(changed))
    )
    with tempfile.TemporaryDirectory() as scratch:
        work = Path(scratch)
        home, dist, venv = work / "home", work / "dist", work / "venv"
        home.mkdir()
        with console.status("Building the wheel and installing it into a new environment"):
            subprocess.run(
                ["uv", "build", "--wheel", "--out-dir", str(dist), "-q"], cwd=ROOT, check=True
            )
            [wheel] = dist.glob("*.whl")
            subprocess.run(["uv", "venv", "-q", "--python", "3.12", str(venv)], check=True)
            subprocess.run(
                ["uv", "pip", "install", "-q", "--python", str(venv / "bin/python"), str(wheel)],
                check=True,
            )
        failures = 0
        shown = regents(venv, home, ["--version"]).stdout.strip()
        if shown != f"regents {version}":
            console.print(
                f"[red]✗[/red] --version printed {escape(shown)!r}, not regents {version}"
            )
            failures += 1
        walked = subprocess.run(
            [str(venv / "bin/python"), "-I", "-c", HELP_WALK],
            capture_output=True,
            text=True,
            cwd=home,
            env=bare(home),
            check=False,
        )
        helped = json.loads(walked.stdout) if walked.returncode == 0 else None
        if helped is None or helped["failed"]:
            failed = helped["failed"] if helped else [walked.stderr.strip()[-400:]]
            console.print(f"[red]✗ --help failed:[/red] {escape(', '.join(failed))}")
            failures += 1
        else:
            console.print(f"[green]✓[/green] --help prints for all {helped['commands']} commands")
        [served] = venv.glob("lib/python*/site-packages/regents_cli/passkey.html")
        if served.read_text("utf-8") == live_touch_id_page():
            console.print(f"[green]✓[/green] The Touch ID page is the one {BROKER} serves")
        else:
            console.print(f"[red]✗ The Touch ID page differs from the one {BROKER} serves[/red]")
            failures += 1
        unchecked: list[str] = []
        for site in sorted(path.parent.name for path in PLATFORMS.glob("*/commands.json")):
            with console.status(f"Reading {site}"):
                table, failed_here, unchecked_here = check_site(site, venv, home)
            console.print(table)
            failures += failed_here
            unchecked += unchecked_here
    if failures:
        console.print(
            f"[bold red]{failures} live check{'s' if failures > 1 else ''} failed.[/bold red]"
        )
        return 1
    if unchecked:
        console.print(
            f"[bold green]regents {version}, installed from its wheel, reads every live site "
            "as pinned,[/bold green] [yellow]except where the site pins no shape:[/yellow] "
            + escape(", ".join(unchecked))
        )
    else:
        console.print(
            f"[bold green]regents {version}, installed from its wheel, reads every live site "
            "as pinned.[/bold green]"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
