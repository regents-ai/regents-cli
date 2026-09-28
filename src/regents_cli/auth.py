"""`regents auth`: sign in to a site with the agent key on this machine, or with your own."""

from __future__ import annotations

from typing import Any

import click

from regents_cli import output, siwa
from regents_cli.errors import UsageError
from regents_cli.runner import read_stdin

TIMEOUT = click.Option(
    ["--timeout-ms"],
    type=click.IntRange(1, 300_000),
    default=30_000,
    show_default=True,
    help="How long to wait for each answer.",
)
JSON = click.Option(["--json", "as_json"], is_flag=True, help="Print the answer as JSON.")


def auth_group(sites: list[str]) -> click.Group:
    site = click.Option(
        ["--site"], type=click.Choice(sites), required=True, help="The site to sign in to."
    )
    group = click.Group(
        "auth",
        help="Sign in to a site with a wallet. One agent key on this machine signs every "
        f"request; it lives in {siwa.key_file()}.",
        no_args_is_help=True,
    )
    group.add_command(
        click.Command(
            "login",
            callback=login,
            params=[
                site,
                click.Option(
                    ["--phase"],
                    type=click.Choice(["prepare", "send"]),
                    help="Sign in with your own key: prepare prints the message to sign; "
                    'send reads {"wallet_address", "nonce", "message", "signature"} on stdin.',
                ),
                click.Option(
                    ["--wallet-address"], help="Your own wallet's address, with --phase prepare."
                ),
                click.Option(
                    ["--siwa-url"],
                    default=siwa.BROKER,
                    show_default=True,
                    help="The sign-in server.",
                ),
                JSON,
                TIMEOUT,
            ],
            help="Sign in to a site. Creates the agent key on first use.",
        )
    )
    group.add_command(
        click.Command(
            "status",
            callback=status,
            params=[JSON],
            help="Show the agent key's address and each site's sign-in.",
        )
    )
    group.add_command(
        click.Command(
            "logout",
            callback=logout,
            params=[site, JSON],
            help="Forget a site's sign-in. The agent key stays.",
        )
    )
    return group


def login(
    site: str,
    phase: str | None,
    wallet_address: str | None,
    siwa_url: str,
    as_json: bool,
    timeout_ms: int,
) -> None:
    if (phase == "prepare") != (wallet_address is not None):
        raise UsageError("--wallet-address goes with --phase prepare, and only with it.")
    if phase == "prepare" and wallet_address is not None:
        output.emit(siwa.challenge(site, wallet_address, siwa_url, timeout_ms), as_json=as_json)
        return
    created = False
    if phase == "send":
        signed = read_stdin(timeout_ms)
        fields = {"wallet_address", "nonce", "message", "signature"}
        if not isinstance(signed, dict) or set(signed) != fields:
            raise UsageError(
                'stdin must hold {"wallet_address", "nonce", "message", "signature"}: the '
                "answer of --phase prepare with the message's signature added."
            )
        sign_in = siwa.verify(site, signed, siwa_url, timeout_ms, local=False)
    else:
        key = siwa.load_key()
        if key is None:
            key, created = siwa.create_key(), True
        sign_in = siwa.sign_in_with_key(site, key, siwa_url, timeout_ms)
    answer: dict[str, Any] = {
        "site": site,
        "wallet_address": sign_in.wallet_address,
        "signed_in_until": sign_in.expires_at,
        "signs": "this machine" if sign_in.local else "you",
    }
    if created:
        answer["key_created"] = str(siwa.key_file())
    output.emit(answer, as_json=as_json)


def status(as_json: bool) -> None:
    key = siwa.load_key()
    output.emit(
        {
            "agent_key": key.address if key is not None else None,
            "sign_ins": [
                {
                    "site": site,
                    "wallet_address": sign_in.wallet_address,
                    "signed_in_until": sign_in.expires_at,
                    "fresh": sign_in.fresh(),
                    "signs": "this machine" if sign_in.local else "you",
                }
                for site, sign_in in siwa.sign_ins().items()
            ],
        },
        as_json=as_json,
    )


def logout(site: str, as_json: bool) -> None:
    output.emit({"site": site, "signed_out": siwa.remove_sign_in(site)}, as_json=as_json)
