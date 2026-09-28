"""Which commit a built artifact came from: stamped onto the wheel by `scripts/stamp_provenance.py`.

The stamp is never in the committed tree. A wheel carries it; a source checkout carries none
and says so rather than naming a commit nobody stamped.
"""

from __future__ import annotations

from typing import Annotated, Final, Literal

from pydantic import StringConstraints

from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import ProtocolModel
from regents_cli.techtree.release.document import packaged_release_root

BUILD_PROVENANCE_SCHEMA_VERSION: Final = "techtree.build-provenance.v1"
BUILD_PROVENANCE_FILENAME: Final = "build-provenance.json"
BUILD_PROVENANCE_INVALID: Final = "build_provenance_invalid"

#: A full git commit, lowercase, never abbreviated.
COMMIT_PATTERN: Final = r"^[0-9a-f]{40}$"
type Commit = Annotated[str, StringConstraints(pattern=COMMIT_PATTERN)]

_WHEEL_MEMBER: Final = f"regents_cli/techtree/resources/release/{BUILD_PROVENANCE_FILENAME}"


class BuildProvenance(ProtocolModel):
    """The commit one built artifact was built from, and nothing else."""

    schema_version: Literal["techtree.build-provenance.v1"]
    source_commit: Commit


def parse_build_provenance(raw: bytes) -> BuildProvenance:
    try:
        return BuildProvenance.model_validate_json(raw)
    except ValueError as error:
        raise ValidationError(
            f"this is not a valid build provenance stamp: {error}", code=BUILD_PROVENANCE_INVALID
        ) from error


def packaged_build_provenance() -> BuildProvenance | None:
    """What this build was stamped with, or None when it is a source checkout."""
    stamp = packaged_release_root() / BUILD_PROVENANCE_FILENAME
    if not stamp.is_file():
        return None
    return parse_build_provenance(stamp.read_bytes())
