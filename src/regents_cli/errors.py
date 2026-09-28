"""Failures and the exit codes every `regents` command shares."""

from __future__ import annotations

from typing import Any, Final

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

    Extra fields travel into the error object; never put a secret in them.
    """

    def __init__(
        self, code: str, message: str, *, exit_code: int = EXIT_FAILED, **fields: Any
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.fields = fields

    def as_json(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, **self.fields}}


class UsageError(CommandError):
    def __init__(self, message: str) -> None:
        super().__init__("usage_error", message, exit_code=EXIT_USAGE)
