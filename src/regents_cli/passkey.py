"""The agent key locked with a passkey on a Mac, in the same format as the SIWA agent client.

`key.json` holds `{"address", "locked": {"credential_id", "iv", "box"}}`: the private key
sealed with AES-GCM under a secret only the passkey gives, after Touch ID on a page served on
this Mac. Once opened, a helper keeps the key until the Mac restarts and signs for this user's
clients on a socket in the user's private temporary folder. The SIWA agent client and
`regents` find the same helper there, so the person confirms once for both.

Run as `python -m regents_cli.passkey <socket>` with the private key on stdin, this module is
that helper.
"""

from __future__ import annotations

import hashlib
import http.server
import json
import os
import secrets
import socket
import socketserver
import subprocess
import sys
import threading
import time
from importlib.resources import files
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from eth_account import Account
from eth_account.messages import encode_defunct

from regents_cli.errors import EXIT_AUTH, CommandError
from regents_cli.output import stderr

BOX_INFO = b"agent key box"
PASSKEY_WAIT_SECONDS = 300
HELPER_START_SECONDS = 10
ASKS = {
    "lock": "Ask your person to lock your new key: they press Use Touch ID on the page that "
    "just opened on this Mac.",
    "unlock": "Ask your person to unlock your key: they press Use Touch ID on the page that "
    "just opened on this Mac. They are asked once after each restart.",
}


def _box_cipher(secret: str) -> AESGCM:
    """The AES-GCM cipher a passkey's secret opens, the same as in the SIWA agent client."""
    derived = HKDF(algorithm=hashes.SHA256(), length=32, salt=bytes(32), info=BOX_INFO).derive(
        bytes.fromhex(secret)
    )
    return AESGCM(derived)


def _passkey_secret(mode: str, address: str, credential_id: str | None) -> dict[str, str]:
    """Open a page on this Mac where the person confirms with Touch ID; answer the passkey's id
    and secret."""
    token = secrets.token_urlsafe(24)
    setup = json.dumps({"mode": mode, "address": address, "credentialId": credential_id})
    page = (
        files("regents_cli").joinpath("passkey.html").read_text("utf-8").replace("__SETUP__", setup)
    ).encode("utf-8")
    answer: dict[str, str] = {}
    answered = threading.Event()

    class Page(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path != f"/{token}":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(page)

        def do_POST(self) -> None:
            if self.path != f"/{token}" or answered.is_set():
                self.send_error(404)
                return
            answer.update(json.loads(self.rfile.read(int(self.headers["content-length"]))))
            self.send_response(204)
            self.end_headers()
            answered.set()

        def log_message(self, *_args: Any) -> None:
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Page)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://localhost:{server.server_port}/{token}"
    stderr.print(f"{ASKS[mode]} {url}", soft_wrap=True)
    subprocess.run(["open", url], check=False)
    try:
        if not answered.wait(PASSKEY_WAIT_SECONDS):
            raise CommandError(
                "no_touch_id",
                f"No Touch ID within {PASSKEY_WAIT_SECONDS // 60} minutes. Run the command again "
                "and ask your person to confirm on the page it opens.",
                exit_code=EXIT_AUTH,
            )
    finally:
        server.shutdown()
    return answer


def lock(address: str, private_key: str) -> dict[str, str]:
    """Make a passkey for this key and seal the key with the passkey's secret."""
    answer = _passkey_secret("lock", address, None)
    iv = secrets.token_bytes(12)
    box = _box_cipher(answer["secret"]).encrypt(
        iv, private_key.encode("utf-8"), address.encode("utf-8")
    )
    return {"credential_id": answer["credential_id"], "iv": iv.hex(), "box": box.hex()}


def _open_box(address: str, locked: dict[str, str]) -> str:
    answer = _passkey_secret("unlock", address, locked["credential_id"])
    private_key = _box_cipher(answer["secret"]).decrypt(
        bytes.fromhex(locked["iv"]), bytes.fromhex(locked["box"]), address.encode("utf-8")
    )
    return private_key.decode("utf-8")


def _helper_socket(address: str) -> str:
    """Where the helper holding this unlocked key listens, the same path the SIWA agent client
    uses: the Mac's own private folder for this user, whatever TMPDIR a harness sets."""
    if sys.platform != "darwin":
        raise CommandError(
            "locked_key_needs_mac",
            "This agent key is locked with a Mac passkey, so only the Mac that locked it can "
            "use it.",
            exit_code=EXIT_AUTH,
        )
    folder = subprocess.run(
        ["getconf", "DARWIN_USER_TEMP_DIR"], capture_output=True, text=True, check=True
    ).stdout.strip()
    name = hashlib.sha256(address.encode("utf-8")).hexdigest()[:16]
    return os.path.join(folder, f"siwa-agent-{name}.sock")


def _ask_helper(path: str, request: dict[str, Any]) -> dict[str, Any] | None:
    """One request to the helper; None when no helper is listening, or the one there is
    stopping and closes without an answer."""
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.connect(path)
            connection.sendall(json.dumps(request).encode("utf-8") + b"\n")
            reply = connection.makefile("rb").readline()
    except (FileNotFoundError, ConnectionRefusedError, BrokenPipeError, ConnectionResetError):
        return None
    if not reply:
        return None
    answer: dict[str, Any] = json.loads(reply)
    if "error" in answer:
        raise CommandError("key_helper_refused", answer["error"], exit_code=EXIT_AUTH)
    return answer


def start_helper(address: str, private_key: str) -> None:
    """Hand the unlocked key to a helper that keeps it until this Mac restarts."""
    path = _helper_socket(address)
    helper = subprocess.Popen(
        [sys.executable, "-m", "regents_cli.passkey", path],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    assert helper.stdin is not None
    helper.stdin.write(private_key.encode("utf-8"))
    helper.stdin.close()
    deadline = time.monotonic() + HELPER_START_SECONDS
    while _ask_helper(path, {"op": "address"}) is None:
        if time.monotonic() > deadline:
            raise CommandError(
                "key_helper_failed",
                "The helper that keeps the unlocked key did not start within "
                f"{HELPER_START_SECONDS} seconds.",
                exit_code=EXIT_AUTH,
            )
        time.sleep(0.1)


def unlocked(address: str, locked: dict[str, str], request: dict[str, Any]) -> dict[str, Any]:
    """Ask the helper holding the unlocked key; open the key with Touch ID first when no helper
    is running."""
    path = _helper_socket(address)
    answer = _ask_helper(path, request)
    if answer is None:
        start_helper(address, _open_box(address, locked))
        answer = _ask_helper(path, request)
    assert answer is not None
    return answer


def sign_message_with(private_key: str, text: str) -> str:
    signed = Account.sign_message(encode_defunct(text=text), private_key=private_key)
    return "0x" + bytes(signed.signature).hex()


def sign_transaction_with(private_key: str, transaction: dict[str, str]) -> str:
    """Sign a transaction given as 0x quantities (chainId, nonce, value, gas, fees) and 0x hex
    (to, data), the shape the helper takes."""
    signed = Account.sign_transaction(
        {
            "type": 2,
            "chainId": int(transaction["chainId"], 16),
            "nonce": int(transaction["nonce"], 16),
            "to": bytes.fromhex(transaction["to"].removeprefix("0x")),
            "data": transaction["data"],
            "value": int(transaction["value"], 16),
            "gas": int(transaction["gas"], 16),
            "maxFeePerGas": int(transaction["maxFeePerGas"], 16),
            "maxPriorityFeePerGas": int(transaction["maxPriorityFeePerGas"], 16),
        },
        private_key=private_key,
    )
    return "0x" + bytes(signed.raw_transaction).hex()


def _serve(path: str) -> None:
    """Keep the key read from stdin and sign with it for this user's clients until the Mac
    restarts."""
    account = Account.from_key(sys.stdin.read().strip())
    private_key = "0x" + bytes(account.key).hex()
    if _ask_helper(path, {"op": "address"}) is not None:
        return
    if os.path.exists(path):
        os.unlink(path)

    class Helper(socketserver.StreamRequestHandler):
        def handle(self) -> None:
            request = json.loads(self.rfile.readline())
            op = request.get("op")
            try:
                if op == "address":
                    reply: dict[str, Any] = {"address": account.address.lower()}
                elif op == "sign_message":
                    reply = {"signature": sign_message_with(private_key, request["text"])}
                elif op == "sign_transaction":
                    reply = {"raw": sign_transaction_with(private_key, request["transaction"])}
                elif op == "stop":
                    reply = {"stopped": True}
                    threading.Thread(target=self.server.shutdown).start()
                else:
                    reply = {"error": f"the key helper does not know {op}"}
            except (KeyError, ValueError, TypeError) as error:
                reply = {"error": f"the key helper could not sign: {error}"}
            self.wfile.write(json.dumps(reply).encode("utf-8") + b"\n")

    os.umask(0o077)
    with socketserver.ThreadingUnixStreamServer(path, Helper) as server:
        bound = os.stat(path).st_ino
        server.serve_forever()
    # A helper started after this one stopped listening has its own socket at the same path.
    if os.path.exists(path) and os.stat(path).st_ino == bound:
        os.unlink(path)


if __name__ == "__main__":
    _serve(sys.argv[1])
