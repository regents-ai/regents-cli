"""`regents <site> doctor`: the same checks for every site, read from its description.

The site answers at all; each public read that needs no input answers; this regents is the
release the site names in its /capabilities.json, or newer; and, for a site with signed commands,
the sign-in on this machine is one the sign-in server accepts. No sign-in yet is not a failure:
only signed commands need one, and an older regents still runs every command it carries.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import partial
from importlib.metadata import version
from typing import Any
from urllib.parse import urlsplit

import click

from regents_cli import output, siwa
from regents_cli.errors import CommandError
from regents_cli.http import Request, base_address, respond, same_origin, send
from regents_cli.next_steps import Step, done, elsewhere, human, patchbay, run, search, sign_in
from regents_cli.platforms import DEFAULT_TIMEOUT_MS, Command, Platform

SIGN_IN = "sign-in"
#: A sign-in check that failed on a file on this machine: signing in again meets the same file.
KEY_FILE_PROBLEMS = ("unsafe_file", "bad_key_file", "unreadable_file")
NOT_SIGNED_IN = "not_signed_in"
RELEASE = "regents version"
BEHIND = "update_available"


def doctor_command(platform: Platform) -> click.Command:
    def run(as_json: bool, base_url: str | None, timeout_ms: int) -> None:
        base = base_address(base_url, platform.env_var, platform.base_url)
        checks = [check("site answers", lambda: site_answers(base, timeout_ms))]
        checks += [
            check(" ".join(c.words), partial(read_answers, base, c, timeout_ms))
            for c in platform.commands
            if needs_nothing(c)
        ]
        named = release_named(base, timeout_ms)
        if named is not None:
            host = urlsplit(base).netloc
            checks.append(check(RELEASE, lambda: release_current(host, named)))
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
                next_steps=[*updates(checks), *repairs(platform, base, failed, message, again)],
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
    """Sign in again for a failed sign-in, or fix the file it could not use; search
    patchbay.help about a site that failed its own checks, then report it there, unless the
    checks ran against another address."""
    steps: list[Step] = []
    for failure in (c for c in failed if c["check"] == SIGN_IN):
        key_file = failure["code"] in KEY_FILE_PROBLEMS
        steps.append(human(failure["detail"]) if key_file else sign_in(platform.site))
    broken = [c for c in failed if c["check"] != SIGN_IN]
    steps.append(run(again, "Then check again."))
    detail = "; ".join(f"{c['check']}: {c['code']}: {c['detail']}" for c in broken)
    if broken and not same_origin(base, platform.base_url):
        steps.append(elsewhere(base, detail))
    elif broken and platform.name == "patchbay":
        steps.append(human(f"If Patchbay keeps failing its checks, tell your person: {message}"))
    elif broken:
        steps.append(search(platform.host, None))
        steps.append(
            patchbay(
                platform.host, (platform.name, "doctor"), "doctor_found_problems", detail, None
            )
        )
    return steps


def updates(checks: list[dict[str, Any]]) -> list[Step]:
    """Ask for a newer regents when the site names one, whatever else the checks found."""
    return [
        human(f"Ask your person to update regents: uv tool upgrade regents-cli. {c['detail']}")
        for c in checks
        if c["code"] == BEHIND
    ]


def held(site: str, checks: list[dict[str, Any]]) -> list[Step]:
    behind = updates(checks)
    if not any(c["code"] == NOT_SIGNED_IN for c in checks):
        return [*behind, done("Every check held; nothing more to run.")]
    return [
        *behind,
        done("The site and its public reads answer; nothing more to run for those."),
        run(
            ("regents", "auth", "login", "--site", site),
            f"For a signed command, ask your person first, then sign in to {site}.",
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


def check(name: str, run: Callable[[], tuple[str, str]]) -> dict[str, Any]:
    """One check's row: its code (the error's, when it failed) and what it found."""
    try:
        code, detail = run()
        return {"check": name, "ok": True, "code": code, "detail": detail}
    except CommandError as error:
        return {"check": name, "ok": False, "code": error.code, "detail": error.message}


def site_answers(base: str, timeout_ms: int) -> tuple[str, str]:
    response = respond(base, Request("GET", "/", headers={"accept": "*/*"}), timeout_ms)
    return "answered", f"{base} answered {response.status_code}."


def read_answers(base: str, command: Command, timeout_ms: int) -> tuple[str, str]:
    send(base, Request(command.method, command.path), timeout_ms)
    return "answered", f"{command.method} {command.path} answered."


def release_named(base: str, timeout_ms: int) -> str | None:
    """The regents-cli release the site's /capabilities.json names (`cli.release`), or None
    when it names none or can't be read: that is no fault of the site's commands."""
    try:
        answered = send(base, Request("GET", "/capabilities.json"), timeout_ms)
    except CommandError:
        return None
    cli = answered.get("cli")
    release = cli.get("release") if isinstance(cli, dict) else None
    return release if isinstance(release, str) and numbered(release) is not None else None


def release_current(host: str, named: str) -> tuple[str, str]:
    installed = version("regents-cli")
    mine = numbered(installed)
    # A build with no release number, such as one from a checkout, is never told to update.
    if mine is not None and (numbered(named) or ()) > mine:
        return BEHIND, f"{host} names regents-cli {named}; this is {installed}."
    return "current", f"{host} names regents-cli {named}; this is {installed}."


def numbered(release: str) -> tuple[int, ...] | None:
    """1.10.20 as (1, 10, 20); anything else is no release to compare."""
    parts = release.split(".")
    return tuple(int(p) for p in parts) if all(p.isdigit() for p in parts) else None


def sign_in_good(site: str, timeout_ms: int) -> tuple[str, str]:
    key = siwa.load_key()
    if siwa.load_receipt(site) is None:
        return NOT_SIGNED_IN, "Not signed in yet; needed only for signed commands."
    receipt = siwa.current(site, timeout_ms)
    if key is None or not receipt.signed_by(key):
        return "own_key", (
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
    return "accepted", (
        f"The sign-in server accepts {receipt.address} until {receipt.receipt_expires_at}; "
        f"it is {listed}, and {vouched}."
    )
