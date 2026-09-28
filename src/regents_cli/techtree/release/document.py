"""The bytes of a release document, and the digest taken over them.

The ReleaseCore must be byte-identical in the CLI package, the plugin and the website, and two
of those are not Python, so its digest is the SHA-256 of the file as stored. That only works
if the file has one spelling: keys sorted, two-space indent, no ASCII escaping, one trailing
newline.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from importlib.resources import files as resource_files
from importlib.resources.abc import Traversable
from typing import Final

from regents_cli.techtree.canonical import sha256_digest_bytes
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.release.models import ReleaseCore

RELEASE_CORE_FILENAME: Final = "release-core.json"
RELEASE_CORE_INVALID: Final = "release_core_invalid"
RELEASE_CORE_MISSING: Final = "release_core_missing"


def render_document(payload: Mapping[str, JsonValue]) -> bytes:
    """The one byte spelling of a release document."""
    text = json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False)
    return f"{text}\n".encode()


def is_canonical_document(raw: bytes) -> bool:
    """Whether these bytes are already in the one stored spelling."""
    try:
        payload = json.loads(raw)
    except ValueError:
        return False
    if not isinstance(payload, dict):
        return False
    return render_document(payload) == raw


def document_digest(raw: bytes) -> Digest:
    """The digest a release document is published under: the SHA-256 of its stored bytes."""
    return sha256_digest_bytes(raw)


def render_release_core(core: ReleaseCore) -> bytes:
    return render_document(core.model_dump(mode="json"))


def parse_release_core(raw: bytes) -> ReleaseCore:
    try:
        return ReleaseCore.model_validate_json(raw)
    except ValueError as error:
        raise ValidationError(
            f"this is not a valid ReleaseCore: {error}", code=RELEASE_CORE_INVALID
        ) from error


def packaged_resources_root() -> Traversable:
    """The resources directory shipped inside the installed package."""
    return resource_files("regents_cli.techtree") / "resources"


def packaged_release_root() -> Traversable:
    return packaged_resources_root() / "release"


def packaged_release_core_bytes() -> bytes:
    """The exact ReleaseCore bytes this build ships; a build with none is not a release."""
    document = packaged_release_root() / RELEASE_CORE_FILENAME
    if not document.is_file():
        raise ValidationError(
            "this build ships no ReleaseCore; it was not produced by the release generator",
            code=RELEASE_CORE_MISSING,
            details={"file": RELEASE_CORE_FILENAME},
        )
    return document.read_bytes()
