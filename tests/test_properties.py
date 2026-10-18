"""Three promises `regents` makes for any input, checked on many generated ones.

- Any refusal a site sends reaches the person as one error with its code and what to do next;
  none crashes `regents`, whatever its fields are named (1.10.15 crashed on a site error field
  named `exit_code`, and on a 402 answer with a `code` or `message` field).
- The request `--phase prepare` prints is the one `--phase send` sends and the one that goes on
  the wire, byte for byte, with its body's digest: one byte out and the site refuses every
  signed request.
- Every command `regents` prints for an agent to run again, for every command every pinned site
  describes, runs the same request again.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import io
import json
import shlex
import unicodedata
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import click
import httpx
import pytest
from hypothesis import HealthCheck, example, given, settings
from hypothesis import strategies as st

from regents_cli import app, output, runner, siwa
from regents_cli.errors import CommandError
from regents_cli.http import Request, answer
from regents_cli.next_steps import Step, for_failure
from regents_cli.platforms import Command, Input, Platform, pinned_platforms

ROOT = app.root()
PLATFORMS = {platform.name: platform for platform in pinned_platforms()}
COMMANDS = [(platform, command) for platform in PLATFORMS.values() for command in platform.commands]
SIGNATURE = "0x" + "ab" * 65

#: A value a person or agent types: any text but a NUL, and not starting with "-". A printed
#: command puts no `--` before its values yet, so one starting with "-" reads as a flag when it
#: runs again (docs/backlogs/regents-cli.md in the workspace).
TYPED = (
    st.text(st.characters(blacklist_categories=["Cs"], blacklist_characters="\x00"), min_size=1)
    | st.text(st.sampled_from("/?#%&=+ ;:@.~_'\"aZ09é"), min_size=1)
).filter(lambda text: not text.startswith("-") and text not in (".", ".."))
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
def signed_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> list[Request]:
    """An agent home signed in to every site, and the requests sent instead of reaching one."""
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
    sent: list[Request] = []

    def respond(base: str, request: Request, timeout_ms: int) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={})

    monkeypatch.setattr(runner, "respond", respond)
    return sent


def stdin_for(command: Command) -> st.SearchStrategy[dict[str, Any]]:
    kinds: dict[str, st.SearchStrategy[Any]] = {
        "array": st.lists(JSON, max_size=3),
        "object": st.dictionaries(st.text(), JSON),
        "string": st.text(),
        "integer": st.integers(),
    }
    return st.fixed_dictionaries(
        {f.field: kinds[f.type] for f in command.stdin_fields if f.required},
        optional={f.field: kinds[f.type] for f in command.stdin_fields if not f.required},
    )


def regents(monkeypatch: pytest.MonkeyPatch, args: list[str], stdin: str) -> str:
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin))
    shown = io.StringIO()
    with contextlib.redirect_stdout(shown), contextlib.redirect_stderr(io.StringIO()):
        code = app.main([*args, "--json"])
    assert code == 0, shown.getvalue()
    return shown.getvalue()


SIGNED = [
    (PLATFORMS["ash-template"], "rooms post <room>"),
    (PLATFORMS["keyfleet"], "rooms sync <fleet>"),
    (PLATFORMS["keyfleet"], "polls vote <fleet> <poll> <choice>"),
]


@given(st.data())
@settings(
    deadline=None, max_examples=60, suppress_health_check=[HealthCheck.function_scoped_fixture]
)
def test_what_is_prepared_is_what_is_sent(
    signed_in: list[Request], monkeypatch: pytest.MonkeyPatch, data: st.DataObject
) -> None:
    platform, name = data.draw(st.sampled_from(SIGNED))
    [command] = [c for c in platform.commands if " ".join(c.words) == name]
    filled = {spec.name: str(data.draw(value_for(spec))) for spec in command.arguments}
    words = [filled[word[1:-1]] if word.startswith("<") else word for word in command.words]
    flags = [
        part
        for spec in command.flags
        if (value := data.draw(st.none() | value_for(spec))) is not None
        for part in (f"--{spec.name}", str(value))
    ]
    args = [platform.name, *words, *flags]
    stdin = json.dumps(data.draw(stdin_for(command)))
    signed_in.clear()

    ready = json.loads(regents(monkeypatch, [*args, "--phase", "prepare"], stdin))
    ready.pop("next_steps")
    regents(
        monkeypatch,
        [*args, "--phase", "send"],
        json.dumps({"request": ready, "signature": SIGNATURE}),
    )

    [sent] = signed_in
    body = ready["body"].encode("utf-8")
    assert sent.target == ready["path"]
    assert sent.content == body
    assert {k: v for k, v in sent.headers.items() if k in ready["headers"]} == ready["headers"]
    digest = base64.b64encode(hashlib.sha256(body).digest()).decode()
    assert sent.headers["content-digest"] == f"sha-256=:{digest}:"
    wire = httpx.Request(sent.method, platform.base_url + sent.target, content=body)
    assert wire.url.raw_path == sent.target.encode("ascii")
    assert wire.content == body
    # Each value lands whole in its own segment of the route's path.
    fields = {spec.field: filled[spec.name] for spec in command.arguments}
    route = command.path.split("/")
    segments = wire.url.raw_path.decode().split("?")[0].split("/")
    assert len(segments) == len(route)
    for part, segment in zip(route, segments, strict=True):
        assert unquote(segment) == fields[part[1:-1]] if part.startswith("{") else segment == part
    assert siwa.rebuild(sent, ready["headers"])[1] == ready["message"]


def click_command(words: list[str]) -> tuple[click.Command, list[str]]:
    """The command a typed line names, and the words left for it to read."""
    command: click.Command = ROOT
    at = 1
    while isinstance(command, click.Group):
        command = command.commands[words[at]]
        at += 1
    return command, words[at:]


@pytest.mark.parametrize(
    "pair", COMMANDS, ids=lambda pair: f"{pair[0].name} {' '.join(pair[1].words)}"
)
@given(data=st.data())
@settings(deadline=None, max_examples=10)
def test_a_printed_command_runs_the_same_request(
    pair: tuple[Platform, Command], data: st.DataObject
) -> None:
    platform, command = pair
    typed = {spec.name: data.draw(value_for(spec)) for spec in command.arguments}
    typed |= {
        spec.name: data.draw(value_for(spec) if spec.required else st.none() | value_for(spec))
        for spec in command.flags
    }
    printed = shlex.join(runner.command_line(platform, command, typed))
    parsed, rest = click_command(shlex.split(printed))
    read = parsed.make_context(parsed.name or "", rest).params
    again = {spec.name: read[spec.name.replace("-", "_")] for spec in command.inputs}
    assert runner.request_for(command, again) == runner.request_for(command, typed)
