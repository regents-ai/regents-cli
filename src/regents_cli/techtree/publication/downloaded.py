"""Checking a Result bundle downloaded from the run log, without trusting the site.

The files are laid back out as a proof directory in a temporary folder, the bundle verifier
reads it as it reads any other, and one check is added: the digest the document says it
publishes has to be the digest of the signed manifest inside it.
"""

from __future__ import annotations

import json
from base64 import b64decode
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from typing import Final

from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.constants import PUBLICATION_SUBMISSION_SCHEMA_VERSION
from regents_cli.techtree.identity.models import (
    VerificationMessage,
    VerificationResult,
    VerificationStatus,
)
from regents_cli.techtree.models.base import ObjectEnvelope
from regents_cli.techtree.publication.models import PublicationSubmission
from regents_cli.techtree.receipts.bundle import (
    BUNDLE_MANIFEST_FILENAME,
    PROOF_BUNDLE_INVALID,
    LocalProofBundleManifest,
)
from regents_cli.techtree.receipts.verify import verify_local_bundle

_DIGEST_CHECK: Final = "publication.bundle_digest"
_DOCUMENT_CHECK: Final = "publication.document"


def is_downloaded_bundle(path: Path) -> bool:
    """Whether a file declares itself a published Result bundle."""
    try:
        document = json.loads(path.read_bytes())
    except (OSError, ValueError):
        return False
    return (
        isinstance(document, dict)
        and document.get("schema_version") == PUBLICATION_SUBMISSION_SCHEMA_VERSION
    )


def verify_downloaded_bundle(path: Path) -> VerificationResult:
    """Verify a downloaded Result bundle as the proof directory it carries."""
    try:
        submission = PublicationSubmission.model_validate_json(path.read_bytes())
    except (OSError, PydanticValidationError):
        return _refused(f"{path.name} is not a readable Result bundle")
    with opened_submission(submission, label=path.name) as (_root, result):
        return result


@contextmanager
def opened_submission(
    submission: PublicationSubmission, *, label: str
) -> Iterator[tuple[Path, VerificationResult]]:
    """The submission laid out as a proof directory, and its verification; the directory is
    gone when the block ends."""
    with TemporaryDirectory(prefix="techtree-published-") as scratch:
        root = Path(scratch)
        refusal = _lay_out(root, submission, label)
        if refusal is not None:
            yield root, _refused(refusal)
            return
        result = verify_local_bundle(root)
        digest = _digest_check(root, submission)
        yield (
            root,
            VerificationResult(
                verified=result.verified and digest.status == "passed",
                messages=[digest, *result.messages],
            ),
        )


def _lay_out(root: Path, submission: PublicationSubmission, label: str) -> str | None:
    for name, encoded in submission.files.items():
        # SECURITY: a file name is a place inside the bundle, never a path out of it.
        relative = _relative(name)
        if relative is None:
            return f"{label} places a file outside its bundle: {name}"
        destination = root.joinpath(*relative.parts)
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(b64decode(encoded, validate=True))
        except OSError:
            return f"{label} places two files at {name}"
    return None


def _relative(name: str) -> PurePosixPath | None:
    relative = PurePosixPath(name)
    if relative.is_absolute() or str(relative) != name or ".." in relative.parts:
        return None
    return relative


def _digest_check(root: Path, submission: PublicationSubmission) -> VerificationMessage:
    try:
        manifest = ObjectEnvelope[LocalProofBundleManifest].model_validate_json(
            (root / BUNDLE_MANIFEST_FILENAME).read_bytes()
        )
    except (OSError, PydanticValidationError):
        return _message(
            _DIGEST_CHECK, "failed", f"the bundle's {BUNDLE_MANIFEST_FILENAME} cannot be read"
        )
    if manifest.payload_digest != submission.bundle_digest:
        return _message(
            _DIGEST_CHECK,
            "failed",
            f"the document names bundle {submission.bundle_digest}, but the files it carries "
            f"are bundle {manifest.payload_digest}",
        )
    return _message(
        _DIGEST_CHECK, "passed", f"the files are the published bundle {submission.bundle_digest}"
    )


def _message(identifier: str, status: VerificationStatus, detail: str) -> VerificationMessage:
    return VerificationMessage(
        id=identifier, status=status, code=PROOF_BUNDLE_INVALID, detail=detail
    )


def _refused(detail: str) -> VerificationResult:
    return VerificationResult(
        verified=False, messages=[_message(_DOCUMENT_CHECK, "failed", detail)]
    )
