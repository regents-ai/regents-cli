"""Each site's pinned command description (cli/commands.json, format regents.commands.v1).

scripts/sync_platforms.py copies them here from the commits in platforms.lock.json and
scripts/check_commands.py checks them, so they are read here without checking again.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from importlib.resources import files
from typing import Any, Final, Literal

type Authority = Literal["public", "wallet-proof"]
type Effect = Literal["read", "quote", "write", "prepare", "payment"]

#: The one command tree named apart from its site (founder, 2026-09-28): Regents' commands read
#: `regents protocol …` rather than `regents regents …`, and sign in to the site `regents`.
SIGN_IN_SITES: Final = {"protocol": "regents"}


@dataclass(frozen=True, slots=True)
class Input:
    name: str
    type: Literal["string", "integer", "decimal", "uuid", "address"]
    location: Literal["path", "query", "body"]
    field: str
    description: str
    required: bool
    enum: tuple[str, ...] | None
    minimum: int | None
    maximum: int | None

    @classmethod
    def parse(cls, raw: dict[str, Any], *, argument: bool) -> Input:
        return cls(
            name=raw["name"],
            type=raw["type"],
            location=raw["in"],
            field=raw["field"],
            description=raw["description"],
            required=argument or raw.get("required", False),
            enum=tuple(raw["enum"]) if "enum" in raw else None,
            minimum=raw.get("minimum"),
            maximum=raw.get("maximum"),
        )


@dataclass(frozen=True, slots=True)
class StdinField:
    field: str
    type: Literal["object", "string"]
    required: bool
    description: str


@dataclass(frozen=True, slots=True)
class Pagination:
    has_more: str
    cursor: str
    flag: str


@dataclass(frozen=True, slots=True)
class Command:
    words: tuple[str, ...]
    description: str
    operation_id: str
    method: str
    path: str
    authority: Authority
    effect: Effect
    arguments: tuple[Input, ...]
    flags: tuple[Input, ...]
    required_one_of: tuple[str, ...]
    body: dict[str, Any] | None
    stdin_fields: tuple[StdinField, ...]
    pagination: Pagination | None

    @property
    def group_words(self) -> tuple[str, ...]:
        """The command's words before its name, arguments left out."""
        return tuple(w for w in self.words if not w.startswith("<"))[:-1]

    @property
    def name(self) -> str:
        return next(w for w in reversed(self.words) if not w.startswith("<"))

    @property
    def inputs(self) -> tuple[Input, ...]:
        return self.arguments + self.flags

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> Command:
        pagination = raw.get("pagination")
        return cls(
            words=tuple(raw["command"].split(" ")),
            description=raw["description"],
            operation_id=raw["operation_id"],
            method=raw["method"],
            path=raw["path"],
            authority=raw["authority"],
            effect=raw["effect"],
            arguments=tuple(Input.parse(a, argument=True) for a in raw.get("arguments", [])),
            flags=tuple(Input.parse(f, argument=False) for f in raw.get("flags", [])),
            required_one_of=tuple(raw.get("required_one_of", [])),
            body=raw.get("body"),
            stdin_fields=tuple(StdinField(**s) for s in raw.get("stdin_fields", [])),
            pagination=Pagination(**pagination) if pagination else None,
        )


@dataclass(frozen=True, slots=True)
class Platform:
    name: str
    base_url: str
    notes: tuple[str, ...]
    commands: tuple[Command, ...]

    @property
    def site(self) -> str:
        """The site this command tree signs in to."""
        return SIGN_IN_SITES.get(self.name, self.name)

    @property
    def env_var(self) -> str:
        return f"{self.name.upper().replace('-', '_')}_BASE_URL"

    @classmethod
    def parse(cls, raw: dict[str, Any]) -> Platform:
        return cls(
            name=raw["platform"],
            base_url=raw["base_url"],
            notes=tuple(raw.get("notes", [])),
            commands=tuple(Command.parse(c) for c in raw["commands"]),
        )


def pinned_platforms() -> list[Platform]:
    """Every site whose pinned files include a commands.json, by name."""
    found = []
    for entry in files(__name__).iterdir():
        description = entry / "commands.json"
        if entry.is_dir() and description.is_file():
            found.append(Platform.parse(json.loads(description.read_text("utf-8"))))
    return sorted(found, key=lambda platform: platform.name)
