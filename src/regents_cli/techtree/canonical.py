"""Canonical JSON (RFC 8785), `sha256:<hex>` digests, and the Verifiers task-hash boundary.

This is the only place Techtree turns a value into bytes for hashing, so its output must stay
byte-identical to Techtree 0.3.0: published entries keep verifying only while it does.
Naive datetimes, non-finite numbers, bytes, sets and unknown objects are refused rather than
guessed at.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from enum import Enum
from pathlib import PurePath
from typing import BinaryIO, Final

import rfc8785
from pydantic import BaseModel

from regents_cli.techtree.constants import DIGEST_PREFIX
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import DIGEST_PATTERN, Digest, JsonValue

VERIFIERS_TASK_HASH_LENGTH: Final = 64

_DIGEST_RE = re.compile(DIGEST_PATTERN)
_RAW_TASK_HASH_RE = re.compile(rf"^[0-9a-f]{{{VERIFIERS_TASK_HASH_LENGTH}}}$")


def _unsupported(value: object, reason: str) -> ValidationError:
    return ValidationError(
        f"cannot canonicalize {type(value).__name__}: {reason}",
        details={"python_type": type(value).__name__},
    )


def _float_to_json(value: float) -> float:
    if math.isnan(value) or math.isinf(value):
        raise ValidationError(
            "cannot canonicalize a non-finite number", details={"value": repr(value)}
        )
    return value


def _datetime_to_json(value: datetime) -> str:
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        raise ValidationError(
            "cannot canonicalize a naive datetime; it does not name an instant",
            details={"value": value.isoformat()},
        )
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _model_to_json(value: BaseModel) -> dict[str, JsonValue]:
    # Read off the instance, not through model_dump, so every leaf follows the rules here.
    return {name: to_json_value(getattr(value, name)) for name in type(value).model_fields}


def to_json_value(value: object) -> JsonValue:
    """Convert models, enums, aware datetimes, paths, decimals, mappings and sequences to JSON."""
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, bool):  # before int: bool is an int
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return _float_to_json(value)
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValidationError(
                "cannot canonicalize a non-finite decimal", details={"value": str(value)}
            )
        return float(value)
    if isinstance(value, datetime):
        return _datetime_to_json(value)
    if isinstance(value, Enum):
        return to_json_value(value.value)
    if isinstance(value, PurePath):
        return value.as_posix()
    if isinstance(value, BaseModel):
        return _model_to_json(value)
    if isinstance(value, Mapping):
        converted: dict[str, JsonValue] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise _unsupported(key, "mapping keys must be strings")
            converted[key] = to_json_value(item)
        return converted
    if isinstance(value, bytes | bytearray | memoryview):
        raise _unsupported(value, "encode binary data as base64 text first")
    if isinstance(value, set | frozenset):
        raise _unsupported(value, "sets have no defined order; use a list")
    if isinstance(value, Sequence):
        return [to_json_value(item) for item in value]
    raise _unsupported(value, "no canonical JSON representation is defined")


def canonical_json_bytes(value: object) -> bytes:
    """RFC 8785 canonical JSON as UTF-8 bytes."""
    try:
        return rfc8785.dumps(to_json_value(value))
    except rfc8785.CanonicalizationError as error:
        raise ValidationError(f"value cannot be canonicalized: {error}") from error


def canonical_json_text(value: object) -> str:
    return canonical_json_bytes(value).decode("utf-8")


def sha256_digest_bytes(data: bytes) -> Digest:
    """`sha256:<hex>` of raw bytes."""
    return f"{DIGEST_PREFIX}{hashlib.sha256(data).hexdigest()}"


def sha256_digest_stream(stream: BinaryIO) -> Digest:
    """`sha256:<hex>` from the stream's position to its end, read in 1 MiB chunks."""
    digest = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
    return f"{DIGEST_PREFIX}{digest.hexdigest()}"


def digest_object(value: object) -> Digest:
    """The digest of a value's canonical JSON."""
    return sha256_digest_bytes(canonical_json_bytes(value))


def validate_digest(value: str) -> Digest:
    """Return `value` when it is `sha256:` and 64 lowercase hex characters."""
    if _DIGEST_RE.fullmatch(value) is None:
        raise ValidationError(
            "digest must be sha256: followed by 64 lowercase hexadecimal characters",
            details={"value": value},
        )
    return value


def verify_bytes_digest(data: bytes, expected: Digest) -> bool:
    """Constant-time check of raw bytes against a digest."""
    return hmac.compare_digest(sha256_digest_bytes(data), validate_digest(expected))


def verify_object_digest(value: object, expected: Digest) -> bool:
    """Constant-time check of a value's canonical JSON against a digest."""
    return hmac.compare_digest(digest_object(value), validate_digest(expected))


def normalize_verifiers_task_hash(raw: str) -> Digest:
    """Turn a Verifiers task hash (exactly 64 lowercase hex, no prefix) into a digest."""
    if raw.startswith(DIGEST_PREFIX):
        raise ValidationError(
            "Verifiers task hashes are unprefixed; use validate_digest for Techtree digests",
            details={"value": raw},
        )
    if len(raw) != VERIFIERS_TASK_HASH_LENGTH:
        raise ValidationError(
            f"Verifiers task hash must be exactly {VERIFIERS_TASK_HASH_LENGTH} characters",
            details={"length": len(raw)},
        )
    if _RAW_TASK_HASH_RE.fullmatch(raw) is None:
        raise ValidationError(
            "Verifiers task hash must be lowercase hexadecimal", details={"value": raw}
        )
    return f"{DIGEST_PREFIX}{raw}"
