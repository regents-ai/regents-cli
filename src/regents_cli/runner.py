"""Builds `regents <platform> …` from the platform's pinned description and runs its commands.

Every described command becomes a command here without code of its own: its arguments
and flags fill the route's path, query and body, and the answer prints the shared way.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import replace
from typing import Any
from urllib.parse import quote

import click

from regents_cli import output
from regents_cli.errors import UsageError
from regents_cli.http import Request, base_address, send
from regents_cli.platforms import Command, Input, Platform

PROOF_TOKEN = re.compile(r"^[A-Za-z0-9_.-]{1,32768}$")
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
        if command.authority == "wallet-proof":
            continue  # arrives with the shared wallet sign-in
        parent = group
        for word in command.group_words:
            child = parent.commands.get(word)
            if not isinstance(child, click.Group):
                child = click.Group(word, no_args_is_help=True)
                parent.add_command(child)
            parent = child
        parent.add_command(build_command(platform, command))
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
    if command.authority == "privy-proof-pair":
        help_text += '\n\nPipe the paired Privy proof on stdin: {"access": …, "identity": …}.'

    def run(as_json: bool, base_url: str | None, timeout_ms: int, **values: Any) -> None:
        given = {spec.name: values[spec.name.replace("-", "_")] for spec in command.inputs}
        missing = [name for name in command.required_one_of if given[name] is None]
        if command.required_one_of and len(missing) == len(command.required_one_of):
            raise UsageError("Give at least one of " + ", ".join(f"--{n}" for n in missing) + ".")
        base = base_address(base_url, platform.env_var, platform.base_url)
        request = request_for(command, given)
        secrets: tuple[str, ...] = ()
        if command.authority == "privy-proof-pair":
            access, identity = read_proof_pair()
            headers = {"authorization": f"Bearer {access}", "privy-id-token": identity}
            request = replace(request, headers=headers)
            secrets = (access, identity)
        answer = send(base, request, timeout_ms, secrets=secrets)
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
    return Request(command.method, path, query, body)


def read_proof_pair() -> tuple[str, str]:
    """The paired Privy proof, piped on stdin and held only for this one request."""
    if sys.stdin.isatty():
        raise UsageError('Pipe the paired Privy proof on stdin: {"access": …, "identity": …}.')
    text = sys.stdin.read(STDIN_LIMIT + 1)
    try:
        pair = json.loads(text) if len(text) <= STDIN_LIMIT else None
    except ValueError:
        pair = None
    if (
        not isinstance(pair, dict)
        or set(pair) != {"access", "identity"}
        or not all(isinstance(pair[k], str) and PROOF_TOKEN.fullmatch(pair[k]) for k in pair)
    ):
        raise UsageError('stdin must hold exactly {"access": …, "identity": …} from Privy.')
    return pair["access"], pair["identity"]


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
