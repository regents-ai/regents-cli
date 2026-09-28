"""Check site command descriptions against the format and the site's own OpenAPI documents.

    python -m regents_cli.check_commands
        every pinned platforms/<name>/commands.json, with the documents pinned beside it
    python -m regents_cli.check_commands <commands.json> <openapi file>...
        one site's description, for the site's own `make check-cli`

A site runs it at a pinned regents-cli commit, with nothing checked out:

    uv run --no-project \\
        --with "regents-cli[check] @ git+https://github.com/regents-ai/regents-cli@<commit>" \\
        python -m regents_cli.check_commands cli/commands.json platform/priv/static/openapi.json
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from importlib.resources import files
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

SHARED_FLAGS = frozenset({"json", "help", "version", "base-url", "timeout-ms", "phase"})
METHODS = ("get", "put", "post", "patch", "delete")


def read_document(path: Path) -> Any:
    text = path.read_text("utf-8")
    return json.loads(text) if path.suffix == ".json" else yaml.safe_load(text)


def operations_in(documents: list[Any]) -> dict[str, tuple[str, str]]:
    found = {}
    for document in documents:
        for route, item in (document.get("paths") or {}).items():
            for method in METHODS:
                operation = (item or {}).get(method) or {}
                if "operationId" in operation:
                    found[operation["operationId"]] = (method.upper(), route)
    return found


def problems_in(description: Any, operations: dict[str, tuple[str, str]]) -> list[str]:
    schema = json.loads(
        files("regents_cli.schemas").joinpath("commands.v1.json").read_text("utf-8")
    )
    errors = sorted(Draft202012Validator(schema).iter_errors(description), key=lambda e: e.path)
    if errors:
        return [f"/{'/'.join(map(str, e.absolute_path))} {e.message}" for e in errors]

    problems = []
    shapes = Counter(re.sub(r"<[^>]+>", "<>", c["command"]) for c in description["commands"])
    problems += [f'two commands have the shape "{shape}"' for shape, n in shapes.items() if n > 1]

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

        sends_body = (
            any(i["in"] == "body" for i in inputs) or "body" in entry or "stdin_fields" in entry
        )
        if sends_body and entry["method"] in ("GET", "DELETE"):
            say(f"{entry['method']} sends no body")
        if "stdin_fields" in entry and entry["authority"] != "wallet-proof":
            say("only wallet-proof commands read body fields from stdin")
        for name in entry.get("required_one_of", []):
            if name not in flag_names:
                say(f"required_one_of names --{name}, which is not a flag")
        pagination = entry.get("pagination")
        if pagination and pagination["flag"] not in flag_names:
            say(f"pagination passes the cursor as --{pagination['flag']}, which is not a flag")

        operation = operations.get(entry["operation_id"])
        if operation is None:
            say(f"operation {entry['operation_id']} is not in the site's OpenAPI documents")
        elif operation != (entry["method"], entry["path"]):
            say(
                f"operation {entry['operation_id']} is {' '.join(operation)}, "
                f"not {entry['method']} {entry['path']}"
            )
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
