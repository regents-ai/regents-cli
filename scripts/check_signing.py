"""Fail when signed requests stop matching ones siwa-server's verifier accepted.

The costly failure: a change to how `regents` signs breaks every wallet-proof request on every
site at once. scripts/signing_vector.json holds a GET, a POST and a GET with an empty signed
body (for a site that reads a body on every signed request), signed with the well-known test
key 0x…01, that siwa-server's own verifier accepted when they were recorded. The receipt in it
comes from a sign-in server on a developer's machine and expired within the hour.

    uv run scripts/check_signing.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from regents_cli import siwa
from regents_cli.http import Request

VECTOR = Path(__file__).resolve().parent / "signing_vector.json"


def main() -> int:
    vector = json.loads(VECTOR.read_text("utf-8"))
    key = siwa.Key(address=vector["wallet_address"], private_key=vector["private_key"])
    failed = []
    for recorded in vector["requests"]:
        request = Request(recorded["method"], recorded["path"], body=recorded["body"])
        headers, message = siwa.unsigned(
            request,
            receipt=vector["receipt"],
            wallet_address=vector["wallet_address"],
            chain_id=siwa.BASE,
            key_id=vector["key_id"],
            created=vector["created"],
            expires=vector["expires"],
            nonce=recorded["nonce"],
        )
        headers["signature"] = siwa.signature_header(siwa.personal_sign(key, message))
        if message != recorded["message"] or headers != recorded["headers"]:
            failed.append(f"{request.method} {request.path}")
    if failed:
        print(f"signed differently from what siwa-server accepted: {', '.join(failed)}")
        return 1
    print(f"all {len(vector['requests'])} signed requests match what siwa-server accepted")
    return 0


if __name__ == "__main__":
    sys.exit(main())
