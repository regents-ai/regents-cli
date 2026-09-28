"""Techtree's failures, each a `CommandError` with one of regents' exit codes."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import ClassVar

from regents_cli.errors import (
    EXIT_AUTH,
    EXIT_CANCELLED,
    EXIT_FAILED,
    EXIT_NOT_FOUND,
    EXIT_USAGE,
    CommandError,
)


class TechtreeError(CommandError):
    """A failure Techtree reports on purpose. `details` travels into the answer as it is."""

    default_code: ClassVar[str] = "techtree_error"
    default_exit_code: ClassVar[int] = EXIT_FAILED

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        details: Mapping[str, object] | None = None,
    ) -> None:
        self.details = dict(details or {})
        super().__init__(
            code or self.default_code,
            message,
            exit_code=self.default_exit_code,
            **({"details": self.details} if self.details else {}),
        )

    def __str__(self) -> str:
        return self.message


class UsageError(TechtreeError):
    """The command, its options, or their combination is not valid."""

    default_code = "usage_error"
    default_exit_code = EXIT_USAGE


class ValidationError(TechtreeError):
    """Input data or a stored document failed validation."""

    default_code = "validation_error"


class PrerequisiteError(TechtreeError):
    """Something that had to be done first has not been done."""

    default_code = "prerequisite_error"


class NotFoundError(TechtreeError):
    """A named object does not exist."""

    default_code = "not_found"
    default_exit_code = EXIT_NOT_FOUND


class ConflictError(TechtreeError):
    """The requested change collides with existing immutable state."""

    default_code = "conflict"


class AuthenticationError(TechtreeError):
    """A credential is missing, rejected, or expired."""

    default_code = "authentication_error"
    default_exit_code = EXIT_AUTH


class EngineError(TechtreeError):
    """The managed engine could not be installed, resolved, or invoked."""

    default_code = "engine_error"


class RunError(TechtreeError):
    """A run failed, or a run operation is not allowed in the run's current phase."""

    default_code = "run_error"


class VerificationError(TechtreeError):
    """A digest, signature, or membership commitment did not verify."""

    default_code = "verification_error"


class CancellationError(TechtreeError):
    """Work stopped because it was cancelled."""

    default_code = "cancelled"
    default_exit_code = EXIT_CANCELLED


class PolicyError(TechtreeError):
    """A data-rights or publication policy forbids the request."""

    default_code = "policy_error"


_MEMORY_ADDRESS = re.compile(r"\b0x[0-9a-fA-F]{6,}\b")
_WHITESPACE_RUN = re.compile(r"\s+")


def stable_exception_message(error: Exception) -> str:
    """One exception's message on one line, with memory addresses normalised."""
    text = _WHITESPACE_RUN.sub(" ", str(error)).strip()
    if not text:
        return type(error).__name__
    return _MEMORY_ADDRESS.sub("0x<address>", text)
