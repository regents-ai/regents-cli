"""The two commands an agent host runs as local MCP servers: `regents browser` for a site's pages
and their WebMCP tools, and `regents mcp` for the site's hosted MCP server. Both are signed with
this machine's agent key. The MCP SDK and Playwright load only when one of them runs, so every
other command starts as fast as before.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from importlib import import_module
from pathlib import Path

import click

from regents_cli import siwa
from regents_cli.errors import CommandError
from regents_cli.http import Request, base_address
from regents_cli.next_steps import human
from regents_cli.platforms import DEFAULT_TIMEOUT_MS, Platform, canonical_site

#: Installs regents-cli with what `regents browser` and `regents mcp` both need. One line for
#: both: a later `uv tool install` replaces the extras an earlier one chose.
INSTALL = "uv tool install --python 3.14 'regents-cli[browser,mcp]'"
#: Installs the Chromium `regents browser` drives.
INSTALL_CHROMIUM = "uvx --from 'playwright==1.64.*' playwright install chromium"
#: Where a site's hosted MCP server takes messages, under the site's address.
MCP_PATH = "/mcp"

type Signer = Callable[[Request], Awaitable[dict[str, str]]]

BASE_URL = click.Option(
    ["--base-url"],
    help="The site's address, such as http://localhost:4000 for a site on this machine.",
)


def _site_map(platforms: list[Platform]) -> dict[str, Platform]:
    """Map each canonical site and unified product alias to its primary platform."""
    sites: dict[str, Platform] = {}
    for platform in sorted(platforms, key=lambda p: (0 if p.name == "protocol" else 1, p.name)):
        sites.setdefault(platform.site, platform)
        sites.setdefault(platform.name, sites[platform.site])
    return sites


def browser_command(platforms: list[Platform]) -> click.Command:
    sites = _site_map(platforms)
    default_site = "regents" if "regents" in sites else sorted(sites)[0]

    @click.command(
        "browser",
        help="A site's pages and the tools each page offers, for your agent host. Add it to your "
        "agent host as a local MCP server: regents browser (defaults to regents.sh across all "
        "products, or pass --site <site>). Pages open in a hidden browser of its own with a fresh "
        "profile, never your own browser, and a signed tool is signed with this machine's agent "
        "key, once for each call.\n\n"
        f"Install it, then its Chromium:\n\n\b\n{INSTALL}\n{INSTALL_CHROMIUM}",
        params=[BASE_URL],
    )
    @click.option(
        "--site",
        default=default_site,
        show_default=True,
        type=click.Choice(sorted(sites)),
        callback=lambda _ctx, _param, value: canonical_site(value),
        help="The site (defaults to regents for unified regents.sh).",
    )
    @click.option("--show-browser", is_flag=True, help="Show the browser window.")
    def run(site: str, base_url: str | None, show_browser: bool) -> None:
        platform = sites[site]
        origin = base_address(
            base_url,
            platform.env_var,
            platform.base_url,
            fallback_env_var=platform.fallback_env_var,
        )
        ready_to_browse()
        from regents_cli import webmcp_host

        bridge = webmcp_host.Bridge(
            origin=origin,
            manifest=webmcp_host.browser_tool_manifest(platform, platforms),
            sign=key_signer(platform.site, origin),
        )
        host = webmcp_host.PageHost(bridge=bridge, show=show_browser)
        webmcp_host.server(platform, host).run("stdio")

    return run


def mcp_command(platforms: list[Platform]) -> click.Command:
    sites = _site_map(platforms)
    default_site = "regents" if "regents" in sites else sorted(sites)[0]

    @click.command(
        "mcp",
        help="A site's hosted MCP server, for your agent host. Add it to your agent host as a "
        "local MCP server: regents mcp (defaults to unified regents.sh/mcp covering Protocol, "
        "Keyfleet, Autolaunch, Patchbay & Techtree, or pass --site <site>). Each message is "
        "signed with this machine's agent key, so the site knows your agent without a token.\n\n"
        f"Install it:\n\n\b\n{INSTALL}",
        params=[BASE_URL],
    )
    @click.option(
        "--site",
        default=default_site,
        show_default=True,
        type=click.Choice(sorted(sites)),
        callback=lambda _ctx, _param, value: canonical_site(value),
        help="The site (defaults to regents for unified regents.sh/mcp).",
    )
    def run(site: str, base_url: str | None) -> None:
        ready_to_proxy()
        import anyio

        from regents_cli import mcp_proxy

        platform = sites[site]
        origin = base_address(
            base_url,
            platform.env_var,
            platform.base_url,
            fallback_env_var=platform.fallback_env_var,
        )
        siwa.current(platform.site, DEFAULT_TIMEOUT_MS)
        anyio.run(mcp_proxy.serve, origin + MCP_PATH, key_signer(platform.site, origin))

    return run


def key_signer(site: str, origin: str) -> Signer:
    """Signs for `origin`'s host with this machine's agent key and its sign-in to `site`, renewed
    when due."""

    async def sign(request: Request) -> dict[str, str]:
        receipt = await asyncio.to_thread(siwa.current, site, DEFAULT_TIMEOUT_MS)
        return await asyncio.to_thread(siwa.sign, request, receipt, origin)

    return sign


def _installed(command: str, modules: tuple[str, ...], install: str) -> None:
    """Refuse to start when an extra the command needs is missing, saying how to add it."""
    for module in modules:
        try:
            import_module(module)
        except ImportError:
            raise CommandError(
                "installation_incomplete",
                f"{command} needs a part of regents-cli this installation lacks.",
                next_steps=[human(f"Install it with {install}, then start again.")],
            ) from None


def ready_to_proxy() -> None:
    """Refuse to start `regents mcp` without the mcp extra, saying how to add it."""
    _installed("regents mcp", ("anyio", "httpx2", "mcp", "mcp_types"), INSTALL)


def ready_to_browse() -> None:
    """Refuse to start without the browser extra and its Chromium, saying how to add them."""
    _installed("regents browser", ("jsonschema", "mcp", "playwright"), INSTALL)
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        executable = playwright.chromium.executable_path
    if not Path(executable).is_file():
        raise CommandError(
            "installation_incomplete",
            "regents browser needs Playwright's Chromium, which is not on this machine.",
            next_steps=[human(f"Install it with {INSTALL_CHROMIUM}, then start again.")],
        )
