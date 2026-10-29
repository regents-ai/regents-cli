"""Four promises `regents` makes for any input, checked on many generated ones.

- Any refusal a site sends reaches the person as one error with its code and what to do next;
  none crashes `regents`, whatever its fields are named (1.10.15 crashed on a site error field
  named `exit_code`, and on a 402 answer with a `code` or `message` field).
- The request `--phase prepare` prints is the one `--phase send` sends and the one that goes on
  the wire, byte for byte, with its body's digest: one byte out and the site refuses every
  signed request.
- Every command `regents` prints for an agent to run again, for every command every pinned site
  describes, runs the same request again.
- Every request names the release and the command that sent it in `x-regent-client`, and
  nothing a person or agent typed after the command's words.
- Every command's help reads in a pipe as plain lines: no frame characters, no spaces padding a
  line out to the width, which an agent would read as part of the help, and one blank line at
  most between blocks.
- Any answer prints in plain words without crashing, and a moment a site sends shows as the same
  minute in the reader's own time zone: a wrong hour sends a person to an event that is over.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import io
import json
import shlex
import unicodedata
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta, timezone
from importlib.metadata import version
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, unquote

import click
import httpx
import pytest
from hypothesis import HealthCheck, example, given, settings
from hypothesis import strategies as st

from regents_cli import app, output, runner
from regents_cli.errors import CommandError
from regents_cli.http import answer
from regents_cli.next_steps import Step, for_failure
from regents_cli.platforms import Command, FollowUp, Input, Platform, StdinField, pinned_platforms

ROOT = app.root()
PLATFORMS = {platform.name: platform for platform in pinned_platforms()}
COMMANDS = [(platform, command) for platform in PLATFORMS.values() for command in platform.commands]
SIGNATURE = "0x" + "ab" * 65

#: A value a person or agent types: any text but a NUL, including text that starts with "-".
TYPED = (
    st.text(st.characters(blacklist_categories=["Cs"], blacklist_characters="\x00"), min_size=1)
    | st.text(st.sampled_from("/?#%&=+ ;:@.~_'\"aZ09é"), min_size=1)
    | st.text(st.sampled_from("-ah"), min_size=1).map(lambda text: "-" + text)
    | st.sampled_from(["-", "--", "--json", "--phase", "--base-url", "--timeout-ms", "--help"])
).filter(lambda text: text not in (".", ".."))
JSON = st.recursive(
    st.none()
    | st.booleans()
    | st.integers()
    | st.floats(allow_nan=False, allow_infinity=False)
    | st.text(),
    lambda inner: st.lists(inner, max_size=3) | st.dictionaries(st.text(), inner, max_size=3),
    max_leaves=10,
)
#: Field names a site's error may carry, including the ones `regents` itself uses.
FIELD = st.sampled_from(
    ["code", "message", "hint", "status", "exit_code", "next_steps", "fields", "review"]
) | st.text(max_size=12)


def value_for(spec: Input) -> st.SearchStrategy[Any]:
    if spec.enum is not None:
        return st.sampled_from(spec.enum)
    if spec.type == "integer":
        return st.integers(spec.minimum, spec.maximum)
    if spec.type in runner.TYPES:
        return st.from_regex(runner.TYPES[spec.type].pattern, fullmatch=True)  # type: ignore[attr-defined]
    return TYPED


#: The exit code each refusal's status calls for; any other status exits 1.
EXITS = {401: 3, 403: 3, 404: 4, 502: 5, 503: 5, 504: 5}


@st.composite
def site_refusals(draw: st.DrawFn) -> httpx.Response:
    error = draw(st.dictionaries(FIELD, JSON, max_size=4))
    if draw(st.booleans()):
        error["code"] = draw(st.text(min_size=1, max_size=20))
    body = draw(JSON | st.dictionaries(FIELD, JSON, max_size=3) | st.just({"error": error}))
    header = st.text(st.characters(min_codepoint=32, max_codepoint=126), max_size=20)
    headers = draw(st.dictionaries(st.sampled_from(["retry-after", "payment-required"]), header))
    status = draw(
        st.sampled_from([400, 401, 402, 403, 404, 409, 429, 500, 502]) | st.integers(300, 599)
    )
    if status == 402 and draw(st.booleans()):
        headers["payment-required"] = draw(header)
    return httpx.Response(status, json=body, headers=headers)


def read_json(content: bytes) -> Any:
    """A body as JSON reads it: NaN and Infinity are not JSON, nor is a body nested too deep."""

    def refuse(constant: str) -> Any:
        raise ValueError(constant)

    try:
        return json.loads(content, parse_constant=refuse) if content else None
    except (ValueError, RecursionError):
        return None


def shown(text: str) -> str:
    """Text as a terminal shows it, without the spaces and line breaks it wraps at."""
    return "".join(c for c in text if not c.isspace() and unicodedata.category(c)[0] != "C")


@given(
    site_refusals(),
    st.sampled_from(
        [
            ["keyfleet", "fleets", "get", "regents_club"],
            ["protocol", "agents", "whoami"],
            ["ash-template", "notes", "pin", "0b6e4a4e-5c1d-4f0e-9a51-2f1f3f7e8d21"],
            ["patchbay", "assist", "request"],
        ]
    ),
    st.booleans(),
)
@example(
    httpx.Response(409, json={"error": {"code": "x", "review": [1], "exit_code": 0}}),
    ["keyfleet", "fleets", "get", "regents_club"],
    False,
)
@example(
    httpx.Response(
        402,
        json={"code": 7, "message": None, "exit_code": 0, "next_steps": [1], "review": [5]},
        headers={"payment-required": "terms"},
    ),
    ["patchbay", "assist", "request"],
    False,
)
@example(
    httpx.Response(500, content=b"[" * 100_000 + b"]" * 100_000),
    ["protocol", "agents", "whoami"],
    True,
)
@example(
    httpx.Response(400, content=b'{"error": {"code": "x", "limit": NaN}}'),
    ["protocol", "agents", "whoami"],
    True,
)
@settings(deadline=None)
def test_any_refusal_reaches_the_person(
    response: httpx.Response, args: list[str], as_json: bool
) -> None:
    with pytest.raises(CommandError) as raised:
        answer(response)
    error = raised.value
    body = read_json(response.content)
    said_code = body.get("error", {}).get("code") if isinstance(body, dict) else None
    if (
        isinstance(body, dict)
        and isinstance(body.get("error"), dict)
        and isinstance(said_code, str)
    ):
        assert error.code == said_code
    elif (
        response.status_code == 402
        and isinstance(body, dict)
        and "payment-required" in response.headers
    ):
        assert error.code == "payment_required"
    assert error.exit_code == EXITS.get(response.status_code, 1)
    assert not error.review
    steps = for_failure(error, app.invocation(ROOT, args))
    assert steps
    assert all(isinstance(step, Step) for step in steps)
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        output.emit_error(error, steps, as_json=as_json)
    if as_json:
        printed = json.loads(out.getvalue())
        assert printed["error"]["code"] == error.code
        assert printed["error"]["message"] == error.message
        assert printed["next_steps"] == [step.as_json() for step in steps]
    else:
        assert shown(error.message) in shown(err.getvalue())
        assert shown(error.code) in shown(err.getvalue())


@pytest.fixture
def signed_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> list[httpx.Request]:
    """An agent home signed in to every site, and each request exactly as it leaves for the
    site, which none reaches."""
    home = tmp_path / "agent"
    (home / "receipts").mkdir(parents=True, mode=0o700)
    home.chmod(0o700)
    address = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
    files: dict[str, Any] = {
        "key.json": {"address": address, "private_key": "0x" + "00" * 31 + "01"}
    }
    for platform in PLATFORMS.values():
        files[f"receipts/{platform.site}.json"] = {
            "address": address,
            "audience": platform.site,
            "receipt": "fixed-receipt",
            "receipt_expires_at": "2999-01-01T00:00:00Z",
            "key_id": address,
        }
    for name, content in files.items():
        (home / name).write_text(json.dumps(content), "utf-8")
        (home / name).chmod(0o600)
    monkeypatch.setenv("SIWA_AGENT_HOME", str(home))
    sent: list[httpx.Request] = []

    def request(method: str, url: str, **sending: Any) -> httpx.Response:
        sent.append(
            httpx.Request(method, url, content=sending["content"], headers=sending["headers"])
        )
        return httpx.Response(200, json={})

    monkeypatch.setattr(httpx, "request", request)
    return sent


def stdin_value(field: StdinField) -> st.SearchStrategy[Any]:
    kinds: dict[str, st.SearchStrategy[Any]] = {
        "array": st.lists(JSON, max_size=3),
        "object": st.dictionaries(st.text(), JSON),
        "string": st.text(),
        "integer": st.integers(field.minimum, field.maximum),
        "uuid": st.from_regex(runner.UUID.pattern, fullmatch=True),
    }
    return kinds[field.type]


def stdin_for(command: Command) -> st.SearchStrategy[dict[str, Any]]:
    return st.fixed_dictionaries(
        {f.field: stdin_value(f) for f in command.stdin_fields if f.required},
        optional={f.field: stdin_value(f) for f in command.stdin_fields if not f.required},
    )


def regents(monkeypatch: pytest.MonkeyPatch, args: list[str], stdin: str) -> str:
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin))
    shown = io.StringIO()
    with contextlib.redirect_stdout(shown), contextlib.redirect_stderr(io.StringIO()):
        code = app.main(args)
    assert code == 0, shown.getvalue()
    return shown.getvalue()


SIGNED = [(platform, command) for platform, command in COMMANDS if command.signed]


def flags_for(command: Command, data: st.DataObject) -> dict[str, Any]:
    """Each flag the command needs, and any of the others."""
    given = {
        spec.name: data.draw(value_for(spec) if spec.required else st.none() | value_for(spec))
        for spec in command.flags
    }
    if command.required_one_of and all(given[name] is None for name in command.required_one_of):
        name = data.draw(st.sampled_from(command.required_one_of))
        given[name] = data.draw(value_for(next(f for f in command.flags if f.name == name)))
    return given


@pytest.mark.parametrize(
    "pair", SIGNED, ids=lambda pair: f"{pair[0].name} {' '.join(pair[1].words)}"
)
@given(data=st.data())
@settings(
    deadline=None, max_examples=8, suppress_health_check=[HealthCheck.function_scoped_fixture]
)
def test_what_is_prepared_is_what_is_sent(
    pair: tuple[Platform, Command],
    signed_in: list[httpx.Request],
    monkeypatch: pytest.MonkeyPatch,
    data: st.DataObject,
) -> None:
    platform, command = pair
    values = {spec.name: data.draw(value_for(spec)) for spec in command.arguments}
    values |= flags_for(command, data)
    names = [word for word in command.words if not word.startswith("<")]
    flags = [
        part
        for spec in command.flags
        if values[spec.name] is not None
        for part in (f"--{spec.name}", str(values[spec.name]))
    ]
    stdin = json.dumps(data.draw(stdin_for(command)))
    signed_in.clear()

    prepare = [
        platform.name,
        *names,
        *flags,
        "--phase",
        "prepare",
        "--json",
        "--",
        *(str(values[spec.name]) for spec in command.arguments),
    ]
    ready = json.loads(regents(monkeypatch, prepare, stdin))
    # The send step `regents` prints, as an agent runs it, with its own signature on stdin.
    [step] = ready.pop("next_steps")
    printed = shlex.split(step["command"])
    send = printed[printed.index("|") + 2 :]
    regents(monkeypatch, send, json.dumps({"request": ready, "signature": SIGNATURE}))

    [wire] = signed_in
    assert wire.url.raw_path == ready["path"].encode("ascii")
    assert wire.headers["x-regent-client"] == (
        f"regents-cli/{version('regents-cli')} {platform.name} {' '.join(names)}"
    )
    assert {name: wire.headers[name] for name in ready["headers"]} == ready["headers"]
    body = ready["body"].encode("utf-8") if "body" in ready else b""
    assert wire.content == body
    if body:
        digest = base64.b64encode(hashlib.sha256(body).digest()).decode()
        assert wire.headers["content-digest"] == f"sha-256=:{digest}:"
    else:
        assert "content-digest" not in wire.headers
    # Each value reaches the site: whole in its own segment of the path, in the query or in
    # the body.
    route = command.path.split("/")
    segments = wire.url.raw_path.decode().split("?")[0].split("/")
    assert len(segments) == len(route)
    in_path = {
        spec.field: str(values[spec.name]) for spec in command.inputs if spec.location == "path"
    }
    for part, segment in zip(route, segments, strict=True):
        assert unquote(segment) == in_path[part[1:-1]] if part.startswith("{") else segment == part
    query = dict(parse_qsl(wire.url.query.decode("ascii"), keep_blank_values=True))
    fields = json.loads(body) if body else {}
    for spec in command.inputs:
        value = values[spec.name]
        if value is not None and spec.location == "query":
            assert query[spec.field] == str(value)
        elif value is not None and spec.location != "path":
            assert fields[spec.field] == value


def click_command(words: list[str]) -> tuple[click.Command, list[str]]:
    """The command a typed line names, and the words left for it to read."""
    command: click.Command = ROOT
    at = 1
    while isinstance(command, click.Group):
        command = command.commands[words[at]]
        at += 1
    return command, words[at:]


def read_back(printed: str) -> dict[str, Any]:
    """What a printed command gives its command when it runs."""
    parsed, rest = click_command(shlex.split(printed))
    return parsed.make_context(parsed.name or "", rest).params


def put(tree: dict[str, Any], dotted: str, value: Any) -> None:
    """Set the value at a dotted path such as "pagination.next_cursor"."""
    *parents, last = dotted.split(".")
    for name in parents:
        tree = tree.setdefault(name, {})
    tree[last] = value


#: The flags `regents` adds to each command it prints.
SHARED = ["--base-url", "https://example.com", "--json"]


@pytest.mark.parametrize(
    "pair", COMMANDS, ids=lambda pair: f"{pair[0].name} {' '.join(pair[1].words)}"
)
@given(data=st.data())
@settings(deadline=None, max_examples=10)
def test_a_printed_command_runs_the_same_request(
    pair: tuple[Platform, Command], data: st.DataObject
) -> None:
    platform, command = pair
    values = {spec.name: data.draw(value_for(spec)) for spec in command.arguments}
    values |= {
        spec.name: data.draw(value_for(spec) if spec.required else st.none() | value_for(spec))
        for spec in command.flags
    }
    # Each command `regents` prints, with the values it should run with: after --phase prepare,
    # the next page, and a site's follow-up.
    send = ["--phase", "send"] if command.signed else []
    printed = [(runner.command_line(platform, command, values, [*SHARED, *send]), values)]
    if command.pagination is not None:
        flag = next(spec for spec in command.flags if spec.name == command.pagination.flag)
        cursor = data.draw(value_for(flag))
        page: dict[str, Any] = {}
        put(page, command.pagination.has_more, True)
        put(page, command.pagination.cursor, cursor)
        step = runner.after(platform, command, page, values, SHARED, finished=True)[0]
        printed.append((shlex.split(step.command or ""), {**values, flag.name: cursor}))
    if not command.required_one_of and not any(spec.required for spec in command.flags):
        # A site's follow-up that runs this same command, filled from its answer.
        again = FollowUp(
            "run",
            "Run it again.",
            " ".join(command.words),
            {spec.name: f"again.{spec.name}" for spec in command.arguments},
            None,
        )
        told = {"again": {spec.name: data.draw(value_for(spec)) for spec in command.arguments}}
        follows = replace(command, next_steps=(again,))
        step = runner.after(platform, follows, told, values, SHARED, finished=True)[0]
        filled = {spec.name: None for spec in command.flags} | told["again"]
        printed.append((shlex.split(step.command or ""), filled))
    for line, expected in printed:
        read = read_back(shlex.join(line))
        read_values = {spec.name: read[spec.name.replace("-", "_")] for spec in command.inputs}
        assert read_values == expected
        assert (read["base_url"], read["as_json"]) == ("https://example.com", True)
    phase = read_back(shlex.join(printed[0][0])).get("phase")
    assert phase == ("send" if command.signed else None)


#: Keys as sites name them, with the endings readable output treats apart.
KEY = st.text(st.sampled_from("abz_"), max_size=8).map(
    lambda key: key + ("_id", "_at", "", "_")[len(key) % 4]
)
ANSWER = st.recursive(
    JSON,
    lambda inner: (
        st.lists(st.dictionaries(KEY, inner, max_size=4), max_size=3)
        | st.dictionaries(KEY, inner, max_size=4)
    ),
    max_leaves=12,
)


@given(answer=st.dictionaries(KEY, ANSWER, max_size=4))
@settings(deadline=None)
def test_any_answer_prints_in_plain_words(answer: dict[str, Any]) -> None:
    with contextlib.redirect_stdout(io.StringIO()):
        output.emit(answer, as_json=False, next_steps=[Step("done", "Finished.")])


@given(
    moment=st.datetimes(
        min_value=datetime(1970, 1, 2), max_value=datetime(9998, 12, 30), timezones=st.just(UTC)
    ),
    offset=st.integers(-14 * 60, 14 * 60),
    zulu=st.booleans(),
)
def test_a_moment_shows_as_the_same_local_minute(moment: datetime, offset: int, zulu: bool) -> None:
    sent = moment.astimezone(timezone(timedelta(minutes=offset))).isoformat()
    if zulu:
        sent = moment.isoformat().replace("+00:00", "Z")
    local = moment.astimezone()
    shown = output._scalar(sent)
    if local.year == datetime.now().astimezone().year:
        read = datetime.strptime(f"{local.year} {shown}", "%Y %d %b %H:%M")
    else:
        read = datetime.strptime(shown, "%d %b %Y %H:%M")
    assert read == local.replace(tzinfo=None, second=0, microsecond=0)


def helps(command: click.Command, parent: click.Context | None = None) -> Iterator[str]:
    """The help of a command and of every command under it, as `--help` prints it."""
    context = command.context_class(command, info_name=command.name, parent=parent)
    yield command.get_help(context)
    if isinstance(command, click.Group):
        for name in command.list_commands(context):
            sub = command.get_command(context, name)
            assert sub is not None
            yield from helps(sub, context)


def test_every_help_reads_as_plain_lines_in_a_pipe() -> None:
    shown = list(helps(app.root()))
    assert len(shown) > 100
    for text in shown:
        assert not any(line != line.rstrip() for line in text.splitlines()), text
        assert not set(text) & set("│─╭╮╰╯┌┐└┘═"), text
        assert "\n\n\n" not in text, text
