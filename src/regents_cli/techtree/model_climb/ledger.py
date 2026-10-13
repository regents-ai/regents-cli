"""The grant ledger (contract section 6): what happened to each local grant, one line per event.

An append-only file beside the grants. `grant issue` writes a grant's `issued` line, each attempt
writes its `used` line before its job is submitted, and `grant revoke` writes `revoked`. Every
line names the grant's digest and nonce and is signed with this machine's Techtree identity key,
so a line edited by hand, or copied from another grant, never counts. It is the operator's own
record on the operator's own machine: it stops mistakes and repeats, and nobody else has checked
it. The provider's lookup by intent id is what stops a second submission.
"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import TypeAdapter
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.errors import PolicyError
from regents_cli.techtree.identity.models import ExecutorIdentity
from regents_cli.techtree.identity.service import IdentityService, verify_signed_object
from regents_cli.techtree.model_climb.contracts import ExecutionGrant
from regents_cli.techtree.models.base import (
    Digest,
    NonEmptyString,
    ObjectEnvelope,
    ProtocolModel,
    UtcDateTime,
)

APPROVAL_REQUIRED = "approval_required"

type Event = Literal["issued", "used", "revoked"]


class LedgerLine(ProtocolModel):
    event: Event
    grant_id: NonEmptyString
    grant_digest: Digest
    nonce: NonEmptyString
    at: UtcDateTime
    #: The attempt a `used` line spends the grant on; no other line carries one.
    intent_id: NonEmptyString | None = None
    #: The operator's two answers for the account's spending limit (contract 6.1), kept on the
    #: `issued` line of a grant whose plan counts on that limit.
    auto_top_up_off: bool | None = None
    balance_within_monthly_limit: bool | None = None


_LINE = TypeAdapter(ObjectEnvelope[LedgerLine])


def record(
    path: Path,
    service: IdentityService,
    grant: ObjectEnvelope[ExecutionGrant],
    event: Event,
    *,
    at: datetime,
    intent_id: str | None = None,
    auto_top_up_off: bool | None = None,
    balance_within_monthly_limit: bool | None = None,
) -> None:
    """Sign one line for `grant` and append it, synced to disk before this returns."""
    line = LedgerLine(
        event=event,
        grant_id=grant.payload.grant_id,
        grant_digest=grant.payload_digest,
        nonce=grant.payload.nonce,
        at=at,
        intent_id=intent_id,
        auto_top_up_off=auto_top_up_off,
        balance_within_monthly_limit=balance_within_monthly_limit,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("ab") as handle:
        handle.write(_LINE.dump_json(service.sign_object(line)) + b"\n")
        handle.flush()
        os.fsync(handle.fileno())


def lines(
    path: Path, identity: ExecutorIdentity, grant: ObjectEnvelope[ExecutionGrant]
) -> list[LedgerLine]:
    """Every line the ledger holds for `grant`, oldest first.

    A ledger with a line that cannot be read, or that this machine's key did not sign, is
    refused whole: a file someone edited says nothing reliable about any grant.
    """
    if not path.exists():
        return []
    found: list[LedgerLine] = []
    for number, raw in enumerate(path.read_bytes().splitlines(), start=1):
        try:
            envelope = _LINE.validate_json(raw)
        except PydanticValidationError as error:
            raise _invalid(path, number, "it cannot be read") from error
        if not verify_signed_object(identity=identity, envelope=envelope).verified:
            raise _invalid(path, number, "this machine's key did not sign it as it stands")
        line = envelope.payload
        if (line.grant_digest, line.nonce) == (grant.payload_digest, grant.payload.nonce):
            found.append(line)
    return found


def _invalid(path: Path, number: int, reason: str) -> PolicyError:
    return PolicyError(
        f"line {number} of the grant ledger does not hold: {reason}. No grant is admitted "
        "until a person has looked at the file.",
        code=APPROVAL_REQUIRED,
        details={"reason": "grant_ledger_invalid", "path": str(path), "line": number},
    )
