"""Prefixed local identifiers: `<prefix>_<32 lowercase hex>`. Labels, never integrity values."""

from __future__ import annotations

import re
import uuid
from typing import Final

from regents_cli.techtree.errors import ValidationError

ID_PREFIXES: Final[frozenset[str]] = frozenset(
    {
        "campaign",
        "climb",
        "draft",
        "run",
        "receipt",
        "uplift",
        "policy",
        "forgerun",
        "forgecmp",
        "forgerev",
        "forgesrc",
        "forgeplan",
        "forgeprop",
        "forgecon",
        "forgecol",
    }
)

_ID_PATTERN = re.compile(r"^(?P<prefix>[a-z][a-z0-9]*)_(?P<body>[0-9a-f]{32})$")


def _require_known_prefix(prefix: str) -> str:
    if prefix not in ID_PREFIXES:
        raise ValidationError(
            f"unknown identifier prefix {prefix!r}",
            details={"prefix": prefix, "known": ", ".join(sorted(ID_PREFIXES))},
        )
    return prefix


def new_id(prefix: str) -> str:
    """A new identifier with this prefix."""
    return f"{_require_known_prefix(prefix)}_{uuid.uuid4().hex}"


def validate_id(value: str, expected_prefix: str | None = None) -> str:
    """Return `value` when it is an identifier, with `expected_prefix` when one is given."""
    match = _ID_PATTERN.fullmatch(value)
    if match is None:
        raise ValidationError(
            "identifier must be <prefix>_<32 lowercase hexadecimal characters>",
            details={"value": value},
        )
    prefix = _require_known_prefix(match.group("prefix"))
    if expected_prefix is not None and prefix != _require_known_prefix(expected_prefix):
        raise ValidationError(
            f"expected a {expected_prefix} identifier, got a {prefix} identifier",
            details={"value": value, "expected_prefix": expected_prefix},
        )
    return value


def id_prefix(value: str) -> str:
    """The prefix of a valid identifier."""
    return validate_id(value).split("_", 1)[0]
