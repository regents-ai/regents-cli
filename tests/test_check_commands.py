"""Refuse unknown body fields and missing server-required fields before a request is signed.
Optional API fields may be omitted by a command with a narrower purpose.
"""

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
                    {"type": "object", "properties": {"text": {}}},
                    {"required": ["text"]},
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
            None,
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
