"""Builds `regents <platform> …` from the platform's pinned description and runs its commands.

Every described command becomes a command here without code of its own: its arguments
and flags fill the route's path, query and body, and the answer prints the shared way.
"""

from __future__ import annotations

import json
import re
import sys
import threading
from dataclasses import replace
from typing import Any
from urllib.parse import quote

import click

from regents_cli import output, siwa
from regents_cli.doctor import doctor_command
from regents_cli.errors import UsageError
from regents_cli.http import Request, base_address, send
from regents_cli.platforms import Command, Input, Platform

STDIN_LIMIT = 200_000


class Pattern(click.ParamType[str]):
    def __init__(self, name: str, pattern: str, example: str) -> None:
        self.name = name
        self.pattern = re.compile(pattern)
        self.example = example

    def convert(self, value: Any, param: click.Parameter | None, ctx: click.Context | None) -> str:
        if isinstance(value, str) and self.pattern.fullmatch(value):
            return value
        self.fail(f"{value!r} is not {self.name}, such as {self.example}.", param, ctx)


TYPES: dict[str, click.ParamType[Any]] = {
    "uuid": Pattern(
        "a UUID",
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        "0b6e4a4e-5c1d-4f0e-9a51-2f1f3f7e8d21",
    ),
    "address": Pattern(
        "an address", r"0x[0-9a-fA-F]{40}", "0x4200000000000000000000000000000000000006"
    ),
    "decimal": Pattern("a decimal number", r"\d+(\.\d+)?", "1.25"),
}


def param_type(spec: Input) -> click.ParamType[Any]:
    if spec.enum is not None:
        return click.Choice(spec.enum)
    if spec.type == "integer":
        return click.IntRange(spec.minimum, spec.maximum)
    return TYPES.get(spec.type, click.STRING)


def platform_group(platform: Platform) -> click.Group:
    help_text = f"Commands for {platform.base_url.removeprefix('https://')}."
    if platform.notes:
        help_text += "\n\n" + "\n\n".join(platform.notes)
    group = click.Group(platform.name, help=help_text, no_args_is_help=True)
    for command in platform.commands:
        parent = group
        for word in command.group_words:
            child = parent.commands.get(word)
            if not isinstance(child, click.Group):
                child = click.Group(word, no_args_is_help=True)
                parent.add_command(child)
            parent = child
        parent.add_command(build_command(platform, command))
    group.add_command(doctor_command(platform))
    return group


def build_command(platform: Platform, command: Command) -> click.Command:
    params: list[click.Parameter] = [
        click.Argument(
            [spec.name.replace("-", "_")], type=param_type(spec), metavar=spec.name.upper()
        )
        for spec in command.arguments
    ]
    params += [
        click.Option(
            [f"--{spec.name}", spec.name.replace("-", "_")],
            type=param_type(spec),
            required=spec.required,
            help=spec.description,
        )
        for spec in command.flags
    ]
    params += [
        click.Option(["--json", "as_json"], is_flag=True, help="Print the answer as JSON."),
        click.Option(["--base-url"], help=f"The site's address; also {platform.env_var}."),
        click.Option(
            ["--timeout-ms"],
            type=click.IntRange(1, 300_000),
            default=30_000,
            show_default=True,
            help="How long to wait for the answer.",
        ),
    ]
    help_text = command.description
    if command.authority == "wallet-proof":
        params.append(
            click.Option(
                ["--phase"],
                type=click.Choice(["prepare", "send"]),
                help="Sign with your own key: prepare prints the request and the message to "
                'sign; send reads {"request": …, "signature": …} on stdin.',
            )
        )
        help_text += f"\n\nSign in first: regents auth login --site {platform.name}."
        if command.stdin_fields:
            optional = not any(f.required for f in command.stdin_fields)
            help_text += f"\n\nPipe {stdin_shape(command)} on stdin" + (
                ", when you have it." if optional else "."
            )

    def run(as_json: bool, base_url: str | None, timeout_ms: int, **values: Any) -> None:
        phase = values.pop("phase", None)
        given = {spec.name: values[spec.name.replace("-", "_")] for spec in command.inputs}
        missing = [name for name in command.required_one_of if given[name] is None]
        if command.required_one_of and len(missing) == len(command.required_one_of):
            raise UsageError("Give at least one of " + ", ".join(f"--{n}" for n in missing) + ".")
        base = base_address(base_url, platform.env_var, platform.base_url)
        request = request_for(command, given)
        if command.authority == "wallet-proof" and phase == "send":
            request = signed_by_caller(command, base, request, timeout_ms)
        elif command.authority == "wallet-proof":
            request = with_stdin_fields(command, request, timeout_ms)
            sign_in = siwa.current(platform.name, timeout_ms)
            if phase == "prepare":
                output.emit(prepared(base, request, sign_in), as_json=as_json)
                return
            request = replace(request, headers=siwa.sign(request, sign_in))
        answer = send(base, request, timeout_ms)
        output.emit(answer, as_json=as_json, hint=next_page_hint(command, answer))

    return click.Command(command.name, params=params, callback=run, help=help_text)


def request_for(command: Command, given: dict[str, Any]) -> Request:
    path = command.path
    query: dict[str, str] = {}
    body: dict[str, Any] | None = dict(command.body) if command.body is not None else None
    for spec in command.inputs:
        value = given[spec.name]
        if value is None:
            continue
        if spec.location == "path":
            if str(value) in ("", ".", ".."):
                raise UsageError(f"{spec.name.upper()} must name a record, not a dot path.")
            path = path.replace("{" + spec.field + "}", quote(str(value), safe=""))
        elif spec.location == "query":
            query[spec.field] = str(value)
        else:
            body = {**(body or {}), spec.field: value}
    if body is None and command.method in ("POST", "PUT", "PATCH"):
        body = {}
    return Request(command.method, path, query, body)


def stdin_shape(command: Command) -> str:
    return "{" + ", ".join(f'"{f.field}": …' for f in command.stdin_fields) + "}"


def read_stdin(timeout_ms: int) -> Any:
    """The JSON piped on stdin, or None when nothing is piped."""
    if sys.stdin.isatty():
        return None
    chunks: list[str] = []
    reader = threading.Thread(
        target=lambda: chunks.append(sys.stdin.read(STDIN_LIMIT + 1)), daemon=True
    )
    reader.start()
    reader.join(timeout_ms / 1000)
    if reader.is_alive():
        raise UsageError(f"stdin was still open after {timeout_ms} ms; pipe the JSON and close it.")
    text = chunks[0] if chunks else ""
    if len(text) > STDIN_LIMIT:
        raise UsageError(f"stdin holds more than {STDIN_LIMIT} characters.")
    if not text.strip():
        return None
    try:
        return json.loads(text)
    except ValueError:
        raise UsageError("stdin does not hold JSON.") from None


def with_stdin_fields(command: Command, request: Request, timeout_ms: int) -> Request:
    """Adds the body fields the caller pipes on stdin."""
    if not command.stdin_fields:
        return request
    shape = stdin_shape(command)
    piped = read_stdin(timeout_ms)
    piped = {} if piped is None else piped
    if not isinstance(piped, dict) or not set(piped) <= {f.field for f in command.stdin_fields}:
        raise UsageError(f"stdin must hold {shape}.")
    for spec in command.stdin_fields:
        if spec.required and spec.field not in piped:
            raise UsageError(f"Pipe {shape} on stdin; {spec.field} is required.")
        kind = dict if spec.type == "object" else str
        if spec.field in piped and not isinstance(piped[spec.field], kind):
            raise UsageError(f"{spec.field} must be {'an object' if kind is dict else 'a string'}.")
    return replace(request, body={**(request.body or {}), **piped})


def prepared(base: str, request: Request, sign_in: siwa.SignIn) -> dict[str, Any]:
    """The exact request to sign and the message the caller personal_signs for it."""
    headers, message = siwa.prepare(request, sign_in)
    content = request.content
    body = {} if content is None else {"body": content.decode("utf-8")}
    return {
        "origin": base,
        "method": request.method,
        "path": request.target,
        **body,
        "headers": headers,
        "message": message,
    }


def signed_by_caller(command: Command, base: str, request: Request, timeout_ms: int) -> Request:
    """The prepared request piped back with its signature, checked to be this command's."""
    piped = read_stdin(timeout_ms)
    shape = '{"request": …, "signature": …} (the request from --phase prepare)'
    if not isinstance(piped, dict) or set(piped) != {"request", "signature"}:
        raise UsageError(f"stdin must hold {shape}.")
    given, signature = piped["request"], piped["signature"]
    keys = {"origin", "method", "path", "headers", "message"}
    if request.body is not None:
        keys.add("body")
    if (
        not isinstance(given, dict)
        or set(given) != keys
        or not isinstance(given["headers"], dict)
        or not isinstance(signature, str)
    ):
        raise UsageError(f"stdin must hold {shape}.")
    if (given["origin"], given["method"], given["path"]) != (base, request.method, request.target):
        raise UsageError("The prepared request is for another site, method or path.")
    if request.body is not None:
        request = replace(request, body=prepared_body(command, request, given["body"]))
    headers, message = siwa.rebuild(request, given["headers"])
    if message != given["message"]:
        raise UsageError("The prepared message does not match its request.")
    return replace(request, headers={**headers, "signature": siwa.signature_header(signature)})


def prepared_body(command: Command, request: Request, text: Any) -> dict[str, Any]:
    """The prepared body: this command's fields as given, plus only its stdin fields."""
    try:
        body = json.loads(text) if isinstance(text, str) else None
    except ValueError:
        body = None
    allowed = set(request.body or {}) | {f.field for f in command.stdin_fields}
    if (
        not isinstance(body, dict)
        or not set(body) <= allowed
        or any(body.get(k) != v for k, v in (request.body or {}).items())
        or replace(request, body=body).content != text.encode("utf-8")
    ):
        raise UsageError("The prepared body is not this command's.")
    return body


def next_page_hint(command: Command, answer: Any) -> str | None:
    if command.pagination is None:
        return None
    has_more = dig(answer, command.pagination.has_more)
    cursor = dig(answer, command.pagination.cursor)
    if has_more is True and cursor is not None:
        return f"More: add --{command.pagination.flag} {cursor}"
    return None


def dig(value: Any, dotted: str) -> Any:
    for key in dotted.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value
