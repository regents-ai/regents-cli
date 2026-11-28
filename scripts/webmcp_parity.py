"""Verify 3-way parity across CLI commands, WebMCP tool manifests, and Hosted `/mcp` tools.

Every pinned site's commands (`commands.json`) and WebMCP tool manifests (`tool_manifest.json`
plus any `*_tools.json` fragments) live under `src/regents_cli/platforms/<site>/`.

For each site:
1. CLI <-> WebMCP: a command and a WebMCP tool match when the command names the tool (`webmcp`)
   or when both hit the same route (method and path, regardless of placeholder names). Any
   unknown `webmcp` reference, unexcused WebMCP tool without a CLI command, or unexcused CLI
   command without a WebMCP tool fails the check.
2. WebMCP <-> Hosted `/mcp` (across the five unified `regents.sh` products: `protocol`,
   `autolaunch`, `keyfleet`, `patchbay`, `techtree`): every non-owner-wallet tool (except the
   bootstrap pairing tool `agents_pair`) must declare its Hosted `/mcp` name via
   `interfaces.mcp` or `hosted: true` + `hosted_name`.

    uv run scripts/webmcp_parity.py           # print the 3-way parity report and fail on gaps
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.table import Table

from regents_cli.platforms import Platform
from regents_cli.webmcp_host import tool_manifest

ROOT = Path(__file__).resolve().parent.parent
PLATFORMS = ROOT / "src/regents_cli/platforms"

#: Unified one-site products sharing `https://regents.sh/mcp`.
UNIFIED_MCP_SITES = frozenset({"protocol", "autolaunch", "keyfleet", "patchbay", "techtree"})

#: Tools whose job `regents` does with its own hand-written commands rather than a site command.
COVERED_BY_CLI: dict[str, dict[str, str]] = {
    "protocol": {
        "regents_account_overview": "regents overview",
    },
    "techtree": {
        "techtree_catalog": "techtree catalog / techtree climb list",
        "techtree_bootstrap": "techtree bootstrap / techtree setup",
        "techtree_climb": "techtree climb show",
        "techtree_publication_bundle": "techtree results bundle / techtree proof verify",
        "techtree_publication_submit": "techtree publish",
        "techtree_skill": "techtree skills show / techtree skill fetch",
        "techtree_account_project_package": "techtree account project-package",
        "techtree_orders_create": "techtree orders create",
        "techtree_model_climb_submit": "techtree model submit",
    },
}

#: Commands with no WebMCP page tool on purpose.
CLI_ONLY: dict[str, dict[str, str]] = {
    "ash-template": {
        "agents pair": "shared SIWA pairing flow",
        "feed": "server-sent events stream, not a request/response page tool",
    },
    "autolaunch": {
        "agents pair": "shared SIWA pairing flow",
    },
    "keyfleet": {
        "feed": "server-sent events stream, not a request/response page tool",
    },
    "patchbay": {
        "agents pair": "shared SIWA pairing flow",
        "health": "shared regents.sh health read on protocol (regents_health)",
    },
    "protocol": {
        "agents pair": "shared SIWA pairing flow",
    },
    "techtree": {
        "agents whoami": "shared SIWA check on protocol",
        "agents pair": "shared SIWA pairing on protocol",
        "account points": "shared Regent Points read on protocol",
    },
}

#: Tools with no CLI command on purpose: owner-wallet browser actions or markdown-only guides.
SITE_ONLY: dict[str, dict[str, str]] = {
    "techtree": {
        "techtree_docs_markdown": "reads the Docs index as Markdown",
    },
    "keyfleet": {
        "proposals_create": "owner-wallet approval flow on the site",
        "proposals_vote": "owner-wallet approval flow on the site",
        "proposals_cancel": "owner-wallet approval flow on the site",
        "proposals_carry_out": "owner-wallet approval flow on the site",
        "keys_mark_present": "owner-wallet approval flow on the site",
        "keys_claim": "owner-wallet approval flow on the site",
        "keys_claim_all": "owner-wallet approval flow on the site",
        "treasury_release": "owner-wallet approval flow on the site",
        "treasury_send_share": "owner-wallet approval flow on the site",
        "treasury_buy_regent": "owner-wallet approval flow on the site",
    },
    "patchbay": {
        "get_my_usdc_balance": "the owner's wallet tool",
        "tip_agent": "the owner's wallet tool; it spends the owner's USDC",
        "accept_solution": "the owner's wallet tool; it moves USDC",
        "withdraw_priority_report": "the owner's wallet tool; it moves USDC",
        "get_webmcp_guide": "browser-only guide to WebMCP",
        "sites_markdown": "Markdown view of sites list",
        "render_repair_card": "browser repair-card alias of get_thread",
    },
}

#: Non-owner tools intentionally omitted from Hosted `/mcp` (bootstrap pairing only).
MCP_EXEMPT: dict[str, set[str]] = {
    "keyfleet": {"agents_pair"},
}

#: Tool authentication values that belong exclusively to human browser wallets (never `/mcp`).
OWNER_WALLET_AUTH = frozenset({"owner_only", "owner_wallet_approval"})

console = Console(highlight=False)


def routes(text: str | None) -> set[str]:
    """`GET /a/{id}, GET /b` as {"GET /a/{}", "GET /b"}; nothing for a tool with no route."""
    if not text or " /" not in text:
        return set()
    return {re.sub(r"\{[^}]*\}", "{}", part.strip()) for part in text.split(",")}


def routes_overlap(cmd_routes: set[str], tool_routes: set[str]) -> bool:
    """True when a command route matches a tool route directly or via `{}` path parameter."""
    if cmd_routes & tool_routes:
        return True
    for cmd_route in cmd_routes:
        pattern = "^" + re.escape(cmd_route).replace(r"\{\}", r"[^/]+") + "$"
        if any(re.match(pattern, tool_route) for tool_route in tool_routes):
            return True
    return False


def mcp_name_for(tool: dict[str, Any]) -> str | None:
    interfaces = tool.get("interfaces")
    if (
        isinstance(interfaces, dict)
        and isinstance(interfaces.get("mcp"), str)
        and interfaces["mcp"]
    ):
        return str(interfaces["mcp"])
    if tool.get("hosted") is True:
        hosted_name = tool.get("hosted_name") or tool.get("name")
        if isinstance(hosted_name, str) and hosted_name:
            return hosted_name
    return None


def compare(name: str) -> dict[str, Any]:
    folder = PLATFORMS / name
    description = json.loads((folder / "commands.json").read_text("utf-8"))
    commands = description["commands"]
    tools = tool_manifest(Platform.parse(description))["tools"]
    covered = COVERED_BY_CLI.get(name, {})
    cli_only = CLI_ONLY.get(name, {})
    site_only = SITE_ONLY.get(name, {})
    mcp_exempt = MCP_EXEMPT.get(name, set())

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
        matched = {tool for tool, served in tool_routes.items() if routes_overlap(route, served)}
        if named in tool_names:
            matched.add(named)
        for tool in matched:
            done_by[tool].append(command["command"])
        if not matched and command["command"] not in cli_only:
            lone_commands.append(command["command"])

    lone_tools = sorted(
        tool for tool, by in done_by.items() if not by and tool not in covered | site_only
    )

    mcp_mapped = 0
    missing_mcp: list[str] = []
    for tool in tools:
        tname = tool["name"]
        auth = tool.get("authentication")
        mapped = mcp_name_for(tool)
        if mapped is not None:
            mcp_mapped += 1
        elif (
            name in UNIFIED_MCP_SITES and auth not in OWNER_WALLET_AUTH and tname not in mcp_exempt
        ):
            missing_mcp.append(tname)

    return {
        "name": name,
        "tools": len(tools),
        "commands": len(commands),
        "mcp_tools": mcp_mapped,
        "lone_tools": lone_tools,
        "lone_commands": lone_commands,
        "unknown_tools": unknown_tools,
        "missing_mcp": sorted(missing_mcp),
        "covered": {tool: how for tool, how in covered.items() if tool in tool_names},
        "site_only": {tool: why for tool, why in site_only.items() if tool in tool_names},
        "cli_only": {
            command: why
            for command, why in cli_only.items()
            if command in {c["command"] for c in commands}
        },
    }


def report(sites: list[dict[str, Any]]) -> int:
    summary = Table(title="3-way parity: WebMCP tools, CLI commands, and Hosted /mcp")
    for column in (
        "Site",
        "WebMCP",
        "CLI",
        "Hosted /mcp",
        "CLI↔WebMCP gaps",
        "MCP gaps",
    ):
        summary.add_column(column, justify="left" if column == "Site" else "right")
    total_gaps = 0
    for site in sites:
        cli_gaps = len(site["lone_tools"]) + len(site["lone_commands"]) + len(site["unknown_tools"])
        mcp_gaps = len(site["missing_mcp"])
        total_gaps += cli_gaps + mcp_gaps
        summary.add_row(
            site["name"],
            str(site["tools"]),
            str(site["commands"]),
            str(site["mcp_tools"]) if site["name"] in UNIFIED_MCP_SITES else "—",
            str(cli_gaps),
            str(mcp_gaps),
        )
    console.print(summary)
    for site in sites:
        table = Table(title=site["name"], show_header=True, title_justify="left")
        table.add_column("Gap", style="bold")
        table.add_column("Names")
        if site["lone_tools"]:
            table.add_row(
                "[red]WebMCP tools with no CLI command[/red]", ", ".join(site["lone_tools"])
            )
        if site["lone_commands"]:
            table.add_row(
                "[red]CLI commands with no WebMCP tool[/red]", ", ".join(site["lone_commands"])
            )
        for command, tool in site["unknown_tools"]:
            table.add_row("[red]CLI names unknown WebMCP tool[/red]", f"{command} → {tool}")
        if site["missing_mcp"]:
            table.add_row(
                "[red]WebMCP tools missing Hosted /mcp mapping[/red]",
                ", ".join(site["missing_mcp"]),
            )
        for tool, how in site["covered"].items():
            table.add_row("[dim]Done by regents itself[/dim]", f"[dim]{tool}: {how}[/dim]")
        for tool, why in site["site_only"].items():
            table.add_row("[dim]Site only[/dim]", f"[dim]{tool}: {why}[/dim]")
        for command, why in site["cli_only"].items():
            table.add_row("[dim]Command line only[/dim]", f"[dim]{command}: {why}[/dim]")
        if table.row_count:
            console.print(table)
    if total_gaps:
        console.print(
            f"[bold red]{total_gaps} parity gap(s) found across CLI / WebMCP / MCP.[/bold red]"
        )
        return 1
    console.print("[bold green]3-way parity verified cleanly across all sites.[/bold green]")
    return 0


def main(args: list[str]) -> int:
    if args:
        console.print(f"[red]unknown arguments:[/red] {' '.join(args)}")
        return 2
    names = sorted(path.parent.name for path in PLATFORMS.glob("*/commands.json"))
    missing = [name for name in names if not (PLATFORMS / name / "tool_manifest.json").is_file()]
    if missing:
        console.print(f"[red]Pinned sites with no tool manifest:[/red] {', '.join(missing)}")
        return 1
    return report([compare(name) for name in names])


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
