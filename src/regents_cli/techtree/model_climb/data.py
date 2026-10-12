"""Split membership commitments (contract 3.4).

A split's commitment is sha256 over the canonical, sorted list of HMAC-SHA256(salt, row id).
The salt never leaves the operator's machine and is never written into an object, so the
commitment says which rows a split holds to someone who has the salt, and nothing to anyone
who does not: row ids are often guessable.
"""

from __future__ import annotations

import hashlib
import hmac
from collections.abc import Sequence
from typing import Final

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import Digest

MINIMUM_SALT_BYTES: Final = 32


def split_commitment(salt: bytes, row_ids: Sequence[str]) -> Digest:
    if len(salt) < MINIMUM_SALT_BYTES:
        raise ValidationError(
            f"a split salt must be at least {MINIMUM_SALT_BYTES} bytes",
            details={"salt_bytes": len(salt)},
        )
    if len(set(row_ids)) != len(row_ids):
        raise ValidationError("a split names each row once; these row ids repeat")
    return digest_object(
        sorted(
            hmac.new(salt, row_id.encode("utf-8"), hashlib.sha256).hexdigest() for row_id in row_ids
        )
    )
