"""`regents auth`: sign in to a site with the agent key on this machine, or with your own."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import click

from regents_cli import output, siwa
from regents_cli.errors import CommandError, UsageError
from regents_cli.http import Request, base_address, send
from regents_cli.platforms import pinned_platforms
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
        f"request; it lives in {siwa.key_file()}, shared with the SIWA agent client. "
        "SIWA_AGENT_HOME moves that folder and SIWA_BROKER names another sign-in server.",
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
            params=[JSON, TIMEOUT],
            help="Show the agent key's address and each site's sign-in. Signed in to Regents, "
            "it also shows the account the agent is paired with, and Regents counts that as "
            "the agent checking in.",
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
    as_json: bool,
    timeout_ms: int,
) -> None:
    if (phase == "prepare") != (wallet_address is not None):
        raise UsageError("--wallet-address goes with --phase prepare, and only with it.")
    if phase == "prepare" and wallet_address is not None:
        output.emit(siwa.challenge(site, wallet_address, timeout_ms), as_json=as_json)
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
        receipt = siwa.verify(site, signed, timeout_ms)
    else:
        key = siwa.load_key()
        if key is None:
            key, created = siwa.create_key(), True
        receipt = siwa.sign_in_with_key(site, key, timeout_ms)
    answer: dict[str, Any] = {
        "site": site,
        "wallet_address": receipt.address,
        "signed_in_until": receipt.receipt_expires_at,
        "signs": signs(receipt, siwa.load_key()),
    }
    if created:
        answer["key_created"] = str(siwa.key_file())
    output.emit(answer, as_json=as_json)


def status(as_json: bool, timeout_ms: int) -> None:
    key = siwa.load_key()
    receipts = siwa.receipts()
    answer: dict[str, Any] = {
        "agent_key": key.address if key is not None else None,
        "sign_ins": [
            {
                "site": site,
                "wallet_address": receipt.address,
                "signed_in_until": receipt.receipt_expires_at,
                "fresh": receipt.fresh(),
                "signs": signs(receipt, key),
            }
            for site, receipt in receipts.items()
        ],
    }
    if "regents" in receipts:
        answer["paired_with"] = paired_account(timeout_ms)
    output.emit(answer, as_json=as_json)


def signs(receipt: siwa.Receipt, key: siwa.Key | None) -> str:
    return "this machine" if key is not None and receipt.signed_by(key) else "you"


def paired_account(timeout_ms: int) -> dict[str, Any] | None:
    """The agent's pairing on Regents, as `regents protocol agents me` reads it; None unpaired."""
    platform = next(p for p in pinned_platforms() if p.site == "regents")
    me = next(c for c in platform.commands if c.words == ("agents", "me"))
    request = Request(me.method, me.path, {}, None)
    request = replace(request, headers=siwa.sign(request, siwa.current("regents", timeout_ms)))
    try:
        answer = send(base_address(None, platform.env_var, platform.base_url), request, timeout_ms)
    except CommandError as error:
        if error.code == "not_paired":
            return None
        raise
    paired: dict[str, Any] = answer["data"]
    return paired


def logout(site: str, as_json: bool) -> None:
    output.emit({"site": site, "signed_out": siwa.remove_receipt(site)}, as_json=as_json)
