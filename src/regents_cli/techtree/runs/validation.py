"""What a run may assume about its taskset's validation: the publisher's receipt, re-checked.

The lock the receipt was issued under is not shipped; only its digest is. The lock is derived
from what the run owns and must digest to exactly the value the receipt names.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import digest_object, to_json_value
from regents_cli.techtree.constants import TASKSET_LOCK_SCHEMA_VERSION
from regents_cli.techtree.errors import VerificationError
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.models.validation import TasksetLock, TasksetValidationReceipt
from regents_cli.techtree.runs.artifacts import VALIDATION_MARKER_SCHEMA_VERSION, RunInputBundle

TASKSET_VALIDATION_INVALID: Final = "taskset_validation_invalid"
_SOURCE: Final = "publisher_receipt"


@dataclass(frozen=True)
class TasksetValidationOutcome:
    """The validation artifacts an executor needs."""

    lock: TasksetLock
    receipt: TasksetValidationReceipt

    def marker_document(self) -> dict[str, JsonValue]:
        """Return the JSON record persisted beside the run."""
        return {
            "schema_version": VALIDATION_MARKER_SCHEMA_VERSION,
            "source": _SOURCE,
            "lock": to_json_value(self.lock),
            "lock_digest": digest_object(self.lock),
            "receipt": to_json_value(self.receipt),
            "receipt_digest": digest_object(self.receipt),
        }


def validate_taskset(run_id: str, inputs: RunInputBundle) -> TasksetValidationOutcome:
    """Verify the publisher's receipt against the run's own inputs and derive its lock."""
    campaign = inputs.campaign
    source = inputs.source
    receipt = source.publisher_validation
    _require(
        source.publisher_validation_digest == campaign.taskset.validation_receipt_digest,
        "the publisher validation receipt this run owns is not the one the Campaign commits to",
        run_id,
    )
    reference = receipt.normalized_evidence
    _require(
        reference is not None and reference.digest == digest_object(inputs.validation_evidence),
        "the normalized evidence this run owns is not what the publisher's receipt was issued from",
        run_id,
    )
    _require(
        receipt.status == "valid",
        f"the publisher's validation receipt reports {receipt.status}, so this taskset is "
        "not fit to be scored",
        run_id,
        status=receipt.status,
    )
    lock = derive_taskset_lock(run_id, inputs)
    _require(
        digest_object(lock) == receipt.taskset_lock_digest,
        "the taskset lock derived from this Campaign is not the lock the publisher's receipt "
        "was issued under",
        run_id,
    )
    membership = campaign.taskset.membership
    _require(
        lock.ordered_task_hashes == list(membership.ordered_task_hashes)
        and lock.membership_digest == membership.membership_digest
        and lock.task_count == campaign.taskset.selection.num_tasks,
        "the locked task membership is not the membership the Campaign commits to",
        run_id,
    )
    _require(
        inputs.validation_evidence.taskset_lock_digest == receipt.taskset_lock_digest,
        "the normalized evidence was produced under a different taskset lock than the receipt",
        run_id,
    )
    return TasksetValidationOutcome(lock=lock, receipt=receipt)


def derive_taskset_lock(run_id: str, inputs: RunInputBundle) -> TasksetLock:
    """Rebuild the lock the publisher's receipt was issued under from what the run owns."""
    campaign = inputs.campaign
    membership = campaign.taskset.membership
    try:
        return TasksetLock(
            schema_version=TASKSET_LOCK_SCHEMA_VERSION,
            taskset_ref=campaign.taskset.ref,
            engine_digest=inputs.source.publisher_validation.engine_digest,
            resolved_package_digest=campaign.taskset.ref.package.digest,
            ordered_task_hashes=list(membership.ordered_task_hashes),
            membership_digest=membership.membership_digest,
            task_count=len(membership.ordered_task_hashes),
        )
    except PydanticValidationError as error:
        raise VerificationError(
            f"no taskset lock can be derived from this Campaign: {error.errors()[0]['msg']}",
            code=TASKSET_VALIDATION_INVALID,
            details={"run_id": run_id},
        ) from error


def _require(condition: bool, message: str, run_id: str, **details: str) -> None:
    if condition:
        return
    reported: dict[str, JsonValue] = {"run_id": run_id}
    reported.update(details)
    raise VerificationError(message, code=TASKSET_VALIDATION_INVALID, details=reported)
