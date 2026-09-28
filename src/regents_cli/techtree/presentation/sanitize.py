"""What may appear in a result, enforced rather than intended.

A run's evidence holds the taskset's hidden expected answers, the grader that knows them,
absolute paths naming somebody's home directory, and tracebacks carrying environment values.
The payload's shape keeps hidden material out; these functions keep it out of the free text
the shape still allows. Nothing here inspects a string for credential-shaped text: a value's
shape is not evidence of what it is. A rollout's final reply has no field either: it is free
text from a model, and a rendering is a place a reader trusts.
"""

from __future__ import annotations

import re
from typing import Final

from pydantic import BaseModel

from regents_cli.techtree.errors import ValidationError

PRESENTATION_REDACTION_FAILED: Final = "presentation_redaction_failed"

#: Escape sequences of every shape a terminal would act on.
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-_]|\x9b[0-9;?]*[@-~]")
#: Everything a terminal treats as a command rather than as text, newline and tab included.
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_WHITESPACE_RUN = re.compile(r"\s+")
#: A rooted filesystem path with at least two segments, POSIX or Windows.
_ABSOLUTE_PATH = re.compile(r"(?:[A-Za-z]:\\|/)[\w.-]+[/\\][\w.\-/\\]*")
_ELLIPSIS: Final = "…"


def sanitize_label(value: str, maximum: int = 120) -> str:
    """One line of plain, bounded text; escapes and control characters go, words stay."""
    flattened = _WHITESPACE_RUN.sub(" ", _CONTROL.sub(" ", _ANSI.sub("", value)))
    label = flattened.strip()
    if len(label) <= maximum:
        return label
    return label[: maximum - 1].rstrip() + _ELLIPSIS


def carries_control(value: str) -> bool:
    """Whether a string holds an escape sequence or a control character."""
    return bool(_ANSI.search(value) or _CONTROL.search(value))


def ensure_no_control_or_local_path(value: str, *, field: str) -> None:
    """Refuse one string that would carry a terminal command or a local path."""
    if carries_control(value):
        raise ValidationError(
            "a result rendering may not carry terminal control sequences",
            code=PRESENTATION_REDACTION_FAILED,
            details={"field": field},
        )
    if _ABSOLUTE_PATH.search(value):
        raise ValidationError(
            "a result rendering may not name an absolute local path",
            code=PRESENTATION_REDACTION_FAILED,
            details={"field": field},
        )


def ensure_no_hidden_task_material(payload: BaseModel) -> None:
    """Check every string in a payload, walked rather than remembered, before anything renders."""
    for path, value in _strings(payload, ""):
        ensure_no_control_or_local_path(value, field=path)


def _strings(value: object, path: str) -> list[tuple[str, str]]:
    """Every string inside a payload, with the field it came from."""
    if isinstance(value, str):
        return [(path, value)]
    found: list[tuple[str, str]] = []
    if isinstance(value, BaseModel):
        for name in type(value).model_fields:
            found.extend(_strings(getattr(value, name), f"{path}.{name}".lstrip(".")))
    elif isinstance(value, dict):
        for key, item in value.items():
            found.extend(_strings(item, f"{path}[{key}]"))
    elif isinstance(value, list | tuple):
        for position, item in enumerate(value):
            found.extend(_strings(item, f"{path}[{position}]"))
    return found
