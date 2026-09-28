"""The ordered commitment over one variant's receipts.

Receipts are indexed by task hash and emitted in the TasksetLock's order, never in arrival
order, so two variants of one comparison commit to the same positions. Editing a receipt
breaks its envelope, editing an envelope breaks the manifest, and reordering the manifest
breaks the membership commitment; `verify_receipt_set` recomputes all three from the receipts
rather than trusting any recorded value. Signatures are checked by whoever holds the identity.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Final, Literal, Self

from pydantic import Field, model_validator

from regents_cli.techtree.canonical import (
    canonical_json_bytes,
    digest_object,
    sha256_digest_bytes,
    validate_digest,
)
from regents_cli.techtree.errors import VerificationError
from regents_cli.techtree.fs import atomic_write_bytes, ensure_private_directory
from regents_cli.techtree.models.base import (
    ArtifactRef,
    Digest,
    NonEmptyString,
    ObjectEnvelope,
    ProtocolModel,
)
from regents_cli.techtree.models.episode_receipt import EpisodeReceiptV2
from regents_cli.techtree.models.experiment import ExperimentVariant
from regents_cli.techtree.receipts.episode import (
    EPISODE_COUNT_MISMATCH,
    TASK_MEMBERSHIP_MISMATCH,
)
from regents_cli.techtree.tasksets.membership import membership_digest

RECEIPT_SET_SCHEMA_VERSION: Final = "techtree.receipt-set.v1alpha1"
RECEIPT_SET_INVALID: Final = "receipt_set_invalid"
RECEIPT_SET_MEDIA_TYPE: Final = "application/json"

#: The manifest sits beside the variant's receipt directory, not inside it, because every
#: file in that directory is read back as a receipt.
_RECEIPTS_DIRECTORY: Final = "receipts"
_RECEIPT_SET_SUFFIX: Final = "-set.json"


class ReceiptSetManifest(ProtocolModel):
    """One variant's receipts, committed to in committed task order."""

    schema_version: Literal["techtree.receipt-set.v1alpha1"]
    run_id: NonEmptyString
    variant: ExperimentVariant
    experiment_manifest_digest: Digest
    ordered_receipt_digests: list[Digest]
    task_membership_digest: Digest
    receipt_count: int = Field(ge=1)

    @model_validator(mode="after")
    def _check_the_commitment_is_internally_consistent(self) -> Self:
        if len(self.ordered_receipt_digests) != self.receipt_count:
            raise ValueError(
                f"the manifest lists {len(self.ordered_receipt_digests)} receipt digests and "
                f"claims a receipt_count of {self.receipt_count}"
            )
        if len(set(self.ordered_receipt_digests)) != len(self.ordered_receipt_digests):
            raise ValueError(
                "a receipt set commits to each receipt once; a repeated digest would let one "
                "episode occupy two positions"
            )
        return self


def build_receipt_set(
    *,
    run_id: str,
    variant: ExperimentVariant,
    experiment_manifest_digest: Digest,
    signed_receipts: Sequence[ObjectEnvelope[EpisodeReceiptV2]],
    ordered_task_hashes: Sequence[Digest],
) -> ReceiptSetManifest:
    """Order receipts by TasksetLock membership and build the commitment."""
    committed = [validate_digest(value) for value in ordered_task_hashes]
    by_task = _envelopes_by_task(
        signed_receipts,
        committed=committed,
        run_id=run_id,
        variant=variant,
        experiment_manifest_digest=experiment_manifest_digest,
    )
    return ReceiptSetManifest(
        schema_version=RECEIPT_SET_SCHEMA_VERSION,
        run_id=run_id,
        variant=variant,
        experiment_manifest_digest=validate_digest(experiment_manifest_digest),
        ordered_receipt_digests=[by_task[task_hash].payload_digest for task_hash in committed],
        task_membership_digest=membership_digest(committed),
        receipt_count=len(committed),
    )


def verify_receipt_set(
    *,
    manifest: ReceiptSetManifest,
    signed_receipts: Sequence[ObjectEnvelope[EpisodeReceiptV2]],
    ordered_task_hashes: Sequence[Digest],
) -> None:
    """Rebuild the commitment from the receipts and refuse if it differs."""
    rebuilt = build_receipt_set(
        run_id=manifest.run_id,
        variant=manifest.variant,
        experiment_manifest_digest=manifest.experiment_manifest_digest,
        signed_receipts=signed_receipts,
        ordered_task_hashes=ordered_task_hashes,
    )
    if rebuilt == manifest:
        return
    raise VerificationError(
        "this receipt set does not commit to the receipts it was given; one of them, or the "
        "manifest itself, changed after it was written",
        code=RECEIPT_SET_INVALID,
        details={
            "run_id": manifest.run_id,
            "variant": manifest.variant.value,
            "recorded": list(manifest.ordered_receipt_digests),
            "recomputed": list(rebuilt.ordered_receipt_digests),
        },
    )


def receipt_set_path(run_root: Path, variant: ExperimentVariant) -> Path:
    return run_root / _RECEIPTS_DIRECTORY / f"{variant.value}{_RECEIPT_SET_SUFFIX}"


def write_receipt_set(manifest: ReceiptSetManifest, path: Path) -> ArtifactRef:
    """Write canonical bytes, so the file's digest and the object's digest are one number."""
    data = canonical_json_bytes(manifest)
    ensure_private_directory(path.parent)
    atomic_write_bytes(path, data)
    return ArtifactRef(
        digest=sha256_digest_bytes(data),
        media_type=RECEIPT_SET_MEDIA_TYPE,
        size=len(data),
        relative_path=None,
    )


def _envelopes_by_task(
    signed_receipts: Sequence[ObjectEnvelope[EpisodeReceiptV2]],
    *,
    committed: Sequence[Digest],
    run_id: str,
    variant: ExperimentVariant,
    experiment_manifest_digest: Digest,
) -> dict[Digest, ObjectEnvelope[EpisodeReceiptV2]]:
    if len(signed_receipts) != len(committed):
        raise VerificationError(
            f"the {variant.value} receipt set was given {len(signed_receipts)} receipts for "
            f"{len(committed)} committed tasks",
            code=EPISODE_COUNT_MISMATCH,
            details={
                "variant": variant.value,
                "receipts": len(signed_receipts),
                "committed": len(committed),
            },
        )
    by_task: dict[Digest, ObjectEnvelope[EpisodeReceiptV2]] = {}
    for envelope in signed_receipts:
        receipt = envelope.payload
        _require_sealed(envelope)
        _require_belongs(
            receipt,
            run_id=run_id,
            variant=variant,
            experiment_manifest_digest=experiment_manifest_digest,
        )
        task_hash = validate_digest(receipt.task_hash)
        if task_hash in by_task:
            raise VerificationError(
                f"two {variant.value} receipts claim task {task_hash}",
                code=TASK_MEMBERSHIP_MISMATCH,
                details={"variant": variant.value, "task_hash": task_hash},
            )
        by_task[task_hash] = envelope
    missing: list[str] = [value for value in committed if value not in by_task]
    unexpected: list[str] = sorted(set(by_task) - set(committed))
    if missing or unexpected:
        raise VerificationError(
            f"the {variant.value} receipts do not cover the tasks the Campaign commits to",
            code=TASK_MEMBERSHIP_MISMATCH,
            details={"variant": variant.value, "missing": missing, "unexpected": unexpected},
        )
    return by_task


def _require_sealed(envelope: ObjectEnvelope[EpisodeReceiptV2]) -> None:
    computed = digest_object(envelope.payload)
    if computed == envelope.payload_digest:
        return
    raise VerificationError(
        "a receipt no longer matches the digest it was sealed under, so it was changed after "
        "it was written",
        code=RECEIPT_SET_INVALID,
        details={
            "receipt_id": envelope.payload.id,
            "sealed": envelope.payload_digest,
            "computed": computed,
        },
    )


def _require_belongs(
    receipt: EpisodeReceiptV2,
    *,
    run_id: str,
    variant: ExperimentVariant,
    experiment_manifest_digest: Digest,
) -> None:
    if (
        receipt.run_id == run_id
        and receipt.variant is variant
        and receipt.experiment_manifest_digest == experiment_manifest_digest
    ):
        return
    raise VerificationError(
        "a receipt from a different run, variant or experiment manifest cannot join this "
        "receipt set",
        code=RECEIPT_SET_INVALID,
        details={
            "receipt_id": receipt.id,
            "run_id": receipt.run_id,
            "variant": receipt.variant.value,
            "experiment_manifest_digest": receipt.experiment_manifest_digest,
        },
    )
