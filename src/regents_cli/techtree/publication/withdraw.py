"""Withdrawing one published entry: signed with the key that signed the run, never deleted.

The request carries no reason and no public key: nothing a submitter writes appears on the
site, and the network verifies the signature against the key inside the bundle it accepted.
No local record is written; the public log is the record of a withdrawal.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import canonical_json_bytes
from regents_cli.techtree.constants import PUBLICATION_WITHDRAWAL_SCHEMA_VERSION
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.models.base import Digest, ObjectEnvelope
from regents_cli.techtree.publication.models import WithdrawalReceiptPayload, WithdrawalRequest
from regents_cli.techtree.publication.transport import HttpsPublicationTransport
from regents_cli.techtree.publication.verify import (
    PUBLICATION_RECEIPT_INVALID,
    verify_withdrawal_receipt,
)
from regents_cli.techtree.release.models import PublicationCoordinates


@dataclass(frozen=True)
class WithdrawalOutcome:
    """What the run log said when it marked one entry withdrawn."""

    bundle_digest: Digest
    entry_url: str
    withdrawn_at: datetime
    key_id: str


class WithdrawalService:
    """Builds, signs and sends one withdrawal, and checks what came back."""

    def __init__(
        self,
        *,
        coordinates: PublicationCoordinates,
        endpoint: str,
        identity: IdentityService,
        transport: HttpsPublicationTransport,
    ) -> None:
        self._coordinates = coordinates
        self._endpoint = endpoint
        self._identity = identity
        self._transport = transport

    @property
    def endpoint(self) -> str:
        return self._endpoint

    def request(self, bundle_digest: Digest) -> ObjectEnvelope[WithdrawalRequest]:
        """The signed request this withdrawal would send; signing is local work."""
        return self._identity.sign_object(
            WithdrawalRequest(
                schema_version=PUBLICATION_WITHDRAWAL_SCHEMA_VERSION,
                bundle_digest=bundle_digest,
                requested_at=datetime.now(UTC),
            )
        )

    def withdraw(self, bundle_digest: Digest) -> WithdrawalOutcome:
        """Send the signed withdrawal, with no address or Skill headers, and check the answer."""
        signed = self.request(bundle_digest)
        response = self._transport.submit(
            endpoint=self._endpoint,
            body=canonical_json_bytes(signed),
            contributor_address=None,
            skill_name=None,
            skill_github_url=None,
        )
        receipt = self._receipt(response, bundle_digest)
        return WithdrawalOutcome(
            bundle_digest=receipt.bundle_digest,
            entry_url=receipt.entry_url,
            withdrawn_at=receipt.withdrawn_at,
            key_id=self._identity.store.load_public().key_id,
        )

    def _receipt(self, response: bytes, bundle_digest: Digest) -> WithdrawalReceiptPayload:
        try:
            envelope = ObjectEnvelope[WithdrawalReceiptPayload].model_validate_json(response)
        except PydanticValidationError as error:
            raise ValidationError(
                "the run log answered with something that is not a withdrawal receipt, so "
                "nothing is known about what it did",
                code=PUBLICATION_RECEIPT_INVALID,
                details={"bundle_digest": bundle_digest},
            ) from error
        verify_withdrawal_receipt(
            envelope, coordinates=self._coordinates, bundle_digest=bundle_digest
        )
        return envelope.payload
