"""Readable output by default; --json prints exactly the answer for machines."""

from __future__ import annotations

import json
import sys
from typing import Any

from rich.console import Console
from rich.padding import Padding
from rich.table import Table
from rich.text import Text

from regents_cli.errors import CommandError

stdout = Console(highlight=False, soft_wrap=True)
stderr = Console(stderr=True, highlight=False, soft_wrap=True)

TABLE_COLUMNS = 6
TABLE_CELL = 40


def emit(value: Any, *, as_json: bool, hint: str | None = None) -> None:
    if as_json:
        sys.stdout.write(json.dumps(value, ensure_ascii=False) + "\n")
        return
    _render(value, indent=0)
    if hint:
        stdout.print(Text(hint, style="dim"))


def emit_error(error: CommandError, *, as_json: bool) -> None:
    if as_json:
        sys.stdout.write(json.dumps(error.as_json(), ensure_ascii=False) + "\n")
        return
    stderr.print(Text.assemble(("error ", "bold red"), (error.code, "red"), f"  {error.message}"))
    for key, value in error.fields.items():
        stderr.print(Text(f"  {key}  {_scalar(value)}", style="dim"))


def _render(value: Any, *, indent: int) -> None:
    pad = " " * indent
    if isinstance(value, dict):
        inline = [k for k, v in value.items() if _is_inline(v)]
        width = max((len(k) for k in inline), default=0)
        for key, item in value.items():
            if key in inline:
                lines = _inline(item).split("\n")
                stdout.print(Text.assemble(pad, (key.ljust(width), "bold"), "  ", lines[0]))
                for line in lines[1:]:
                    stdout.print(Text(" " * (indent + width + 2) + line))
            else:
                stdout.print(Text.assemble(pad, (key, "bold cyan")))
                _render(item, indent=indent + 2)
    elif _is_table(value):
        columns = list(value[0])
        table = Table(box=None, pad_edge=False, padding=(0, 2, 0, 0))
        for column in columns:
            table.add_column(column, style="bold" if column == columns[0] else None)
        for row in value:
            table.add_row(*(_scalar(row.get(c)) for c in columns))
        stdout.print(Padding(table, (0, 0, 0, indent)))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            if index:
                stdout.print()
            _render(item, indent=indent)
    else:
        stdout.print(Text(pad + _scalar(value)))


def _is_scalar(value: Any) -> bool:
    return value is None or isinstance(value, str | int | float | bool)


def _is_inline(value: Any) -> bool:
    return (
        _is_scalar(value)
        or value == {}
        or (isinstance(value, list) and all(_is_scalar(v) for v in value))
    )


def _inline(value: Any) -> str:
    if isinstance(value, list | dict):
        return ", ".join(_scalar(v) for v in value) or "none"
    return _scalar(value)


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
