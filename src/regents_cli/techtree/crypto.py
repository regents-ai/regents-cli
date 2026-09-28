"""Ed25519 keys, and signatures over the ASCII digest string (`sha256:<hex>`).

Signing the digest string rather than the canonical bytes lets a verifier check a signature
holding only the digest that appears in the document. Where keys live is `identity`'s job.
"""

from __future__ import annotations

import base64

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from regents_cli.techtree.canonical import validate_digest
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import Digest, SignatureEnvelope

ED25519_PRIVATE_KEY_BYTES = 32
ED25519_PUBLIC_KEY_BYTES = 32
ED25519_SIGNATURE_BYTES = 64


def generate_private_key() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.generate()


def public_key_bytes(private_key: Ed25519PrivateKey) -> bytes:
    return private_key.public_key().public_bytes_raw()


def private_key_bytes(private_key: Ed25519PrivateKey) -> bytes:
    return private_key.private_bytes_raw()


def load_private_key(raw: bytes) -> Ed25519PrivateKey:
    if len(raw) != ED25519_PRIVATE_KEY_BYTES:
        raise ValidationError(
            f"Ed25519 private keys are {ED25519_PRIVATE_KEY_BYTES} raw bytes",
            details={"length": len(raw)},
        )
    return Ed25519PrivateKey.from_private_bytes(raw)


def load_public_key(raw: bytes) -> Ed25519PublicKey:
    if len(raw) != ED25519_PUBLIC_KEY_BYTES:
        raise ValidationError(
            f"Ed25519 public keys are {ED25519_PUBLIC_KEY_BYTES} raw bytes",
            details={"length": len(raw)},
        )
    return Ed25519PublicKey.from_public_bytes(raw)


def public_key_to_base64(public_key: Ed25519PublicKey) -> str:
    return base64.b64encode(public_key.public_bytes_raw()).decode("ascii")


def sign_digest(
    private_key: Ed25519PrivateKey, digest: Digest, *, key_id: str
) -> SignatureEnvelope:
    """Sign the ASCII digest string."""
    signature = private_key.sign(validate_digest(digest).encode("ascii"))
    return SignatureEnvelope(
        algorithm="ed25519",
        key_id=key_id,
        signature=base64.b64encode(signature).decode("ascii"),
    )


def verify_signature(
    public_key: Ed25519PublicKey, digest: Digest, signature: SignatureEnvelope
) -> bool:
    """False for a well-formed but wrong signature; a malformed digest raises."""
    message = validate_digest(digest).encode("ascii")
    raw_signature = base64.b64decode(signature.signature, validate=True)
    if len(raw_signature) != ED25519_SIGNATURE_BYTES:
        return False
    try:
        public_key.verify(raw_signature, message)
    except InvalidSignature:
        return False
    return True
