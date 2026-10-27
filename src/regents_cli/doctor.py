"""`regents <site> doctor`: the same checks for every site, read from its description.

The site answers at all; each public read that needs no input answers; and, for a site with
signed commands, the sign-in on this machine is one the sign-in server accepts. No sign-in yet is
not a failure: only signed commands need one.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import partial
from typing import Any

import click

from regents_cli import output, siwa
from regents_cli.errors import CommandError
from regents_cli.http import Request, base_address, respond, send
from regents_cli.next_steps import Step, done, elsewhere, human, patchbay, run, search, sign_in
from regents_cli.platforms import DEFAULT_TIMEOUT_MS, Command, Platform

SIGN_IN = "sign-in"
NOT_SIGNED_IN = "Not signed in yet; needed only for signed commands."


def doctor_command(platform: Platform) -> click.Command:
    def run(as_json: bool, base_url: str | None, timeout_ms: int) -> None:
        base = base_address(base_url, platform.env_var, platform.base_url)
        checks = [check("site answers", lambda: site_answers(base, timeout_ms))]
        checks += [
            check(" ".join(c.words), partial(read_answers, base, c, timeout_ms))
            for c in platform.commands
            if needs_nothing(c)
        ]
        if any(c.signed for c in platform.commands):
            checks.append(check(SIGN_IN, lambda: sign_in_good(platform.site, timeout_ms)))
        found: dict[str, Any] = {"site": platform.site, "base_url": base, "checks": checks}
        failed = [c for c in checks if not c["ok"]]
        if failed:
            message = f"{len(failed)} of {len(checks)} checks failed."
            again = ["regents", platform.name, "doctor"]
            again += ["--base-url", base_url] if base_url else []
            again += ["--json"] if as_json else []
            raise CommandError(
                "doctor_found_problems",
                message,
                next_steps=repairs(platform, base, failed, message, again),
                **found,
            )
        output.emit(found, as_json=as_json, next_steps=held(platform.site, checks))

    return click.Command(
        "doctor",
        callback=run,
        params=[
            click.Option(["--json", "as_json"], is_flag=True, help="Print the answer as JSON."),
            click.Option(["--base-url"], help=f"The site's address; also {platform.env_var}."),
            click.Option(
                ["--timeout-ms"],
                type=click.IntRange(1, 300_000),
                default=DEFAULT_TIMEOUT_MS,
                show_default=True,
                help="How long to wait for each answer.",
            ),
        ],
        help="Check that the site answers, that its public reads answer, and that your "
        "sign-in is good, if you have signed in.",
    )


def repairs(
    platform: Platform, base: str, failed: list[dict[str, Any]], message: str, again: list[str]
) -> list[Step]:
    """Sign in again for a failed sign-in; search patchbay.help about a site that failed its own
    checks, then report it there, unless the checks ran against another address."""
    steps: list[Step] = []
    if any(c["check"] == SIGN_IN for c in failed):
        steps.append(sign_in(platform.site))
    broken = [c for c in failed if c["check"] != SIGN_IN]
    steps.append(run(again, "Then check again."))
    detail = "; ".join(f"{c['check']}: {c['detail']}" for c in broken)
    if broken and platform.name == "patchbay":
        steps.append(human(f"If Patchbay keeps failing its checks, tell your person: {message}"))
    elif broken and base != platform.base_url:
        steps.append(elsewhere(base, platform.host, detail))
    elif broken:
        steps.append(search(platform.host, None))
        steps.append(
            patchbay(
                platform.host, (platform.name, "doctor"), "doctor_found_problems", detail, None
            )
        )
    return steps


def held(site: str, checks: list[dict[str, Any]]) -> list[Step]:
    if not any(c["check"] == SIGN_IN and c["detail"] == NOT_SIGNED_IN for c in checks):
        return [done("Every check held; nothing more to run.")]
    return [
        done("The site and its public reads answer; nothing more to run for those."),
        run(
            ("regents", "auth", "login", "--site", site),
            f"When you need a signed command, ask your person first, then sign in to {site}.",
        ),
    ]


def needs_nothing(command: Command) -> bool:
    return (
        command.authority == "public"
        and command.effect == "read"
        and command.method == "GET"
        and not command.arguments
        and not command.required_one_of
        and not any(flag.required for flag in command.flags)
    )


def check(name: str, run: Callable[[], str]) -> dict[str, Any]:
    try:
        return {"check": name, "ok": True, "detail": run()}
    except CommandError as error:
        return {"check": name, "ok": False, "detail": f"{error.code}: {error.message}"}


def site_answers(base: str, timeout_ms: int) -> str:
    response = respond(base, Request("GET", "/", headers={"accept": "*/*"}), timeout_ms)
    return f"{base} answered {response.status_code}."


def read_answers(base: str, command: Command, timeout_ms: int) -> str:
    send(base, Request(command.method, command.path), timeout_ms)
    return f"{command.method} {command.path} answered."


def sign_in_good(site: str, timeout_ms: int) -> str:
    if siwa.load_receipt(site) is None:
        return NOT_SIGNED_IN
    receipt = siwa.current(site, timeout_ms)
    key = siwa.load_key()
    if key is None or not receipt.signed_by(key):
        return (
            f"Signed in with your own key as {receipt.address} until "
            f"{receipt.receipt_expires_at}; only that key can sign a request to check it further."
        )
    told = siwa.confirm(site, receipt, timeout_ms)
    listing, person = told["agentRegistration"], told["agentBook"]
    listed = (
        f"listed in the agent registry at {listing['registryUrl']}"
        if listing
        else "not listed in the agent registry (optional: regents auth register)"
    )
    vouched = (
        f"its World ID person is {person['humanId']}"
        if person
        else "it has accepted no World ID person (optional: regents auth accept-world-id)"
    )
    return (
        f"The sign-in server accepts {receipt.address} until {receipt.receipt_expires_at}; "
        f"it is {listed}, and {vouched}."
    )
