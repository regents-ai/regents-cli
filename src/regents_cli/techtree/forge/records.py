"""How forge records are kept: an approval written once, a record read back whole and validated
or refused by name, and the command a person runs to read one."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel
from pydantic import ValidationError as ModelValidationError

from regents_cli.techtree.approval import ReviewedOn
from regents_cli.techtree.errors import NotFoundError, ValidationError
from regents_cli.techtree.forge.models import FORGE_APPROVAL_SCHEMA_VERSION, ForgeApproval
from regents_cli.techtree.fs import atomic_write_json


def read_record[M: BaseModel](
    model: type[M], path: Path, *, missing: str, code: str, details: Mapping[str, object]
) -> M:
    """The record at `path`; `missing` with `code` when there is none."""
    found = read_optional(model, path, details=details)
    if found is None:
        raise NotFoundError(missing, code=code, details=details)
    return found


def read_optional[M: BaseModel](
    model: type[M], path: Path, *, details: Mapping[str, object]
) -> M | None:
    """The record at `path`, or None when it was never written."""
    if not path.is_file():
        return None
    try:
        return model.model_validate_json(path.read_bytes())
    except ModelValidationError as error:
        issue = error.errors(include_input=False, include_url=False)[0]
        raise ValidationError(
            f"{path} is not a valid record: {issue['msg']}",
            code="forge_evidence_invalid",
            details={**details, "file": str(path)},
        ) from error


def inspect_command(record_id: str) -> str:
    """The command that reads a forge record back, for an error to name."""
    return f"regents techtree forge status {record_id}"


def write_approval(
    path: Path, *, subject_id: str, subject_digest: str, reviewed_on: ReviewedOn, yes: bool
) -> ForgeApproval:
    """Record a person's approval of exactly one reviewed subject."""
    approval = ForgeApproval(
        schema_version=FORGE_APPROVAL_SCHEMA_VERSION,
        subject_id=subject_id,
        subject_digest=subject_digest,
        approved_at=datetime.now(UTC),
        reviewed_on=reviewed_on,
        answered_with="yes-flag" if yes else "prompt",
    )
    atomic_write_json(path, approval)
    return approval
