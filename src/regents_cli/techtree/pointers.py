"""RFC 6901 JSON Pointer spelling and containment."""

from __future__ import annotations

from typing import Final

POINTER_SEPARATOR: Final = "/"

#: At least one reference token; the empty pointer (the whole document) is outside it.
JSON_POINTER_PATTERN: Final = r"^(?:/(?:[^/~]|~[01])*)+$"


def json_pointer_escape(segment: str) -> str:
    """Escape `~` as `~0`, then `/` as `~1`."""
    return segment.replace("~", "~0").replace(POINTER_SEPARATOR, "~1")


def pointer_is_within(pointer: str, allowed_root: str) -> bool:
    """Whether `pointer` is `allowed_root` or below it, at a token boundary.

    `/a/skills_extra` is not within `/a/skills`.
    """
    return pointer == allowed_root or pointer.startswith(f"{allowed_root}{POINTER_SEPARATOR}")
