"""One way to reach a site: the base-address rule, one request, one way to read the answer."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from importlib.metadata import version
from typing import Any
from urllib.parse import urlencode, urlsplit

import click
import httpx

from regents_cli.errors import (
    EXIT_AUTH,
    EXIT_FAILED,
    EXIT_NOT_FOUND,
    EXIT_UNREACHABLE,
    CommandError,
    UsageError,
)

LOOPBACK = frozenset({"localhost", "127.0.0.1", "::1"})


def origin(value: str, source: str) -> str:
    """An HTTPS origin, or HTTP on this machine, with no credentials, path, query or fragment."""
    parts = urlsplit(value)
    local = parts.scheme == "http" and parts.hostname in LOOPBACK
    if (
        (parts.scheme != "https" and not local)
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
    ):
        raise UsageError(
            f"{source} must be an HTTPS origin such as https://example.com, with no path; "
            "HTTP is allowed only for this machine."
        )
    return f"{parts.scheme}://{parts.netloc}"


def same_origin(one: str, other: str) -> bool:
    """Whether two addresses are one origin: the same scheme, host and port, written either way."""
    return _origin_key(one) == _origin_key(other)


def _origin_key(value: str) -> tuple[str, str | None, int | None]:
    parts = urlsplit(value)
    scheme = parts.scheme.lower()
    try:
        port = parts.port or {"https": 443, "http": 80}.get(scheme)
    except ValueError:  # a port that is not a number is never the usual one
        port = -1
    return scheme, parts.hostname, port


def base_address(flag: str | None, env_var: str, site: str) -> str:
    """--base-url, then <PLATFORM>_BASE_URL, then the site's own address."""
    if flag is not None:
        return origin(flag, "--base-url")
    if value := os.environ.get(env_var):
        return origin(value, env_var)
    return origin(site, "the site's address")


@dataclass(frozen=True, slots=True)
class Request:
    method: str
    path: str
    query: dict[str, str] = field(default_factory=dict)
    body: dict[str, Any] | None = None
    headers: dict[str, str] = field(default_factory=dict)
    raw_content: bytes | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        if self.body is not None and self.raw_content is not None:
            raise UsageError("A request carries either JSON fields or exact body bytes, not both.")

    @property
    def target(self) -> str:
        """The path and query exactly as sent, which is also what a signature covers."""
        return self.path + ("?" + urlencode(self.query) if self.query else "")

    @property
    def content(self) -> bytes | None:
        """The body's bytes exactly as sent, which is also what a content digest covers."""
        if self.raw_content is not None:
            return self.raw_content
        if self.body is None:
            return None
        return json.dumps(self.body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def send(base: str, request: Request, timeout_ms: int) -> dict[str, Any]:
    """Send once, never follow a redirect, and return the JSON answer or raise its error."""
    return answer(respond(base, request, timeout_ms))


def unreadable_address(error: httpx.InvalidURL) -> CommandError:
    """Why httpx could not read an address. On a command that checks its addresses first, the
    cause is NO_PROXY: httpx reads an IPv6 entry only without brackets (::1, not [::1])."""
    bracketed = dict.fromkeys(
        entry.strip()
        for name in ("NO_PROXY", "no_proxy")
        for entry in os.environ.get(name, "").split(",")
        if entry.strip().startswith("[")
    )
    if bracketed:
        return CommandError(
            "proxy_settings",
            f"NO_PROXY lists {', '.join(bracketed)}, which regents can't read, so nothing was "
            "sent. Write an IPv6 address there without brackets, such as ::1.",
            exit_code=EXIT_UNREACHABLE,
        )
    return CommandError(
        "unreachable",
        f"An address could not be read ({error}), so nothing was sent.",
        exit_code=EXIT_UNREACHABLE,
    )


def client_header() -> dict[str, str]:
    """`x-regent-client`: this release and the words of the command being run, such as
    `regents-cli/1.10.18 patchbay rooms list`, so a site can count its calls by command. Click
    builds the words from command names alone, so no argument or flag value is ever in it. A
    signature does not cover it. Nothing when no command is running."""
    context = click.get_current_context(silent=True)
    if context is None:
        return {}
    words = context.command_path.split(" ")[1:]
    return {"x-regent-client": f"regents-cli/{version('regents-cli')} {' '.join(words)}"}


def respond(base: str, request: Request, timeout_ms: int) -> httpx.Response:
    """Send once and never follow a redirect."""
    content = request.content
    headers = {"accept": "application/json", **client_header(), **request.headers}
    if content is not None:
        headers["content-type"] = "application/json"
    try:
        return httpx.request(
            request.method,
            base + request.target,
            content=content,
            headers=headers,
            timeout=timeout_ms / 1000,
            follow_redirects=False,
        )
    except httpx.TimeoutException:
        raise CommandError(
            "timeout",
            f"{base} did not answer within {timeout_ms} ms. The request was not retried.",
            exit_code=EXIT_UNREACHABLE,
        ) from None
    except httpx.TransportError:
        raise CommandError(
            "unreachable",
            f"{base} could not be reached. The request was not retried.",
            exit_code=EXIT_UNREACHABLE,
        ) from None


def _not_json(constant: str) -> Any:
    """NaN and Infinity are not JSON; an answer holding one is an unreadable answer."""
    raise ValueError(f"{constant} is not JSON")


def answer(response: httpx.Response) -> dict[str, Any]:
    if response.status_code == 204 and not response.content:
        return {}
    try:
        body = json.loads(response.content, parse_constant=_not_json)
    except (ValueError, RecursionError):
        body = None
    if response.is_success and isinstance(body, dict):
        return body
    if response.is_success:
        raise CommandError("invalid_response", "The site answered, but not with a JSON object.")
    raise _error_for(response, body)


def holds(value: Any, *fields: str) -> bool:
    """Whether `value` is a JSON object with each of `fields`."""
    return isinstance(value, dict) and all(field in value for field in fields)


def unreadable() -> CommandError:
    return CommandError(
        "invalid_response", "The answer is JSON, but not in the shape regents reads."
    )


def data_with(answered: dict[str, Any], *fields: str) -> dict[str, Any]:
    """An answer's `data` object, holding each of `fields`; any other answer is unreadable."""
    data = answered.get("data")
    if isinstance(data, dict) and holds(data, *fields):
        return data
    raise unreadable()


def exit_code_for(status: int) -> int:
    """The exit code a refusal with this status ends `regents` with."""
    if status in (502, 503, 504):
        return EXIT_UNREACHABLE
    return {401: EXIT_AUTH, 403: EXIT_AUTH, 404: EXIT_NOT_FOUND}.get(status, EXIT_FAILED)


def _error_for(response: httpx.Response, body: Any) -> CommandError:
    status = response.status_code
    exit_code = exit_code_for(status)
    fields: dict[str, Any] = {"status": status}
    if retry_after := response.headers.get("retry-after"):
        fields["retry_after"] = retry_after
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict) and isinstance(error.get("code"), str):
        message = error.get("message")
        return CommandError.refused(
            error["code"],
            message if isinstance(message, str) else f"The site refused the request ({status}).",
            exit_code=exit_code,
            fields={**error, **fields},
        )
    if status == 402 and isinstance(body, dict) and "payment-required" in response.headers:
        return _payment_required(response, body, fields)
    if response.is_redirect:
        return CommandError(
            "redirected",
            f"The site answered with a redirect ({status}); it was not followed.",
            exit_code=exit_code,
            **fields,
        )
    return CommandError(
        f"http_{status}", f"The site refused the request ({status}).", exit_code=exit_code, **fields
    )


def _payment_required(
    response: httpx.Response, body: dict[str, Any], fields: dict[str, Any]
) -> CommandError:
    """A 402 that offers terms: the whole answer, with the x402 `payment-required` header."""
    return CommandError.refused(
        "payment_required",
        "Nothing was paid. Sign payment_terms with your wallet, then send the signature.",
        exit_code=EXIT_FAILED,
        fields={**body, **fields, "payment_required": response.headers["payment-required"]},
    )
