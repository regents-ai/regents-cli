"""Every golden document round-trips to the same bytes and the digest this build pins.

The costly failure: a renamed field, a narrowed enum or a changed default silently changes
the digest this build computes for a document it signs, so proofs, catalog entries and
published Climbs stop agreeing with the documents they name. A deliberate change to a
document's shape regenerates the goldens (scripts/techtree/build_goldens.py) and re-pins
these digests with it.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import BaseModel

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object
from regents_cli.techtree.identity.models import ExecutorIdentity
from regents_cli.techtree.models.base import ObjectEnvelope
from regents_cli.techtree.models.campaign import CampaignSpecV4
from regents_cli.techtree.models.catalog import ClimbSummaryV2
from regents_cli.techtree.models.climb import ClimbManifest
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.episode_receipt import EpisodeReceiptV3
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import ExperimentManifestV4
from regents_cli.techtree.models.run import RunRequestV2
from regents_cli.techtree.models.uplift_report import UpliftReportV3
from regents_cli.techtree.models.validation import TasksetLock, TasksetValidationReceipt
from regents_cli.techtree.receipts.execution import ComparisonExecutionRecord

GOLDEN = Path(__file__).parent / "fixtures" / "golden"

CASES: dict[str, tuple[type[BaseModel], str]] = {
    "campaign-v4.json": (
        CampaignSpecV4,
        "sha256:35432972c4cc98245d63a862861c0f8285b58b1cc8772133217e798a25f3c5a8",
    ),
    "campaign-parity-candidate.json": (
        CampaignSpecV4,
        "sha256:1ed3fece70f9a00c35d0ae080a7d15a1006272adf4c15bdaeb111fc06d055c2b",
    ),
    "climb-v2.json": (
        ClimbManifest,
        "sha256:5015ce4676d3c17eaecd52e714e6253f1c3e01d449493736927cbec57ec72c0e",
    ),
    "climb.json": (
        ClimbManifest,
        "sha256:9cc24f6d26c7622a3b36cffffc4bf7c2419cd17425491b1cf59adbcde12f7ba4",
    ),
    "climb-summary-v2.json": (
        ClimbSummaryV2,
        "sha256:2618b333a8ee58cb438d0557e908af3fc833b04912ddaa8581f221ba7a019b83",
    ),
    "comparison-execution.json": (
        ComparisonExecutionRecord,
        "sha256:153c44943199ca01ae5904b0802566a9ce8c6338292afb1e85edb5880d060fe9",
    ),
    "data-policy.json": (
        DataPolicy,
        "sha256:f61fff0ff5941205fca8fc044c81e7a56aed9017539f6927ab9df0e81f70f88b",
    ),
    "episode-receipt-v3.json": (
        ObjectEnvelope[EpisodeReceiptV3],
        "sha256:4bce630c4e057c8fa011ad22857d57564f659a34a5806ffaafa6c1c9329771b6",
    ),
    "execution-plan.json": (
        ResolvedExecutionPlan,
        "sha256:01cb3af651c0c4c61686554c762a58d00734e5feeae7d9bc8cc09b197ea90d3b",
    ),
    "executor-identity.json": (
        ExecutorIdentity,
        "sha256:329813ff239795e2c765eb169a9d6d3ad3eaec263403a8ad61899bf2fbb25d77",
    ),
    "experiment-baseline-v4.json": (
        ExperimentManifestV4,
        "sha256:1fd63b06dd0b3bec3f32894142a017758d954554842c74a5f09f801c013c79a4",
    ),
    "experiment-candidate-v4.json": (
        ExperimentManifestV4,
        "sha256:41661151e13adb0699d2a44106478111e6dd8a5e239c9319e258678a8da8c6f6",
    ),
    "run-request-v2.json": (
        RunRequestV2,
        "sha256:d1afc8d83779564e2f5d9a3a52bfe56ef722b9c3949394e084749b0da03f9f74",
    ),
    "taskset-lock.json": (
        TasksetLock,
        "sha256:6b9044be827c645e165347bf40d9fcb744c132eb8066c92bb5ed2834d6db5543",
    ),
    "taskset-validation-receipt.json": (
        TasksetValidationReceipt,
        "sha256:8ccab5ac9e48a25ea26d621551b578ae4e210b61f950700477ae75252af27504",
    ),
    "uplift-report-v3.json": (
        ObjectEnvelope[UpliftReportV3],
        "sha256:7683e88ab99d45a0be84898c714afefdcbe4ee2d57af5545268b86a9bc04c048",
    ),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_golden_round_trips_to_its_bytes_and_pinned_digest(name: str) -> None:
    model, expected_digest = CASES[name]
    raw = (GOLDEN / name).read_bytes()
    parsed = model.model_validate_json(raw)
    assert canonical_json_bytes(parsed) == canonical_json_bytes(json.loads(raw))
    assert digest_object(parsed) == expected_digest
