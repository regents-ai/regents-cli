"""The loopback forwarder that carries a Climb's model calls to the person's ChatGPT plan.

On the plan route the run's model calls reach this server on 127.0.0.1, never OpenAI directly,
so the access token never leaves this process: the caller holds only a key made for this run.
Each call is rewritten into what the plan takes (OpenAI's own name for the run's model in place
of Prime's `openai/<model>`, which the subject asks for on both routes; the refused fields
dropped; `store` false and `stream` true; system messages moved into `instructions`; function
tools grouped in one namespace), sent to OpenAI's Responses API with a fresh access token, and
counted only when OpenAI sends `response.completed`.

The plan's own refusals end the run. The first one is kept, every later call is answered with
it without reaching OpenAI, and the run's watch loop sees it through `raise_if_stopped()`.
Any other failure is the caller's to see, exactly as OpenAI sent it.
"""

from __future__ import annotations

import hmac
import json
import secrets
import threading
import time
from collections.abc import Mapping
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import TracebackType
from typing import Final, Literal

import httpx

from regents_cli.errors import CommandError
from regents_cli.techtree.chatgpt.signin import (
    MODEL_SIGN_IN_REQUIRED,
    PLAN_NOT_ELIGIBLE,
    REQUEST_ID_HEADER,
    access_token,
    plan_not_eligible,
    sign_in_required,
)
from regents_cli.techtree.errors import AuthenticationError, RunError

OPENAI_RESPONSES_URL: Final = "https://api.openai.com/v1/responses"
FORWARDER_KEY_ENV: Final = "TECHTREE_PLAN_FORWARDER_KEY"

#: The request fields OpenAI's preview limitations say the plan refuses, plus
#: `previous_response_id` (the full history is always in `input`) and `service_tier`, an
#: override OpenAI names among what `subscription_sharing_unsupported_capability` refuses.
REFUSED_FIELDS: Final = frozenset(
    {
        "background",
        "conversation",
        "max_output_tokens",
        "max_tool_calls",
        "metadata",
        "moderation",
        "multi_agent",
        "previous_response_id",
        "prompt",
        "prompt_cache_retention",
        "safety_identifier",
        "service_tier",
        "temperature",
        "top_logprobs",
        "top_p",
        "truncation",
        "user",
    }
)

PLAN_LIMIT_REACHED: Final = "plan_limit_reached"
PLAN_REQUEST_REFUSED: Final = "plan_request_refused"
PLAN_UNAVAILABLE: Final = "plan_unavailable"
PLAN_LIMIT_MESSAGE: Final = (
    "Your ChatGPT plan's limit for Regents is used up. Manage usage: "
    "https://chatgpt.com/settings/usage"
)

#: Function and custom tools go in one namespace, because the plan refuses them at the top level.
TOOL_NAMESPACE: Final = "tools"
_TOOL_NAMESPACE_DESCRIPTION: Final = "The tools for this task."
_NAMESPACED_TOOL_TYPES: Final = frozenset({"function", "custom"})
_NAMESPACED_CALL_TYPES: Final = frozenset({"function_call", "custom_tool_call"})

#: Waits before the second and third try of a call the plan was too busy to take.
_BUSY_RETRY_DELAYS_SECONDS: tuple[float, ...] = (1.0, 3.0)
_MAX_REQUEST_BYTES: Final = 64 * 1024 * 1024
_MAX_ERROR_BYTES: Final = 1024 * 1024
#: A reasoning model can think for minutes between two streamed events.
_UPSTREAM_TIMEOUT: Final = httpx.Timeout(connect=30.0, read=900.0, write=60.0, pool=60.0)

_LIMIT_CODES: Final = frozenset({"subscription_sharing_usage_limit_exceeded"})
_REFUSED_CODES: Final = frozenset(
    {"subscription_sharing_unsupported_capability", "subscription_sharing_route_not_supported"}
)
_BUSY_CODES: Final = frozenset(
    {"subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable"}
)
_NOT_ELIGIBLE_CODES: Final = frozenset(
    {
        "subscription_sharing_user_not_eligible",
        "chatpass_v2_scope_not_authorized",
        "chatpass_v2_invalid_authorization_context",
    }
)
_SIGNED_OUT_CODES: Final = frozenset({"subscription_sharing_invalid_user"})

type _Kind = Literal["limit", "refused", "busy", "not_eligible", "signed_out"]
type _Json = dict[str, object]


@dataclass(frozen=True)
class PlanUsage:
    """Tokens summed over every `response.completed` this forwarder saw."""

    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cached_tokens: int = 0


@dataclass(frozen=True)
class _Stop:
    """A run-ending refusal: what `raise_if_stopped()` raises and every later call is told."""

    code: str
    message: str
    http_status: int
    details: Mapping[str, object]

    def error(self) -> RunError:
        return RunError(self.message, code=self.code, details=self.details)

    def body(self) -> bytes:
        error = {"message": self.message, "type": "regents_plan_stop", "code": self.code}
        return json.dumps({"error": {**error, "param": None}}).encode("utf-8")


class PlanForwarder:
    """Serves `POST /v1/responses` on 127.0.0.1 for one run, while used as a context manager."""

    def __init__(self, home: Path, model_id: str) -> None:
        self._home = home
        self._model_id = model_id
        self._key = secrets.token_urlsafe(32)
        self._lock = threading.Lock()
        self._completed_calls = 0
        self._usage = PlanUsage()
        self._stop: _Stop | None = None
        self._client = httpx.Client(timeout=_UPSTREAM_TIMEOUT, follow_redirects=False)
        self._server = _Server(self)
        self._thread = threading.Thread(
            target=self._server.serve_forever, name="plan-forwarder", daemon=True
        )

    def __enter__(self) -> PlanForwarder:
        self._thread.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join()
        self._client.close()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self._server.server_address[1]}/v1"

    @property
    def key(self) -> str:
        """The run's key: the child sends it as its bearer token, from `FORWARDER_KEY_ENV`."""
        return self._key

    @property
    def completed_calls(self) -> int:
        with self._lock:
            return self._completed_calls

    @property
    def usage(self) -> PlanUsage:
        with self._lock:
            return self._usage

    def raise_if_stopped(self) -> None:
        """Raise the first run-ending refusal as a `RunError`, if any call has met one."""
        with self._lock:
            stop = self._stop
        if stop is not None:
            raise stop.error()

    def _stopped(self) -> _Stop | None:
        with self._lock:
            return self._stop

    def _record(self, stop: _Stop) -> None:
        with self._lock:
            if self._stop is None:
                self._stop = stop

    def _count(self, response: object) -> None:
        usage = response.get("usage") if isinstance(response, dict) else None
        usage = usage if isinstance(usage, dict) else {}
        details = usage.get("input_tokens_details")
        cached = details.get("cached_tokens") if isinstance(details, dict) else 0
        with self._lock:
            self._completed_calls += 1
            self._usage = PlanUsage(
                input_tokens=self._usage.input_tokens + _int(usage.get("input_tokens")),
                output_tokens=self._usage.output_tokens + _int(usage.get("output_tokens")),
                total_tokens=self._usage.total_tokens + _int(usage.get("total_tokens")),
                cached_tokens=self._usage.cached_tokens + _int(cached),
            )

    def _authorized(self, header: str | None) -> bool:
        expected = f"Bearer {self._key}".encode("latin-1")
        return hmac.compare_digest((header or "").encode("latin-1"), expected)


def plan_request(body: Mapping[str, object], model_id: str) -> _Json:
    """A caller's Responses request rewritten into what the ChatGPT plan takes, for the run's one
    model."""
    request: _Json = {name: value for name, value in body.items() if name not in REFUSED_FIELDS}
    request["model"] = model_id
    request["store"] = False
    request["stream"] = True
    _move_system_text(request)
    _namespace_tools(request)
    return request


def _move_system_text(request: _Json) -> None:
    """The plan refuses system messages; their text joins `instructions`, after what is there."""
    items = request.get("input")
    if not isinstance(items, list):
        return
    system = [item for item in items if isinstance(item, dict) and item.get("role") == "system"]
    if not system:
        return
    texts = [text for item in system for text in _texts(item.get("content"))]
    existing = request.get("instructions")
    request["instructions"] = "\n\n".join(
        [existing, *texts] if isinstance(existing, str) and existing else texts
    )
    request["input"] = [item for item in items if not any(item is s for s in system)]


def _texts(content: object) -> list[str]:
    if isinstance(content, str):
        return [content]
    if not isinstance(content, list):
        return []
    return [
        part["text"]
        for part in content
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    ]


def _namespace_tools(request: _Json) -> None:
    """Group function and custom tools in one namespace, and name it on the calls in history."""
    tools = request.get("tools")
    if not isinstance(tools, list):
        return
    grouped = [
        tool
        for tool in tools
        if isinstance(tool, dict) and tool.get("type") in _NAMESPACED_TOOL_TYPES
    ]
    if not grouped:
        return
    request["tools"] = [
        *(tool for tool in tools if not any(tool is g for g in grouped)),
        {
            "type": "namespace",
            "name": TOOL_NAMESPACE,
            "description": _TOOL_NAMESPACE_DESCRIPTION,
            "tools": grouped,
        },
    ]
    names = {tool.get("name") for tool in grouped}
    items = request.get("input")
    if isinstance(items, list):
        request["input"] = [_namespaced_call(item, names) for item in items]


def _namespaced_call(item: object, names: set[object]) -> object:
    if (
        isinstance(item, dict)
        and item.get("type") in _NAMESPACED_CALL_TYPES
        and "namespace" not in item
        and item.get("name") in names
    ):
        return {**item, "namespace": TOOL_NAMESPACE}
    return item


def _kind(http_status: int | None, code: str | None) -> _Kind | None:
    """Which of the plan's refusals this is, or None for an ordinary failure the caller sees as
    it is. A code that arrives mid-stream comes without a status."""
    if code in _LIMIT_CODES:
        return "limit"
    if code in _REFUSED_CODES:
        return "refused"
    if code in _BUSY_CODES or http_status == 503:
        return "busy"
    if code in _NOT_ELIGIBLE_CODES or http_status == 403:
        return "not_eligible"
    if code in _SIGNED_OUT_CODES or http_status == 401:
        return "signed_out"
    return None


def _stop_for(
    kind: _Kind, *, http_status: int | None, request_id: str | None, code: str | None, param: object
) -> _Stop:
    details = {
        name: value
        for name, value in (
            ("http_status", http_status),
            ("request_id", request_id),
            ("openai_code", code),
            ("openai_param", param),
        )
        if value is not None
    }
    match kind:
        case "limit":
            return _Stop(PLAN_LIMIT_REACHED, PLAN_LIMIT_MESSAGE, 429, details)
        case "refused":
            message = (
                "OpenAI refused a model call as something your ChatGPT plan doesn't take. That "
                "is a fault in regents, not in your plan, so the call was not retried."
            )
            return _Stop(PLAN_REQUEST_REFUSED, message, http_status or 400, details)
        case "busy":
            message = (
                "OpenAI couldn't serve your ChatGPT plan just now, even after retrying. Try the "
                "run again later."
            )
            return _Stop(PLAN_UNAVAILABLE, message, 503, details)
        case "not_eligible":
            return _Stop(PLAN_NOT_ELIGIBLE, plan_not_eligible().message, 403, details)
        case "signed_out":
            reason = "OpenAI no longer accepts this machine's ChatGPT sign-in."
            return _Stop(MODEL_SIGN_IN_REQUIRED, sign_in_required(reason).message, 401, details)


def _error_fields(error: object) -> tuple[str | None, object]:
    """The `code` and `param` of an OpenAI error object; a `{"detail": ...}` body has neither."""
    if not isinstance(error, dict):
        return None, None
    code = error.get("code")
    return (code if isinstance(code, str) else None), error.get("param")


def _event_error(event: _Json) -> object:
    """The error a `response.failed` event carries on its response, or an `error` event itself."""
    if event.get("type") == "error":
        return event
    response = event.get("response")
    return response.get("error") if isinstance(response, dict) else None


def _int(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


class _SseEvents:
    """Server-sent events parsed from a byte stream, one complete event at a time."""

    def __init__(self) -> None:
        self._buffer = b""

    def feed(self, chunk: bytes) -> list[_Json]:
        self._buffer = (self._buffer + chunk).replace(b"\r\n", b"\n")
        events: list[_Json] = []
        while (end := self._buffer.find(b"\n\n")) != -1:
            block, self._buffer = self._buffer[:end], self._buffer[end + 2 :]
            data = b"\n".join(
                line[5:].removeprefix(b" ")
                for line in block.split(b"\n")
                if line.startswith(b"data:")
            )
            try:
                event = json.loads(data)
            except ValueError:
                continue
            if isinstance(event, dict):
                events.append(event)
        return events


class _Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, forwarder: PlanForwarder) -> None:
        super().__init__(("127.0.0.1", 0), _Handler)
        self.forwarder = forwarder

    def handle_error(self, request: object, client_address: object) -> None:
        """Silent: a caller that hangs up mid-reply is not news, and nothing here is logged."""


class _Handler(BaseHTTPRequestHandler):
    server: _Server
    #: Whether the caller has been sent a status line, so a later failure can't send another.
    answered = False

    def do_POST(self) -> None:
        forwarder = self.server.forwarder
        if self.path != "/v1/responses":
            self._error(404, "not_found", "Only POST /v1/responses is served here.")
            return
        if not forwarder._authorized(self.headers.get("Authorization")):
            self._error(401, "invalid_api_key", "The key for this run was not presented.")
            return
        if (stop := forwarder._stopped()) is not None:
            self._send(stop.http_status, "application/json", stop.body())
            return
        body = self._request_body()
        if body is not None:
            self._forward(forwarder, body)

    def _request_body(self) -> _Json | None:
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._error(411, "invalid_request_error", "The request has no Content-Length.")
            return None
        if not 0 < length <= _MAX_REQUEST_BYTES:
            self._error(413, "invalid_request_error", "The request body is empty or too large.")
            return None
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            body = None
        if not isinstance(body, dict):
            self._error(400, "invalid_request_error", "The request body is not a JSON object.")
            return None
        return body

    def _forward(self, forwarder: PlanForwarder, body: _Json) -> None:
        wants_stream = body.get("stream") is True
        request = plan_request(body, forwarder._model_id)
        payload = json.dumps(request, ensure_ascii=False).encode("utf-8")
        delays = (0.0, *_BUSY_RETRY_DELAYS_SECONDS)
        for attempt, delay in enumerate(delays):
            time.sleep(delay)
            if (stop := forwarder._stopped()) is not None:
                self._send(stop.http_status, "application/json", stop.body())
                return
            try:
                token = access_token(forwarder._home)
            except CommandError as error:
                if isinstance(error, AuthenticationError) and error.code == MODEL_SIGN_IN_REQUIRED:
                    self._stop(forwarder, _Stop(error.code, error.message, 401, error.details))
                else:
                    self._error(502, "upstream_unavailable", error.message)
                return
            headers = {
                "authorization": f"Bearer {token}",
                "content-type": "application/json",
                "accept": "text/event-stream",
            }
            try:
                with forwarder._client.stream(
                    "POST", OPENAI_RESPONSES_URL, content=payload, headers=headers
                ) as upstream:
                    retry = self._relay(
                        forwarder, upstream, wants_stream, can_retry=attempt < len(delays) - 1
                    )
            except httpx.HTTPError:
                if not self.answered:
                    self._error(502, "upstream_unavailable", "OpenAI could not be reached.")
                return
            if not retry:
                return

    def _relay(
        self,
        forwarder: PlanForwarder,
        upstream: httpx.Response,
        wants_stream: bool,
        *,
        can_retry: bool,
    ) -> bool:
        """Answer the caller from one upstream reply; True asks for the call to be tried again."""
        request_id = upstream.headers.get(REQUEST_ID_HEADER)
        if upstream.status_code != 200:
            raw = _read_capped(upstream)
            try:
                parsed: object = json.loads(raw)
            except ValueError:
                parsed = None
            error = parsed.get("error") if isinstance(parsed, dict) else None
            code, param = _error_fields(error)
            kind = _kind(upstream.status_code, code)
            if kind == "busy" and can_retry:
                return True
            if kind is None:
                content_type = upstream.headers.get("content-type", "application/json")
                self._send(upstream.status_code, content_type, raw, request_id)
                return False
            stop = _stop_for(
                kind,
                http_status=upstream.status_code,
                request_id=request_id,
                code=code,
                param=param,
            )
            self._stop(forwarder, stop, request_id)
            return False
        if wants_stream:
            self.answered = True
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            if request_id is not None:
                self.send_header(REQUEST_ID_HEADER, request_id)
            self.end_headers()
        events = _SseEvents()
        for chunk in upstream.iter_bytes():
            if wants_stream:
                self.wfile.write(chunk)
                self.wfile.flush()
            for event in events.feed(chunk):
                kind_of_event = event.get("type")
                response = event.get("response")
                if kind_of_event == "response.completed":
                    forwarder._count(response)
                    if not wants_stream:
                        self._send(200, "application/json", _dumps(response), request_id)
                        return False
                elif kind_of_event == "response.incomplete" and not wants_stream:
                    self._send(200, "application/json", _dumps(response), request_id)
                    return False
                elif kind_of_event in ("response.failed", "error"):
                    error = _event_error(event)
                    code, param = _error_fields(error)
                    kind = _kind(None, code)
                    if kind == "busy" and can_retry and not wants_stream:
                        return True
                    if kind is not None:
                        stop = _stop_for(
                            kind, http_status=None, request_id=request_id, code=code, param=param
                        )
                        if wants_stream:
                            forwarder._record(stop)
                        else:
                            self._stop(forwarder, stop, request_id)
                            return False
                    elif not wants_stream:
                        body = _dumps({"error": error})
                        self._send(500, "application/json", body, request_id)
                        return False
        if not wants_stream:
            message = "OpenAI's stream ended before the reply was complete."
            self._error(502, "upstream_incomplete", message, request_id)
        return False

    def _stop(self, forwarder: PlanForwarder, stop: _Stop, request_id: str | None = None) -> None:
        forwarder._record(stop)
        self._send(stop.http_status, "application/json", stop.body(), request_id)

    def _error(self, status: int, code: str, message: str, request_id: str | None = None) -> None:
        error = {"message": message, "type": "invalid_request_error", "code": code, "param": None}
        self._send(status, "application/json", _dumps({"error": error}), request_id)

    def _send(
        self, status: int, content_type: str, data: bytes, request_id: str | None = None
    ) -> None:
        self.answered = True
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if request_id is not None:
            self.send_header(REQUEST_ID_HEADER, request_id)
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        """Silent: nothing about a call is logged."""


def _read_capped(upstream: httpx.Response) -> bytes:
    chunks: list[bytes] = []
    received = 0
    for chunk in upstream.iter_bytes():
        chunks.append(chunk)
        received += len(chunk)
        if received >= _MAX_ERROR_BYTES:
            break
    return b"".join(chunks)[:_MAX_ERROR_BYTES]


def _dumps(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")
