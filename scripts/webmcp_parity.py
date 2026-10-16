"""Compare each site's WebMCP tools with its `regents` commands, from the pinned copies.

A command and a tool do the same thing when the command names the tool (`webmcp`), or when
both call the same route (method and path, whatever the path's placeholders are called). The
report lists, for each site, the tools no command does, the commands no tool does, and the
commands that name a tool the site's list does not have. It shows gaps and never fails a
release.

    uv run scripts/webmcp_parity.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.table import Table

ROOT = Path(__file__).resolve().parent.parent
PLATFORMS = ROOT / "src/regents_cli/platforms"

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

console = Console(highlight=False)


def routes(text: str | None) -> set[str]:
    """`GET /a/{id}, GET /b` as {"GET /a/{}", "GET /b"}; nothing for a tool with no route."""
    if not text or " /" not in text:
        return set()
    return {re.sub(r"\{[^}]*\}", "{}", part.strip()) for part in text.split(",")}


def compare(name: str) -> dict[str, Any]:
    commands = json.loads((PLATFORMS / name / "commands.json").read_text("utf-8"))["commands"]
    tools = json.loads((PLATFORMS / name / "tool_manifest.json").read_text("utf-8"))["tools"]
    covered = {**COVERED_BY_CLI["*"], **COVERED_BY_CLI.get(name, {})}
    tool_names = {tool["name"] for tool in tools}
    tool_routes = {tool["name"]: routes(tool.get("route")) for tool in tools}
    done_by: dict[str, list[str]] = {tool: [] for tool in tool_names}
    lone_commands: list[str] = []
    unknown_tools: list[tuple[str, str]] = []
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
        if not matched:
            lone_commands.append(command["command"])
    lone_tools = sorted(tool for tool, by in done_by.items() if not by and tool not in covered)
    return {
        "name": name,
        "tools": len(tools),
        "commands": len(commands),
        "lone_tools": lone_tools,
        "lone_commands": lone_commands,
        "unknown_tools": unknown_tools,
        "covered": {tool: how for tool, how in covered.items() if tool in tool_names},
    }


def main() -> int:
    sites = [
        compare(folder.name)
        for folder in sorted(PLATFORMS.iterdir())
        if (folder / "tool_manifest.json").is_file()
    ]
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
        console.print(table)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
