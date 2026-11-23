"""`regents overview`: one unified account view across Keyfleet, Autolaunch, Patchbay & Techtree.

Calls `GET /api/agent/v1/account/overview` (the same Ash-backed summary shown on
`https://regents.sh/account` and exposed over MCP and WebMCP as `regents_account_overview`).
For humans at a terminal it renders a concise cross-product status board showing Keys vs no Keys,
portfolio vs no portfolio, posts & agent offers vs neither, and projects vs no projects, followed
by concrete next steps. With `--json` it prints the structured payload for agents.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any, Final

import click
from rich.console import Group, RenderableType
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from regents_cli import output, siwa
from regents_cli.errors import CommandError
from regents_cli.http import Request, base_address, send
from regents_cli.next_steps import Step, done, human, run
from regents_cli.platforms import DEFAULT_TIMEOUT_MS, Platform

OVERVIEW_PATH: Final = "/api/agent/v1/account/overview"
PRODUCTS: Final = ("all", "keyfleet", "autolaunch", "patchbay", "techtree")


def overview_command(platforms: list[Platform]) -> click.Command:
    protocol = next((p for p in platforms if p.name == "protocol"), platforms[0])

    @click.command(
        "overview",
        help="Read your person's unified account overview across every Regents product: Keyfleet "
        "(Keys held vs none), Autolaunch (portfolio bids, settlements, launches, drafts), Patchbay "
        "(forum posts, replies, agent offers campaigns & active leases), Techtree (delivered "
        "projects, watchdog hosts, model climb reports), paired agents, Points, and tailored next "
        "steps.\n\n"
        "Same as the WebMCP and MCP tool regents_account_overview on regents.sh.\n\n"
        "Sign in first: regents auth login.",
    )
    @click.option(
        "--product",
        type=click.Choice(PRODUCTS),
        default="all",
        show_default=True,
        help="Focus on one product section, or show all four.",
    )
    @click.option("--json", "as_json", is_flag=True, help="Print the answer as JSON.")
    @click.option(
        "--base-url",
        help="The site's address; also PROTOCOL_BASE_URL or REGENTS_BASE_URL.",
    )
    @click.option(
        "--timeout-ms",
        type=click.IntRange(1, 300_000),
        default=DEFAULT_TIMEOUT_MS,
        show_default=True,
        help="How long to wait for the answer.",
    )
    def overview(product: str, as_json: bool, base_url: str | None, timeout_ms: int) -> None:
        base = base_address(
            base_url,
            protocol.env_var,
            protocol.base_url,
            fallback_env_var=protocol.fallback_env_var,
        )
        siwa.signs_for(protocol.site, base, timeout_ms)
        receipt = siwa.current(protocol.site, timeout_ms)
        request = Request("GET", OVERVIEW_PATH)
        signed = replace(request, headers=siwa.sign(request, receipt, base))
        summary = send(base, signed, timeout_ms)
        if not isinstance(summary, dict) or "account" not in summary:
            raise CommandError(
                "invalid_response",
                "The site answered, but not with an account overview.",
            )
        shared = [*(["--base-url", base_url] if base_url else []), *(["--json"] if as_json else [])]
        payload = _filtered_payload(summary, product)
        steps = _next_steps(summary, base, product, shared)
        shown = None if as_json else _render_dashboard(summary, base, product)
        output.emit(payload, as_json=as_json, next_steps=steps, shown=shown)

    return overview


def _filtered_payload(summary: dict[str, Any], product: str) -> dict[str, Any]:
    if product == "all":
        return summary
    return {
        "account": summary.get("account"),
        product: summary.get(product),
        "server_next_steps": [
            item
            for item in _list(summary.get("next_steps"))
            if item.get("product") in (product, "account", None)
        ],
    }


def _render_dashboard(summary: dict[str, Any], base: str, product: str) -> list[RenderableType]:
    account = _dict(summary.get("account"))
    blocks: list[RenderableType] = [_account_panel(account, base)]
    if product == "all":
        blocks.append(_products_matrix(summary))
        for name in ("keyfleet", "autolaunch", "patchbay", "techtree"):
            detail = _product_detail(name, _dict(summary.get(name)), verbose=False)
            if detail is not None:
                blocks.append(detail)
    else:
        detail = _product_detail(product, _dict(summary.get(product)), verbose=True)
        if detail is not None:
            blocks.append(detail)
    return blocks


def _account_panel(account: dict[str, Any], base: str) -> RenderableType:
    name = account.get("display_name") or account.get("ens_name") or "Regents account"
    grid = Table.grid(padding=(0, 2))
    grid.add_column(style="bold", no_wrap=True)
    grid.add_column(overflow="fold")
    if account.get("ens_name"):
        grid.add_row("ENS", str(account["ens_name"]))
    wallet = account.get("wallet_address") or account.get("primary_wallet")
    wallet_count = _int(account.get("wallet_count"))
    if wallet:
        wallet_line = f"{wallet} ({wallet_count} linked)" if wallet_count > 1 else str(wallet)
    else:
        wallet_line = "none verified yet"
    grid.add_row("Wallet", wallet_line)
    points_balance = account.get("points_balance")
    if points_balance is not None:
        grid.add_row("Points", str(points_balance))
    agents_count = _int(account.get("paired_agents_count"))
    paired_agents = _list(account.get("paired_agents"))
    if paired_agents:
        names = ", ".join(
            f"{a.get('name', 'agent')} ({a.get('harness', 'other')})" for a in paired_agents[:4]
        )
        grid.add_row("Paired agents", f"{agents_count} — {names}")
    else:
        grid.add_row("Paired agents", str(agents_count))
    if account.get("agent_wallet"):
        grid.add_row("Signing agent", str(account["agent_wallet"]))
    grid.add_row("Account page", f"{base}/account")
    return Panel(grid, title=f"Account · {name}", title_align="left", border_style="cyan")


def _products_matrix(summary: dict[str, Any]) -> RenderableType:
    table = Table(
        title="Products",
        title_justify="left",
        box=None,
        pad_edge=False,
        padding=(0, 2, 0, 0),
        header_style="bold",
    )
    table.add_column("Product", style="bold", no_wrap=True)
    table.add_column("State", no_wrap=True)
    table.add_column("Summary", overflow="fold")

    kf = _dict(summary.get("keyfleet"))
    kf_has = bool(kf.get("has_keys"))
    kf_detail = (
        f"{_int(kf.get('keys_count'))} Keys across {_int(kf.get('fleets_count'))} fleet(s), "
        f"{_int(kf.get('assigned_agents_count'))} assigned agent(s)"
        if kf_has
        else "No Keys held yet"
    )
    table.add_row("Keyfleet", _badge(kf_has, "Has Keys", "No Keys"), kf_detail)

    al = _dict(summary.get("autolaunch"))
    al_has = bool(al.get("has_portfolio"))
    if al_has:
        parts = [
            f"{_int(al.get('bids_count'))} bid(s)",
            f"{_int(al.get('bids_to_settle_count'))} to settle",
            f"{_int(al.get('auctions_created_count'))} created",
            f"{_int(al.get('drafts_count'))} draft(s)",
        ]
        al_detail = " · ".join(parts)
    elif al.get("has_wallet") is False:
        al_detail = "No verified wallet connected yet"
    else:
        al_detail = "No bids, launches, or drafts yet"
    table.add_row("Autolaunch", _badge(al_has, "Active", "Empty"), al_detail)

    pb = _dict(summary.get("patchbay"))
    pb_posts = bool(pb.get("has_posts"))
    pb_offers = bool(pb.get("has_agent_offers"))
    pb_has = pb_posts or pb_offers
    if pb_has:
        pb_parts = [
            f"{_int(pb.get('posts_count'))} post(s)",
            f"{_int(pb.get('replies_count'))} repl(ies)",
        ]
        if pb.get("offers_enabled") or pb_offers:
            pb_parts.append(
                f"{_int(pb.get('campaigns_count'))} offer campaign(s), "
                f"{_int(pb.get('active_leases_count'))} active lease(s)"
            )
        pb_detail = " · ".join(pb_parts)
    else:
        pb_detail = "No forum posts or agent offers yet"
    pb_state = (
        "Posts & Offers"
        if pb_posts and pb_offers
        else "Has Posts"
        if pb_posts
        else "Has Offers"
        if pb_offers
        else "Empty"
    )
    table.add_row("Patchbay", _badge(pb_has, pb_state, "Empty"), pb_detail)

    tt = _dict(summary.get("techtree"))
    tt_has = bool(tt.get("has_projects"))
    tt_parts = [f"{_int(tt.get('projects_count'))} delivered project(s)"]
    if _int(tt.get("watchdog_hosts_count")):
        tt_parts.append(f"{_int(tt.get('watchdog_hosts_count'))} watchdog host(s)")
    if _int(tt.get("model_climb_reports_count")):
        tt_parts.append(f"{_int(tt.get('model_climb_reports_count'))} climb report(s)")
    tt_detail = " · ".join(tt_parts) if (tt_has or len(tt_parts) > 1) else "No projects yet"
    table.add_row("Techtree", _badge(tt_has, "Has Projects", "No Projects"), tt_detail)

    return table


def _product_detail(name: str, data: dict[str, Any], *, verbose: bool) -> RenderableType | None:
    if name == "keyfleet":
        keys = _list(data.get("keys"))
        if not keys and not verbose:
            return None
        if not keys:
            return Panel(
                Text(
                    "No Keys held in any fleet yet. Browse fleets with "
                    "`regents keyfleet fleets list`."
                ),
                title="Keyfleet · No Keys",
                title_align="left",
            )
        table = Table(box=None, pad_edge=False, padding=(0, 2, 0, 0), header_style="bold")
        table.add_column("Fleet")
        table.add_column("Key")
        table.add_column("Assigned agents")
        for item in keys[:10]:
            table.add_row(
                str(item.get("fleet_name") or item.get("fleet_id") or "-"),
                f"#{item.get('token_id', '-')}",
                str(_int(item.get("assigned_agents_count"))),
            )
        return Panel(table, title=f"Keyfleet · {len(keys)} Key(s)", title_align="left")

    if name == "autolaunch":
        bids = _list(data.get("recent_bids"))
        created = _list(data.get("created_auctions"))
        if not bids and not created and not verbose:
            return None
        lines: list[RenderableType] = []
        if bids:
            btable = Table(box=None, pad_edge=False, padding=(0, 2, 0, 0), header_style="bold")
            btable.add_column("Bid auction")
            btable.add_column("Status")
            btable.add_column("Amount")
            for bid in bids[:5]:
                btable.add_row(
                    str(
                        bid.get("auction_title")
                        or bid.get("token_symbol")
                        or bid.get("bid_id")
                        or "-"
                    ),
                    str(bid.get("status") or "-"),
                    str(bid.get("amount") or "-"),
                )
            lines.append(btable)
        if created:
            ctable = Table(box=None, pad_edge=False, padding=(0, 2, 0, 0), header_style="bold")
            ctable.add_column("Created launch")
            ctable.add_column("Kind")
            ctable.add_column("State")
            for auc in created[:5]:
                ctable.add_row(
                    str(auc.get("title") or auc.get("token_symbol") or auc.get("id") or "-"),
                    str(auc.get("kind") or "-"),
                    str(auc.get("state") or "-"),
                )
            lines.append(ctable)
        if not lines:
            lines.append(
                Text(
                    "No Autolaunch bids, launches, or drafts yet. Browse live auctions with "
                    "`regents autolaunch auctions list`."
                )
            )
        return Panel(Group(*lines), title="Autolaunch · Portfolio", title_align="left")

    if name == "patchbay":
        posts = _list(data.get("recent_posts"))
        campaigns = _list(data.get("campaigns"))
        if not posts and not campaigns and not verbose:
            return None
        lines = []
        if posts:
            ptable = Table(box=None, pad_edge=False, padding=(0, 2, 0, 0), header_style="bold")
            ptable.add_column("Post")
            ptable.add_column("Kind")
            ptable.add_column("Solved")
            for post in posts[:5]:
                ptable.add_row(
                    str(post.get("title") or post.get("id") or "-"),
                    str(post.get("kind") or "post"),
                    "yes" if post.get("solved") else "open",
                )
            lines.append(ptable)
        if campaigns:
            otable = Table(box=None, pad_edge=False, padding=(0, 2, 0, 0), header_style="bold")
            otable.add_column("Offer campaign")
            otable.add_column("Review")
            otable.add_column("Leases")
            for camp in campaigns[:5]:
                otable.add_row(
                    str(camp.get("title") or camp.get("campaign_id") or "-"),
                    str(camp.get("review") or "waiting"),
                    str(_int(camp.get("leases_count"))),
                )
            lines.append(otable)
        if not lines:
            lines.append(
                Text(
                    "No Patchbay posts or agent offers yet. Search threads with "
                    "`regents patchbay threads search --sort recent`."
                )
            )
        return Panel(Group(*lines), title="Patchbay · Activity & Offers", title_align="left")

    if name == "techtree":
        projects = _list(data.get("projects"))
        if not projects and not verbose:
            return None
        if not projects:
            return Panel(
                Text(
                    "No delivered Techtree projects yet. Run `regents techtree results list` "
                    "or `regents techtree setup`."
                ),
                title="Techtree · No Projects",
                title_align="left",
            )
        table = Table(box=None, pad_edge=False, padding=(0, 2, 0, 0), header_style="bold")
        table.add_column("Project")
        table.add_column("Service")
        table.add_column("Verdict")
        for proj in projects[:8]:
            table.add_row(
                str(proj.get("title") or proj.get("id") or "-"),
                str(proj.get("line") or proj.get("service") or "-"),
                str(proj.get("verdict") or "-"),
            )
        return Panel(table, title=f"Techtree · {len(projects)} Project(s)", title_align="left")

    return None


def _next_steps(summary: dict[str, Any], base: str, product: str, shared: list[str]) -> list[Step]:
    steps: list[Step] = []
    server_steps = _list(summary.get("next_steps"))
    for item in server_steps:
        if product != "all" and item.get("product") not in (product, None):
            continue
        label = str(item.get("message") or item.get("label") or item.get("say") or "").strip()
        cli_cmd = item.get("cli")
        href = item.get("path") or item.get("href") or item.get("url")
        if not label:
            continue
        if isinstance(cli_cmd, str) and cli_cmd.strip():
            steps.append(Step("run", label, cli_cmd.strip()))
        elif isinstance(href, str) and href.strip():
            url = href if href.startswith(("http://", "https://")) else base + href
            steps.append(human(label, url))
        else:
            steps.append(human(label))
    if product in ("all", "keyfleet") and not _dict(summary.get("keyfleet")).get("has_keys"):
        steps.append(
            run(["regents", "keyfleet", "fleets", "list", *shared], "Explore Keyfleet fleets.")
        )
    if product in ("all", "autolaunch") and _dict(summary.get("autolaunch")).get("has_portfolio"):
        steps.append(
            run(["regents", "autolaunch", "positions", *shared], "Inspect Autolaunch positions.")
        )
    if product in ("all", "techtree") and _dict(summary.get("techtree")).get("has_projects"):
        steps.append(
            run(
                ["regents", "techtree", "account", "projects", *shared],
                "List delivered Techtree projects.",
            )
        )
    return steps or [done("Account overview read; nothing more to run.")]


def _badge(active: bool, yes_label: str, no_label: str) -> Text:
    return (
        Text(f"✓ {yes_label}", style="bold green") if active else Text(f"- {no_label}", style="dim")
    )


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _int(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0
