"""What every Techtree command shares at the edge: the `--json` flag and how an answer prints."""

from __future__ import annotations

from collections.abc import Sequence

import click
from rich.console import RenderableType

from regents_cli import output
from regents_cli.techtree.identity.models import VerificationMessage
from regents_cli.techtree.models.base import JsonValue

JSON = click.Option(["--json", "as_json"], is_flag=True, help="Print the answer as JSON.")
BASE_URL = click.Option(
    ["--base-url"], metavar="URL", help="Techtree's address; also TECHTREE_BASE_URL."
)


def emit(
    answer: dict[str, JsonValue], *, as_json: bool, shown: Sequence[RenderableType] | None = None
) -> None:
    """The whole answer as JSON, or what a person reads: its `report` as Markdown, unless
    `shown` says the same thing in blocks better suited, such as a check list or a file as it is."""
    if as_json:
        output.emit(answer, as_json=True)
        return
    output.show(*(shown if shown is not None else [output.report(str(answer["report"]))]))


def warnings(messages: list[VerificationMessage]) -> list[JsonValue]:
    """Verification warnings in the answer's `warnings` shape."""
    return [{"id": message.code, "text": message.detail} for message in messages]
