"""`regents <site> doctor`: the same checks for every site, read from its description.

The site answers at all; each public read that needs no input answers; and, for a site with
wallet-proof commands, the sign-in on this machine is one the sign-in server accepts.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import partial
from typing import Any

import click

from regents_cli import output, siwa
from regents_cli.errors import CommandError
from regents_cli.http import Request, base_address, respond, send
from regents_cli.platforms import Command, Platform


def doctor_command(platform: Platform) -> click.Command:
    def run(as_json: bool, base_url: str | None, timeout_ms: int) -> None:
        base = base_address(base_url, platform.env_var, platform.base_url)
        checks = [check("site answers", lambda: site_answers(base, timeout_ms))]
        checks += [
            check(" ".join(c.words), partial(read_answers, base, c, timeout_ms))
            for c in platform.commands
            if needs_nothing(c)
        ]
        if any(c.authority == "wallet-proof" for c in platform.commands):
            checks.append(check("sign-in", lambda: sign_in_good(platform.site, timeout_ms)))
        found: dict[str, Any] = {"site": platform.site, "base_url": base, "checks": checks}
        failed = sum(not c["ok"] for c in checks)
        if failed:
            raise CommandError(
                "doctor_found_problems", f"{failed} of {len(checks)} checks failed.", **found
            )
        output.emit(found, as_json=as_json)

    return click.Command(
        "doctor",
        callback=run,
        params=[
            click.Option(["--json", "as_json"], is_flag=True, help="Print the answer as JSON."),
            click.Option(["--base-url"], help=f"The site's address; also {platform.env_var}."),
            click.Option(
                ["--timeout-ms"],
                type=click.IntRange(1, 300_000),
                default=30_000,
                show_default=True,
                help="How long to wait for each answer.",
            ),
        ],
        help="Check that the site answers, that its public reads answer, and that your "
        "sign-in is good.",
    )


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
    receipt = siwa.current(site, timeout_ms)
    key = siwa.load_key()
    if key is None or not receipt.signed_by(key):
        return (
            f"Signed in with your own key as {receipt.address} until "
            f"{receipt.receipt_expires_at}; only that key can sign a request to check it further."
        )
    siwa.confirm(site, receipt, timeout_ms)
    return f"The sign-in server accepts {receipt.address} until {receipt.receipt_expires_at}."
