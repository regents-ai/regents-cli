"""`regents auth`: sign in to a site with the agent key on this machine, or with your own."""

from __future__ import annotations

import re
import shlex
import time
from dataclasses import replace
from typing import Any

import click

from regents_cli import base, output, siwa
from regents_cli.errors import EXIT_AUTH, CommandError, UsageError
from regents_cli.http import Request, base_address, send
from regents_cli.platforms import DEFAULT_TIMEOUT_MS, pinned_platforms
from regents_cli.runner import read_stdin

TIMEOUT = click.Option(
    ["--timeout-ms"],
    type=click.IntRange(1, 300_000),
    default=DEFAULT_TIMEOUT_MS,
    show_default=True,
    help="How long to wait for each answer.",
)
JSON = click.Option(["--json", "as_json"], is_flag=True, help="Print the answer as JSON.")
TX_HASH = re.compile(r"0x[0-9a-fA-F]{64}")
HUMAN_ID = re.compile(r"0x[0-9a-fA-F]{64}")
REGISTRATION_WAIT_SECONDS = 60
REGISTRATION_POLL_SECONDS = 2


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
            help="Show the agent key's address, each site's sign-in, the agent's listing in "
            "the agent registry and the World ID person it accepted (each null when it has "
            "none), read through a sign-in this machine's key made. Signed in to Regents, it "
            "also shows the account the agent is paired with, and Regents counts that as the "
            "agent checking in.",
        )
    )
    group.add_command(
        click.Command(
            "register",
            callback=register,
            params=[
                click.Option(["--name"], required=True, help="The agent's public name."),
                click.Option(
                    ["--description"], required=True, help="What the agent does, in a sentence."
                ),
                click.Option(["--image"], help="An https address of the agent's picture."),
                click.Option(
                    ["--wallet-address"],
                    help="List your own wallet instead: prints the transaction for it to send.",
                ),
                click.Option(
                    ["--tx-hash"],
                    help="Check a registration already sent, with the same name, description "
                    "and image.",
                ),
                JSON,
                TIMEOUT,
            ],
            help="List the agent in the agent registry on Base (optional; sign-in never needs "
            "it). The agent key on this machine sends the one transaction and pays its gas, so "
            f"it needs a little ETH on Base; {base.BASE_RPC} carries it unless SIWA_BASE_RPC "
            "names another Base node. Each run sends a new transaction.",
        )
    )
    group.add_command(
        click.Command(
            "accept-world-id",
            callback=accept_world_id,
            params=[
                click.Option(
                    ["--human-id"],
                    help="Your person's World ID number, as the command without it showed. "
                    "Signs only while World's AgentBook still names that number.",
                ),
                click.Option(
                    ["--phase"],
                    type=click.Choice(["prepare", "send"]),
                    help="Accept with your own key: prepare prints the message to sign; send "
                    'reads {"wallet_address", "nonce", "message", "signature"} on stdin.',
                ),
                click.Option(
                    ["--wallet-address"], help="Your own wallet's address, with --phase prepare."
                ),
                JSON,
                TIMEOUT,
            ],
            help="Accept the person who vouched for the agent with World ID (optional). World's "
            "AgentBook lets anyone with a World ID put their number on any wallet, so sites "
            "show the person only once the agent's wallet accepts them. Without --human-id it "
            "shows the number AgentBook names; check it with your person, then run it again "
            "with --human-id.",
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
    mine = [site for site, receipt in receipts.items() if key and receipt.signed_by(key)]
    if mine:
        site = "regents" if "regents" in mine else mine[0]
        told = siwa.confirm(site, siwa.current(site, timeout_ms), timeout_ms)
        listing, person = told["agentRegistration"], told["agentBook"]
        answer["registry_listing"] = listing["registryUrl"] if listing else None
        answer["world_id"] = (
            {"human_id": person["humanId"], "agent_count": person["agentCount"]} if person else None
        )
    if "regents" in receipts:
        answer["paired_with"] = paired_account(timeout_ms)
    output.emit(answer, as_json=as_json)


def register(
    name: str,
    description: str,
    image: str | None,
    wallet_address: str | None,
    tx_hash: str | None,
    as_json: bool,
    timeout_ms: int,
) -> None:
    key = siwa.load_key()
    if wallet_address is not None and not siwa.ADDRESS.fullmatch(wallet_address):
        raise UsageError(f"{wallet_address!r} is not an address.")
    if tx_hash is not None and not TX_HASH.fullmatch(tx_hash):
        raise UsageError("--tx-hash must be 0x followed by 64 hex characters.")
    if wallet_address is not None:
        wallet = wallet_address
    elif key is not None:
        wallet = key.address
    else:
        raise CommandError(
            "no_agent_key",
            "There is no agent key on this machine yet. Make it with regents auth login "
            "--site <site>, or list your own wallet with --wallet-address.",
            exit_code=EXIT_AUTH,
        )
    profile = {"wallet_address": wallet, "name": name, "description": description}
    if image is not None:
        profile["image"] = image
    again = ["regents", "auth", "register", "--name", name, "--description", description]
    again += ["--image", image] if image is not None else []
    again += ["--wallet-address", wallet_address] if wallet_address is not None else []
    if tx_hash is None:
        step = siwa.registration_step(profile, timeout_ms)
        if wallet_address is not None:
            output.emit(
                step,
                as_json=as_json,
                hint=f"Send this one transaction from {wallet} on Base with your wallet, then "
                f"run: {shlex.join([*again, '--tx-hash', '<its hash>'])}",
            )
            return
        if key is None or key.signer is not None:
            raise CommandError(
                "signer_cannot_send",
                "This machine's agent key signs through a command, which signs messages and "
                f"not transactions. Send it from that wallet: --wallet-address {wallet}.",
                exit_code=EXIT_AUTH,
            )
        try:
            tx_hash = base.send(key, step, timeout_ms)
        except CommandError as error:
            if error.code != "base_send_unclear":
                raise
            sent = error.fields["tx_hash"]
            raise CommandError(
                error.code,
                error.message,
                exit_code=error.exit_code,
                tx_hash=sent,
                hint="Check it before sending another: " + shlex.join([*again, "--tx-hash", sent]),
            ) from None
    outcome = siwa.registration_outcome(profile, tx_hash, timeout_ms)
    deadline = time.monotonic() + REGISTRATION_WAIT_SECONDS
    while outcome["code"] == "registration_pending" and time.monotonic() < deadline:
        time.sleep(REGISTRATION_POLL_SECONDS)
        outcome = siwa.registration_outcome(profile, tx_hash, timeout_ms)
    if outcome["code"] == "registration_pending":
        output.emit(
            {"wallet_address": wallet.lower(), "tx_hash": tx_hash, "listed": False},
            as_json=as_json,
            hint="The transaction is not on Base yet. Check again with: "
            + shlex.join([*again, "--tx-hash", tx_hash]),
        )
        return
    listed = outcome["data"]
    output.emit(
        {
            "wallet_address": listed["walletAddress"],
            "listed": True,
            "agent_id": listed["agentId"],
            "registry_url": listed["registryUrl"],
            "profile_url": listed["profileUrl"],
            "tx_hash": listed["txHash"],
        },
        as_json=as_json,
    )


def accept_world_id(
    human_id: str | None,
    phase: str | None,
    wallet_address: str | None,
    as_json: bool,
    timeout_ms: int,
) -> None:
    if (phase == "prepare") != (wallet_address is not None):
        raise UsageError("--wallet-address goes with --phase prepare, and only with it.")
    if human_id is not None and phase is not None:
        raise UsageError(
            "--human-id is for the agent key on this machine. With your own key, check the "
            "number --phase prepare shows before you sign."
        )
    if human_id is not None and not HUMAN_ID.fullmatch(human_id):
        raise UsageError("--human-id must be 0x followed by 64 hex characters.")
    if phase == "prepare" and wallet_address is not None:
        output.emit(
            siwa.agent_book_challenge(wallet_address, timeout_ms),
            as_json=as_json,
            hint="Check that human_id is your person's World ID number: accepting is for good, "
            "and the wallet can never accept another person. Then sign the message "
            f'with {wallet_address}, add the signature to this answer as "signature", and '
            "pipe it to: regents auth accept-world-id --phase send. The message lasts five "
            "minutes.",
        )
        return
    if phase == "send":
        signed = read_stdin(timeout_ms)
        fields = {"wallet_address", "human_id", "nonce", "message", "signature"}
        if not isinstance(signed, dict) or set(signed) != fields:
            raise UsageError(
                "stdin must hold the answer of --phase prepare with the message's signature "
                'added as "signature".'
            )
        proof = {field: signed[field] for field in ("wallet_address", "nonce", "message")}
        output.emit(
            siwa.accept_agent_book({**proof, "signature": signed["signature"]}, None, timeout_ms),
            as_json=as_json,
        )
        return
    key = siwa.load_key()
    if key is None:
        raise CommandError(
            "no_agent_key",
            "There is no agent key on this machine yet. Make it with regents auth login "
            "--site <site>, or accept with your own wallet: --phase prepare --wallet-address.",
            exit_code=EXIT_AUTH,
        )
    found = siwa.agent_book_challenge(key.address, timeout_ms)
    if human_id is None:
        named = {field: found[field] for field in ("wallet_address", "human_id")}
        hint = (
            "World's AgentBook names this person behind the agent. Anyone with a World ID can put "
            "their number on any wallet, so ask your person whether this is their World ID "
            "number. Accepting is for good: the agent can never accept another person. If it is "
            "theirs, run: "
            + shlex.join(["regents", "auth", "accept-world-id", "--human-id", found["human_id"]])
        )
        output.emit(named, as_json=as_json, hint=hint)
        return
    if human_id.lower() != found["human_id"]:
        raise CommandError(
            "human_id_mismatch",
            f"World's AgentBook names {found['human_id']} behind {found['wallet_address']}, not "
            f"{human_id.lower()}. Nothing was signed; ask your person before accepting.",
            exit_code=EXIT_AUTH,
        )
    signed = {
        "wallet_address": found["wallet_address"],
        "nonce": found["nonce"],
        "message": found["message"],
        "signature": siwa.personal_sign(key, found["message"]),
    }
    output.emit(siwa.accept_agent_book(signed, siwa.signer_name(key), timeout_ms), as_json=as_json)


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
