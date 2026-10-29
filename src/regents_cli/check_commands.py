"""Check site command descriptions against the format and the site's own OpenAPI documents.

    python -m regents_cli.check_commands
        every pinned platforms/<name>/commands.json, with the documents pinned beside it
    python -m regents_cli.check_commands <commands.json> <openapi file>...
        one site's description, for the site's own `make check-cli`

A site runs it at a pinned regents-cli commit, with nothing checked out:

    uv run --no-project \\
        --with "regents-cli[check] @ git+https://github.com/regents-ai/regents-cli@<commit>" \\
        python -m regents_cli.check_commands cli/commands.json <openapi.json>
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from collections.abc import Set
from importlib.resources import files
from pathlib import Path
from typing import Any, NamedTuple

import yaml
from jsonschema import Draft202012Validator

SHARED_FLAGS = frozenset({"json", "help", "version", "base-url", "timeout-ms", "phase"})
METHODS = ("get", "put", "post", "patch", "delete")


def read_document(path: Path) -> Any:
    text = path.read_text("utf-8")
    return json.loads(text) if path.suffix == ".json" else yaml.safe_load(text)


def is_json(kind: str) -> bool:
    media = kind.split(";")[0].strip().lower()
    return media == "application/json" or (
        media.startswith("application/") and media.endswith("+json")
    )


def answers_json(document: Any, operation: dict[str, Any]) -> bool:
    shared = (document.get("components") or {}).get("responses") or {}
    for code, response in (operation.get("responses") or {}).items():
        if str(code).startswith("2"):
            name = response.get("$ref", "").removeprefix("#/components/responses/")
            content = (shared.get(name, {}) if name else response).get("content") or {}
            if str(code) == "204" and content:
                return False
            if not all(map(is_json, content)):
                return False
    return True


class Body(NamedTuple):
    """The fields an operation's JSON request body names, and those it requires. `fields` is
    None when the body is not one set of named fields: oneOf, anyOf, or an open object that
    names none."""

    fields: frozenset[str] | None
    required: frozenset[str]


class Operation(NamedTuple):
    method: str
    route: str
    answers_json: bool
    body: Body | None  # None: the operation takes no request body


def followed(document: Any, node: Any) -> Any:
    """`node`, or what its local `$ref` points to in `document`, followed to the end."""
    seen = set()
    while "$ref" in node:
        reference = node["$ref"]
        if reference in seen:
            raise ValueError(f"$ref {reference} leads back to itself")
        seen.add(reference)
        node = document
        for part in reference.removeprefix("#/").split("/"):
            node = node[part.replace("~1", "/").replace("~0", "~")]
    return node


def body_named_in(document: Any, schema: Any, *, in_all_of: bool = False) -> Body:
    """The named fields of one request-body schema, `allOf` parts merged."""
    schema = followed(document, schema)
    required = set(schema.get("required") or [])
    fields = set(schema.get("properties") or {})
    known = "oneOf" not in schema and "anyOf" not in schema
    for part in schema.get("allOf", []):
        inner = body_named_in(document, part, in_all_of=True)
        if inner.fields is None:
            known = False
        else:
            fields |= inner.fields
        required |= inner.required
    closed = schema.get("additionalProperties") is False or schema.get("maxProperties") == 0
    named = frozenset(fields) if known and (fields or closed or in_all_of) else None
    return Body(named, frozenset(required))


def request_body(document: Any, operation: dict[str, Any]) -> Body | None:
    if "requestBody" not in operation:
        return None
    content = followed(document, operation["requestBody"]).get("content") or {}
    schemas = [
        kind["schema"] for media, kind in content.items() if is_json(media) and "schema" in kind
    ]
    if len(schemas) != 1:
        return Body(None, frozenset())
    return body_named_in(document, schemas[0])


def operations_in(documents: list[Any]) -> dict[str, Operation]:
    found = {}
    for document in documents:
        for route, item in (document.get("paths") or {}).items():
            for method in METHODS:
                operation = (item or {}).get(method) or {}
                if "operationId" in operation:
                    found[operation["operationId"]] = Operation(
                        method.upper(),
                        route,
                        answers_json(document, operation),
                        request_body(document, operation),
                    )
    return found


def body_problems(entry: dict[str, Any], body: Body | None) -> list[str]:
    """Where the body this command sends differs from its operation's request body."""
    inputs = [i for i in entry.get("arguments", []) + entry.get("flags", []) if i["in"] == "body"]
    stdin = entry.get("stdin_fields", [])
    fixed = set(entry.get("body", {}))
    sent = {i["field"] for i in inputs} | {f["field"] for f in stdin} | fixed
    always = (
        {i["field"] for i in entry.get("arguments", []) if i["in"] == "body"}
        | {i["field"] for i in entry.get("flags", []) if i["in"] == "body" and i.get("required")}
        | {f["field"] for f in stdin if f.get("required")}
    )
    operation = entry["operation_id"]
    if body is None:
        return [f"sends {named(sent)}, but operation {operation} takes no body"] if sent else []
    problems = []
    if body.fields is not None and (unknown := sent - body.fields):
        problems.append(f"sends {named(unknown)}, which operation {operation}'s body does not name")
    if optional := body.required - always - fixed:
        problems.append(f"operation {operation} requires {named(optional)}, which it may leave out")
    return problems


def named(fields: Set[str]) -> str:
    return ", ".join(sorted(fields))


def problems_in(description: Any, operations: dict[str, Operation]) -> list[str]:
    schema = json.loads(
        files("regents_cli.schemas").joinpath("commands.v1.json").read_text("utf-8")
    )
    errors = sorted(Draft202012Validator(schema).iter_errors(description), key=lambda e: e.path)
    if errors:
        return [f"/{'/'.join(map(str, e.absolute_path))} {e.message}" for e in errors]

    problems = []
    shapes = Counter(re.sub(r"<[^>]+>", "<>", c["command"]) for c in description["commands"])
    problems += [f'two commands have the shape "{shape}"' for shape, n in shapes.items() if n > 1]

    described = {c["command"]: c for c in description["commands"]}
    for entry in description["commands"]:

        def say(message: str, entry: dict[str, Any] = entry) -> None:
            problems.append(f"{entry['command']}: {message}")

        args = entry.get("arguments", [])
        flags = entry.get("flags", [])
        flag_names = [f["name"] for f in flags]
        inputs = args + flags

        placeholders = [w[1:-1] for w in entry["command"].split(" ") if w.startswith("<")]
        if placeholders != [a["name"] for a in args]:
            say("arguments must match the <words> in the command, in order")
        for name, n in Counter(i["name"] for i in inputs).items():
            if n > 1:
                say(f"input {name} is listed twice")
        if entry["command"].split(" ")[0] == "doctor":
            say("doctor is regents' own command for every site")
        for name in flag_names:
            if name in SHARED_FLAGS:
                say(f"--{name} is a shared flag")

        path_fields = sorted(i["field"] for i in inputs if i["in"] == "path")
        if path_fields != sorted(re.findall(r"\{([^}]+)\}", entry["path"])):
            say(
                f"path inputs ({', '.join(path_fields) or 'none'}) "
                f"must fill exactly {entry['path']}"
            )
        for i in inputs:
            if "enum" in i and i["type"] != "string":
                say(f"{i['name']}: only string inputs take enum")
            if ("minimum" in i or "maximum" in i) and i["type"] != "integer":
                say(f"{i['name']}: only integer inputs take minimum and maximum")

        fills_body = any(i["in"] == "body" for i in inputs) or "stdin_fields" in entry
        empty_signed_body = entry.get("body") == {} and entry["authority"] != "public"
        if entry["method"] in ("GET", "DELETE") and (
            fills_body or ("body" in entry and not empty_signed_body)
        ):
            say(
                f"{entry['method']} sends no body, except an empty signed one: "
                "body {} on a signed command"
            )
        if "stdin_fields" in entry and entry["authority"] == "public":
            say("only signed commands read body fields from stdin")
        if "conditions" in entry and entry["authority"] != "paired_agent":
            say("only paired_agent commands take conditions")
        for name in entry.get("required_one_of", []):
            if name not in flag_names:
                say(f"required_one_of names --{name}, which is not a flag")
        pagination = entry.get("pagination")
        if pagination and pagination["flag"] not in flag_names:
            say(f"pagination passes the cursor as --{pagination['flag']}, which is not a flag")

        for step in entry.get("next_steps", []):
            if step["kind"] == "done" and "url" in step:
                say("next_steps: only a human step names a url")
            if step["kind"] != "run":
                continue
            target = described.get(step["command"])
            if target is None:
                say(f"next_steps runs {step['command']}, which is not one of its commands")
                continue
            words = [w[1:-1] for w in step["command"].split(" ") if w.startswith("<")]
            filled = step.get("arguments", {})
            own = {a["name"] for a in entry.get("arguments", [])}
            if not set(filled) <= set(words) or not set(words) - set(filled) <= own:
                say(
                    f"next_steps: arguments and this command's own arguments must fill exactly "
                    f"the <words> of {step['command']}"
                )
            if target.get("required_one_of") or any(
                f.get("required") for f in target.get("flags", [])
            ):
                say(f"next_steps runs {step['command']}, which needs flags a step can't fill")

        operation = operations.get(entry["operation_id"])
        if operation is None:
            say(f"operation {entry['operation_id']} is not in the site's OpenAPI documents")
        elif (operation.method, operation.route) != (entry["method"], entry["path"]):
            say(
                f"operation {entry['operation_id']} is {operation.method} {operation.route}, "
                f"not {entry['method']} {entry['path']}"
            )
        elif not operation.answers_json:
            say(
                f"operation {entry['operation_id']} does not answer JSON or an empty 204 on success"
            )
        else:
            for problem in body_problems(entry, operation.body):
                say(problem)
    return problems


def pinned_sites() -> list[tuple[Path, list[Path]]]:
    root = Path(str(files("regents_cli.platforms")))
    return [
        (folder / "commands.json", sorted(p for p in folder.iterdir() if p.name != "commands.json"))
        for folder in sorted(root.iterdir())
        if (folder / "commands.json").is_file()
    ]


def main(args: list[str]) -> int:
    sites = [(Path(args[0]), [Path(a) for a in args[1:]])] if args else pinned_sites()
    failed = False
    for commands, documents in sites:
        problems = problems_in(
            read_document(commands), operations_in(list(map(read_document, documents)))
        )
        if problems:
            failed = True
            print(f"{commands}:\n  " + "\n  ".join(problems), file=sys.stderr)
        else:
            print(f"{commands}: ok")
    if not sites:
        print("No pinned site describes its commands yet.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
