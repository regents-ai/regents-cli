"""The two commands an agent host runs as local MCP servers: `regents browser` for a site's pages
and their WebMCP tools, and `regents mcp` for the site's hosted MCP server. Both are signed with
this machine's agent key. The MCP SDK and Playwright load only when one of them runs, so every
other command starts as fast as before.
"""

from __future__ import annotations

from pathlib import Path

import click

from regents_cli import siwa
from regents_cli.errors import CommandError
from regents_cli.http import base_address
from regents_cli.next_steps import human
from regents_cli.platforms import DEFAULT_TIMEOUT_MS, Platform

#: Installs the Chromium that the browser extra's Playwright release drives.
INSTALL_CHROMIUM = "uvx --from 'playwright==1.64.*' playwright install chromium"

BASE_URL = click.Option(
    ["--base-url"],
    help="The site's address, such as http://localhost:4000 for a site on this machine.",
)


def browser_command(platforms: list[Platform]) -> click.Command:
    sites = {platform.site: platform for platform in platforms}

    @click.command(
        "browser",
        help="A site's pages and the tools each page offers, for your agent host. Add it to your "
        "agent host as a local MCP server: regents browser --site <site>. Pages open in a "
        "hidden browser of its own with a fresh profile, never your own browser, and a signed "
        "tool is signed with this machine's agent key, once for each call.",
        params=[BASE_URL],
    )
    @click.option("--site", required=True, type=click.Choice(sorted(sites)), help="The site.")
    @click.option("--show-browser", is_flag=True, help="Show the browser window.")
    def run(site: str, base_url: str | None, show_browser: bool) -> None:
        from regents_cli import webmcp_host

        platform = sites[site]
        origin = base_address(base_url, platform.env_var, platform.base_url)
        _ready_to_browse()
        bridge = webmcp_host.Bridge(
            origin=origin,
            manifest=webmcp_host.tool_manifest(platform),
            sign=webmcp_host.key_signer(platform.site),
        )
        host = webmcp_host.PageHost(bridge=bridge, show=show_browser)
        webmcp_host.server(platform, host).run("stdio")

    return run


def mcp_command(platforms: list[Platform]) -> click.Command:
    sites = {platform.site: platform for platform in platforms}

    @click.command(
        "mcp",
        help="A site's MCP server, for your agent host. Add it to your agent host as a local "
        "MCP server: regents mcp --site <site>. Each message is signed with this machine's "
        "agent key, so the site knows your agent without a token.",
        params=[BASE_URL],
    )
    @click.option("--site", required=True, type=click.Choice(sorted(sites)), help="The site.")
    def run(site: str, base_url: str | None) -> None:
        import anyio

        from regents_cli import mcp_proxy, webmcp_host

        platform = sites[site]
        origin = base_address(base_url, platform.env_var, platform.base_url)
        siwa.current(platform.site, DEFAULT_TIMEOUT_MS)
        anyio.run(mcp_proxy.serve, f"{origin}/mcp", webmcp_host.key_signer(platform.site))

    return run


def _ready_to_browse() -> None:
    """Refuse to start without Playwright and its Chromium, saying how to add them."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise CommandError(
            "installation_incomplete",
            "regents browser needs the browser extra, which this installation lacks.",
            next_steps=[
                human(
                    "Install regents-cli with its browser extra: uv tool install --python 3.14 "
                    "'regents-cli[browser]'. Then install its Chromium: "
                    f"{INSTALL_CHROMIUM}"
                )
            ],
        ) from None
    with sync_playwright() as playwright:
        executable = playwright.chromium.executable_path
    if not Path(executable).is_file():
        raise CommandError(
            "installation_incomplete",
            "regents browser needs Playwright's Chromium, which is not on this machine.",
            next_steps=[human(f"Install it with {INSTALL_CHROMIUM}, then start again.")],
        )
