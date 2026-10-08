"""Check end to end that a sign-in server accepts what `regents` signs and refuses what it must.

The costly failure: `regents` and the sign-in server disagree about a signed request, and every
agent on every site is locked out at once. Before a release that changes signing, run this against
a local sign-in server built from the same library as the packaged signing contract:

    SIWA_BROKER=http://localhost:4198 uv run scripts/check_siwa_server.py

It signs in to the server's `regents` audience with a throwaway key through `regents auth login`,
then has the server check signed requests the way a site does (POST /api/shared/siwa/http-verify):
a read with no body, a write with a JSON body, a read with an empty signed body and a read with
a query are accepted; a changed body, a changed query, another site's audience and a replay are
refused. SIWA_BROKER has no default, so
this never signs in to the live server.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import httpx
from eth_account import Account

from regents_cli import siwa
from regents_cli.http import Request

SITE = "regents"


def verify(
    broker: str, audience: str, request: Request, headers: dict[str, str], body: Any
) -> bool:
    """Whether the sign-in server accepts `headers` for `request` sent with `body`'s bytes."""
    answer = httpx.post(
        f"{broker}/api/shared/siwa/http-verify",
        json={"method": request.method, "path": request.target, "headers": headers, "body": body},
        headers={"x-siwa-audience": audience},
        timeout=30,
    )
    if answer.status_code == 200:
        return answer.json()["data"]["verified"] is True
    if answer.status_code in (401, 409):
        return False
    raise SystemExit(f"the sign-in server answered {answer.status_code}: {answer.text[:300]}")


def text(request: Request) -> str | None:
    content = request.content
    return None if content is None else content.decode("utf-8")


def main() -> int:
    broker = os.environ.get("SIWA_BROKER", "").rstrip("/")
    if not broker:
        print("Set SIWA_BROKER to a local sign-in server, such as http://localhost:4198.")
        return 2
    with tempfile.TemporaryDirectory() as folder:
        home = Path(folder) / "agent"
        home.mkdir(mode=0o700)
        account = Account.create()
        key = {"address": account.address.lower(), "private_key": "0x" + bytes(account.key).hex()}
        (home / "key.json").write_text(json.dumps(key), "utf-8")
        (home / "key.json").chmod(0o600)
        os.environ["SIWA_AGENT_HOME"] = str(home)
        login = subprocess.run(
            [sys.executable, "-m", "regents_cli", "auth", "login", "--site", SITE, "--json"],
            capture_output=True,
            text=True,
            check=False,
        )
        if login.returncode != 0:
            print(f"regents auth login failed:\n{login.stdout}{login.stderr}")
            return 1
        receipt = siwa.load_receipt(SITE)
        assert receipt is not None

        def signed(request: Request) -> dict[str, str]:
            return siwa.sign(request, receipt)

        read = Request("GET", "/api/agent/check")
        write = Request("POST", "/api/agent/check", body={"note": "hello"})
        empty = Request("GET", "/api/agent/check", body={})
        query = Request("GET", "/api/agent/check", {"cursor": "2"})
        replayed = signed(read)
        cases = [
            ("a read with no body", True, read, signed(read), None, SITE),
            ("a write with a JSON body", True, write, signed(write), text(write), SITE),
            ("a read with an empty signed body", True, empty, signed(empty), text(empty), SITE),
            ("a read with a query", True, query, signed(query), None, SITE),
            ("a changed body", False, write, signed(write), '{"note":"changed"}', SITE),
            ("another site's audience", False, read, signed(read), None, "patchbay"),
            ("a first send", True, read, replayed, None, SITE),
            ("the same request again", False, read, replayed, None, SITE),
            (
                "a changed query",
                False,
                Request("GET", "/api/agent/check", {"cursor": "3"}),
                signed(query),
                None,
                SITE,
            ),
        ]
        failed = []
        for label, expected, request, headers, body, audience in cases:
            accepted = verify(broker, audience, request, headers, body)
            print(f"{'accepted' if accepted else 'refused '}  {label}")
            if accepted != expected:
                failed.append(label)
    if failed:
        print(f"the sign-in server disagreed with regents on: {', '.join(failed)}")
        return 1
    print(f"the sign-in server at {broker} accepts and refuses what it should")
    return 0


if __name__ == "__main__":
    sys.exit(main())
