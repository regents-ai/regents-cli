"""Signing this machine in to the person's ChatGPT plan with OpenAI's Sign in with ChatGPT.

A Climb can run on the person's ChatGPT plan instead of their own Prime key (59 a, 105 b). This
module is the whole sign-in: the browser login with PKCE on a loopback callback, the ID-token
check, the one file the tokens live in, the refresh that rotates them, the plan's model list,
and the logout that revokes them at OpenAI.

Tokens live only in `<home>/chatgpt.json` (0600, written atomically). They never go into a URL,
a log, an exception or an answer: the browser address holds only the state, the nonce and the
PKCE challenge. The refresh token rotates on every use, so every refresh happens under one file
lock and the replacement is written before the new access token is handed out.

The host id sits beside it in `chatgpt-host.json`: OpenAI counts plan usage per stable host id,
so logout removes the tokens but keeps the id this machine signs in with.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
import uuid
import webbrowser
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Final
from urllib.parse import parse_qsl, quote, urlencode, urlsplit

import httpx
import jwt
import pydantic
from filelock import FileLock, Timeout
from pydantic import BaseModel, ConfigDict, Field

from regents_cli import output
from regents_cli.errors import EXIT_UNREACHABLE, CommandError
from regents_cli.techtree.errors import (
    AuthenticationError,
    ConflictError,
    TechtreeError,
    ValidationError,
)
from regents_cli.techtree.fs import atomic_write_bytes, ensure_private_directory, fsync_directory
from regents_cli.techtree.models.base import ProtocolModel

ISSUER: Final = "https://auth.openai.com"
OPENID_CONFIGURATION_URL: Final = "https://auth.openai.com/.well-known/openid-configuration"
AUTHORIZE_URL: Final = "https://auth.openai.com/api/accounts/authorize"
TOKEN_URL: Final = "https://auth.openai.com/api/accounts/oauth/token"
MODELS_URL: Final = "https://api.openai.com/v1/models"
RESOURCE: Final = "https://api.openai.com/v1"
USAGE_SETTINGS_URL: Final = "https://chatgpt.com/settings/usage"

#: First-time registration goes to this client id; OpenAI answers with the one to keep.
REGISTRATION_CLIENT_ID: Final = "dynamic_agent_client"
AGENT_NAME: Final = "Regents"
PLAN_SCOPE: Final = "chatgpt.tokens.use.direct"
SCOPES: Final = ("openid", "profile", "email", "offline_access", "resource.invoke", PLAN_SCOPE)

CREDENTIALS_FILE: Final = "chatgpt.json"
HOST_ID_FILE: Final = "chatgpt-host.json"
REQUEST_ID_HEADER: Final = "x-request-id"

MODEL_SIGN_IN_REQUIRED: Final = "model_sign_in_required"
PLAN_NOT_ELIGIBLE: Final = "plan_not_eligible"
MODEL_SIGN_IN_FAILED: Final = "model_sign_in_failed"
OPENAI_UNEXPECTED_ANSWER: Final = "openai_unexpected_answer"

_LOCK_FILE: Final = "chatgpt.json.lock"
_LOCK_TIMEOUT_SECONDS: Final = 60.0
_HTTP_TIMEOUT_SECONDS: Final = 60.0
_CALLBACK_WAIT_SECONDS: Final = 300.0
_CALLBACK_SOCKET_SECONDS: Final = 10.0
#: An access token lasts an hour; one closer than this to expiring is refreshed first.
_REFRESH_MARGIN_SECONDS: Final = 300
_REFRESH_TOKEN_LIFETIME_SECONDS: Final = 30 * 24 * 60 * 60
_REVOKE_RETRY_DELAYS_SECONDS: Final = (0.0, 1.0, 2.0)
#: ID tokens are signed with a published asymmetric key; nothing else is accepted.
_ID_TOKEN_ALGORITHMS: Final = ("ES256", "PS256", "RS256")
#: The refresh errors OpenAI documents as "this refresh token can no longer be used".
_UNUSABLE_REFRESH_ERRORS: Final = frozenset(
    {
        "invalid_grant",
        "invalid_refresh_token",
        "token_expired",
        "refresh_token_expired",
        "refresh_token_invalidated",
        "refresh_token_reused",
    }
)
_LOGIN_COMMAND: Final = "regents techtree model login"
_LOGOUT_COMMAND: Final = "regents techtree model logout"


@dataclass(frozen=True)
class SignedIn:
    email: str


@dataclass(frozen=True)
class LocalSignIn:
    """What this machine holds, read without a network call. `ready` means the refresh token is
    within its 30 days and the sign-in grants use of the plan."""

    email: str
    ready: bool


@dataclass(frozen=True)
class PlanModel:
    slug: str
    display_name: str


@dataclass(frozen=True)
class PlanStatus:
    email: str
    models: tuple[PlanModel, ...]


@dataclass(frozen=True)
class LoggedOut:
    """`removed` says a sign-in file was here; `email` is None when it could not be read."""

    removed: bool
    email: str | None
    revocation_confirmed: bool


class _Credentials(ProtocolModel):
    """`<home>/chatgpt.json`. The tokens are kept out of every repr."""

    email: str
    subject: str
    client_id: str
    access_token: str = Field(repr=False)
    refresh_token: str = Field(repr=False)
    access_expires_at: int
    refresh_expires_at: int
    scopes: list[str]


class _HostId(ProtocolModel):
    ext_agent_host_id: str


class _OpenAiDocument(BaseModel):
    """Something OpenAI sends: only the fields named here are read."""

    model_config = ConfigDict(frozen=True, extra="ignore")


class _OpenIdConfiguration(_OpenAiDocument):
    issuer: str
    jwks_uri: str
    revocation_endpoint: str


class _CodeTokens(_OpenAiDocument):
    access_token: str = Field(repr=False)
    refresh_token: str = Field(repr=False)
    id_token: str = Field(repr=False)
    expires_in: int
    scope: str


class _RefreshedTokens(_OpenAiDocument):
    access_token: str = Field(repr=False)
    refresh_token: str = Field(repr=False)
    expires_in: int
    scope: str


class _ListedModel(_OpenAiDocument):
    slug: str
    display_name: str
    visibility: str


class _ModelList(_OpenAiDocument):
    models: list[_ListedModel]


@dataclass(frozen=True)
class _Identity:
    subject: str
    email: str


def sign_in_required(reason: str, **details: object) -> AuthenticationError:
    return AuthenticationError(
        f"{reason} Run `{_LOGIN_COMMAND}` to sign in to your ChatGPT plan.",
        code=MODEL_SIGN_IN_REQUIRED,
        details=details,
    )


def plan_not_eligible(**details: object) -> AuthenticationError:
    return AuthenticationError(
        "OpenAI says this ChatGPT account can't lend its plan to Regents. That takes ChatGPT "
        "Plus or Pro, in a workspace and region that allow it.",
        code=PLAN_NOT_ELIGIBLE,
        details=details,
    )


def _sign_in_failed(message: str, **details: object) -> AuthenticationError:
    return AuthenticationError(message, code=MODEL_SIGN_IN_FAILED, details=details)


def login(home: Path) -> SignedIn:
    """Sign in through the browser and keep the tokens in `<home>/chatgpt.json`."""
    host_id = _host_id(home)
    kept = _readable(home)
    client_id = REGISTRATION_CLIENT_ID if kept is None else kept.client_id
    verifier = secrets.token_urlsafe(64)
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    with _CallbackServer() as server:
        redirect_uri = f"http://127.0.0.1:{server.port}/callback"
        query = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": " ".join(SCOPES),
            "resource": RESOURCE,
            "state": state,
            "nonce": nonce,
            "code_challenge": _pkce_challenge(verifier),
            "code_challenge_method": "S256",
            "ext_agent_host_id": host_id,
        }
        if kept is None:
            # OpenAI wants the name only on first registration; the person can rename it there.
            query["agent_name_hint"] = AGENT_NAME
        address = f"{AUTHORIZE_URL}?{urlencode(query, quote_via=quote)}"
        if webbrowser.open(address):
            output.stderr.print("Finish signing in to ChatGPT in the browser window that opened.")
        else:
            output.stderr.print(
                "No browser opened. Open this address in a browser on this machine to sign in "
                f"to ChatGPT:\n{address}",
                soft_wrap=True,
            )
        answer = server.wait(_CALLBACK_WAIT_SECONDS)
    issued_client_id = _issued_client_id(answer, state=state, kept=kept)
    with _client() as client:
        configuration = _openid_configuration(client)
        response = _post_form(
            client,
            TOKEN_URL,
            {
                "grant_type": "authorization_code",
                "code": answer["code"],
                "client_id": issued_client_id,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri,
                "resource": RESOURCE,
            },
        )
        if response.status_code != 200:
            raise _sign_in_failed(
                "OpenAI did not accept the sign-in code, so nothing was saved. Run "
                f"`{_LOGIN_COMMAND}` again.",
                http_status=response.status_code,
                openai_code=_oauth_error(response),
                request_id=response.headers.get(REQUEST_ID_HEADER),
            )
        tokens = _parse(_CodeTokens, response, "the sign-in")
        identity = _verify_id_token(
            tokens.id_token,
            client=client,
            jwks_uri=configuration.jwks_uri,
            client_id=issued_client_id,
            nonce=nonce,
        )
    scopes = tokens.scope.split()
    if PLAN_SCOPE not in scopes:
        raise _sign_in_failed(
            "You signed in, but without allowing Regents to use your ChatGPT plan, so nothing "
            f"was saved. Run `{_LOGIN_COMMAND}` again and allow it."
        )
    if kept is not None and identity.subject != kept.subject:
        raise _sign_in_failed(
            "That is a different ChatGPT account from the one this machine signs in with, so "
            f"nothing was changed. Run `{_LOGOUT_COMMAND}` first to switch accounts."
        )
    now = _now()
    credentials = _Credentials(
        email=identity.email,
        subject=identity.subject,
        client_id=issued_client_id,
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        access_expires_at=now + tokens.expires_in,
        refresh_expires_at=now + _REFRESH_TOKEN_LIFETIME_SECONDS,
        scopes=sorted(scopes),
    )
    with _locked(home):
        _save(home, credentials)
    return SignedIn(email=identity.email)


def access_token(home: Path) -> str:
    """A fresh access token, refreshed first when it is about to expire."""
    return _fresh(home).access_token


def local_sign_in(home: Path) -> LocalSignIn | None:
    """What `<home>/chatgpt.json` says, with no network call and no refresh."""
    credentials = _load(home)
    if credentials is None:
        return None
    ready = credentials.refresh_expires_at > _now() and PLAN_SCOPE in credentials.scopes
    return LocalSignIn(email=credentials.email, ready=ready)


def status(home: Path) -> PlanStatus:
    """The signed-in email and the models the plan offers (those OpenAI lists as `list`)."""
    credentials = _fresh(home)
    with _client() as client:
        response = _get(
            client, MODELS_URL, headers={"authorization": f"Bearer {credentials.access_token}"}
        )
    request_id = response.headers.get(REQUEST_ID_HEADER)
    if response.status_code == 401:
        raise sign_in_required(
            "OpenAI no longer accepts this machine's ChatGPT sign-in.",
            http_status=401,
            request_id=request_id,
        )
    if response.status_code == 403:
        raise plan_not_eligible(http_status=403, request_id=request_id)
    if response.status_code != 200:
        raise _unexpected(response, "the model list")
    listing = _parse(_ModelList, response, "the model list")
    return PlanStatus(
        email=credentials.email,
        models=tuple(
            PlanModel(slug=model.slug, display_name=model.display_name)
            for model in listing.models
            if model.visibility == "list"
        ),
    )


def logout(home: Path) -> LoggedOut:
    """Revoke the sign-in at OpenAI, then delete the file whether or not OpenAI confirmed it."""
    path = home / CREDENTIALS_FILE
    with _locked(home):
        if not path.exists():
            return LoggedOut(removed=False, email=None, revocation_confirmed=False)
        credentials = _readable(home)
        confirmed = credentials is not None and _revoke(credentials)
        path.unlink()
        fsync_directory(home)
    return LoggedOut(
        removed=True,
        email=None if credentials is None else credentials.email,
        revocation_confirmed=confirmed,
    )


def _fresh(home: Path) -> _Credentials:
    with _locked(home):
        credentials = _load(home)
        if credentials is None:
            raise sign_in_required("This machine isn't signed in to a ChatGPT plan.")
        now = _now()
        if credentials.access_expires_at - now > _REFRESH_MARGIN_SECONDS:
            return credentials
        if credentials.refresh_expires_at <= now:
            raise sign_in_required("The ChatGPT sign-in on this machine is more than 30 days old.")
        refreshed = _refresh(credentials)
        # The old refresh token is spent now, so the replacement is kept before anything else.
        _save(home, refreshed)
    if PLAN_SCOPE not in refreshed.scopes:
        raise sign_in_required("OpenAI no longer grants Regents use of your ChatGPT plan.")
    return refreshed


def _refresh(credentials: _Credentials) -> _Credentials:
    with _client() as client:
        response = _post_form(
            client,
            TOKEN_URL,
            {
                "grant_type": "refresh_token",
                "client_id": credentials.client_id,
                "refresh_token": credentials.refresh_token,
                "resource": RESOURCE,
            },
        )
    if response.status_code != 200:
        error = _oauth_error(response)
        if error in _UNUSABLE_REFRESH_ERRORS:
            raise sign_in_required(
                "OpenAI no longer accepts this machine's ChatGPT sign-in.", openai_code=error
            )
        if error == "invalid_client":
            raise AuthenticationError(
                "OpenAI no longer recognises this machine's Regents registration. Run "
                f"`{_LOGOUT_COMMAND}`, then `{_LOGIN_COMMAND}`.",
                code=MODEL_SIGN_IN_REQUIRED,
                details={"openai_code": error},
            )
        raise _unexpected(response, "the token refresh")
    tokens = _parse(_RefreshedTokens, response, "the token refresh")
    now = _now()
    return credentials.model_copy(
        update={
            "access_token": tokens.access_token,
            "refresh_token": tokens.refresh_token,
            "access_expires_at": now + tokens.expires_in,
            "refresh_expires_at": now + _REFRESH_TOKEN_LIFETIME_SECONDS,
            "scopes": sorted(tokens.scope.split()),
        }
    )


def _revoke(credentials: _Credentials) -> bool:
    """Whether OpenAI confirmed the revocation; a network failure or 5xx is retried."""
    for delay in _REVOKE_RETRY_DELAYS_SECONDS:
        time.sleep(delay)
        try:
            with _client() as client:
                endpoint = _openid_configuration(client).revocation_endpoint
                response = _post_form(
                    client,
                    endpoint,
                    {
                        "token": credentials.refresh_token,
                        "token_type_hint": "refresh_token",
                        "client_id": credentials.client_id,
                    },
                )
        except CommandError:
            continue
        if response.status_code == 200:
            return True
        if response.status_code < 500:
            return False
    return False


def _issued_client_id(answer: Mapping[str, str], *, state: str, kept: _Credentials | None) -> str:
    """Check the one callback against this attempt and return the client id to exchange with."""
    if not hmac.compare_digest(answer.get("state", ""), state):
        raise _sign_in_failed(
            "The sign-in answer didn't belong to this attempt, so it was refused. Run "
            f"`{_LOGIN_COMMAND}` again."
        )
    if (error := answer.get("error")) is not None:
        if error == "access_denied":
            raise _sign_in_failed(
                "You didn't allow Regents to use your ChatGPT plan, so nothing was saved."
            )
        raise _sign_in_failed(
            f"OpenAI ended the sign-in without signing you in, so nothing was saved. Run "
            f"`{_LOGIN_COMMAND}` again.",
            openai_code=error,
        )
    if not answer.get("code"):
        raise _sign_in_failed("OpenAI's sign-in answer carried no code, so nothing was saved.")
    returned = answer.get("client_id")
    if kept is not None:
        if returned is not None and returned != kept.client_id:
            raise _sign_in_failed(
                "OpenAI answered for a different Regents registration than this machine's, so "
                "nothing was changed."
            )
        return kept.client_id
    if not returned or returned == REGISTRATION_CLIENT_ID:
        raise _sign_in_failed(
            "OpenAI's sign-in answer did not register Regents, so nothing was saved. Run "
            f"`{_LOGIN_COMMAND}` again."
        )
    return returned


def _verify_id_token(
    id_token: str, *, client: httpx.Client, jwks_uri: str, client_id: str, nonce: str
) -> _Identity:
    """Signature against OpenAI's published keys, then issuer, audience, expiry and nonce."""
    response = _get(client, jwks_uri)
    if response.status_code != 200:
        raise _unexpected(response, "the request for its signing keys")
    failed = _sign_in_failed(
        "The ID token OpenAI returned did not verify, so nothing was saved. Run "
        f"`{_LOGIN_COMMAND}` again."
    )
    try:
        key_id = jwt.get_unverified_header(id_token).get("kid")
        keys = [key for key in jwt.PyJWKSet.from_json(response.text).keys if key.key_id == key_id]
        if len(keys) != 1:
            raise failed
        claims = jwt.decode(
            id_token,
            key=keys[0],
            algorithms=list(_ID_TOKEN_ALGORITHMS),
            audience=client_id,
            issuer=ISSUER,
            options={"require": ["exp", "iat", "iss", "aud", "sub", "nonce"]},
        )
    except (jwt.PyJWTError, ValueError):
        raise failed from None
    subject = claims["sub"]
    email = claims.get("email")
    claimed_nonce = claims["nonce"]
    if not (
        isinstance(claimed_nonce, str)
        and hmac.compare_digest(claimed_nonce, nonce)
        and isinstance(subject, str)
        and subject
        and isinstance(email, str)
        and email
    ):
        raise failed
    return _Identity(subject=subject, email=email)


def _openid_configuration(client: httpx.Client) -> _OpenIdConfiguration:
    response = _get(client, OPENID_CONFIGURATION_URL)
    if response.status_code != 200:
        raise _unexpected(response, "the request for its OpenID configuration")
    configuration = _parse(_OpenIdConfiguration, response, "the OpenID configuration")
    if configuration.issuer != ISSUER:
        raise TechtreeError(
            f"OpenAI's OpenID configuration names the issuer {configuration.issuer!r}, not "
            f"{ISSUER}, so it was not used.",
            code=OPENAI_UNEXPECTED_ANSWER,
        )
    return configuration


def _host_id(home: Path) -> str:
    """This machine's `urn:uuid:` host id, made once and kept across logins and logouts."""
    path = home / HOST_ID_FILE
    try:
        return _HostId.model_validate_json(path.read_bytes()).ext_agent_host_id
    except FileNotFoundError:
        pass
    except pydantic.ValidationError:
        raise ValidationError(
            f"{path} is not a host id this version reads; remove it and sign in again.",
            details={"path": str(path)},
        ) from None
    host = _HostId(ext_agent_host_id=f"urn:uuid:{uuid.uuid4()}")
    atomic_write_bytes(path, host.model_dump_json(indent=2).encode("utf-8") + b"\n")
    return host.ext_agent_host_id


def _load(home: Path) -> _Credentials | None:
    try:
        raw = (home / CREDENTIALS_FILE).read_bytes()
    except FileNotFoundError:
        return None
    try:
        return _Credentials.model_validate_json(raw)
    except pydantic.ValidationError:
        # `from None`: the validation error quotes the file, and the file holds tokens.
        raise sign_in_required("The ChatGPT sign-in saved on this machine can't be read.") from None


def _readable(home: Path) -> _Credentials | None:
    """The saved sign-in for the two commands that replace or remove it; one that can't be read
    is simply replaced or removed."""
    try:
        return _load(home)
    except AuthenticationError:
        return None


def _save(home: Path, credentials: _Credentials) -> None:
    data = credentials.model_dump_json(indent=2).encode("utf-8") + b"\n"
    atomic_write_bytes(home / CREDENTIALS_FILE, data)


@contextmanager
def _locked(home: Path) -> Iterator[None]:
    """One process at a time reads, refreshes, writes or removes the sign-in."""
    ensure_private_directory(home)
    lock = FileLock(home / _LOCK_FILE, timeout=_LOCK_TIMEOUT_SECONDS, mode=0o600)
    try:
        lock.acquire()
    except Timeout as error:
        raise ConflictError(
            "another regents process is holding the ChatGPT sign-in lock",
            details={"waited_seconds": _LOCK_TIMEOUT_SECONDS},
        ) from error
    try:
        yield
    finally:
        lock.release()


def _client() -> httpx.Client:
    return httpx.Client(timeout=_HTTP_TIMEOUT_SECONDS, follow_redirects=False)


def _get(
    client: httpx.Client, url: str, *, headers: Mapping[str, str] | None = None
) -> httpx.Response:
    try:
        return client.get(url, headers=headers)
    except httpx.HTTPError:
        raise _unreachable(url) from None


def _post_form(client: httpx.Client, url: str, data: Mapping[str, str]) -> httpx.Response:
    try:
        return client.post(url, data=data)
    except httpx.HTTPError:
        raise _unreachable(url) from None


def _unreachable(url: str) -> CommandError:
    return CommandError(
        "unreachable",
        f"{urlsplit(url).netloc} could not be reached. Nothing was changed.",
        exit_code=EXIT_UNREACHABLE,
    )


def _unexpected(response: httpx.Response, what: str) -> TechtreeError:
    return TechtreeError(
        f"OpenAI answered {what} with HTTP {response.status_code}, which this version of "
        "regents doesn't expect.",
        code=OPENAI_UNEXPECTED_ANSWER,
        details={
            "http_status": response.status_code,
            "request_id": response.headers.get(REQUEST_ID_HEADER),
        },
    )


def _parse[T: _OpenAiDocument](model: type[T], response: httpx.Response, what: str) -> T:
    try:
        return model.model_validate_json(response.content)
    except pydantic.ValidationError:
        # `from None`: the validation error quotes the body, and the body can hold tokens.
        raise TechtreeError(
            f"OpenAI's answer to {what} is not in the shape OpenAI documents.",
            code=OPENAI_UNEXPECTED_ANSWER,
            details={"request_id": response.headers.get(REQUEST_ID_HEADER)},
        ) from None


def _oauth_error(response: httpx.Response) -> str | None:
    """The OAuth `error` code (RFC 6749) of a refused token request, when it carries one."""
    try:
        body = response.json()
    except ValueError:
        return None
    error = body.get("error") if isinstance(body, dict) else None
    return error if isinstance(error, str) else None


def _pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _now() -> int:
    return int(time.time())


class _CallbackServer(HTTPServer):
    """The loopback listener for OpenAI's one redirect back to this machine."""

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _CallbackHandler)
        self.answer: dict[str, str] | None = None

    @property
    def port(self) -> int:
        return int(self.server_address[1])

    def wait(self, seconds: float) -> dict[str, str]:
        deadline = time.monotonic() + seconds
        while self.answer is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise _sign_in_failed(
                    f"No sign-in answer came back within {int(seconds) // 60} minutes, so "
                    f"nothing was saved. Run `{_LOGIN_COMMAND}` again."
                )
            self.timeout = remaining
            self.handle_request()
        return self.answer


class _CallbackHandler(BaseHTTPRequestHandler):
    server: _CallbackServer
    timeout = _CALLBACK_SOCKET_SECONDS

    def do_GET(self) -> None:
        parts = urlsplit(self.path)
        if parts.path != "/callback" or self.server.answer is not None:
            self.send_error(404)
            return
        self.server.answer = dict(parse_qsl(parts.query))
        page = (
            b"<!doctype html><meta charset=utf-8><title>Regents</title>"
            b"<p>Regents has your answer. You can close this tab and go back to the terminal.</p>"
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.end_headers()
        self.wfile.write(page)

    def log_message(self, format: str, *args: object) -> None:
        """Silent: the callback address carries the sign-in code."""
