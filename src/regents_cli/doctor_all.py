"""`regents doctor`: this machine and every site in one run, so an agent that is stuck learns the
one thing to do first.

This machine: the regents release and the Python it runs on, the agent key (its address, never
more), and whether `regents mcp` and `regents browser` can run. Each site, in turn: the checks
`regents <site> doctor` runs; once the sign-in server accepts the sign-in, whether a person's
account is paired with the agent, read from the site's own signed `agents whoami`; and whether the
site answers at the address `regents mcp` sends to, reached with a GET that is not signed and
starts nothing there. A site that answers that GET with 404 serves no hosted MCP.

It changes nothing on any site and signs only what those checks sign. A key locked behind Touch ID
is never opened: when no helper holds it unlocked, its sign-ins are left unchecked.
"""

from __future__ import annotations

from functools import partial
from importlib.metadata import version
from platform import python_version
from typing import Any

import click

from regents_cli import output, passkey, siwa
from regents_cli.agent_hosts import (
    INSTALL,
    INSTALL_CHROMIUM,
    MCP_PATH,
    ready_to_browse,
    ready_to_proxy,
)
from regents_cli.auth import pairing_status, probe_of
from regents_cli.doctor import (
    ACCEPTED,
    NOT_SIGNED_IN,
    SIGN_IN,
    UNCHECKED,
    Kind,
    check,
    reported,
    site_checks,
    updates,
)
from regents_cli.errors import CommandError
from regents_cli.http import Request, answer, base_address, respond
from regents_cli.next_steps import (
    Step,
    account_menu,
    done,
    human,
    not_served,
    pair_first,
    run,
    sign_in,
)
from regents_cli.platforms import DEFAULT_TIMEOUT_MS, Command, Platform
from regents_cli.runner import unpaired

AGENT_KEY = "agent key"
#: A key locked behind Touch ID that no helper holds unlocked now.
LOCKED = "locked"
#: The order a site's failures are fixed in: first what this regents or the person can clear,
#: last what only time or the site's team can.
ORDER: tuple[Kind, ...] = ("address", "sign_in", "pairing", "permission", "network", "site")


def doctor_all_command(platforms: list[Platform]) -> click.Command:
    choices = sorted({p.site for p in platforms} | {p.name for p in platforms})

    @click.command(
        "doctor",
        help="Check this machine and every site in one run: whether regents mcp and regents "
        "browser can run here, the agent key, and each site's answers, sign-in, pairing and "
        "hosted MCP. A failed check names its kind, and the answer ends with the one thing to do "
        "first. It changes nothing on any site and never opens a key locked behind Touch ID.",
    )
    @click.option(
        "--site",
        "named",
        multiple=True,
        type=click.Choice(choices),
        help="Check only this site or product namespace; give it again for another.",
    )
    @click.option(
        "--base-url",
        help="Override the site address (for example http://localhost:4010 for local dev).",
    )
    @click.option("--json", "as_json", is_flag=True, help="Print the answer as JSON.")
    @click.option(
        "--timeout-ms",
        type=click.IntRange(1, 300_000),
        default=DEFAULT_TIMEOUT_MS,
        show_default=True,
        help="How long to wait for each answer.",
    )
    def doctor(
        named: tuple[str, ...], base_url: str | None, as_json: bool, timeout_ms: int
    ) -> None:
        key = check(AGENT_KEY, agent_key)
        machine = [key, check("regents mcp", mcp_ready), check("regents browser", browser_ready)]
        may_sign = key["ok"] and key["code"] != LOCKED
        selected = [
            platform
            for platform in sorted(
                platforms, key=lambda p: (0 if p.name == "protocol" else 1, p.name)
            )
            if not named or platform.site in named or platform.name in named
        ]
        seen_origins: set[tuple[str, str]] = set()
        checked: list[tuple[Platform, dict[str, Any]]] = []
        for platform in selected:
            base = base_address(
                base_url,
                platform.env_var,
                platform.base_url,
                fallback_env_var=platform.fallback_env_var,
            )
            origin_key = (platform.site, base)
            include_shared = origin_key not in seen_origins
            seen_origins.add(origin_key)
            checked.append(
                (
                    platform,
                    site_report(
                        platform,
                        base,
                        timeout_ms,
                        may_sign=may_sign,
                        include_shared=include_shared,
                    ),
                )
            )
        found: dict[str, Any] = {
            "regents": version("regents-cli"),
            "python": python_version(),
            "machine": machine,
            "sites": [report for _, report in checked],
        }
        rows = [*machine, *(row for _, report in checked for row in report["checks"])]
        failed = [row for row in rows if not row["ok"]]
        if failed:
            again = ["regents", "doctor", *(word for site in named for word in ("--site", site))]
            again += ["--base-url", base_url] if base_url else []
            again += ["--json"] if as_json else []
            raise CommandError(
                "doctor_found_problems",
                f"{len(failed)} of {len(rows)} checks failed.",
                next_steps=[*updates(rows)[:1], *first_fix(machine, checked, again)],
                **found,
            )
        output.emit(found, as_json=as_json, next_steps=[*updates(rows)[:1], *all_held(rows)])

    return doctor


def site_report(
    platform: Platform,
    base: str,
    timeout_ms: int,
    *,
    may_sign: bool,
    include_shared: bool = True,
) -> dict[str, Any]:
    """The site's own doctor checks, its pairing once the sign-in server accepts the sign-in,
    and its hosted MCP address."""
    checks = site_checks(
        platform, base, timeout_ms, may_sign=may_sign, include_shared=include_shared
    )
    if include_shared:
        probe = probe_of(platform)
        accepted = any(c["check"] == SIGN_IN and c["code"] == ACCEPTED for c in checks)
        if probe is not None and accepted:
            checks.append(check("pairing", partial(paired, platform, probe, timeout_ms, base)))
        checks.append(check("hosted MCP", partial(mcp_answers, base, timeout_ms)))
    return {
        "site": platform.site,
        "product": platform.name,
        "base_url": base,
        "checks": checks,
    }


def agent_key() -> tuple[str, str]:
    """This machine's agent key, by its address and how it signs; never the key itself."""
    key = siwa.load_key()
    if key is None:
        return "no_key", f"No agent key in {siwa.home()} yet; the first sign-in makes one."
    if key.signer is not None:
        return "signer", f"{key.address}, signed for by your own wallet's signing command."
    if key.locked is None:
        return "on_file", f"{key.address}, kept in {siwa.key_file()}."
    if passkey.helper_running(key.address):
        return "unlocked", f"{key.address}, locked with a passkey and open until this Mac restarts."
    return LOCKED, (
        f"{key.address}, locked with a passkey: signing waits for your person's Touch ID, so its "
        "sign-ins were not checked."
    )


def mcp_ready() -> tuple[str, str]:
    ready_to_proxy()
    return "installed", "regents mcp can run."


def browser_ready() -> tuple[str, str]:
    ready_to_browse()
    return "installed", "regents browser can run, with its Chromium."


def paired(
    platform: Platform, probe: Command, timeout_ms: int, base: str | None = None
) -> tuple[str, str]:
    """Whether a person's account is paired with this agent, as the site's own probe says."""
    told = pairing_status(platform, probe, timeout_ms, base_url=base)
    if unpaired(told):
        raise CommandError(
            "agent_not_paired", f"No person's account is paired with this agent on {platform.host}."
        )
    if told.get("status") == "person_not_here":
        raise CommandError(
            "person_not_here", f"Paired, but your person has not signed in on {platform.host} yet."
        )
    return "paired", f"Paired with a person's account on {platform.host}."


def mcp_answers(base: str, timeout_ms: int) -> tuple[str, str]:
    """Whether the site answers at the address `regents mcp` sends to."""
    response = respond(base, Request("GET", MCP_PATH), timeout_ms)
    if response.status_code == 404:
        return "none", f"{base} serves no hosted MCP at {MCP_PATH}."
    if response.is_server_error:
        answer(response)  # Raises the site's own error, with its status.
    return "answered", f"{base}{MCP_PATH} answered {response.status_code}."


def first_fix(
    machine: list[dict[str, Any]], checked: list[tuple[Platform, dict[str, Any]]], again: list[str]
) -> list[Step]:
    """The one thing to do first, then check again: anything on this machine before any site,
    and a site's failures in ORDER."""
    here = [row for row in machine if not row["ok"]]
    here += [row for _, report in checked for row in report["checks"] if row["kind"] == "machine"]
    if here:
        return [fix_here(here[0]), run(again, "Then check again.")]
    failed = [
        (platform, report["base_url"], row)
        for platform, report in checked
        for row in report["checks"]
        if not row["ok"]
    ]
    platform, base, row = min(failed, key=lambda found: ORDER.index(found[2]["kind"]))
    return fix_site(platform, base, row, again)


def fix_here(row: dict[str, Any]) -> Step:
    if row["code"] == "installation_incomplete":
        return human(
            f"Ask your person to install what regents mcp and regents browser need with {INSTALL}, "
            f"and the Chromium regents browser drives with {INSTALL_CHROMIUM}."
        )
    return human(f"Ask your person to fix this on this machine: {row['detail']}")


def fix_site(platform: Platform, base: str, row: dict[str, Any], again: list[str]) -> list[Step]:
    once_more = run(again, "Then check again.")
    match row["kind"]:
        case "address":
            return [not_served(), once_more]
        case "sign_in":
            return [sign_in(platform.site), once_more]
        case "pairing" if row["code"] == "person_not_here":
            person = human(
                f"Ask your person to sign in on {platform.host} once: this agent is paired with "
                "their account, and the site waits for them there.",
                account_menu(platform.host),
            )
            return [person, once_more]
        case "pairing":
            return [*pair_first(platform.name, platform.host), once_more]
        case "permission":
            return [human(f"Ask your person about this first: {row['detail']}"), once_more]
    # Unreachable, or the site's own error: once more, and then it is for the site's team.
    detail = f"{row['check']}: {row['code']}: {row['detail']}"
    return [
        run(again, "Wait a minute, then check again."),
        *reported(platform, base, ("doctor",), row["code"], detail),
    ]


def all_held(rows: list[dict[str, Any]]) -> list[Step]:
    """Done, and how to check the sign-ins this run could not."""
    sign_ins = [row["code"] for row in rows if row["check"] == SIGN_IN]
    if UNCHECKED in sign_ins:
        return [
            done("Every check that needs no signing held."),
            run(
                ("regents", "auth", "status"),
                "Ask your person first: the agent key is locked until they confirm Touch ID, "
                "which this asks for once. Then check again, and each sign-in is checked too.",
            ),
        ]
    if sign_ins and all(code == NOT_SIGNED_IN for code in sign_ins):
        return [
            done("The sites and their public reads answer; nothing more to run for those."),
            run(
                ("regents", "auth", "login", "--site", "<site>"),
                "For a signed command, ask your person first, then sign in to the site you need.",
            ),
        ]
    return [done("Every check held; nothing more to run.")]
