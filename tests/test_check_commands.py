"""Refuse unknown body fields and missing server-required fields before a request is signed.
Optional API fields may be omitted by a command with a narrower purpose.
"""

from __future__ import annotations

from typing import Any

import pytest

from regents_cli.check_commands import file_problems, followed, operations_in, problems_in

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


PICTURE = {
    "name": "file",
    "type": "file",
    "in": "body",
    "field": "picture",
    "enum": ["image/png"],
    "maximum": 1000,
    "description": "The picture.",
}


def uploading(**changes: Any) -> dict[str, Any]:
    return {
        "operation_id": "upload",
        "method": "PUT",
        "arguments": [PICTURE],
        "flags": [],
    } | changes


@pytest.mark.parametrize(
    ("changes", "problems"),
    [
        ({}, []),
        (
            {"arguments": [PICTURE | {"in": "query"}]},
            [
                "a file argument fills the body",
                "a file argument is the whole body: nothing else may fill it",
            ],
        ),
        (
            {"arguments": [PICTURE, PICTURE | {"name": "other"}]},
            ["a file argument is the whole body: nothing else may fill it"],
        ),
        (
            {"stdin_fields": []},
            ["a file argument is the whole body: nothing else may fill it"],
        ),
        (
            {"arguments": [{k: v for k, v in PICTURE.items() if k != "maximum"}]},
            ["a file argument names its content types (enum) and its most bytes"],
        ),
        ({"method": "GET"}, ["a file is sent with POST or PUT"]),
        (
            {"arguments": [PICTURE | {"enum": ["image/png", "image/gif"]}]},
            ["operation upload takes no image/gif body"],
        ),
    ],
)
def test_a_file_is_the_whole_body_of_a_type_the_site_takes(
    changes: dict[str, Any], problems: list[str]
) -> None:
    takes = operations_in([upload_openapi({"image/png": {}})])["upload"]
    assert file_problems(uploading(**changes), takes) == problems


def test_a_file_goes_only_to_an_operation_that_takes_a_body() -> None:
    """An operation with no body would get the file's bytes it never reads."""
    takes = operations_in([upload_openapi(None)])["upload"]
    assert file_problems(uploading(), takes) == ["operation upload takes no body"]


def upload_openapi(content: dict[str, Any] | None) -> dict[str, Any]:
    operation: dict[str, Any] = {"operationId": "upload", "responses": {"204": {}}}
    if content is not None:
        operation["requestBody"] = {"content": content}
    return {"openapi": "3.1.0", "paths": {"/upload/{ticket}": {"put": operation}}}


ADDRESS = {
    "name": "upload-url",
    "type": "site_url",
    "in": "path",
    "field": "ticket",
    "description": "The address the site answered.",
}
TICKET = {
    "name": "ticket",
    "type": "string",
    "in": "path",
    "field": "ticket",
    "description": "The ticket.",
}


@pytest.mark.parametrize(
    ("command", "inputs", "problems"),
    [
        ("<upload-url> <file>", {"arguments": [ADDRESS, PICTURE]}, []),
        (
            "<upload-url>",
            {"arguments": [ADDRESS], "flags": [PICTURE]},
            ["site_url and file inputs are arguments, not flags"],
        ),
        (
            "<upload-url> <ticket> <file>",
            {"arguments": [ADDRESS, TICKET, PICTURE]},
            [
                "path inputs (ticket, ticket) must fill exactly /upload/{ticket}",
                "a site_url argument is the command's only path input",
            ],
        ),
        (
            "<ticket> <upload-url> <file>",
            {"arguments": [TICKET, ADDRESS | {"in": "query"}, PICTURE]},
            [
                "a site_url argument is the command's only path input",
                "a site_url argument fills the path",
            ],
        ),
    ],
)
def test_a_site_address_is_the_whole_path(
    command: str, inputs: dict[str, Any], problems: list[str]
) -> None:
    """An address the site answered names the whole path, so no other input may fill part of it."""
    upload = {
        "command": f"avatar upload {command}",
        "description": "Send a picture.",
        "operation_id": "upload",
        "method": "PUT",
        "path": "/upload/{ticket}",
        "authority": "public",
        "effect": "write",
    } | inputs
    description = {
        "format": "regents.commands.v1",
        "platform": "notes",
        "base_url": "https://notes.example",
        "commands": [upload],
    }
    found = problems_in(description, operations_in([upload_openapi({"image/png": {}})]))
    assert found == [f"{upload['command']}: {problem}" for problem in problems]
