"""Every V2 document Techtree 0.3.0 writes still round-trips to the same bytes and digest.

The costly failure: a renamed field, a narrowed enum or a changed default makes this build
compute a different digest for a document 0.3.0 signed, so every existing proof, catalog entry
and published climb stops verifying. The expected digests were computed by Techtree 0.3.0's
own models from these same golden files.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import BaseModel

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object
from regents_cli.techtree.identity.models import ExecutorIdentity
from regents_cli.techtree.models.base import ObjectEnvelope
from regents_cli.techtree.models.campaign import CampaignSpecV2
from regents_cli.techtree.models.catalog import ClimbSummaryV2
from regents_cli.techtree.models.climb import ClimbManifest
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.episode_receipt import EpisodeReceiptV2
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import ExperimentManifestV2
from regents_cli.techtree.models.run import RunRequestV2
from regents_cli.techtree.models.uplift_report import UpliftReportV2
from regents_cli.techtree.models.validation import TasksetLock, TasksetValidationReceipt
from regents_cli.techtree.receipts.execution import ComparisonExecutionRecord

GOLDEN = Path(__file__).parent / "fixtures" / "golden"

CASES: dict[str, tuple[type[BaseModel], str]] = {
    "campaign-v2.json": (
        CampaignSpecV2,
        "sha256:6c2120a1e571fef9bfedd8b2bae282d1233016d42fdde8a82f9925d78c2d838a",
    ),
    "campaign-parity-candidate.json": (
        CampaignSpecV2,
        "sha256:18cf196010e2135f5367cfae477ab13122a471ba9b25bc4290b4d0acfa409617",
    ),
    "climb-v2.json": (
        ClimbManifest,
        "sha256:95950b244eb2f8035be3c2c5c43acc98f5ee5352fc1d71ce69f09ab8031f1e2a",
    ),
    "climb.json": (
        ClimbManifest,
        "sha256:8a98cf28affe2de98e3431db3b2a26b0a6dc60861fc9fb0f264d8ca044c217ba",
    ),
    "climb-summary-v2.json": (
        ClimbSummaryV2,
        "sha256:f175a87dbee883c7358a32620ad2409539f80e83e7f655cae16d2f989bc99949",
    ),
    "comparison-execution.json": (
        ComparisonExecutionRecord,
        "sha256:9b25006e88f7bec19318ae6b4074d1005d747d699959fb45dc2998bf4d46834c",
    ),
    "data-policy.json": (
        DataPolicy,
        "sha256:f61fff0ff5941205fca8fc044c81e7a56aed9017539f6927ab9df0e81f70f88b",
    ),
    "episode-receipt-v2.json": (
        ObjectEnvelope[EpisodeReceiptV2],
        "sha256:37972a531cf983e8d0d5114c478a7c03053c36712f5f059a96c67a14304ebec9",
    ),
    "execution-plan.json": (
        ResolvedExecutionPlan,
        "sha256:01cb3af651c0c4c61686554c762a58d00734e5feeae7d9bc8cc09b197ea90d3b",
    ),
    "executor-identity.json": (
        ExecutorIdentity,
        "sha256:329813ff239795e2c765eb169a9d6d3ad3eaec263403a8ad61899bf2fbb25d77",
    ),
    "experiment-baseline-v2.json": (
        ExperimentManifestV2,
        "sha256:ac01bcd2e2e7aa9d59561cd9f2db3689573dd32710eeb3c5ba51b4a632d30bf8",
    ),
    "experiment-candidate-v2.json": (
        ExperimentManifestV2,
        "sha256:6d195c91cc43f92e2bdd0d30446db1b6c3bd9fe1632e07040e26a2566f6063a6",
    ),
    "run-request-v2.json": (
        RunRequestV2,
        "sha256:da22d6d48f582db69212ca841f717ac4169a51d54626cbd979889d309f92f98d",
    ),
    "taskset-lock.json": (
        TasksetLock,
        "sha256:6b9044be827c645e165347bf40d9fcb744c132eb8066c92bb5ed2834d6db5543",
    ),
    "taskset-validation-receipt.json": (
        TasksetValidationReceipt,
        "sha256:8ccab5ac9e48a25ea26d621551b578ae4e210b61f950700477ae75252af27504",
    ),
    "uplift-report-v2.json": (
        ObjectEnvelope[UpliftReportV2],
        "sha256:134eed19e4d6c9e8237e9b0112557a5f79b674a5a714046a6dda6f72297700c0",
    ),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_golden_round_trips_to_the_bytes_and_digest_0_3_0_computed(name: str) -> None:
    model, expected_digest = CASES[name]
    raw = (GOLDEN / name).read_bytes()
    parsed = model.model_validate_json(raw)
    assert canonical_json_bytes(parsed) == canonical_json_bytes(json.loads(raw))
    assert digest_object(parsed) == expected_digest
