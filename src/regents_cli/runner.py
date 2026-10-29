"""Builds `regents <platform> …` from the platform's pinned description and runs its commands.

Every described command becomes a command here without code of its own: its arguments
and flags fill the route's path, query and body, and the answer prints the shared way.
"""

from __future__ import annotations

import json
import mimetypes
import re
import sys
import threading
from collections.abc import Sequence
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit

import click

from regents_cli import output, siwa
from regents_cli.doctor import doctor_command
from regents_cli.errors import UsageError
from regents_cli.http import Request, answer, base_address, respond, same_origin
from regents_cli.next_steps import Step, as_described, done, pair_first, run_piped, wallet
from regents_cli.next_steps import run as run_step
from regents_cli.platforms import Command, Input, Platform, StdinField

STDIN_LIMIT = 200_000
#: The one command that asks for its stdin fields when run at a terminal, its code hidden.
PAIR = ("agents", "pair")
#: The read-only command that says which account an agent is paired to.
WHOAMI = ("agents", "whoami")
#: Each stdin field type, as the JSON value it must be and how an error names it.
STDIN_TYPES: dict[str, tuple[type, str]] = {
    "array": (list, "a list"),
    "object": (dict, "an object"),
    "string": (str, "a string"),
    "integer": (int, "an integer"),
    "uuid": (str, "a UUID"),
}


class Pattern(click.ParamType[str]):
    def __init__(self, name: str, pattern: str, example: str) -> None:
        self.name = name
        self.pattern = re.compile(pattern)
        self.example = example

    def convert(self, value: Any, param: click.Parameter | None, ctx: click.Context | None) -> str:
        if isinstance(value, str) and self.pattern.fullmatch(value):
            return value
        self.fail(f"{value!r} is not {self.name}, such as {self.example}.", param, ctx)


UUID = Pattern(
    "a UUID",
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
    "0b6e4a4e-5c1d-4f0e-9a51-2f1f3f7e8d21",
)

TYPES: dict[str, click.ParamType[Any]] = {
    "uuid": UUID,
    "address": Pattern(
        "an address", r"0x[0-9a-fA-F]{40}", "0x4200000000000000000000000000000000000006"
    ),
    "decimal": Pattern("a decimal number", r"[0-9]+(\.[0-9]+)?", "1.25"),
}


def param_type(spec: Input) -> click.ParamType[Any]:
    if spec.type == "file":
        return click.Path(exists=True, dir_okay=False, readable=True)
    if spec.enum is not None:
        return click.Choice(spec.enum)
    if spec.type == "integer":
        return click.IntRange(spec.minimum, spec.maximum)
    return TYPES.get(spec.type, click.STRING)


def platform_group(platform: Platform, group: click.Group | None = None) -> click.Group:
    help_text = f"Commands for {platform.base_url.removeprefix('https://')}."
    if platform.notes:
        help_text += "\n\n" + "\n\n".join(platform.notes)
    if group is None:
        group = click.Group(platform.name, help=help_text, no_args_is_help=True)
    else:
        # Custom groups reuse their command objects; composition must not mutate those.
        group = deepcopy(group)
        group.help = f"{group.help}\n\n{help_text}"
    described: list[click.Group] = []
    public: dict[click.Group, set[str]] = {}
    for command in platform.commands:
        parent = group
        for word in command.group_words:
            child = parent.commands.get(word)
            if child is None:
                child = click.Group(word, no_args_is_help=True)
                parent.add_command(child)
                described.append(child)
            elif not isinstance(child, click.Group):
                raise UsageError(
                    f"{platform.name}: described group {word} conflicts with a command."
                )
            parent = child
        if command.name in parent.commands:
            raise UsageError(
                f"{platform.name}: described command {' '.join(command.words)} already exists."
            )
        parent.add_command(build_command(platform, command))
        if command.authority == "public":
            public.setdefault(parent, set()).add(command.name)
    # A description names commands, not groups: each group's line lists what it holds, the
    # commands that need no sign-in first.
    for child in described:
        child.help = holds(child, public.get(child, set()))
    if "doctor" not in group.commands:
        group.add_command(doctor_command(platform))
    return group


def holds(group: click.Group, public: set[str]) -> str:
    """The group's line: one sentence, since a list of commands shows only a help's first."""
    names = sorted(group.commands)
    groups = [n for n in names if isinstance(group.commands[n], click.Group)]
    free = [n for n in names if n in public]
    signed = [n for n in names if n not in public and n not in groups]
    parts = [
        f"{label}: {', '.join(listed)}"
        for label, listed in (
            ("needs no sign-in", free),
            ("needs a sign-in", signed),
            ("groups", groups),
        )
        if listed
    ]
    line = "; ".join(parts)
    return line[:1].upper() + line[1:]


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
            default=command.timeout_ms,
            show_default=True,
            help="How long to wait for the answer.",
        ),
    ]
    help_text = command.description
    if command.webmcp is not None:
        help_text += f"\n\nSame as the WebMCP tool {command.webmcp} on {platform.host}."
    if command.signed:
        params.append(
            click.Option(
                ["--phase"],
                type=click.Choice(["prepare", "send"]),
                help="Sign with your own key: prepare prints the request and the message to "
                'sign; send reads {"request": …, "signature": …} on stdin.',
            )
        )
        help_text += f"\n\nSign in first: regents auth login --site {platform.site}."
        if command.authority == "paired_agent":
            help_text += " " + needs_pairing(platform, command)
        if command.stdin_fields:
            optional = not any(f.required for f in command.stdin_fields)
            help_text += f"\n\nPipe {stdin_shape(command)} on stdin" + (
                ", when you have it." if optional else "."
            )
        if command.words == PAIR:
            help_text += " At a terminal it asks for each instead, the code hidden as you type."
        help_text += "".join(f"\n\n{f.field}: {f.description}" for f in command.stdin_fields)
        if command.stdin_fields:
            help_text += "\n\n\b\nExample:\n  " + example(platform, command)

    def run(as_json: bool, base_url: str | None, timeout_ms: int, **values: Any) -> None:
        phase = values.pop("phase", None)
        given = {spec.name: values[spec.name.replace("-", "_")] for spec in command.inputs}
        missing = [name for name in command.required_one_of if given[name] is None]
        if command.required_one_of and len(missing) == len(command.required_one_of):
            raise UsageError("Give at least one of " + ", ".join(f"--{n}" for n in missing) + ".")
        base = base_address(base_url, platform.env_var, platform.base_url)
        request = request_for(command, given, base)
        shared = [*(["--base-url", base_url] if base_url else []), *(["--json"] if as_json else [])]
        if command.signed and phase == "send":
            request = signed_by_caller(command, base, request, timeout_ms)
        elif command.signed:
            request = with_stdin_fields(command, request, timeout_ms)
            receipt = siwa.current(platform.site, timeout_ms)
            if phase == "prepare":
                ready = prepared(base, request, receipt)
                again = command_line(platform, command, given, ["--phase", "send", *shared])
                output.emit(ready, as_json=as_json, next_steps=[send_signed(ready, again)])
                return
            request = replace(request, headers=siwa.sign(request, receipt))
        response = respond(base, request, timeout_ms)
        told = answer(response)
        steps = after(platform, command, told, given, shared, finished=response.status_code != 202)
        output.emit(told, as_json=as_json, next_steps=steps)

    return click.Command(command.name, params=params, callback=run, help=help_text)


#: What each condition asks of a paired agent's person, in the help.
CONDITIONS = {
    "spending_allowed": "let it spend their Credits",
    "member": "be a member of what it acts on",
}


def needs_pairing(platform: Platform, command: Command) -> str:
    """The help's line for a paired_agent command: the agent paired with its person, who has
    signed in on this site once, then each condition."""
    asks = [
        f"have paired this agent with their account (regents {platform.name} agents pair; a "
        f"pairing works on every Regent site) and signed in on {platform.host} once"
    ]
    asks += [CONDITIONS[c] for c in command.conditions]
    return f"Your person must {in_words(asks)}."


def request_for(command: Command, given: dict[str, Any], base: str) -> Request:
    path = command.path
    query: dict[str, str] = {}
    body: dict[str, Any] | None = dict(command.body) if command.body is not None else None
    sent: tuple[Input, Path] | None = None
    for spec in command.inputs:
        value = given[spec.name]
        if value is None:
            continue
        if spec.type == "site_url":
            path = on_this_site(spec, str(value), command.path, base)
        elif spec.type == "file":
            sent = (spec, Path(value))
        elif spec.location == "path":
            if str(value) in ("", ".", ".."):
                raise UsageError(f"{spec.name.upper()} must name a record, not a dot path.")
            path = path.replace("{" + spec.field + "}", quote(str(value), safe=""))
        elif spec.location == "query":
            query[spec.field] = str(value)
        else:
            body = {**(body or {}), spec.field: value}
    if sent is not None:
        return file_request(command, *sent, path, query)
    if body is None and command.method in ("POST", "PUT", "PATCH"):
        body = {}
    return Request(command.method, path, query, body)


def on_this_site(spec: Input, value: str, route: str, base: str) -> str:
    """The path of an address on this site whose path is `route`, such as the upload address an
    earlier answer gave. An address anywhere else is refused, so nothing goes elsewhere."""
    parts = urlsplit(value)
    # A filled segment holds only the characters a site's tickets use, so neither ".." nor an
    # escaped dot segment such as "%2e%2e" can name another route.
    pattern = "/".join(
        r"(?!\.\.?(?:/|$))[A-Za-z0-9._~-]+" if part.startswith("{") else re.escape(part)
        for part in route.split("/")
    )
    if (
        not same_origin(f"{parts.scheme}://{parts.netloc}", base)
        or parts.username
        or parts.password
        or parts.query
        or parts.fragment
        or not re.fullmatch(pattern, parts.path)
    ):
        raise UsageError(
            f"{spec.name.upper()} must be an address on {base} of the form {base}{route}, as the "
            "site answered it."
        )
    return parts.path


def file_request(
    command: Command, spec: Input, file: Path, path: str, query: dict[str, str]
) -> Request:
    """The file's bytes as the whole body, with the content type its extension gives."""
    kind, packed = mimetypes.guess_type(file.name)
    allowed = spec.enum or ()
    if kind not in allowed or packed is not None:
        raise UsageError(
            f"{spec.name.upper()} must be named for its type, ending in "
            f"{in_words([mimetypes.guess_extension(each) or each for each in allowed], 'or')}."
        )
    limit = spec.maximum or 0
    try:
        with file.open("rb") as opened:
            content = opened.read(limit + 1)
    except OSError as error:
        raise UsageError(f"{spec.name.upper()} {file} cannot be read: {error.strerror}.") from None
    if len(content) > limit:
        raise UsageError(f"{spec.name.upper()} holds more than {limit:,} bytes.")
    return Request(command.method, path, query, raw_content=content, headers={"content-type": kind})


def example(platform: Platform, command: Command) -> str:
    """The command with its required stdin fields piped in, or its first when none is required,
    each value a placeholder to fill: a string's in quotes, any other JSON value bare."""
    fields = [f for f in command.stdin_fields if f.required] or list(command.stdin_fields[:1])
    piped = ", ".join(
        f'"{f.field}": ' + (f'"<{f.field}>"' if f.type == "string" else f"<{f.field}>")
        for f in fields
    )
    names = [w if not w.startswith("<") else w[1:-1].upper() for w in command.words]
    return f"printf '%s' '{{{piped}}}' | regents {platform.name} {' '.join(names)}"


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
    if piped is None and command.words == PAIR and sys.stdin.isatty():
        piped = asked(command)
    piped = {} if piped is None else piped
    if not isinstance(piped, dict):
        raise UsageError(f"stdin must hold {shape}.")
    unknown = sorted(set(piped) - {f.field for f in command.stdin_fields})
    if unknown:
        are = "is not one of its fields" if len(unknown) == 1 else "are not among its fields"
        raise UsageError(f"stdin must hold {shape}; {in_words(unknown)} {are}.")
    validate_stdin_fields(command, piped)
    return replace(request, body={**(request.body or {}), **piped})


def asked(command: Command) -> dict[str, str]:
    """Each stdin field typed at the terminal, the pairing code never shown."""
    return {
        f.field: click.prompt(f.field.capitalize(), hide_input=f.field == "code", err=True)
        for f in command.stdin_fields
    }


def validate_stdin_fields(command: Command, piped: dict[str, Any]) -> None:
    """Keep JSON types intact, including refusing booleans where an integer is required."""
    missing = [f.field for f in command.stdin_fields if f.required and f.field not in piped]
    if missing:
        are = "is" if len(missing) == 1 else "are"
        raise UsageError(
            f"Pipe {stdin_shape(command)} on stdin; {in_words(missing)} {are} required."
        )
    wrong = [
        problem
        for f in command.stdin_fields
        if f.field in piped and (problem := stdin_problem(f, piped[f.field]))
    ]
    if wrong:
        raise UsageError("; ".join(wrong) + ".")


def stdin_problem(field: StdinField, value: Any) -> str:
    """What is wrong with one piped value, checked as a flag of the same type is; "" when
    nothing is."""
    kind, named = STDIN_TYPES[field.type]
    if type(value) is not kind:
        return f"{field.field} must be {named}"
    if field.type == "uuid" and isinstance(value, str) and not UUID.pattern.fullmatch(value):
        return f"{field.field} must be a UUID, such as {UUID.example}"
    low, high = field.minimum, field.maximum
    if isinstance(value, int) and (
        (low is not None and value < low) or (high is not None and value > high)
    ):
        return f"{field.field} must be {within(low, high)}"
    return ""


def within(low: int | None, high: int | None) -> str:
    """an integer from 1 to 60; an integer of at least 1; an integer of at most 60."""
    if low is not None and high is not None:
        return f"an integer from {low} to {high}"
    return f"an integer of at least {low}" if low is not None else f"an integer of at most {high}"


def in_words(names: list[str], joined: str = "and") -> str:
    """rooms, graph and run."""
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + f" {joined} " + names[-1]


def prepared(base: str, request: Request, receipt: siwa.Receipt) -> dict[str, Any]:
    """The exact request to sign and the message the caller personal_signs for it."""
    headers, message = siwa.prepare(request, receipt)
    content = request.content
    body = {} if content is None else {"body": content.decode("utf-8")}
    return {
        "contract": siwa.contract_id(),
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
    shape = (
        '{"request": …, "signature": …} '
        "(the request is --phase prepare's answer, less its next_steps)"
    )
    if not isinstance(piped, dict) or set(piped) != {"request", "signature"}:
        raise UsageError(f"stdin must hold {shape}.")
    given, signature = piped["request"], piped["signature"]
    keys = {"contract", "origin", "method", "path", "headers", "message"}
    if request.body is not None:
        keys.add("body")
    if (
        not isinstance(given, dict)
        or set(given) != keys
        or not isinstance(given["headers"], dict)
        or not isinstance(signature, str)
    ):
        raise UsageError(f"stdin must hold {shape}.")
    if given["contract"] != siwa.contract_id():
        raise UsageError(
            "This request was prepared under another signing contract than this regents signs "
            "with. Prepare it again with --phase prepare and sign the new message."
        )
    if (given["origin"], given["method"], given["path"]) != (base, request.method, request.target):
        raise UsageError("The prepared request is for another site, method or path.")
    if request.body is not None:
        request = replace(request, body=prepared_body(command, request, given["body"]))
    headers, message = siwa.rebuild(request, given["headers"])
    if message != given["message"]:
        raise UsageError("The prepared message does not match its request.")
    return replace(request, headers=siwa.with_signature(headers, signature))


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
    validate_stdin_fields(command, body)
    return body


def command_line(
    platform: Platform, command: Command, given: dict[str, Any], extra: Sequence[str]
) -> list[str]:
    """The command, from the values it was given: its words, its flags and the extra flags,
    then its values."""
    names = [word for word in command.words if not word.startswith("<")]
    flags = [
        part
        for spec in command.flags
        if given[spec.name] is not None
        for part in (f"--{spec.name}", str(given[spec.name]))
    ]
    values = [str(given[spec.name]) for spec in command.arguments]
    return typed(["regents", platform.name, *names, *flags, *extra], values)


def typed(words: Sequence[str], values: Sequence[str]) -> list[str]:
    """Words and flags, then values: after `--` when one starts with "-", so none reads as a
    flag."""
    return [*words, *(["--"] if any(value.startswith("-") for value in values) else []), *values]


def send_signed(ready: dict[str, Any], line: list[str]) -> Step:
    """After --phase prepare: the prepared request back, with the signature of its message."""
    piped = json.dumps({"request": ready, "signature": "<signature of message>"})
    return run_piped(
        piped,
        line,
        "Sign message with your own key, put the signature in place of <signature of message>, "
        "and send it.",
    )


def after(
    platform: Platform,
    command: Command,
    answer: dict[str, Any],
    given: dict[str, Any],
    shared: list[str],
    *,
    finished: bool,
) -> list[Step]:
    """What follows a site's answer: the transactions it gives the caller's wallet to send, its
    next page, the follow-ups the site describes, a check
    of a new pairing, or nothing more. An answer that took the request without finishing it
    (202) is followed the way the command's description says, and never sent again."""
    steps: list[Step] = to_send(answer)
    if command.pagination is not None:
        cursor = dig(answer, command.pagination.cursor)
        if dig(answer, command.pagination.has_more) is True and cursor is not None:
            steps.append(
                run_step(
                    command_line(
                        platform, command, {**given, command.pagination.flag: cursor}, shared
                    ),
                    "Read the next page, if you need more than this one.",
                )
            )
    for follow_up in command.next_steps:
        if follow_up.kind != "run" or follow_up.command is None:
            steps.append(Step(follow_up.kind, follow_up.say, url=follow_up.url))
            continue
        words = follow_up.command.split(" ")
        filled = [
            dig(answer, follow_up.arguments[w[1:-1]])
            if w[1:-1] in follow_up.arguments
            else given.get(w[1:-1])
            for w in words
            if w.startswith("<")
        ]
        if all(isinstance(value, str | int) and str(value) for value in filled):
            names = [word for word in words if not word.startswith("<")]
            line = typed(["regents", platform.name, *names, *shared], [str(v) for v in filled])
            steps.append(run_step(line, follow_up.say))
    if command.words == WHOAMI and unpaired(answer.get("data")):
        steps += pair_first(platform.name, platform.host)
    whoami = any(c.words == WHOAMI for c in platform.commands)
    if command.words == PAIR and whoami:
        steps.append(
            run_step(
                ["regents", platform.name, *WHOAMI, *shared],
                "Check the pairing: it names the account this agent now acts for.",
            )
        )
    if steps:
        return steps
    if not finished:
        return [
            as_described(
                (platform.name, *command.group_words),
                command.description,
                "The site took this but has not finished it, so don't run it again.",
            )
        ]
    # An answer in a {"data": …} envelope (regents.sh, the template) carries it in data; an
    # answer without one (Patchbay's search) carries it at the top.
    data = answer.get("data")
    said = (data if isinstance(data, dict) else answer).get("next_step")
    if isinstance(said, str) and said.strip():
        return site_says(platform, command.effect, said)
    return [done(DONE[command.effect])]


def to_send(answer: dict[str, Any]) -> list[Step]:
    """An answer's `transactions`, at the top or in `data`, are for the caller's own wallet to
    send in order; `regents` sends none of them. One the chain's state makes certain to fail
    (its `blocked` reason) stops them all, since the later ones depend on it."""
    data = answer.get("data")
    holder = answer if "transactions" in answer else data if isinstance(data, dict) else {}
    listed = holder.get("transactions")
    if not (isinstance(listed, list) and listed and all(isinstance(t, dict) for t in listed)):
        return []
    blocked = [
        f"{t.get('name', number)} ({t['blocked']})"
        for number, t in enumerate(listed, 1)
        if isinstance(t.get("blocked"), str) and t["blocked"].strip()
    ]
    if blocked:
        return [
            done(
                f"Send nothing now: the chain's own state makes {in_words(blocked)} certain to "
                "fail."
            )
        ]
    chain = holder.get("chain_id")
    count = f"{len(listed)} transaction{'s' if len(listed) > 1 else ''}"
    on = f" on chain {chain}" if isinstance(chain, int) and not isinstance(chain, bool) else ""
    return [
        wallet(
            f"Send the {count} in transactions from your own wallet{on}, in order. regents sends "
            "none of them, so nothing has happened on the chain yet."
        )
    ]


#: An HTTP route named in a site's own words, such as "POST /forum/threads".
ROUTE = re.compile(r"\b(GET|POST|PUT|PATCH|DELETE) (/[^\s,;)`'\"?#]*)")


def site_says(platform: Platform, effect: str, said: str) -> list[Step]:
    """The site's own next step, as it wrote it: with the help of the command for the first
    route it names that is one of the site's commands, or else beside what the answer means."""
    for method, path in ROUTE.findall(said):
        command = routed_command(platform, method, path.rstrip("."))
        if command is not None:
            named = [w for w in command.words if not w.startswith("<")]
            follow = run_step(["regents", platform.name, *named, "--help"], said)
            return [follow] if effect == "read" else [done(DONE[effect]), follow]
    return [done(f"{DONE[effect]} The site adds: {said}")]


def hinted(platform: Platform, hint: Any, shared: list[str]) -> list[Step]:
    """A refusal's hint that names one of the site's routes, such as "GET /api/v1/fleets lists
    every fleet.": that command with the caller's `shared` options, run as it is when it only
    reads and needs nothing more, or else its help."""
    if not isinstance(hint, str):
        return []
    for method, path in ROUTE.findall(hint):
        command = routed_command(platform, method, path.rstrip("."))
        if command is not None:
            named = [w for w in command.words if not w.startswith("<")]
            needs = (
                bool(command.arguments or command.required_one_of)
                or any(f.required for f in command.flags)
                or any(f.required for f in command.stdin_fields)
            )
            ready = command.effect == "read" and not needs
            return [
                run_step(
                    ["regents", platform.name, *named, *(shared if ready else ["--help"])], hint
                )
            ]
    return []


def routed_command(platform: Platform, method: str, path: str) -> Command | None:
    """The one command whose route is exactly `path`, or else the one whose route takes it with
    a value in each {placeholder}."""
    same = [c for c in platform.commands if c.method == method]
    exact = [c for c in same if c.path == path]
    matching = exact or [c for c in same if routed(c.path, path)]
    return matching[0] if len(matching) == 1 else None


def routed(template: str, path: str) -> bool:
    """Whether `path` is the command's route, with any value in each {placeholder}."""
    pattern = "/".join(
        "[^/]+" if part.startswith("{") else re.escape(part) for part in template.split("/")
    )
    return re.fullmatch(pattern, path) is not None


#: What a finished answer means, by what the command does.
DONE = {
    "read": "That is the answer; nothing more to run.",
    "quote": "That is the quote; nothing more to run unless you go ahead with it.",
    "write": "The site took the change; nothing more to run.",
    "prepare": "The terms are set; nothing more to run unless you go ahead with them.",
    "payment": "The site took the payment; nothing more to run.",
}


def unpaired(identity: Any) -> bool:
    """Whether an `agents whoami` answer's data says no person's account is paired."""
    return isinstance(identity, dict) and "pairing" in identity and identity["pairing"] is None


def dig(value: Any, dotted: str) -> Any:
    for key in dotted.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value
