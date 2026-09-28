"""Shared protocol types and the two base classes.

`ProtocolModel` is frozen, strict and extra-forbidden; everything hashed or signed derives
from it. `StateModel` is the same but mutable, for local records edited in place. Strict
models take one JSON spelling per type, so stored documents are loaded with
`model_validate_json` on their raw bytes, which also lets a caller digest what it parsed.
"""

from __future__ import annotations

import base64
import binascii
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from regents_cli.techtree.constants import DIGEST_PREFIX

type JsonScalar = str | int | float | bool | None
type JsonValue = JsonScalar | list[JsonValue] | dict[str, JsonValue]

#: Lowercase only, so one digest has one spelling and byte comparison means something.
DIGEST_PATTERN = rf"^{DIGEST_PREFIX}[0-9a-f]{{64}}$"

type Digest = Annotated[str, StringConstraints(pattern=DIGEST_PATTERN)]


def _require_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(UTC)


type UtcDateTime = Annotated[datetime, AfterValidator(_require_utc)]


def _require_visible_characters(value: str) -> str:
    if not value.strip():
        raise ValueError("value must contain at least one non-whitespace character")
    return value


type NonEmptyString = Annotated[
    str, StringConstraints(min_length=1), AfterValidator(_require_visible_characters)
]


def _require_base64(value: str) -> str:
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("value must be base64") from error
    if base64.b64encode(decoded).decode("ascii") != value:
        raise ValueError("value must be canonical base64")
    return value


type Base64String = Annotated[str, StringConstraints(min_length=1), AfterValidator(_require_base64)]


class ProtocolModel(BaseModel):
    """A hashed or signed document: frozen, strict, extra-forbidden."""

    model_config = ConfigDict(
        frozen=True,
        strict=True,
        extra="forbid",
        validate_default=True,
        populate_by_name=False,
    )


class StateModel(BaseModel):
    """A local record edited in place: strict, extra-forbidden, validated on assignment."""

    model_config = ConfigDict(
        frozen=False,
        strict=True,
        extra="forbid",
        validate_default=True,
        validate_assignment=True,
        populate_by_name=False,
    )


class ArtifactRef(ProtocolModel):
    """A content-addressed pointer to a stored byte stream."""

    digest: Digest
    media_type: NonEmptyString
    size: Annotated[int, Field(gt=0)]
    relative_path: str | None = None


class PublicKeyRef(ProtocolModel):
    """An Ed25519 public key as protocol documents carry it."""

    algorithm: Literal["ed25519"]
    key_id: NonEmptyString
    public_key: Base64String


class SignatureEnvelope(ProtocolModel):
    """A detached Ed25519 signature over a digest string."""

    algorithm: Literal["ed25519"]
    key_id: NonEmptyString
    signature: Base64String


class ObjectEnvelope[T: BaseModel](ProtocolModel):
    """A payload with its digest and an optional signature.

    `payload_digest` is carried, never recomputed on validation, so a payload that no longer
    matches it can be caught; services check the pair with `verify_object_digest`.
    """

    payload: T
    payload_digest: Digest
    signature: SignatureEnvelope | None = None
