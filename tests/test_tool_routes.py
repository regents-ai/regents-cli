"""A command that names one of its site's WebMCP tools (`webmcp`) does what that tool does: the
tool is in the site's pinned tool list, and calls the command's own method and path. A site that
moves a route in one and not the other sends an agent's browser and its command line to two
addresses, one of them gone. The names inside {braces} may differ (Patchbay's tool list says
{payment_intent_id} where its command says {id}): that is the same address. A tool with no
`route` is not compared. `python -m regents_cli.check_commands` checks each command's route
against the site's pinned API contract."""

from __future__ import annotations

import re

import pytest

from regents_cli import webmcp_host
from regents_cli.platforms import Command, Platform, pinned_platforms

PLATFORMS = pinned_platforms()
TOOLS = {
    platform.name: {tool["name"]: tool for tool in webmcp_host.tool_manifest(platform)["tools"]}
    for platform in PLATFORMS
}
NAMING = [
    (platform, command, command.webmcp)
    for platform in PLATFORMS
    for command in platform.commands
    if command.webmcp is not None
]
ROUTED = [
    (platform, command, TOOLS[platform.name][tool]["route"])
    for platform, command, tool in NAMING
    if "route" in TOOLS[platform.name].get(tool, {})
]


def named(case: tuple[Platform, Command, str]) -> str:
    platform, command, _ = case
    return f"{platform.name} {' '.join(command.words)}"


def address(route: str) -> str:
    """A route with the names inside its braces left out: "GET /a/{id}" as "GET /a/{}"."""
    return re.sub(r"\{[^}]*\}", "{}", route)


@pytest.mark.parametrize("case", NAMING, ids=named)
def test_a_command_names_a_tool_its_site_lists(case: tuple[Platform, Command, str]) -> None:
    platform, _, tool = case
    assert tool in TOOLS[platform.name]


@pytest.mark.parametrize("case", ROUTED, ids=named)
def test_a_named_tool_calls_the_commands_route(case: tuple[Platform, Command, str]) -> None:
    _, command, route = case
    assert address(route) == address(f"{command.method} {command.path}")
