"""Check end to end that a site and its sign-in server accept what `regents` signs and refuse
what they must.

The costly failure: `regents` and the sign-in server disagree about a signed request, and every
agent on every site is locked out at once. Before a release that changes signing, run this against
a local ash-template site and the local sign-in server it checks signatures with, both built from
the same library as the packaged signing contract:

    SIWA_BROKER=http://localhost:4198 ASH_TEMPLATE_BASE_URL=http://localhost:4000 \\
      uv run scripts/check_siwa_server.py

It signs in to the server's `ash-template` and `patchbay` audiences with a throwaway key through
`regents auth login`, then sends the site its signed `agents whoami` (GET
/api/agents/v1/whoami), which the site checks with the sign-in server using its own key, as it
checks every signed request: a read, a read with a query, one with a JSON body and one with an
empty signed body are accepted; a changed query, a changed body, another site's sign-in and a
replay are refused. Neither address has a default; point both at local copies, since a live site
refuses a throwaway key's sign-in from a local server and every accepted case would fail.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from dataclasses import replace
from pathlib import Path

from eth_account import Account

from regents_cli import siwa
from regents_cli.errors import CommandError
from regents_cli.http import Request, respond
from regents_cli.platforms import identity_probe

SITE = "ash-template"
OTHER_SITE = "patchbay"


def accepted(base: str, request: Request) -> bool:
    """Whether the site accepts `request`, signed: 200, or refused with 401 or 409."""
    try:
        answer = respond(base, request, 30_000)
    except CommandError as error:
        raise SystemExit(f"the site did not answer: {error.code}: {error.message}") from error
    if answer.status_code == 200:
        return True
    if answer.status_code in (401, 409):
        return False
    raise SystemExit(f"the site answered {answer.status_code}: {answer.text[:300]}")


def main() -> int:
    broker = os.environ.get("SIWA_BROKER", "").rstrip("/")
    platform, probe = identity_probe(SITE)
    base = os.environ.get(platform.env_var, "").rstrip("/")
    if not broker or not base:
        print(
            f"Set SIWA_BROKER to a local sign-in server, such as http://localhost:4198, and "
            f"{platform.env_var} to a local {SITE} site that checks signatures with it."
        )
        return 2
    with tempfile.TemporaryDirectory() as folder:
        home = Path(folder) / "agent"
        home.mkdir(mode=0o700)
        account = Account.create()
        key = {"address": account.address.lower(), "private_key": "0x" + bytes(account.key).hex()}
        (home / "key.json").write_text(json.dumps(key), "utf-8")
        (home / "key.json").chmod(0o600)
        os.environ["SIWA_AGENT_HOME"] = str(home)
        for site in (SITE, OTHER_SITE):
            login = subprocess.run(
                [sys.executable, "-m", "regents_cli", "auth", "login", "--site", site, "--json"],
                capture_output=True,
                text=True,
                check=False,
            )
            if login.returncode != 0:
                print(f"regents auth login --site {site} failed:\n{login.stdout}{login.stderr}")
                return 1
        receipt, other = siwa.load_receipt(SITE), siwa.load_receipt(OTHER_SITE)
        assert receipt is not None and other is not None

        def signed(request: Request, by: siwa.Receipt = receipt) -> Request:
            return replace(request, headers=siwa.sign(request, by))

        read = Request(probe.method, probe.path)
        query = Request(probe.method, probe.path, {"cursor": "2"})
        body = Request(probe.method, probe.path, body={"note": "hello"})
        empty = Request(probe.method, probe.path, body={})
        replayed = signed(read)
        cases = [
            ("a read", True, signed(read)),
            ("a read with a query", True, signed(query)),
            ("a read with a JSON body", True, signed(body)),
            ("a read with an empty signed body", True, signed(empty)),
            ("a changed body", False, replace(signed(body), body={"note": "changed"})),
            (
                "a changed query",
                False,
                replace(signed(query), query={"cursor": "3"}),
            ),
            (f"a sign-in made for {OTHER_SITE}", False, signed(read, other)),
            ("a first send", True, replayed),
            ("the same request again", False, replayed),
        ]
        failed = []
        for label, expected, request in cases:
            answer = accepted(base, request)
            print(f"{'accepted' if answer else 'refused '}  {label}")
            if answer != expected:
                failed.append(label)
    if failed:
        print(f"the site and its sign-in server disagreed with regents on: {', '.join(failed)}")
        return 1
    print(f"{base} and the sign-in server at {broker} accept and refuse what they should")
    return 0


if __name__ == "__main__":
    sys.exit(main())
