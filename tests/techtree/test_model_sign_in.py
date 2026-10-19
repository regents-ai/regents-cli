"""`regents techtree model login`, `status` and `logout`, run whole against a stand-in for
OpenAI's sign-in: the browser step asks for the plan with PKCE and this machine's host id, the
tokens are kept in a private file and never shown, an answer or ID token for another attempt
saves nothing, and logout revokes the sign-in at OpenAI's revocation address and keeps the host
id. A refused sign-in step is read for
its OAuth error code whatever the body holds, and never crashes login
(R-20261018-deep-oauth-error: a body nested deeper than Python reads raised RecursionError
instead of answering).
"""

from __future__ import annotations

import contextlib
import io
import json
import threading
import time
from collections.abc import Callable
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from hypothesis import example, given
from hypothesis import strategies as st

from regents_cli import app, browser
from regents_cli.techtree.chatgpt import signin
from regents_cli.techtree.chatgpt.signin import _oauth_error

JSON = st.recursive(
    st.none() | st.booleans() | st.integers() | st.text(),
    lambda inner: st.lists(inner, max_size=3) | st.dictionaries(st.text(), inner, max_size=3),
    max_leaves=10,
)
BODIES = st.binary() | JSON.map(lambda value: json.dumps(value).encode("utf-8"))


@given(BODIES)
@example(b"[" * 100_000 + b"]" * 100_000)
@example(b'{"error": "invalid_grant"}')
def test_any_refused_body_gives_its_error_code_or_none(body: bytes) -> None:
    code = _oauth_error(httpx.Response(400, content=body))
    try:
        read = json.loads(body)
    except (ValueError, RecursionError):
        assert code is None
        return
    said = read.get("error") if isinstance(read, dict) else None
    assert code == (said if isinstance(said, str) else None)


class OpenAi:
    """A stand-in for OpenAI's sign-in: it answers the browser step the way a person who allows
    Regents does, issues tokens for the code it gave, and signs the ID token with its own key."""

    CLIENT_ID = "client-regents-1"
    EMAIL = "person@example.com"

    def __init__(
        self,
        *,
        nonce_for: Callable[[str], str] = lambda nonce: nonce,
        state_for: Callable[[str], str] = lambda state: state,
    ) -> None:
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.nonce_for, self.state_for = nonce_for, state_for
        self.authorized: dict[str, str] = {}
        self.forms: list[dict[str, str]] = []
        self.callbacks: list[threading.Thread] = []

    def allow(self, _ask: str, address: str) -> None:
        """The person opens the address and allows Regents; OpenAI sends the browser back."""
        self.authorized = dict(parse_qsl(urlsplit(address).query))
        back = urlencode(
            {
                "code": "code-1",
                "state": self.state_for(self.authorized["state"]),
                "client_id": self.CLIENT_ID,
            }
        )
        callback = threading.Thread(
            target=httpx.get, args=(f"{self.authorized['redirect_uri']}?{back}",)
        )
        callback.start()
        self.callbacks.append(callback)

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == signin.OPENID_CONFIGURATION_URL:
            return httpx.Response(
                200,
                json={
                    "issuer": signin.ISSUER,
                    "jwks_uri": "https://auth.openai.com/jwks",
                    "revocation_endpoint": "https://auth.openai.com/revoke",
                },
            )
        if url == "https://auth.openai.com/jwks":
            public = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(self.key.public_key()))
            return httpx.Response(200, json={"keys": [{**public, "kid": "key-1"}]})
        if url == signin.MODELS_URL:
            assert request.headers["authorization"] == "Bearer access-1"
            return httpx.Response(
                200,
                json={
                    "models": [
                        {"slug": "gpt-6", "display_name": "GPT-6", "visibility": "list"},
                        {"slug": "gpt-6-hidden", "display_name": "Hidden", "visibility": "hide"},
                    ]
                },
            )
        self.forms.append({"url": url, **dict(parse_qsl(request.content.decode()))})
        if url == "https://auth.openai.com/revoke":
            return httpx.Response(200)
        assert url == signin.TOKEN_URL
        now = int(time.time())
        id_token = jwt.encode(
            {
                "iss": signin.ISSUER,
                "aud": self.CLIENT_ID,
                "sub": "person-1",
                "email": self.EMAIL,
                "nonce": self.nonce_for(self.authorized["nonce"]),
                "iat": now,
                "exp": now + 600,
            },
            self.key,
            algorithm="ES256",
            headers={"kid": "key-1"},
        )
        return httpx.Response(
            200,
            json={
                "access_token": "access-1",
                "refresh_token": "refresh-1",
                "id_token": id_token,
                "expires_in": 3600,
                "scope": " ".join(signin.SCOPES),
            },
        )


def regents(words: list[str], openai: OpenAi, home: Path) -> tuple[int, str]:
    """`regents techtree model <words> --json` with HOME at `home`, against the stand-in."""
    shown = io.StringIO()
    with (
        pytest.MonkeyPatch.context() as patch,
        contextlib.redirect_stdout(shown),
        contextlib.redirect_stderr(shown),
    ):
        patch.setenv("HOME", str(home))
        patch.setattr(browser, "offer", openai.allow)
        patch.setattr(
            signin, "_client", lambda: httpx.Client(transport=httpx.MockTransport(openai.handle))
        )
        exit_code = app.main(["techtree", "model", *words, "--json"])
    for callback in openai.callbacks:
        callback.join(timeout=10)
    return exit_code, shown.getvalue()


def test_model_login_status_and_logout_run_whole_and_never_show_a_token(tmp_path: Path) -> None:
    openai = OpenAi()
    root = tmp_path / ".regents/techtree"

    logged_in, said = regents(["login"], openai, tmp_path)
    assert logged_in == 0, said
    assert json.loads(said)["email"] == OpenAi.EMAIL
    asked = openai.authorized
    host_id = json.loads((root / signin.HOST_ID_FILE).read_text())["ext_agent_host_id"]
    assert (asked["client_id"], asked["agent_name_hint"], asked["ext_agent_host_id"]) == (
        signin.REGISTRATION_CLIENT_ID,
        signin.AGENT_NAME,
        host_id,
    )
    [exchange] = openai.forms
    assert exchange["client_id"] == OpenAi.CLIENT_ID
    assert signin._pkce_challenge(exchange["code_verifier"]) == asked["code_challenge"]
    assert asked["code_challenge_method"] == "S256"
    kept = root / signin.CREDENTIALS_FILE
    assert kept.stat().st_mode & 0o777 == 0o600
    assert json.loads(kept.read_text())["client_id"] == OpenAi.CLIENT_ID

    listed, said_status = regents(["status"], openai, tmp_path)
    assert listed == 0, said_status
    assert json.loads(said_status)["models"] == [{"slug": "gpt-6", "display_name": "GPT-6"}]

    logged_out, said_logout = regents(["logout"], openai, tmp_path)
    assert logged_out == 0, said_logout
    assert json.loads(said_logout)["revocation_confirmed"] is True
    revoked = openai.forms[-1]
    assert (revoked["url"], revoked["token"]) == ("https://auth.openai.com/revoke", "refresh-1")
    assert not kept.exists()
    assert (root / signin.HOST_ID_FILE).exists()
    for token in ("access-1", "refresh-1", "code-1"):
        assert token not in said + said_status + said_logout


@pytest.mark.parametrize(
    "openai",
    [
        pytest.param(lambda: OpenAi(nonce_for=lambda nonce: nonce + "-other"), id="ID token"),
        pytest.param(lambda: OpenAi(state_for=lambda state: state + "-other"), id="answer"),
    ],
)
def test_an_answer_for_another_attempt_is_refused_and_nothing_is_saved(
    openai: Callable[[], OpenAi], tmp_path: Path
) -> None:
    stand_in = openai()

    logged_in, said = regents(["login"], stand_in, tmp_path)

    assert logged_in != 0
    assert json.loads(said)["error"]["code"] == signin.MODEL_SIGN_IN_FAILED
    assert not (tmp_path / ".regents/techtree" / signin.CREDENTIALS_FILE).exists()
    assert "access-1" not in said and "refresh-1" not in said
