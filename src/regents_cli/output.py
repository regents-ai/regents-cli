"""Readable output by default; --json prints exactly the answer for machines.

Every command tree shows what a person reads through the same few blocks: a summary of
fields, a table of records, a check list with one mark per check, a compact Markdown report,
text shown exactly as it is, the review a person reads before agreeing to something, and one
shape of failure. At a terminal they are styled; in a pipe they are plain text.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from markdown_it import MarkdownIt
from rich.console import Console, ConsoleOptions, Group, RenderableType, RenderResult
from rich.markdown import Markdown
from rich.padding import Padding
from rich.panel import Panel
from rich.segment import Segment
from rich.table import Table
from rich.text import Text

from regents_cli.errors import CommandError

stdout = Console(highlight=False)
stderr = Console(stderr=True, highlight=False)

TABLE_COLUMNS = 6
TABLE_CELL = 40

type CheckStatus = Literal["pass", "warn", "fail", "skip"]

MARKS: dict[CheckStatus, tuple[str, str]] = {
    "pass": ("✓", "bold green"),
    "warn": ("!", "bold yellow"),
    "fail": ("✗", "bold red"),
    "skip": ("-", "dim"),
}


@dataclass(frozen=True)
class Check:
    """One check as a person reads it: what was checked, how it came out, and what was found."""

    label: str
    status: CheckStatus
    detail: str


def emit(value: Any, *, as_json: bool, hint: str | None = None) -> None:
    """The answer: as JSON, or as a summary, table or check list read off its shape."""
    if as_json:
        sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
        return
    show(_renderable(value))
    if hint:
        stdout.print(Text(hint, style="dim"))


def emit_error(error: CommandError, *, as_json: bool) -> None:
    if as_json:
        sys.stdout.write(json.dumps(error.as_json(), ensure_ascii=False) + "\n")
        return
    stderr.print(_failure(error), crop=False)


def show(*blocks: RenderableType) -> None:
    """What a person reads, one blank line between blocks; a line shown as it is stays whole."""
    stdout.print(_spaced(blocks), crop=False)


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
    """What a person reads before they are asked to agree to something: one point per line,
    each marked, with a line that starts with spaces continuing the point before it."""
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
    fields = dict(error.fields)
    review_lines = fields.pop("review", None)
    if isinstance(review_lines, list):
        blocks.append(review(review_lines))
    if fields:
        blocks.append(_indented(_renderable(fields)))
    return Group(*blocks)


def _renderable(value: Any) -> RenderableType:
    if isinstance(value, dict):
        return _summary(value)
    if _is_checks(value):
        return checks(
            Check(row["check"], "pass" if row["ok"] else "fail", row["detail"]) for row in value
        )
    if _is_table(value):
        return _table(value)
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


def _table(rows: list[dict[str, Any]]) -> Table:
    columns = list(rows[0])
    table = Table(box=None, pad_edge=False, padding=(0, 2, 0, 0), header_style="bold")
    for column in columns:
        table.add_column(_label(column), overflow="fold")
    for row in rows:
        table.add_row(*(Text(_scalar(row[column])) for column in columns))
    return table


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
    return key.replace("_", " ")


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
    """The rows `regents <site> doctor` answers with: what was checked, whether it held, and why."""
    return (
        isinstance(value, list)
        and bool(value)
        and all(isinstance(row, dict) and set(row) == {"check", "ok", "detail"} for row in value)
    )


def _is_table(value: Any) -> bool:
    """Short flat records read best as a table; anything longer prints one block per record."""
    if not (isinstance(value, list) and value and all(isinstance(row, dict) for row in value)):
        return False
    keys = value[0].keys()
    return (
        len(keys) <= TABLE_COLUMNS
        and all(row.keys() == keys for row in value)
        and all(
            _is_scalar(v) and len(_scalar(v)) <= TABLE_CELL for row in value for v in row.values()
        )
    )


def _scalar(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, bool):
        return "yes" if value else "no"
    return str(value)
