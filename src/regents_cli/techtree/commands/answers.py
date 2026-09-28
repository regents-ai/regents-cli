"""What every Techtree command shares at the edge: the `--json` flag and how an answer prints."""

from __future__ import annotations

import click

from regents_cli import output
from regents_cli.techtree.identity.models import VerificationMessage
from regents_cli.techtree.models.base import JsonValue

JSON = click.Option(["--json", "as_json"], is_flag=True, help="Print the answer as JSON.")


def emit(answer: dict[str, JsonValue], *, as_json: bool) -> None:
    """The whole answer as JSON, or its `report` Markdown for a person."""
    if as_json:
        output.emit(answer, as_json=True)
        return
    output.stdout.print(str(answer["report"]), markup=False)


def warnings(messages: list[VerificationMessage]) -> list[JsonValue]:
    """Verification warnings in the answer's `warnings` shape."""
    return [{"id": message.code, "text": message.detail} for message in messages]
