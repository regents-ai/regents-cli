"""Failures and the exit codes every `regents` command shares."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any, Final

if TYPE_CHECKING:
    from regents_cli.next_steps import Step

EXIT_OK: Final = 0
EXIT_FAILED: Final = 1
EXIT_USAGE: Final = 2
EXIT_AUTH: Final = 3
EXIT_NOT_FOUND: Final = 4
EXIT_UNREACHABLE: Final = 5
EXIT_CANCELLED: Final = 130

EXIT_CODES: Final = {
    EXIT_OK: "Success.",
    EXIT_FAILED: "The command ran but the operation failed.",
    EXIT_USAGE: "Usage error: unknown command, missing argument, or invalid flag value.",
    EXIT_AUTH: "Sign-in or wallet proof is missing, expired, or rejected.",
    EXIT_NOT_FOUND: "The requested record was not found.",
    EXIT_UNREACHABLE: "The site could not be reached, or did not answer in time.",
    EXIT_CANCELLED: "The command was interrupted.",
}


class CommandError(Exception):
    """A failure reported as {"error": {"code", "message", ...}} with its exit code.

    Extra fields travel into the error object; never put a secret in them. `next_steps` says
    what to do about it when the place that raises it knows better than its kind does.
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        exit_code: int = EXIT_FAILED,
        next_steps: Sequence[Step] = (),
        **fields: Any,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.next_steps = tuple(next_steps)
        self.fields = fields

    @classmethod
    def refused(
        cls, code: str, message: str, *, exit_code: int, fields: Mapping[str, Any]
    ) -> CommandError:
        """A site's refusal. The site's fields travel in the error whatever they are named, as
        data: one named exit_code or next_steps changes nothing, and code and message are always
        these."""
        error = cls(code, message, exit_code=exit_code)
        error.fields = {k: v for k, v in fields.items() if k not in ("code", "message")}
        return error

    def as_json(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, **self.fields}}


class UsageError(CommandError):
    def __init__(self, message: str) -> None:
        super().__init__("usage_error", message, exit_code=EXIT_USAGE)
