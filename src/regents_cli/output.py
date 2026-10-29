"""Readable output by default; --json prints exactly the answer for machines.

Every command tree shows what a person reads through the same few blocks: a summary of
fields, a table of records, a check list with one mark per check, a compact Markdown report,
text shown exactly as it is, the review a person reads before agreeing to something, and one
shape of failure. Every answer and every failure ends with what to do next (`next_steps`).
At a terminal they are styled; in a pipe they are plain text. Readable output shows a site's
times in this computer's time zone, leaves a record's links to others (`*_id` beside its own `id`)
to --json and names headings in words.
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from markdown_it import MarkdownIt
from rich.cells import cell_len
from rich.console import Console, ConsoleOptions, Group, RenderableType, RenderResult
from rich.markdown import Markdown
from rich.padding import Padding
from rich.panel import Panel
from rich.segment import Segment
from rich.table import Table
from rich.text import Text

from regents_cli.errors import CommandError
from regents_cli.next_steps import Kind, Step

stdout = Console(highlight=False)
stderr = Console(stderr=True, highlight=False)

#: Words in a site's field names that read differently on screen; a trailing "at" is dropped, so
#: inserted_at reads "Added" and last_seen_at reads "Last seen".
WORDS = {
    "inserted": "added",
    "id": "ID",
    "url": "URL",
    "ens": "ENS",
    "usdc": "USDC",
    "eth": "ETH",
}

#: A moment as sites send it, such as 2026-10-29T05:31:07.123456Z; shown as the reader's local time.
MOMENT = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})")

type CheckStatus = Literal["pass", "warn", "fail", "skip"]

MARKS: dict[CheckStatus, tuple[str, str]] = {
    "pass": ("✓", "bold green"),
    "warn": ("!", "bold yellow"),
    "fail": ("✗", "bold red"),
    "skip": ("-", "dim"),
}

STEP_MARKS: dict[Kind, tuple[str, str]] = {
    "done": ("✓", "bold green"),
    "run": ("→", "bold cyan"),
    "human": ("!", "bold yellow"),
    "wallet": ("◆", "bold blue"),
    "patchbay": ("↗", "bold magenta"),
}


@dataclass(frozen=True)
class Check:
    """One check as a person reads it: what was checked, how it came out, and what was found."""

    label: str
    status: CheckStatus
    detail: str


def emit(
    value: dict[str, Any],
    *,
    as_json: bool,
    next_steps: Sequence[Step],
    shown: Sequence[RenderableType] | None = None,
) -> None:
    """The answer and what to do next: as JSON, with `next_steps` beside the answer's fields,
    or as blocks read off the answer's shape (or `shown`, when that says it better) and a Next
    block."""
    if not next_steps:
        raise ValueError("Every answer says what to do next.")
    if as_json:
        steps = [step.as_json() for step in next_steps]
        sys.stdout.write(json.dumps({**value, "next_steps": steps}, ensure_ascii=False) + "\n")
        return
    show(*(shown if shown is not None else [_renderable(value)]), _next(next_steps))


def emit_error(error: CommandError, next_steps: Sequence[Step], *, as_json: bool) -> None:
    """The failure and what to do about it, with `next_steps` beside `error` in JSON."""
    if as_json:
        steps = [step.as_json() for step in next_steps]
        sys.stdout.write(
            json.dumps({**error.as_json(), "next_steps": steps}, ensure_ascii=False) + "\n"
        )
        return
    _print(stderr, _spaced([_failure(error), _next(next_steps)]))


def show(*blocks: RenderableType) -> None:
    """What a person reads, one blank line between blocks; a line shown as it is stays whole."""
    _print(stdout, _spaced(blocks))


def _print(console: Console, block: RenderableType) -> None:
    """Printed whole. In a pipe each line ends at its last character, not padded with spaces to
    the width, which agents and diffs would read as part of the answer."""
    if console.is_terminal:
        console.print(block, crop=False)
        return
    with console.capture() as captured:
        console.print(block, crop=False)
    console.file.write("".join(line.rstrip() + "\n" for line in captured.get().splitlines()))


def report(markdown: str) -> RenderableType:
    """A compact Markdown report, laid out for the terminal."""
    return _Report(markdown)


def checks(items: Iterable[Check]) -> RenderableType:
    grid = Table.grid(padding=(0, 1))
    grid.add_column(no_wrap=True)
    grid.add_column(style="bold", no_wrap=True)
    grid.add_column(overflow="fold")
    for item in items:
        mark, style = MARKS[item.status]
        grid.add_row(Text(mark, style=style), Text(item.label), Text(item.detail))
    return grid


def verbatim(text: str) -> RenderableType:
    """Text shown exactly as it is, such as log lines or a file: never wrapped or cropped."""
    return Text(text, no_wrap=True, overflow="ignore")


def review(lines: Sequence[str]) -> RenderableType:
    """What a person reads before they agree to something, or before the agent key signs it: one
    point per line, each marked, with a line that starts with spaces continuing the point before."""
    grid = Table.grid(padding=(0, 1))
    grid.add_column(no_wrap=True)
    grid.add_column(overflow="fold")
    for line in lines:
        grid.add_row(Text("•" if line and not line[0].isspace() else ""), Text(line))
    return Panel(grid, title="Review", title_align="left", border_style="yellow", padding=(0, 1))


class _Report(Markdown):
    """Rich's Markdown with HTML switched off, so `<path to SKILL.md>` shows as written, and
    without the blank line Rich puts before a report that opens with a list."""

    def __init__(self, text: str) -> None:
        super().__init__(text, justify="default")
        parser = MarkdownIt("commonmark", {"html": False}).enable("strikethrough").enable("table")
        self.parsed = parser.parse(text)

    def __rich_console__(self, console: Console, options: ConsoleOptions) -> RenderResult:
        segments = iter(super().__rich_console__(console, options))
        first = next(segments, None)
        if first is None:
            return
        if not (isinstance(first, Segment) and first.text == "\n"):
            yield first
        yield from segments


def _failure(error: CommandError) -> RenderableType:
    blocks: list[RenderableType] = [
        Text.assemble(("✗ ", "bold red"), (error.message, "bold")),
        Text("  " + error.code, style="dim"),
    ]
    if error.review:
        blocks.append(review(error.review))
    if error.fields:
        blocks.append(_indented(_renderable(error.fields)))
    return Group(*blocks)


def _next(steps: Sequence[Step]) -> RenderableType:
    """One line per step, marked by its kind; a command or address on its own line, whole, so
    it can be copied as it is."""
    lines: list[RenderableType] = [Text("Next", style="bold")]
    for step in steps:
        mark, style = STEP_MARKS[step.kind]
        said = Table.grid(padding=(0, 1))
        said.add_column(no_wrap=True)
        said.add_column()
        said.add_row(Text(mark, style=style), Text(step.say))
        lines.append(Padding(said, (0, 0, 0, 2)))
        for exact in (step.command, step.url):
            if exact is not None:
                lines.append(Text("    " + exact, style="cyan", no_wrap=True, overflow="ignore"))
    return Group(*lines)


def _renderable(value: Any) -> RenderableType:
    if isinstance(value, dict):
        return _summary(value)
    if _is_checks(value):
        return checks(
            Check(row["check"], "pass" if row["ok"] else "fail", row["detail"]) for row in value
        )
    if _is_table(value):
        return _Records(value)
    if isinstance(value, list):
        blocks: list[RenderableType] = []
        for index, item in enumerate(value):
            if index and not _is_scalar(item):
                blocks.append(Text())
            blocks.append(_renderable(item))
        return Group(*blocks)
    return Text(_scalar(value))


def _summary(fields: dict[str, Any]) -> RenderableType:
    """Fields in the order given: a label and value per line, a nested block for a structure."""
    blocks: list[RenderableType] = []
    grid: Table | None = None
    for key, item in fields.items():
        if _is_inline(item):
            if grid is None:
                grid = Table.grid(padding=(0, 2))
                grid.add_column(style="bold", no_wrap=True)
                grid.add_column(overflow="fold")
                blocks.append(grid)
            grid.add_row(Text(_label(key)), Text(_inline(item)))
        else:
            grid = None
            blocks.append(Text(_label(key), style="bold"))
            blocks.append(_indented(_renderable(item)))
    return Group(*blocks)


class _Records:
    """Flat records of one shape: a table when every shown column fits the width it is drawn in
    at its widest, or else one block of fields per record. A table leaves the columns that link to
    other records (`*_id`) to --json when each record has its own `id`, and says so in one line
    under it."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def __rich_console__(self, console: Console, options: ConsoleOptions) -> RenderResult:
        columns = _shown_columns(self.rows[0])
        widths = [
            max(cell_len(_label(column)), *(cell_len(_scalar(row[column])) for row in self.rows))
            for column in columns
        ]
        if sum(widths) + 2 * (len(widths) - 1) > options.max_width:
            blocks: list[RenderableType] = []
            for index, row in enumerate(self.rows):
                if index:
                    blocks.append(Text())
                blocks.append(_summary(row))
            yield Group(*blocks)
            return
        table = Table(box=None, pad_edge=False, padding=(0, 2, 0, 0), header_style="bold")
        for column in columns:
            table.add_column(_label(column), no_wrap=True)
        for row in self.rows:
            table.add_row(*(Text(_scalar(row[column])) for column in columns))
        yield table
        if len(columns) < len(self.rows[0]):
            yield Text("Add --json for the ID columns.", style="dim")


def _shown_columns(row: dict[str, Any]) -> list[str]:
    """Every column, less the links to other records when the record has its own `id` to pick it
    by; without one, a link such as `thread_id` is the only handle for the next command."""
    if "id" not in row:
        return list(row)
    return [column for column in row if not column.endswith("_id")]


def _spaced(blocks: Sequence[RenderableType]) -> Group:
    """The blocks with a blank line between them."""
    separated: list[RenderableType] = []
    for index, block in enumerate(blocks):
        if index:
            separated.append(Text())
        separated.append(block)
    return Group(*separated)


def _indented(block: RenderableType) -> RenderableType:
    return Padding(block, (0, 0, 0, 2), expand=False)


def _label(key: str) -> str:
    """A field's name in plain words: response_to_id reads "Response to ID"."""
    words = key.split("_")
    if len(words) > 1 and words[-1] == "at":
        words.pop()
    line = " ".join(WORDS.get(word, word) for word in words)
    return line[:1].upper() + line[1:]


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, str | int | float | bool)


def _is_inline(value: Any) -> bool:
    """Scalars, and lists of scalars with no spaces in them; sentences get a line each."""
    return (
        _is_scalar(value)
        or value == {}
        or (isinstance(value, list) and all(_is_scalar(v) and " " not in _scalar(v) for v in value))
    )


def _inline(value: Any) -> str:
    if isinstance(value, list | dict):
        return ", ".join(_scalar(v) for v in value) or "none"
    return _scalar(value)


def _is_checks(value: Any) -> bool:
    """The rows `regents <site> doctor` answers with: what was checked, whether it held, its
    code, the exit code of one that failed, and what it found."""
    held = {"check", "ok", "code", "detail"}
    return (
        isinstance(value, list)
        and bool(value)
        and all(
            isinstance(row, dict)
            and set(row) == (held if row.get("ok") is True else held | {"exit_code"})
            for row in value
        )
    )


def _is_table(value: Any) -> bool:
    """Flat records of one shape, which read best as a table when they fit."""
    if not (isinstance(value, list) and value and all(isinstance(row, dict) for row in value)):
        return False
    keys = value[0].keys()
    return (
        bool(_shown_columns(value[0]))
        and all(row.keys() == keys for row in value)
        and all(_is_scalar(v) for row in value for v in row.values())
    )


def _scalar(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, str) and MOMENT.fullmatch(value):
        return _local_time(value)
    return str(value)


def _local_time(moment: str) -> str:
    """29 Oct 05:31 in the reader's own time zone, with the year when it is not this one."""
    try:
        local = datetime.fromisoformat(moment).astimezone()
    except ValueError:
        return moment
    year = "" if local.year == datetime.now().astimezone().year else f" {local.year}"
    return f"{local.day} {local:%b}{year} {local:%H:%M}"
