"""One way to reach a site: the base-address rule, one request, one way to read the answer."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode, urlsplit

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

    @property
    def target(self) -> str:
        """The path and query exactly as sent, which is also what a signature covers."""
        return self.path + ("?" + urlencode(self.query) if self.query else "")

    @property
    def content(self) -> bytes | None:
        """The body's bytes exactly as sent, which is also what a content digest covers."""
        if self.body is None:
            return None
        return json.dumps(self.body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def send(base: str, request: Request, timeout_ms: int) -> Any:
    """Send once, never follow a redirect, and return the JSON answer or raise its error."""
    content = request.content
    headers = {"accept": "application/json", **request.headers}
    if content is not None:
        headers["content-type"] = "application/json"
    try:
        response = httpx.request(
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
    return answer(response)


def answer(response: httpx.Response) -> Any:
    try:
        body = response.json()
    except ValueError:
        body = None
    if response.is_success and body is not None:
        return body
    if response.is_success:
        raise CommandError("invalid_response", "The site answered, but not with JSON.")
    raise _error_for(response, body)


def _error_for(response: httpx.Response, body: Any) -> CommandError:
    status = response.status_code
    exit_code = {401: EXIT_AUTH, 403: EXIT_AUTH, 404: EXIT_NOT_FOUND}.get(status, EXIT_FAILED)
    if status in (502, 503, 504):
        exit_code = EXIT_UNREACHABLE
    fields: dict[str, Any] = {"status": status}
    if retry_after := response.headers.get("retry-after"):
        fields["retry_after"] = retry_after
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict) and isinstance(error.get("code"), str):
        message = error.get("message")
        return CommandError(
            error["code"],
            message if isinstance(message, str) else f"The site refused the request ({status}).",
            exit_code=exit_code,
            **fields,
        )
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
