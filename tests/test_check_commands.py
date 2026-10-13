"""A command's body must be the one its OpenAPI operation takes: a field the site does not name,
a field the site takes that nothing sends, or a required field the command may leave out, is
caught by the site's own `make check-cli` instead of by an agent whose signed request the site
then refuses."""

from __future__ import annotations

from typing import Any

import pytest

from regents_cli.check_commands import followed, operations_in, problems_in

OPENAPI = {
    "openapi": "3.1.0",
    "paths": {
        "/notes": {
            "post": {
                "operationId": "createNote",
                "requestBody": {
                    "content": {
                        "application/json": {"schema": {"$ref": "#/components/schemas/New"}}
                    }
                },
                "responses": {"201": {"content": {"application/json": {}}}},
            }
        }
    },
    "components": {
        "schemas": {
            "New": {
                "allOf": [
                    {"type": "object", "properties": {"text": {}}, "required": ["text"]},
                    {"type": "object", "properties": {"pinned": {}}},
                ]
            }
        }
    },
}


def described(**changes: Any) -> dict[str, Any]:
    command = {
        "command": "notes create",
        "description": "Write a note.",
        "operation_id": "createNote",
        "method": "POST",
        "path": "/notes",
        "authority": "signed_agent",
        "effect": "write",
        "stdin_fields": [
            {"field": "text", "type": "string", "required": True, "description": "The note."},
            {"field": "pinned", "type": "string", "description": "Pin it."},
        ],
    }
    return {
        "format": "regents.commands.v1",
        "platform": "notes",
        "base_url": "https://notes.example",
        "commands": [command | changes],
    }


@pytest.mark.parametrize(
    ("changes", "problem"),
    [
        ({}, None),
        (
            {"body": {"colour": "red"}},
            "sends colour, which operation createNote's body does not name",
        ),
        (
            {
                "stdin_fields": [
                    {
                        "field": "text",
                        "type": "string",
                        "required": True,
                        "description": "The note.",
                    }
                ]
            },
            "operation createNote's body names pinned, which it never sends",
        ),
        (
            {
                "stdin_fields": [
                    {"field": "text", "type": "string", "description": "The note."},
                    {"field": "pinned", "type": "string", "description": "Pin it."},
                ]
            },
            "operation createNote requires text, which it may leave out",
        ),
        (
            {"authority": "signed_agent", "conditions": ["member"]},
            "only paired_agent commands take conditions",
        ),
        ({"authority": "paired_agent", "conditions": ["spending_allowed", "member"]}, None),
    ],
)
def test_body_and_conditions(changes: dict[str, Any], problem: str | None) -> None:
    problems = problems_in(described(**changes), operations_in([OPENAPI]))
    assert problems == ([f"notes create: {problem}"] if problem else [])


def test_a_ref_loop_stops_the_check() -> None:
    """A $ref loop in a site's OpenAPI document fails `make check-cli` instead of hanging it."""
    loop = {"A": {"$ref": "#/B"}, "B": {"$ref": "#/A"}}
    with pytest.raises(ValueError, match="leads back to itself"):
        followed(loop, {"$ref": "#/A"})
