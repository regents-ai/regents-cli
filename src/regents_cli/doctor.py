"""`regents <site> doctor`: the same checks for every site, read from its description.

The site answers at all; each public read that needs no input answers; this regents is the
release the site names in its /capabilities.json, or newer; and, for a site with signed commands,
the sign-in on this machine is one the sign-in server accepts. No sign-in yet is not a failure:
only signed commands need one, and an older regents still runs every command it carries.

`regents doctor` runs the same checks for every site. Each check's row says, when it failed,
what kind of failure it is, read from the error's code and the site's status.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from functools import partial
from importlib.metadata import version
from typing import Any, Literal
from urllib.parse import urlsplit

import click

from regents_cli import output, siwa
from regents_cli.errors import EXIT_AUTH, EXIT_UNREACHABLE, CommandError
from regents_cli.http import Request, base_address, respond, same_origin, send
from regents_cli.next_steps import Step, done, elsewhere, human, patchbay, run, search, sign_in
from regents_cli.platforms import DEFAULT_TIMEOUT_MS, Command, Platform

#: What a failed check is: the site could not be reached (network), the sign-in is missing,
#: run out or refused (sign_in), no person's account is paired with the agent, or its person has
#: not signed in on the site yet (pairing), the site refused this agent (permission), the site
#: serves nothing at the address (address), the site answered with its own error (site), or
#: something on this machine needs installing or fixing (machine).
type Kind = Literal["network", "sign_in", "pairing", "permission", "address", "site", "machine"]

SIGN_IN = "sign-in"
#: A sign-in check that failed on a file on this machine: signing in again meets the same file.
KEY_FILE_PROBLEMS = ("unsafe_file", "bad_key_file", "unreadable_file")
#: Failures this machine causes, which only fixing something here clears: a file the key or a
#: sign-in is kept in, a part of regents not installed, or the program that signs with the key.
MACHINE_PROBLEMS = frozenset(
    {
        *KEY_FILE_PROBLEMS,
        "installation_incomplete",
        "locked_key_needs_mac",
        "key_helper_not_answering",
        "key_helper_refused",
        "key_helper_failed",
        "signer_failed",
    }
)
PAIRING_PROBLEMS = frozenset({"agent_not_paired", "person_not_here"})
NOT_SIGNED_IN = "not_signed_in"
ACCEPTED = "accepted"
#: A sign-in made by a key that can't sign now without its person: it was left unchecked.
UNCHECKED = "unchecked"
RELEASE = "regents version"
BEHIND = "update_available"


def doctor_command(platform: Platform) -> click.Command:
    def run(as_json: bool, base_url: str | None, timeout_ms: int) -> None:
        base = base_address(
            base_url,
            platform.env_var,
            platform.base_url,
            fallback_env_var=platform.fallback_env_var,
        )
        checks = site_checks(platform, base, timeout_ms, may_sign=True)
        found: dict[str, Any] = {
            "site": platform.site,
            "product": platform.name,
            "base_url": base,
            "checks": checks,
        }
        failed = [c for c in checks if not c["ok"]]
        if failed:
            message = f"{len(failed)} of {len(checks)} checks failed."
            again = ["regents", platform.name, "doctor"]
            again += ["--base-url", base_url] if base_url else []
            again += ["--json"] if as_json else []
            raise CommandError(
                "doctor_found_problems",
                message,
                next_steps=[*updates(checks), *repairs(platform, base, failed, again)],
                **found,
            )
        output.emit(found, as_json=as_json, next_steps=held(platform.site, checks))

    return click.Command(
        "doctor",
        callback=run,
        params=[
            click.Option(["--json", "as_json"], is_flag=True, help="Print the answer as JSON."),
            click.Option(
                ["--base-url"],
                help=(
                    f"The site's address; also {platform.env_var} or {platform.fallback_env_var}."
                    if platform.fallback_env_var
                    else f"The site's address; also {platform.env_var}."
                ),
            ),
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


def site_checks(
    platform: Platform,
    base: str,
    timeout_ms: int,
    *,
    may_sign: bool,
    include_shared: bool = True,
) -> list[dict[str, Any]]:
    """The site at `base` answers, its public reads that need no input answer, this regents is
    the release it names or newer, and, for a site with signed commands, the sign-in to it holds.
    Signing checks the sign-in only when `may_sign`; otherwise the sign-in is left unchecked."""
    checks: list[dict[str, Any]] = []
    if include_shared:
        checks.append(check("site answers", lambda: site_answers(base, timeout_ms)))
    checks += [
        check(" ".join(c.words), partial(read_answers, platform.name, base, c, timeout_ms))
        for c in platform.commands
        if needs_nothing(c)
    ]
    if include_shared:
        named = release_named(base, timeout_ms)
        if named is not None:
            host = urlsplit(base).netloc
            checks.append(check(RELEASE, lambda: release_current(host, named)))
        if any(c.signed for c in platform.commands):
            checks.append(
                check(
                    SIGN_IN,
                    lambda: sign_in_good(platform.site, base, timeout_ms, may_sign=may_sign),
                )
            )
    return checks


def repairs(
    platform: Platform, base: str, failed: list[dict[str, Any]], again: list[str]
) -> list[Step]:
    """Sign in again for a failed sign-in, or fix the file it could not use; report a site that
    failed its own checks."""
    steps: list[Step] = []
    for failure in (c for c in failed if c["check"] == SIGN_IN):
        key_file = failure["code"] in KEY_FILE_PROBLEMS
        steps.append(human(failure["detail"]) if key_file else sign_in(platform.site))
    broken = [c for c in failed if c["check"] != SIGN_IN]
    steps.append(run(again, "Then check again."))
    if broken:
        detail = "; ".join(f"{c['check']}: {c['code']}: {c['detail']}" for c in broken)
        words = (platform.name, "doctor")
        steps += reported(platform, base, words, "doctor_found_problems", detail)
    return steps


def reported(
    platform: Platform, base: str, words: Sequence[str], code: str, detail: str
) -> list[Step]:
    """Search Patchbay (regents.sh/patchbay) about a site that failed its checks, then report it
    there; a person is told instead when Patchbay itself failed, or the checks ran against another
    address."""
    if not same_origin(base, platform.base_url):
        return [elsewhere(base, detail)]
    if platform.name == "patchbay":
        return [human(f"If Patchbay keeps failing its checks, tell your person: {detail}")]
    return [search(platform.host, None), patchbay(platform.host, words, code, detail, None)]


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
    """One check's row: its code (the error's, when it failed), the kind of failure, and what
    it found."""
    try:
        code, detail = run()
        return {"check": name, "ok": True, "code": code, "kind": None, "detail": detail}
    except CommandError as error:
        return {
            "check": name,
            "ok": False,
            "code": error.code,
            "kind": kind_of(error),
            "detail": error.message,
        }


def kind_of(error: CommandError) -> Kind:
    """A failure's kind, from its code and, for a refusal, the status it came with."""
    if error.code in MACHINE_PROBLEMS:
        return "machine"
    if error.code in PAIRING_PROBLEMS:
        return "pairing"
    status = error.fields.get("status")
    if isinstance(status, int):
        refused: dict[int, Kind] = {401: "sign_in", 403: "permission", 404: "address"}
        return refused.get(status, "site")
    if error.exit_code == EXIT_UNREACHABLE:
        return "network"
    if error.exit_code == EXIT_AUTH:
        return "sign_in"
    return "site"


def site_answers(base: str, timeout_ms: int) -> tuple[str, str]:
    response = respond(base, Request("GET", "/", headers={"accept": "*/*"}), timeout_ms)
    return "answered", f"{base} answered {response.status_code}."


#: Public reads behind an optional site feature gate where 404 `not_found` means turned off.
GATED_PUBLIC_READS: frozenset[tuple[str, str]] = frozenset({("patchbay", "offers list")})


def read_answers(
    platform_name: str, base: str, command: Command, timeout_ms: int
) -> tuple[str, str]:
    try:
        send(base, Request(command.method, command.path), timeout_ms)
    except CommandError as error:
        if (
            (platform_name, " ".join(command.words)) in GATED_PUBLIC_READS
            and error.code == "not_found"
            and error.fields.get("status") == 404
        ):
            return "not_enabled", f"{command.method} {command.path} is currently turned off."
        raise
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


def sign_in_good(site: str, base: str, timeout_ms: int, *, may_sign: bool) -> tuple[str, str]:
    key = siwa.load_key()
    kept = siwa.load_receipt(site)
    if kept is None:
        return NOT_SIGNED_IN, "Not signed in yet; needed only for signed commands."
    if not may_sign and key is not None and kept.signed_by(key):
        return UNCHECKED, (
            f"Signed in as {kept.address} until {kept.receipt_expires_at}; not checked, since "
            "signing with the agent key now waits for your person."
        )
    receipt = siwa.current(site, timeout_ms)
    if key is None or not receipt.signed_by(key):
        return "own_key", (
            f"Signed in with your own key as {receipt.address} until "
            f"{receipt.receipt_expires_at}; only that key can sign a request to check it further."
        )
    siwa.signs_for(site, base, timeout_ms)
    told = siwa.confirm(site, receipt, base, timeout_ms)
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
    return ACCEPTED, (
        f"The sign-in server accepts {receipt.address} until {receipt.receipt_expires_at}; "
        f"it is {listed}, and {vouched}."
    )
