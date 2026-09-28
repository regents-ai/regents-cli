"""Where the local signing key lives: `<techtree home>/identities/`.

`executor-private-key.bin` holds the raw Ed25519 private bytes at 0600 and is created with
O_EXCL, so a second creation is a conflict rather than a silent replacement that would orphan
every receipt signed under the old key. `executor-public.json` is the canonical
`ExecutorIdentity`. The private half is never returned as bytes: callers get a key object
that can sign, and no error detail carries the material. The key identifier is the digest of
the public key bytes, so two files that disagree about which key they describe cannot both be
self-consistent.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import canonical_json_bytes, sha256_digest_bytes
from regents_cli.techtree.crypto import (
    ED25519_PRIVATE_KEY_BYTES,
    generate_private_key,
    load_private_key,
    load_public_key,
    private_key_bytes,
    public_key_bytes,
    public_key_to_base64,
    sign_digest,
    verify_signature,
)
from regents_cli.techtree.errors import ConflictError, NotFoundError, ValidationError
from regents_cli.techtree.fs import (
    atomic_write_bytes,
    ensure_private_directory,
    fsync_directory,
    open_exclusive,
)
from regents_cli.techtree.identity.models import LOCAL_IDENTITY_INVALID, ExecutorIdentity
from regents_cli.techtree.paths import TechtreePaths

PRIVATE_KEY_FILENAME: Final = "executor-private-key.bin"
PUBLIC_IDENTITY_FILENAME: Final = "executor-public.json"

#: Domain-separated so a self-check signature can never be replayed as a signature over a
#: protocol object: no canonical document digests to this value.
IDENTITY_SELF_CHECK_CHALLENGE: Final = b"techtree/identity/self-check/v1"

_FILE_MODE: Final = 0o600


class IdentityStore:
    """Creates, loads, and self-checks the local executor identity."""

    def __init__(
        self, paths: TechtreePaths, *, clock: Callable[[], datetime] | None = None
    ) -> None:
        self._paths = paths
        self._clock = clock or _utc_now

    @property
    def directory(self) -> Path:
        return self._paths.identities_dir

    @property
    def private_key_path(self) -> Path:
        return self.directory / PRIVATE_KEY_FILENAME

    @property
    def public_identity_path(self) -> Path:
        return self.directory / PUBLIC_IDENTITY_FILENAME

    def exists(self) -> bool:
        return self.private_key_path.is_file() and self.public_identity_path.is_file()

    def create(self) -> ExecutorIdentity:
        """Generate a key, write both halves exclusively, and return the public one.

        The private half is written first with O_EXCL: its existence is what means "this
        machine has an identity", so it is the file that has to win the race. The public half
        is derived from it, so rewriting it over a stale one is correct.
        """
        ensure_private_directory(self.directory)
        private_key = generate_private_key()
        try:
            with open_exclusive(self.private_key_path, _FILE_MODE) as handle:
                handle.write(private_key_bytes(private_key))
                handle.flush()
                os.fsync(handle.fileno())
        except ConflictError as error:
            raise ConflictError(
                "this machine already has a local signing key; replacing it would silently "
                "orphan every receipt signed under the old one",
                code=LOCAL_IDENTITY_INVALID,
                details={"path": str(self.private_key_path)},
            ) from error
        identity = _identity_for(private_key, created_at=self._clock())
        atomic_write_bytes(
            self.public_identity_path, canonical_json_bytes(identity), mode=_FILE_MODE
        )
        fsync_directory(self.directory)
        return identity

    def load_public(self) -> ExecutorIdentity:
        path = self.public_identity_path
        try:
            raw = path.read_bytes()
        except FileNotFoundError as error:
            raise NotFoundError(
                "this machine has no local signing identity yet; `regents techtree setup` "
                "creates one",
                code=LOCAL_IDENTITY_INVALID,
                details={"path": str(path)},
            ) from error
        try:
            return ExecutorIdentity.model_validate_json(raw)
        except PydanticValidationError as error:
            raise ValidationError(
                "the stored local identity is not a valid identity document: "
                f"{error.errors()[0]['msg']}",
                code=LOCAL_IDENTITY_INVALID,
                details={"path": str(path)},
            ) from error

    def load_private(self) -> Ed25519PrivateKey:
        """Load the private half; nothing but a key object that can sign reaches the caller."""
        path = self.private_key_path
        try:
            raw = path.read_bytes()
        except FileNotFoundError as error:
            raise NotFoundError(
                "this machine has no local signing key yet; `regents techtree setup` creates one",
                code=LOCAL_IDENTITY_INVALID,
                details={"path": str(path)},
            ) from error
        if len(raw) != ED25519_PRIVATE_KEY_BYTES:
            raise ValidationError(
                "the stored local signing key is not an Ed25519 private key",
                code=LOCAL_IDENTITY_INVALID,
                details={"path": str(path), "length": len(raw)},
            )
        return load_private_key(raw)

    def verify_pair(self) -> bool:
        """Sign a fixed challenge in memory and check it against the public half.

        False for two well-formed files describing different keys; a file that cannot be read
        raises, because "missing" and "does not match itself" call for different repairs.
        """
        private_key = self.load_private()
        identity = self.load_public()
        public_key = load_public_key(public_key_bytes(private_key))
        if public_key_to_base64(public_key) != identity.public_key:
            return False
        if _key_id_for(private_key) != identity.key_id:
            return False
        challenge = sha256_digest_bytes(IDENTITY_SELF_CHECK_CHALLENGE)
        signature = sign_digest(private_key, challenge, key_id=identity.key_id)
        return verify_signature(public_key, challenge, signature)


def _identity_for(private_key: Ed25519PrivateKey, *, created_at: datetime) -> ExecutorIdentity:
    return ExecutorIdentity(
        kind="local_ed25519",
        key_id=_key_id_for(private_key),
        algorithm="ed25519",
        public_key=public_key_to_base64(private_key.public_key()),
        created_at=created_at,
    )


def _key_id_for(private_key: Ed25519PrivateKey) -> str:
    """Derived from the public bytes, never assigned, so it cannot be reused for another key."""
    return sha256_digest_bytes(public_key_bytes(private_key))


def _utc_now() -> datetime:
    return datetime.now(UTC)
