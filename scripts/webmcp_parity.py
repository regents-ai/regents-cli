"""Compare each site's WebMCP tools with its `regents` commands, from the pinned copies.

The tool lists are pinned in tool_manifests/ and never ship; the command lists ship in the
package under src/regents_cli/platforms/.

A command and a tool do the same thing when the command names the tool (`webmcp`), or when
both call the same route (method and path, whatever the path's placeholders are called). The
report lists, for each site, the tools no command does, the commands no tool does, and the
commands that name a tool the site's list does not have. Tools regents does itself, and tools
and commands that are site-only or command-line-only by design, are listed apart and are not
gaps. The report shows gaps and never fails a release.

The feature map, verification/features.yml, writes the same comparison into each site's
features (scripts/features.py), so a new gap is seen in the change that makes it.

    uv run scripts/webmcp_parity.py           # print the report
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.table import Table

ROOT = Path(__file__).resolve().parent.parent
PLATFORMS = ROOT / "src/regents_cli/platforms"
TOOL_MANIFESTS = ROOT / "tool_manifests"

#: Who may call a command, from its `authority`.
WHO = {"public": "anyone", "signed_agent": "signed-in agent", "paired_agent": "paired agent"}

#: Tools whose job `regents` does with its own commands rather than a site command.
COVERED_BY_CLI: dict[str, dict[str, str]] = {
    "*": {"prepare_agent_request": "regents signs each request itself"},
    "techtree": {
        "techtree_start": "techtree setup",
        "techtree_climbs": "techtree climb list",
        "techtree_climb": "techtree climb show",
        "techtree_publication": "techtree publish",
    },
}

#: Commands with no tool on purpose: no site page or tool does them.
CLI_ONLY: dict[str, dict[str, str]] = {
    "*": {
        "agents pair": "a person's pairing code is redeemed from the command line",
        "health": "a plain up-or-down read for scripts",
    },
    "techtree": {
        "model-climb reports": "private reports have no site page or tool",
        "model-climb report <digest>": "private reports have no site page or tool",
    },
    "patchbay": {
        "payments get <id>": "get_payment_status is the owner's tool, not an agent's",
        "payments complete <id>": "the signer finishes its own payment; no tool does this step",
        "assist free": "asks for a free fix; the tools offer only the paid one",
    },
    "protocol": {"agents status": "a check-in write; agents whoami is the read"},
}

#: Tools with no command on purpose: guides to the site, cards drawn in a page, and the owner's
#: own website actions.
SITE_ONLY: dict[str, dict[str, str]] = {
    "*": {
        "about": "reads the about page",
        "docs": "reads the docs page",
    },
    "patchbay": {
        "get_payment_status": "the owner's tool; agents use payments get",
        "hello": "the owner's tool",
        "get_my_usdc_balance": "the owner's tool",
        "set_my_agent_name": "the owner's tool",
        "tip_agent": "the owner's tool; it spends the owner's USDC",
        "accept_solution": "the owner's tool; it moves USDC",
        "withdraw_priority_report": "the owner's tool; it moves USDC",
        "get_patchbay_help": "a guide to the site",
        "get_webmcp_guide": "a guide to WebMCP",
        "render_repair_card": "draws a thread in the page",
        "invoke_patchbay_room": "a room's own tool, run from the room's page",
        "cancel_patchbay_room_call": "a room's own tool, run from the room's page",
        "finish_patchbay_room_call": "a room's own tool, run from the room's page",
        "request_patchbay_repair": "a room's own tool, run from the room's page",
    },
    "protocol": {"regents_about": "reads the about and docs pages"},
}

console = Console(highlight=False)


def routes(text: str | None) -> set[str]:
    """`GET /a/{id}, GET /b` as {"GET /a/{}", "GET /b"}; nothing for a tool with no route."""
    if not text or " /" not in text:
        return set()
    return {re.sub(r"\{[^}]*\}", "{}", part.strip()) for part in text.split(",")}


def compare(name: str) -> dict[str, Any]:
    commands = json.loads((PLATFORMS / name / "commands.json").read_text("utf-8"))["commands"]
    tools = json.loads((TOOL_MANIFESTS / f"{name}.json").read_text("utf-8"))["tools"]
    covered = {**COVERED_BY_CLI["*"], **COVERED_BY_CLI.get(name, {})}
    cli_only = {**CLI_ONLY["*"], **CLI_ONLY.get(name, {})}
    site_only = {**SITE_ONLY["*"], **SITE_ONLY.get(name, {})}
    tool_names = {tool["name"] for tool in tools}
    tool_routes = {tool["name"]: routes(tool.get("route")) for tool in tools}
    done_by: dict[str, list[str]] = {tool: [] for tool in tool_names}
    lone_commands: list[str] = []
    unknown_tools: list[tuple[str, str]] = []
    rows: list[dict[str, Any]] = []
    untooled: set[str] = set()
    for command in commands:
        route = routes(f"{command['method']} {command['path']}")
        named = command.get("webmcp")
        if named is not None and named not in tool_names:
            unknown_tools.append((command["command"], named))
        matched = {tool for tool, served in tool_routes.items() if route & served}
        if named in tool_names:
            matched.add(named)
        for tool in matched:
            done_by[tool].append(command["command"])
        rows.append({**command, "tools": sorted(matched)})
        if not matched:
            untooled.add(command["command"])
        if not matched and command["command"] not in cli_only:
            lone_commands.append(command["command"])
    lone_tools = sorted(
        tool for tool, by in done_by.items() if not by and tool not in covered | site_only
    )
    unserved = {tool for tool, by in done_by.items() if not by}
    return {
        "name": name,
        "tools": len(tools),
        "commands": len(commands),
        "lone_tools": lone_tools,
        "lone_commands": lone_commands,
        "unknown_tools": unknown_tools,
        "rows": rows,
        "done_by": done_by,
        "covered": {tool: how for tool, how in covered.items() if tool in tool_names},
        "site_only": {tool: why for tool, why in site_only.items() if tool in tool_names},
        "cli_only": {
            command: why
            for command, why in cli_only.items()
            if command in {command["command"] for command in commands}
        },
        # The allowlist entries this site needs: a tool or command that has no partner.
        "needs": {("COVERED_BY_CLI", tool) for tool in covered if tool in unserved}
        | {("SITE_ONLY", tool) for tool in site_only if tool in unserved}
        | {("CLI_ONLY", command) for command in cli_only if command in untooled},
    }


def stale(sites: list[dict[str, Any]]) -> list[str]:
    """Allowlist entries no site needs: a tool that now has a command, a command that now has
    a tool, or a name no site has."""
    found = []
    for table, entries in (
        ("COVERED_BY_CLI", COVERED_BY_CLI),
        ("CLI_ONLY", CLI_ONLY),
        ("SITE_ONLY", SITE_ONLY),
    ):
        for scope, names in entries.items():
            within = [site for site in sites if scope in ("*", site["name"])]
            found += [
                f"{table}[{scope!r}] {name!r}"
                for name in names
                if not any((table, name) in site["needs"] for site in within)
            ]
    return found


def command_state(site: dict[str, Any], row: dict[str, Any]) -> str:
    named = row.get("webmcp")
    if named is not None and named not in site["done_by"]:
        return f"**names `{named}`, which the site does not list**"
    if row["tools"]:
        return ", ".join(f"`{tool}`" for tool in row["tools"])
    if row["command"] in site["cli_only"]:
        return f"command line only: {site['cli_only'][row['command']]}"
    return "**no tool**"


def tool_state(site: dict[str, Any], tool: str) -> str:
    if tool in site["covered"]:
        return f"done by regents itself: {site['covered'][tool]}"
    if tool in site["site_only"]:
        return f"site only: {site['site_only'][tool]}"
    return "**no command**"


def report(sites: list[dict[str, Any]]) -> None:
    summary = Table(title="WebMCP tools and regents commands, from the pinned copies")
    for column in ("Site", "Tools", "Commands", "Tools with no command", "Commands with no tool"):
        summary.add_column(column, justify="left" if column == "Site" else "right")
    for site in sites:
        summary.add_row(
            site["name"],
            str(site["tools"]),
            str(site["commands"]),
            str(len(site["lone_tools"])),
            str(len(site["lone_commands"])),
        )
    console.print(summary)
    for site in sites:
        table = Table(title=site["name"], show_header=True, title_justify="left")
        table.add_column("Gap", style="bold")
        table.add_column("Names")
        if site["lone_tools"]:
            table.add_row("Tools with no command", ", ".join(site["lone_tools"]))
        if site["lone_commands"]:
            table.add_row("Commands with no tool", ", ".join(site["lone_commands"]))
        for command, tool in site["unknown_tools"]:
            table.add_row("Names a tool the site does not list", f"{command} → {tool}")
        for tool, how in site["covered"].items():
            table.add_row("[dim]Done by regents itself[/dim]", f"[dim]{tool}: {how}[/dim]")
        for tool, why in site["site_only"].items():
            table.add_row("[dim]Site only[/dim]", f"[dim]{tool}: {why}[/dim]")
        for command, why in site["cli_only"].items():
            table.add_row("[dim]Command line only[/dim]", f"[dim]{command}: {why}[/dim]")
        console.print(table)


def main(args: list[str]) -> int:
    if args:
        console.print(f"[red]unknown arguments:[/red] {' '.join(args)}")
        return 2
    names = sorted(path.parent.name for path in PLATFORMS.glob("*/commands.json"))
    missing = [name for name in names if not (TOOL_MANIFESTS / f"{name}.json").is_file()]
    if missing:
        console.print(f"[red]Pinned sites with no tool manifest:[/red] {', '.join(missing)}")
        return 1
    report([compare(name) for name in names])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
