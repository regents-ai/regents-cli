"""What a ReleaseCore is: the frozen coordinates of one Climb release, every one concrete.

It says nothing about the artifact built from it: the source commit is stamped onto the wheel
at build time (`release/provenance.py`), because an artifact never describes its own identity.
"""

from __future__ import annotations

import base64
import re
from typing import Annotated, Final, Literal, Self

from pydantic import AfterValidator, StringConstraints, model_validator

from regents_cli.techtree.canonical import sha256_digest_bytes
from regents_cli.techtree.constants import DIGEST_PREFIX
from regents_cli.techtree.crypto import ED25519_PUBLIC_KEY_BYTES
from regents_cli.techtree.models.base import Digest, NonEmptyString, ProtocolModel, PublicKeyRef

RELEASE_CORE_SCHEMA_VERSION: Final = "techtree.release-core.v2"

#: Three numbers; nothing merely proposed has a version.
VERSION_PATTERN: Final = r"^[0-9]+(?:\.[0-9]+){2}$"
type Version = Annotated[str, StringConstraints(pattern=VERSION_PATTERN)]

#: A Hermes release tag, which is how the engine installs the subject harness: `v2026.7.20`.
HERMES_TAG_PATTERN: Final = r"^v[0-9]+(?:\.[0-9]+){2,3}$"
type HermesTag = Annotated[str, StringConstraints(pattern=HERMES_TAG_PATTERN)]

RELEASE_ID_PATTERN: Final = r"^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$"
type ReleaseId = Annotated[str, StringConstraints(pattern=RELEASE_ID_PATTERN)]

#: Sixty-four hexadecimal characters, not all zero: nothing hashes to zero.
CONCRETE_DIGEST_PATTERN: Final = rf"^{DIGEST_PREFIX}0*[1-9a-f][0-9a-f]*$"
CONCRETE_DIGEST_LENGTH: Final = len(DIGEST_PREFIX) + 64
type ConcreteDigest = Annotated[
    str,
    StringConstraints(
        pattern=CONCRETE_DIGEST_PATTERN,
        min_length=CONCRETE_DIGEST_LENGTH,
        max_length=CONCRETE_DIGEST_LENGTH,
    ),
]

#: An absolute https content address ending in the digest of the bytes it returns, with no
#: userinfo: a published coordinate is copied everywhere and must carry no credential.
OBJECT_URL_PATTERN: Final = rf"^https://[^\s/@]+/[^\s]*{DIGEST_PREFIX}[0-9a-f]{{64}}$"
_OBJECT_URL_DIGEST_RE: Final = re.compile(rf"{DIGEST_PREFIX}[0-9a-f]{{64}}$")

#: https, no query, no fragment: a submission travels in a body and never in a URL.
PLAIN_HTTPS_URL_PATTERN: Final = r"^https://[^\s/@?#]+(?:/[^\s?#]*)?$"


def _require_resolvable_host(value: str) -> str:
    """Reject an address under `.invalid`, which RFC 2606 guarantees never resolves."""
    authority = value.removeprefix("https://").split("/", 1)[0]
    host = authority.rsplit(":", 1)[0] if ":" in authority else authority
    if host.lower().endswith(".invalid"):
        raise ValueError("an address under .invalid can never resolve")
    return value


type ObjectUrl = Annotated[
    str, StringConstraints(pattern=OBJECT_URL_PATTERN), AfterValidator(_require_resolvable_host)
]
type PlainHttpsUrl = Annotated[
    str,
    StringConstraints(pattern=PLAIN_HTTPS_URL_PATTERN),
    AfterValidator(_require_resolvable_host),
]


def object_url_digest(url: str) -> Digest:
    """The file digest a content address is keyed by."""
    found = _OBJECT_URL_DIGEST_RE.search(url)
    if found is None:
        raise ValueError(f"{url!r} is not keyed by the digest of what it serves")
    return found.group()


class PinnedNetworkKey(PublicKeyRef):
    """The public half of the key the run log countersigns receipts with.

    SECURITY: the identifier is checked to be the digest of the key, so a receipt that names
    this key and carries another is caught without a check of its own. Only the public half
    ever reaches this repository.
    """

    @model_validator(mode="after")
    def _check_the_identifier_is_the_digest_of_the_key(self) -> Self:
        raw = base64.b64decode(self.public_key, validate=True)
        if len(raw) != ED25519_PUBLIC_KEY_BYTES:
            raise ValueError(f"an Ed25519 public key is {ED25519_PUBLIC_KEY_BYTES} raw bytes")
        if not any(raw):
            raise ValueError("an all-zero public key names no key")
        derived = sha256_digest_bytes(raw)
        if self.key_id != derived:
            raise ValueError(
                "a network key identifier is the digest of the key it carries: this one says "
                f"{self.key_id} and carries {derived}"
            )
        return self


class PublicationCoordinates(ProtocolModel):
    """Where a run is published, where it is then read, and who countersigns.

    All three are release coordinates rather than settings: an installed wheel publishes with
    nothing configured, an entry address is checked against the pinned log before a receipt
    is written, and a countersignature is only worth prior knowledge of the key.
    """

    submission_endpoint: PlainHttpsUrl
    public_log_url: PlainHttpsUrl
    network_key: PinnedNetworkKey


class ReleaseCore(ProtocolModel):
    """The frozen coordinates of one Climb release."""

    schema_version: Literal["techtree.release-core.v2"]
    release_id: ReleaseId
    cli_version: Version
    protocol_version: NonEmptyString
    engine_digest: ConcreteDigest
    catalog_digest: ConcreteDigest
    intro_climb_reference: NonEmptyString
    starter_skill_digest: ConcreteDigest
    starter_skill_object_url: ObjectUrl
    minimum_host_hermes_version: Version
    maximum_tested_host_hermes_version: Version
    subject_hermes_version: HermesTag
    publication: PublicationCoordinates
