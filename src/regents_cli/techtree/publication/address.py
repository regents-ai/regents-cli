"""Checking an EVM address or a Skill GitHub URL somebody typed. Nothing here stores anything.

An address is optional, volunteered and unverifiable. What can be caught cheaply is caught: the
shape, and the EIP-55 checksum a mixed-case spelling carries. What travels is the lowercase
spelling. A refusal never echoes the address back: it would end up in scrollback and in
whatever a host agent keeps.
"""

from __future__ import annotations

import re
from typing import Final
from urllib.parse import urlsplit

from eth_utils.address import to_checksum_address

from regents_cli.techtree.errors import ValidationError

CONTRIBUTOR_ADDRESS_INVALID: Final = "contributor_address_invalid"
SKILL_GITHUB_URL_INVALID: Final = "skill_github_url_invalid"

_ADDRESS_PATTERN: Final = re.compile(r"\A0x[0-9a-fA-F]{40}\Z")
# GitHub owners are at most 39 alphanumerics or dashes, never at an edge; repositories at most
# 100 characters with dots and underscores as well. One spelling, no .git, nothing else.
_GITHUB_OWNER_PATTERN: Final = re.compile(r"\A[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\Z")
_GITHUB_REPOSITORY_PATTERN: Final = re.compile(r"\A[A-Za-z0-9][A-Za-z0-9._-]{0,99}\Z")


def canonical_contributor_address(typed: str) -> str:
    """The lowercase form of a typed address, or a refusal that says why without echoing it."""
    trimmed = typed.strip()
    if not _ADDRESS_PATTERN.match(trimmed):
        raise ValidationError(
            "an address is 0x followed by exactly 40 hexadecimal characters, and this one is "
            f"not: {_shape_of(trimmed)}",
            code=CONTRIBUTOR_ADDRESS_INVALID,
            details={"reason": "shape"},
        )
    body = trimmed[2:]
    if body == body.lower() or body == body.upper():
        # One case throughout carries no checksum, so there is nothing to be wrong about.
        return trimmed.lower()
    if trimmed != to_checksum_address(trimmed.lower()):
        raise ValidationError(
            "this address is written in mixed case, which carries a checksum, and the checksum "
            "does not match: one character of it is wrong. An address nobody controls cannot "
            "be undone, so it is refused rather than sent",
            code=CONTRIBUTOR_ADDRESS_INVALID,
            details={"reason": "checksum"},
        )
    return trimmed.lower()


def canonical_skill_github_url(typed: str) -> str:
    """Exactly `https://github.com/owner/repo`, or a refusal. Descriptive metadata only."""
    if typed != typed.strip():
        raise ValidationError(
            "a Skill GitHub URL has no surrounding whitespace",
            code=SKILL_GITHUB_URL_INVALID,
            details={"reason": "whitespace"},
        )
    try:
        parts = urlsplit(typed)
        port = parts.port
    except ValueError:
        parts = None
        port = None
    path_parts = parts.path.split("/") if parts is not None else []
    if (
        parts is None
        or parts.scheme != "https"
        or parts.netloc != "github.com"
        or parts.username is not None
        or parts.password is not None
        or port is not None
        or parts.query
        or parts.fragment
        or "?" in typed
        or "#" in typed
        or len(path_parts) != 3
        or path_parts[0]
        or not _GITHUB_OWNER_PATTERN.fullmatch(path_parts[1])
        or not _GITHUB_REPOSITORY_PATTERN.fullmatch(path_parts[2])
        or path_parts[2].lower().endswith(".git")
    ):
        raise ValidationError(
            "a Skill GitHub URL must be exactly https://github.com/owner/repo, with no .git "
            "suffix, query, fragment, credentials, or extra path",
            code=SKILL_GITHUB_URL_INVALID,
            details={"reason": "shape"},
        )
    return typed


def _shape_of(typed: str) -> str:
    """Describe what was typed without repeating it back."""
    prefix = "starts with 0x" if typed[:2].lower() == "0x" else "no 0x prefix"
    return f"{prefix}, {len(typed)} characters"
