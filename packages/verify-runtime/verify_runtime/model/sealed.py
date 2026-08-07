"""Canonical sealed verifier material and answer-key commitments."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .base import ModelValidationError, canonical_json_bytes, require_json_value, sha256_bytes


SEALED_VERIFIER_PACKET_FORMAT = "regent-forge-prime-v1"


def sealed_verifier_material(
    *,
    family: Mapping[str, Any],
    task: Mapping[str, Any],
    grader_source: bytes,
    answer_key: Any,
) -> bytes:
    """Build the canonical verifier material whose digest commits the answer key.

    The public reference-commitment index and the task commitment are
    deliberately omitted from this input: including either would make
    commitment creation circular.  The raw answer key exists only in the
    separately constructed sealed packet.
    """

    if not isinstance(grader_source, bytes):
        raise ModelValidationError("sealed verifier grader source must be bytes")
    answer_key = require_json_value(answer_key, "sealed.answer_key")
    family_without_identity = dict(family)
    family_without_identity.pop("family_id", None)
    # The reference commitment list is the public index of these commitments;
    # including it would make each reference commitment circular.
    family_without_identity.pop("reference_questions", None)
    task_without_commitment = dict(task)
    task_without_commitment.pop("family_id", None)
    task_without_commitment.pop("answer_key_commitment", None)
    return canonical_json_bytes(
        {
            "schema_version": 1,
            "format": SEALED_VERIFIER_PACKET_FORMAT,
            "family": family_without_identity,
            "task": task_without_commitment,
            "grader": {
                "content": grader_source.decode("utf-8"),
                "digest": sha256_bytes(grader_source),
            },
            "answer_key": answer_key,
        }
    )


def sealed_verifier_packet(
    *,
    family: Mapping[str, Any],
    task: Mapping[str, Any],
    grader_source: bytes,
    answer_key: Any,
) -> bytes:
    """Build the private packet sent to the verifier boundary.

    The packet retains the full family and task identities for provider-side
    validation.  The lock commitment is computed from
    :func:`sealed_verifier_material`, whose circular public commitment fields
    are excluded from the digest input.
    """

    if not isinstance(grader_source, bytes):
        raise ModelValidationError("sealed verifier grader source must be bytes")
    answer_key = require_json_value(answer_key, "sealed.answer_key")
    return canonical_json_bytes(
        {
            "schema_version": 1,
            "format": SEALED_VERIFIER_PACKET_FORMAT,
            "family": dict(family),
            "task": dict(task),
            "grader": {
                "content": grader_source.decode("utf-8"),
                "digest": sha256_bytes(grader_source),
            },
            "answer_key": answer_key,
        }
    )


def sealed_answer_key_commitment(
    *,
    family: Mapping[str, Any],
    task: Mapping[str, Any],
    grader_source: bytes,
    answer_key: Any,
) -> str:
    """Commit to canonical sealed material, never to raw answer text alone."""

    return sha256_bytes(
        sealed_verifier_material(
            family=family,
            task=task,
            grader_source=grader_source,
            answer_key=answer_key,
        )
    )
