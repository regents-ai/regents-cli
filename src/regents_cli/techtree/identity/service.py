"""Signing objects, and checking signed ones.

The signature is made over the digest of the payload's canonical bytes, and the check
recomputes that digest from the payload rather than trusting the one the envelope records:
a stored envelope never recalculates `payload_digest`, so an edited payload keeps its old
digest and looks fine to a parser. Verification takes the identity to check against, because
a proof bundle is verified against the key it carries, offline, on another machine. A verified
signature proves only that these bytes have not changed since the holder of that self-issued
key signed them.
"""

from __future__ import annotations

from base64 import b64decode
from typing import Final

from pydantic import BaseModel

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.crypto import load_public_key, sign_digest, verify_signature
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.identity.models import (
    LOCAL_IDENTITY_INVALID,
    SIGNATURE_VERIFICATION_FAILED,
    ExecutorIdentity,
    VerificationMessage,
    VerificationResult,
)
from regents_cli.techtree.identity.store import IdentityStore
from regents_cli.techtree.models.base import ObjectEnvelope

_PASSED: Final = "passed"
_FAILED: Final = "failed"


class IdentityService:
    """The local identity, ready to sign and to check its own signatures."""

    def __init__(self, store: IdentityStore) -> None:
        self._store = store

    @property
    def store(self) -> IdentityStore:
        return self._store

    def ensure(self) -> ExecutorIdentity:
        """Return the existing valid identity, creating one if there is none.

        An identity whose two halves no longer describe each other is never replaced: the old
        key signed real receipts, and replacing it would make those signatures unverifiable
        without saying so.
        """
        if not self._store.exists():
            return self._store.create()
        identity = self._store.load_public()
        if self._store.verify_pair():
            return identity
        raise ValidationError(
            "the two halves of this machine's local signing identity do not describe the "
            "same key, so nothing may be signed with it",
            code=LOCAL_IDENTITY_INVALID,
            details={"key_id": identity.key_id},
        )

    def sign_object[T: BaseModel](self, value: T) -> ObjectEnvelope[T]:
        """Canonicalize, digest, and sign one protocol object."""
        identity = self._store.load_public()
        digest = digest_object(value)
        signature = sign_digest(self._store.load_private(), digest, key_id=identity.key_id)
        return ObjectEnvelope[T](payload=value, payload_digest=digest, signature=signature)

    def verify_envelope[T: BaseModel](self, envelope: ObjectEnvelope[T]) -> VerificationResult:
        """Verify one envelope against this machine's own public identity."""
        return verify_signed_object(identity=self._store.load_public(), envelope=envelope)


def verify_signed_object[T: BaseModel](
    *, identity: ExecutorIdentity, envelope: ObjectEnvelope[T], subject: str = "object"
) -> VerificationResult:
    """Verify one envelope's digest and signature against a public identity.

    `subject` names what is being checked, so a reader of a failed bundle learns which of
    forty receipts is the problem.
    """
    messages: list[VerificationMessage] = []
    computed = digest_object(envelope.payload)
    digest_matches = computed == envelope.payload_digest
    messages.append(
        VerificationMessage(
            id=f"{subject}.payload_digest",
            status=_PASSED if digest_matches else _FAILED,
            code=SIGNATURE_VERIFICATION_FAILED,
            detail=(
                "the payload still matches the digest it was signed under"
                if digest_matches
                else "the payload no longer matches the digest it was signed under: "
                f"sealed {envelope.payload_digest}, computed {computed}"
            ),
        )
    )
    signature = envelope.signature
    if signature is None:
        messages.append(
            VerificationMessage(
                id=f"{subject}.signature_present",
                status=_FAILED,
                code=SIGNATURE_VERIFICATION_FAILED,
                detail="this object carries no signature, so nothing vouches for it",
            )
        )
        return VerificationResult(verified=False, messages=messages)
    named_key = signature.key_id == identity.key_id
    messages.append(
        VerificationMessage(
            id=f"{subject}.signature_key",
            status=_PASSED if named_key else _FAILED,
            code=LOCAL_IDENTITY_INVALID,
            detail=(
                f"signed by key {identity.key_id}"
                if named_key
                else f"signed by key {signature.key_id}, which is not the key "
                f"{identity.key_id} this proof carries"
            ),
        )
    )
    verified = named_key and digest_matches and _signature_verifies(identity, envelope)
    messages.append(
        VerificationMessage(
            id=f"{subject}.signature",
            status=_PASSED if verified else _FAILED,
            code=SIGNATURE_VERIFICATION_FAILED,
            detail=(
                "the signature verifies against the public key carried with it"
                if verified
                else "the signature does not verify against the public key carried with it"
            ),
        )
    )
    return VerificationResult(verified=verified, messages=messages)


def _signature_verifies[T: BaseModel](
    identity: ExecutorIdentity, envelope: ObjectEnvelope[T]
) -> bool:
    signature = envelope.signature
    if signature is None:
        return False
    public_key = load_public_key(b64decode(identity.public_key, validate=True))
    return verify_signature(public_key, envelope.payload_digest, signature)
