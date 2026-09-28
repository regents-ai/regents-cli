"""Checking what the run log answered, against the network key the release pins.

SECURITY: the key is never learned from the answer. A receipt checked against the key it
carries proves nothing; every check below is against the pin. Nothing here contacts anything
or writes anything.
"""

from __future__ import annotations

from base64 import b64decode
from typing import Final, NoReturn
from urllib.parse import urlsplit

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.crypto import load_public_key, verify_signature
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import Digest, JsonValue, ObjectEnvelope, PublicKeyRef
from regents_cli.techtree.publication.models import (
    PublicationReceiptPayload,
    WithdrawalReceiptPayload,
)
from regents_cli.techtree.release.models import PublicationCoordinates

#: One code for every way an answer fails to be the run log's own word, with the check named
#: in `details.check`: a caller writes nothing down whichever it was.
PUBLICATION_RECEIPT_INVALID: Final = "publication_receipt_invalid"


def verify_publication_receipt(
    envelope: ObjectEnvelope[PublicationReceiptPayload],
    *,
    coordinates: PublicationCoordinates,
    run_id: str,
    bundle_digest: Digest,
) -> None:
    """Raise unless this is the pinned run log's receipt for what was sent."""
    receipt = envelope.payload
    _check_countersignature(envelope, coordinates, subject=run_id)
    if receipt.run_id != run_id or receipt.bundle_digest != bundle_digest:
        _refuse(
            "receipt.subject",
            "the run log's receipt is for a different submission than the one that was sent",
            run_id=run_id,
            receipt_run_id=receipt.run_id,
            receipt_bundle_digest=receipt.bundle_digest,
        )
    _check_entry_url(receipt.entry_url, coordinates, subject=run_id)
    if receipt.failed_checks:
        _refuse(
            "receipt.checks",
            f"the run log accepted nothing: {receipt.failed_checks[0].detail}",
            run_id=run_id,
            failed_checks=[check.id for check in receipt.failed_checks],
        )


def verify_withdrawal_receipt(
    envelope: ObjectEnvelope[WithdrawalReceiptPayload],
    *,
    coordinates: PublicationCoordinates,
    bundle_digest: Digest,
) -> None:
    """Raise unless this is the pinned run log's record of this withdrawal."""
    receipt = envelope.payload
    _check_countersignature(envelope, coordinates, subject=bundle_digest)
    if receipt.bundle_digest != bundle_digest:
        _refuse(
            "withdrawal.subject",
            "the run log's answer withdraws a different entry than the one that was asked for",
            bundle_digest=bundle_digest,
            receipt_bundle_digest=receipt.bundle_digest,
        )
    _check_entry_url(receipt.entry_url, coordinates, subject=bundle_digest)


def _check_countersignature(
    envelope: ObjectEnvelope[PublicationReceiptPayload] | ObjectEnvelope[WithdrawalReceiptPayload],
    coordinates: PublicationCoordinates,
    *,
    subject: str,
) -> None:
    """Raise unless the pinned network key signed exactly these payload bytes."""
    computed = digest_object(envelope.payload)
    if computed != envelope.payload_digest:
        _refuse(
            "receipt.payload_digest",
            "the run log's answer no longer matches the digest it was signed under: "
            f"sealed {envelope.payload_digest}, computed {computed}",
            subject=subject,
        )
    signature = envelope.signature
    if signature is None:
        _refuse(
            "receipt.signature_present",
            "the run log's answer carries no signature, so nothing countersigns it",
            subject=subject,
        )
    pinned = coordinates.network_key
    if signature.key_id != pinned.key_id:
        _refuse(
            "receipt.signature_key",
            f"the run log's answer is signed by key {signature.key_id}, which is not the key "
            f"{pinned.key_id} this release publishes to",
            subject=subject,
        )
    if not _same_key(envelope.payload.public_key, pinned):
        _refuse(
            "receipt.carried_key",
            "the run log's answer names the pinned key and carries a different one",
            subject=subject,
        )
    public_key = load_public_key(b64decode(pinned.public_key, validate=True))
    if not verify_signature(public_key, envelope.payload_digest, signature):
        _refuse(
            "receipt.signature",
            "the run log's answer does not verify against the public key this release pins",
            subject=subject,
        )


def _check_entry_url(entry_url: str, coordinates: PublicationCoordinates, *, subject: str) -> None:
    """Raise unless the entry lives on the public log this release pins."""
    pinned = urlsplit(coordinates.public_log_url)
    entry = urlsplit(entry_url)
    if entry.scheme != "https" or entry.netloc != pinned.netloc:
        _refuse(
            "receipt.entry_url",
            f"the run log says this entry lives at {entry_url}, which is not on "
            f"{coordinates.public_log_url}",
            subject=subject,
            entry_url=entry_url,
        )


def _same_key(carried: PublicKeyRef, pinned: PublicKeyRef) -> bool:
    return (
        carried.algorithm == pinned.algorithm
        and carried.key_id == pinned.key_id
        and carried.public_key == pinned.public_key
    )


def _refuse(check: str, message: str, **details: JsonValue) -> NoReturn:
    raise ValidationError(
        message, code=PUBLICATION_RECEIPT_INVALID, details={"check": check, **details}
    )
