"""`forge inspect-skill`: look at a Source Skill without running any of it, and record it.

The entries and their reasons come from the one Skill intake, `skills/scanner.py`. Here a file
is *required* when the Skill's instructions name it: SKILL.md, and every path SKILL.md or an
admitted file it names mentions, as a Markdown link target or as a bare path relative to the
Skill or to the mentioning file (a directory only with its trailing slash). A link to a file
that is not there, or outside the Skill, is a refusal. A required file that cannot be carried
refuses the whole Skill; an unsupported file nothing names is left out and listed. An admitted
source keeps exactly the bytes that were hashed under `skill/`.

SKILL.md's header is read with a deliberately small reader: top-level `key: value` lines with
plain or quoted values, and `metadata` as one level of indented `key: value` lines. Any other
YAML is refused with its line number. What the header declares, `allowed-tools` included,
grants nothing.
"""

from __future__ import annotations

import json
import posixpath
import re
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Final
from urllib.parse import unquote

from pydantic import ValidationError as ModelValidationError

from regents_cli.techtree.constants import MAX_SKILL_FILES, MAX_SKILL_TOTAL_BYTES
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.forge.models import (
    FORGE_SOURCE_SCHEMA_VERSION,
    ForgeRefusalReason,
    ForgeSkillDeclaration,
    ForgeSourceEntry,
    ForgeSourceRecord,
    ForgeSourceRefusal,
    ForgeSourceStatus,
)
from regents_cli.techtree.forge.records import read_record
from regents_cli.techtree.forge.skill import SKILL_DIRNAME
from regents_cli.techtree.fs import atomic_write_bytes, atomic_write_json
from regents_cli.techtree.ids import new_id
from regents_cli.techtree.manifests.builder import skill_content_digest
from regents_cli.techtree.models.skill import SKILL_ENTRY_FILE, SkillFile
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.skills.scanner import (
    UNSUPPORTED_WORDS,
    SkillEntry,
    inventory,
    resolve_skill_root,
)

SOURCE_FILENAME: Final = "source.json"

_TOKEN = re.compile(r"(?<![\w./-])(?:\./)?([\w.-]+(?:/[\w.-]+)*/?)")
_INLINE_LINK = re.compile(r"\]\(\s*<?([^)>\s]+)")
_REFERENCE_LINK = re.compile(r"^\s*\[[^\]]+\]:\s*<?(\S+?)>?\s*$", re.MULTILINE)
_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
_TOP_LEVEL = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$")
_NESTED = re.compile(r"^[ \t]+([A-Za-z0-9_.-]+):(?:[ \t]+(.*))?$")


def inspect_source_skill(paths: TechtreePaths, skill_path: Path) -> ForgeSourceStatus:
    """Inventory one Source Skill and write its record, admitted or refused."""
    try:
        root = resolve_skill_root(skill_path)
        entries = inventory(root)
    except ValidationError as error:
        raise ValidationError(
            error.message, code="forge_source_invalid", details=error.details
        ) from error
    by_path = {entry.path: entry for entry in entries}
    named, refusals = _required(entries, by_path)
    refusals += [
        _refusal(
            entry.path,
            "required_unsupported",
            f"{entry.path} is named by the Skill's instructions but "
            f"{UNSUPPORTED_WORDS[entry.reason]}",
        )
        for entry in entries
        if entry.path in named and entry.reason is not None
    ]
    entrypoint = by_path[SKILL_ENTRY_FILE]
    declaration = None
    if entrypoint.data is not None:
        declaration, problems = _declaration(entrypoint.data.decode(), root.name)
        refusals += problems
    admitted = [entry for entry in entries if entry.reason is None]
    refusals += _totals(admitted)
    admitted_files = [
        SkillFile(
            path=entry.path,
            media_type=str(entry.media_type),
            size=len(entry.data or b""),
            digest=str(entry.digest),
        )
        for entry in admitted
    ]
    source_id = new_id("forgesrc")
    directory = paths.forge_source_dir(source_id)
    record = ForgeSourceRecord(
        schema_version=FORGE_SOURCE_SCHEMA_VERSION,
        source_id=source_id,
        created_at=datetime.now(UTC),
        origin=str(root.absolute()),
        state="refused" if refusals else "admitted",
        declaration=declaration,
        entries=[
            ForgeSourceEntry(
                path=entry.path,
                kind=entry.kind,
                size=entry.size,
                digest=entry.digest,
                disposition="admitted" if entry.reason is None else "unsupported",
                reason=entry.reason,
                required=entry.path in named,
            )
            for entry in entries
        ],
        admitted_files=admitted_files,
        admitted_digest=skill_content_digest(admitted_files),
        refusals=refusals,
    )
    directory.mkdir(parents=True, mode=0o700)
    if record.state == "admitted":
        for entry in admitted:
            atomic_write_bytes(directory / SKILL_DIRNAME / entry.path, entry.data or b"")
    atomic_write_json(directory / SOURCE_FILENAME, record.model_dump(mode="json"))
    return _status(directory, record)


def read_source_status(paths: TechtreePaths, source_id: str) -> ForgeSourceStatus:
    """Read one inspected Source Skill's record back."""
    directory = paths.forge_source_dir(source_id)
    record = read_record(
        ForgeSourceRecord,
        directory / SOURCE_FILENAME,
        missing=f"no inspected Source Skill {source_id}",
        code="forge_source_not_found",
        details={"source_id": source_id, "path": str(directory)},
    )
    return _status(directory, record)


def _status(directory: Path, record: ForgeSourceRecord) -> ForgeSourceStatus:
    return ForgeSourceStatus(
        source_id=record.source_id,
        path=str(directory),
        snapshot_path=str(directory / SKILL_DIRNAME) if record.state == "admitted" else None,
        record=record,
    )


def _required(
    entries: list[SkillEntry], by_path: dict[str, SkillEntry]
) -> tuple[set[str], list[ForgeSourceRefusal]]:
    """Follow the names from SKILL.md through admitted text: every path named, and every
    link that leaves the Skill or names nothing in it."""
    directories = {
        parent.as_posix()
        for entry in entries
        for parent in PurePosixPath(entry.path).parents
        if parent.name
    } | {entry.path for entry in entries if entry.kind == "directory"}
    refusals: list[ForgeSourceRefusal] = []
    required = {SKILL_ENTRY_FILE}
    queue = [SKILL_ENTRY_FILE]
    while queue:
        current = by_path[queue.pop(0)]
        if current.data is None:
            continue
        text = current.data.decode("utf-8")
        named: set[str] = set()
        for target in _link_targets(text):
            resolved = _resolve_link(current.path, target)
            if resolved is None:
                refusals.append(
                    _refusal(
                        current.path,
                        "outside_reference",
                        f"{current.path} links to {target}, which is outside the Skill",
                    )
                )
            elif resolved in by_path or resolved in directories:
                named.add(resolved)
            elif resolved != ".":
                refusals.append(
                    _refusal(
                        current.path,
                        "missing_reference",
                        f"{current.path} links to {target}, which is not in the Skill",
                    )
                )
        base = posixpath.dirname(current.path)
        for token in _TOKEN.findall(text):
            for candidate in {token, posixpath.join(base, token)}:
                cleaned = posixpath.normpath(candidate.rstrip(".")) + (
                    "/" if candidate.endswith("/") else ""
                )
                if cleaned in by_path:
                    named.add(cleaned)
                elif cleaned.endswith("/") and cleaned[:-1] in directories:
                    named.add(cleaned[:-1])
        for name in sorted(named):
            under = (
                [name]
                if name in by_path
                else [entry.path for entry in entries if entry.path.startswith(f"{name}/")]
            )
            for path in under:
                if path not in required:
                    required.add(path)
                    queue.append(path)
    return required, refusals


def _link_targets(text: str) -> list[str]:
    return [
        target
        for target in [*_INLINE_LINK.findall(text), *_REFERENCE_LINK.findall(text)]
        if not _SCHEME.match(target) and not target.startswith(("#", "//"))
    ]


def _resolve_link(source: str, target: str) -> str | None:
    """The Skill-relative path a link names, or None when it leaves the Skill."""
    bare = unquote(target.split("#", 1)[0].split("?", 1)[0])
    if not bare:
        return "."
    if bare.startswith("/"):
        return None
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source), bare))
    if resolved == ".." or resolved.startswith("../"):
        return None
    return resolved


def _refusal(path: str, reason: ForgeRefusalReason, message: str) -> ForgeSourceRefusal:
    return ForgeSourceRefusal(path=path, reason=reason, message=message)


def _totals(admitted: list[SkillEntry]) -> list[ForgeSourceRefusal]:
    refusals: list[ForgeSourceRefusal] = []
    if len(admitted) > MAX_SKILL_FILES:
        refusals.append(
            _refusal(
                ".",
                "too_many_files",
                f"the Skill has {len(admitted)} files Techtree would carry, more "
                f"than the {MAX_SKILL_FILES} allowed",
            )
        )
    total = sum(len(entry.data or b"") for entry in admitted)
    if total > MAX_SKILL_TOTAL_BYTES:
        refusals.append(
            _refusal(
                ".",
                "too_many_bytes",
                f"the files Techtree would carry come to {total} bytes, more than "
                f"the {MAX_SKILL_TOTAL_BYTES} allowed",
            )
        )
    return refusals


def _declaration(
    text: str, directory_name: str
) -> tuple[ForgeSkillDeclaration | None, list[ForgeSourceRefusal]]:
    """Read the header the Agent Skills specification defines, or say why not."""
    try:
        fields, metadata = _header(text)
    except _HeaderError as error:
        return None, [_refusal(SKILL_ENTRY_FILE, "declaration", str(error))]
    allowed_tools = fields.pop("allowed-tools", "")
    try:
        declaration = ForgeSkillDeclaration(
            name=fields.pop("name", ""),
            description=fields.pop("description", ""),
            license=fields.pop("license", None),
            compatibility=fields.pop("compatibility", None),
            metadata=metadata,
            allowed_tools=allowed_tools.split(),
            other_fields=fields,
        )
    except ModelValidationError as error:
        issue = error.errors(include_input=False, include_url=False)[0]
        field = ".".join(str(part) for part in issue["loc"])
        return None, [
            _refusal(
                SKILL_ENTRY_FILE,
                "declaration",
                f"SKILL.md declares a {field} the Agent Skills specification does "
                f"not allow: {issue['msg']}",
            )
        ]
    if declaration.name != directory_name:
        return None, [
            _refusal(
                SKILL_ENTRY_FILE,
                "declaration",
                f"SKILL.md names the Skill {declaration.name} but its folder is "
                f"called {directory_name}, and the Agent Skills specification "
                f"requires them to match: rename the folder to {declaration.name}, "
                "or change the name in SKILL.md",
            )
        ]
    return declaration, []


class _HeaderError(Exception):
    """A header line Techtree does not read, said in words."""


def _header(text: str) -> tuple[dict[str, str], dict[str, str]]:
    lines = [line.removesuffix("\r") for line in text.split("\n")]
    if lines[0] != "---":
        raise _HeaderError("SKILL.md does not begin with a --- header")
    try:
        end = lines.index("---", 1)
    except ValueError as error:
        raise _HeaderError("SKILL.md's header has no closing ---") from error
    fields: dict[str, str] = {}
    metadata: dict[str, str] = {}
    in_metadata = False
    for number, line in enumerate(lines[1:end], start=2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        nested = _NESTED.match(line)
        if nested is not None:
            key, value = nested.group(1), nested.group(2)
            if not in_metadata:
                raise _HeaderError(
                    f"SKILL.md line {number} is indented outside metadata, YAML "
                    "Techtree does not read"
                )
            if value is None:
                raise _HeaderError(
                    f"SKILL.md line {number} nests another level under metadata; "
                    "each metadata entry is one key: value line"
                )
            _put(metadata, key, _scalar(value, number), number)
            continue
        top = _TOP_LEVEL.match(line)
        if top is None:
            raise _HeaderError(f"SKILL.md line {number} is not a key: value line Techtree reads")
        key, value = top.group(1), top.group(2)
        in_metadata = key == "metadata" and value is None
        if in_metadata:
            if "metadata" in fields:
                raise _HeaderError(f"SKILL.md line {number} repeats metadata")
            fields["metadata"] = ""
            continue
        if value is None:
            raise _HeaderError(
                f"SKILL.md line {number} gives {key} no value, or nested YAML "
                "Techtree does not read"
            )
        _put(fields, key, _scalar(value, number), number)
    fields.pop("metadata", None)
    return fields, metadata


def _put(target: dict[str, str], key: str, value: str, number: int) -> None:
    if key in target:
        raise _HeaderError(f"SKILL.md line {number} repeats {key}")
    target[key] = value


def _scalar(raw: str, number: int) -> str:
    value = raw.strip()
    if value.startswith('"'):
        try:
            parsed = json.loads(value)
        except ValueError:
            parsed = None
        if not isinstance(parsed, str):
            raise _HeaderError(
                f"SKILL.md line {number} has a double-quoted value Techtree cannot read"
            )
        return parsed
    if value.startswith("'"):
        inner = value[1:-1] if len(value) > 1 and value.endswith("'") else None
        if inner is None or "'" in inner.replace("''", ""):
            raise _HeaderError(
                f"SKILL.md line {number} has a single-quoted value Techtree cannot read"
            )
        return inner.replace("''", "'")
    if (
        value[:1] in set("&*!|>{[%@`,?:#")
        or value.startswith("- ")
        or ": " in value
        or " #" in value
        or value.endswith(":")
    ):
        raise _HeaderError(
            f"SKILL.md line {number} uses YAML Techtree does not read; quote the "
            "value to keep it as plain text"
        )
    return value
