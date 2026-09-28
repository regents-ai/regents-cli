"""The membership digest: the one number a Campaign, a lock and a receipt set all commit to.

The digest is taken over `{"ordered_task_hashes": [...]}` rather than a bare array, so the
meaning of the list is inside the hashed bytes. Changing the key changes every membership
digest in existence. Every hash is revalidated on the way in.
"""

from __future__ import annotations

from typing import Final

from regents_cli.techtree.canonical import digest_object, validate_digest
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import Digest

MEMBERSHIP_DIGEST_KEY: Final = "ordered_task_hashes"


def membership_digest(ordered_task_hashes: list[Digest]) -> Digest:
    if not ordered_task_hashes:
        raise ValidationError(
            "a membership digest commits to at least one task",
            code="membership_empty",
            details={"task_count": 0},
        )
    return digest_object(
        {MEMBERSHIP_DIGEST_KEY: [validate_digest(value) for value in ordered_task_hashes]}
    )
