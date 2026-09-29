"""Wallet sign-in (SIWA) and signed requests, the way the SIWA server checks them.

One agent key lives on this machine. `regents auth login --site <name>` signs in to that
site's audience and keeps the receipt; every wallet-proof request is then signed with the
key. Someone who keeps their own key instead signs the exact messages printed here.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct

from regents_cli.errors import EXIT_AUTH, EXIT_UNREACHABLE, CommandError, UsageError
from regents_cli.http import Request, answer, origin

CHAIN_ID = 8453
BROKER = "https://siwa.regents.sh"
SIGNATURE_LIFETIME_SECONDS = 120
RENEW_MARGIN_SECONDS = 60
COMPONENTS = (
    "@method",
    "@path",
    "x-siwa-receipt",
    "x-key-id",
    "x-timestamp",
    "x-agent-wallet-address",
    "x-agent-chain-id",
)
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}")
SIGNATURE = re.compile(r"0x[0-9a-fA-F]{130}")
SIGNATURE_INPUT = re.compile(
    r"sig1=\((?P<components>[^)]*)\);created=(?P<created>[1-9][0-9]*)"
    r';expires=(?P<expires>[1-9][0-9]*);nonce="(?P<nonce>sig-nonce-[0-9a-f]{32})"'
    r';keyid="(?P<key_id>0x[0-9a-f]{40})"'
)


def home() -> Path:
    return Path.home() / ".regents"


def key_file() -> Path:
    return home() / "agent-key.json"


def sign_ins_file() -> Path:
    return home() / "sign-ins.json"


@dataclass(frozen=True, slots=True)
class Key:
    address: str
    private_key: str


@dataclass(frozen=True, slots=True)
class SignIn:
    """A site's receipt. `local` is true when the key on this machine signed in."""

    wallet_address: str
    key_id: str
    receipt: str
    expires_at: str
    broker: str
    local: bool

    def fresh(self, margin: int = 0) -> bool:
        expires = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
        return expires.timestamp() - time.time() > margin


def _write_private(path: Path, value: Any) -> None:
    path.parent.mkdir(mode=0o700, exist_ok=True)
    path.parent.chmod(0o700)
    temporary = path.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as file:
        json.dump(value, file, indent=2)
    os.replace(temporary, path)


def _read_private(path: Path) -> Any:
    if not path.is_file():
        return None
    if path.stat().st_mode & 0o077:
        raise CommandError(
            "unsafe_file",
            f"{path} can be read by other users. Run chmod 600 {path}.",
            exit_code=EXIT_AUTH,
        )
    return json.loads(path.read_text("utf-8"))


def load_key() -> Key | None:
    stored = _read_private(key_file())
    return Key(**stored) if stored is not None else None


def create_key() -> Key:
    account = Account.create()
    key = Key(address=account.address.lower(), private_key="0x" + bytes(account.key).hex())
    _write_private(key_file(), asdict(key))
    return key


def sign_ins() -> dict[str, SignIn]:
    stored = _read_private(sign_ins_file()) or {}
    return {site: SignIn(**record) for site, record in stored.items()}


def save_sign_in(site: str, sign_in: SignIn) -> None:
    _write_private(sign_ins_file(), {**_stored(), site: asdict(sign_in)})


def remove_sign_in(site: str) -> bool:
    stored = _stored()
    if site not in stored:
        return False
    del stored[site]
    _write_private(sign_ins_file(), stored)
    return True


def _stored() -> dict[str, Any]:
    return {site: asdict(record) for site, record in sign_ins().items()}


def personal_sign(key: Key, message: str) -> str:
    signed = Account.sign_message(encode_defunct(text=message), private_key=key.private_key)
    return "0x" + bytes(signed.signature).hex()


def _broker(
    broker: str,
    path: str,
    body: dict[str, Any],
    timeout_ms: int,
    headers: dict[str, str] | None = None,
) -> Any:
    try:
        response = httpx.post(
            broker + path,
            json=body,
            headers=headers,
            timeout=timeout_ms / 1000,
            follow_redirects=False,
        )
    except httpx.HTTPError:
        raise CommandError(
            "unreachable",
            f"The sign-in server {broker} could not be reached, or did not answer in time.",
            exit_code=EXIT_UNREACHABLE,
        ) from None
    return answer(response)


def challenge(site: str, wallet_address: str, broker: str, timeout_ms: int) -> dict[str, str]:
    """Ask the sign-in server for the message this wallet signs to sign in to `site`."""
    if not ADDRESS.fullmatch(wallet_address):
        raise UsageError(f"{wallet_address!r} is not an address.")
    issued = _broker(
        origin(broker, "--siwa-url"),
        "/api/shared/siwa/wallet/nonce",
        {"wallet_address": wallet_address, "chain_id": CHAIN_ID, "audience": site},
        timeout_ms,
    )
    data = issued["data"]
    return {
        "wallet_address": wallet_address.lower(),
        "nonce": data["nonce"],
        "message": data["message"],
    }


def verify(
    site: str, signed: dict[str, str], broker: str, timeout_ms: int, *, local: bool
) -> SignIn:
    """Hand the signed challenge back and keep the receipt for `site`."""
    broker = origin(broker, "--siwa-url")
    verified = _broker(
        broker,
        "/api/shared/siwa/wallet/verify",
        {"chain_id": CHAIN_ID, "audience": site, **signed},
        timeout_ms,
    )
    data = verified["data"]
    sign_in = SignIn(
        wallet_address=data["walletAddress"],
        key_id=data["keyId"],
        receipt=data["receipt"],
        expires_at=data["receiptExpiresAt"],
        broker=broker,
        local=local,
    )
    save_sign_in(site, sign_in)
    return sign_in


def sign_in_with_key(site: str, key: Key, broker: str, timeout_ms: int) -> SignIn:
    issued = challenge(site, key.address, broker, timeout_ms)
    signed = {**issued, "signature": personal_sign(key, issued["message"])}
    return verify(site, signed, broker, timeout_ms, local=True)


def current(site: str, timeout_ms: int) -> SignIn:
    """This site's receipt, renewed first when the key on this machine signed in."""
    sign_in = sign_ins().get(site)
    if sign_in is None:
        raise CommandError(
            "not_signed_in",
            f"Sign in first: regents auth login --site {site}.",
            exit_code=EXIT_AUTH,
        )
    if sign_in.fresh(RENEW_MARGIN_SECONDS):
        return sign_in
    key = load_key()
    if sign_in.local and key is not None and key.address == sign_in.wallet_address:
        return sign_in_with_key(site, key, sign_in.broker, timeout_ms)
    raise CommandError(
        "sign_in_expired",
        f"The sign-in to {site} has expired. Sign in again with regents auth login --site {site}.",
        exit_code=EXIT_AUTH,
    )


def unsigned(
    request: Request,
    *,
    receipt: str,
    wallet_address: str,
    key_id: str,
    created: int,
    expires: int,
    nonce: str,
) -> tuple[dict[str, str], str]:
    """The request's signed headers, less `signature`, and the message to personal_sign."""
    headers = {
        "x-siwa-receipt": receipt,
        "x-key-id": key_id,
        "x-timestamp": str(created),
        "x-agent-wallet-address": wallet_address,
        "x-agent-chain-id": str(CHAIN_ID),
    }
    components = list(COMPONENTS)
    if (content := request.content) is not None:
        digest = base64.b64encode(hashlib.sha256(content).digest()).decode("ascii")
        headers["content-digest"] = f"sha-256=:{digest}:"
        components.append("content-digest")
    params = (
        "(" + " ".join(f'"{c}"' for c in components) + ")"
        f';created={created};expires={expires};nonce="{nonce}";keyid="{key_id}"'
    )
    headers["signature-input"] = "sig1=" + params
    values = {"@method": request.method.lower(), "@path": request.target, **headers}
    lines = [f'"{c}": {values[c]}' for c in components]
    return headers, "\n".join([*lines, f'"@signature-params": {params}'])


def prepare(request: Request, sign_in: SignIn) -> tuple[dict[str, str], str]:
    created = int(time.time())
    return unsigned(
        request,
        receipt=sign_in.receipt,
        wallet_address=sign_in.wallet_address,
        key_id=sign_in.key_id,
        created=created,
        expires=created + SIGNATURE_LIFETIME_SECONDS,
        nonce="sig-nonce-" + secrets.token_hex(16),
    )


def rebuild(request: Request, headers: dict[str, str]) -> tuple[dict[str, str], str]:
    """The headers and message `prepare` gave for `request`, read back from its headers.

    Anything other than exactly what `prepare` printed for this request is refused.
    """
    match = SIGNATURE_INPUT.fullmatch(headers.get("signature-input", ""))
    if match is None:
        raise UsageError("The request's signature-input is not one regents prepared.")
    expected, message = unsigned(
        request,
        receipt=headers.get("x-siwa-receipt", ""),
        wallet_address=headers.get("x-agent-wallet-address", ""),
        key_id=match["key_id"],
        created=int(match["created"]),
        expires=int(match["expires"]),
        nonce=match["nonce"],
    )
    if expected != headers:
        raise UsageError("The request's headers are not the ones regents prepared for it.")
    return expected, message


def signature_header(signature: str) -> str:
    if not SIGNATURE.fullmatch(signature):
        raise UsageError("The signature must be 0x followed by 130 hex characters.")
    return "sig1=:" + base64.b64encode(bytes.fromhex(signature[2:])).decode("ascii") + ":"


def sign(request: Request, sign_in: SignIn) -> dict[str, str]:
    """Signed headers for `request`, signed with the key on this machine."""
    key = load_key()
    if not sign_in.local or key is None or key.address != sign_in.wallet_address:
        raise CommandError(
            "outside_key",
            "This site's sign-in belongs to a key that is not on this machine. "
            "Sign with it yourself: --phase prepare, then --phase send.",
            exit_code=EXIT_AUTH,
        )
    headers, message = prepare(request, sign_in)
    return {**headers, "signature": signature_header(personal_sign(key, message))}


def confirm(site: str, sign_in: SignIn, timeout_ms: int) -> None:
    """Have the sign-in server check a request signed with this sign-in, as the site does."""
    request = Request("GET", "/")
    checked = _broker(
        sign_in.broker,
        "/api/shared/siwa/http-verify",
        {"method": request.method, "path": request.target, "headers": sign(request, sign_in)},
        timeout_ms,
        headers={"x-siwa-audience": site},
    )
    if not isinstance(checked, dict) or checked.get("code") != "http_envelope_valid":
        raise CommandError(
            "sign_in_refused",
            f"The sign-in server did not accept a request signed for {site}.",
            exit_code=EXIT_AUTH,
        )
