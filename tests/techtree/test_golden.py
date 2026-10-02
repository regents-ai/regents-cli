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
from regents_cli.techtree.models.campaign import CampaignSpecV3
from regents_cli.techtree.models.catalog import ClimbSummaryV2
from regents_cli.techtree.models.climb import ClimbManifest
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.episode_receipt import EpisodeReceiptV3
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import ExperimentManifestV3
from regents_cli.techtree.models.run import RunRequestV2
from regents_cli.techtree.models.uplift_report import UpliftReportV2
from regents_cli.techtree.models.validation import TasksetLock, TasksetValidationReceipt
from regents_cli.techtree.receipts.execution import ComparisonExecutionRecord

GOLDEN = Path(__file__).parent / "fixtures" / "golden"

CASES: dict[str, tuple[type[BaseModel], str]] = {
    "campaign-v3.json": (
        CampaignSpecV3,
        "sha256:c72a742310795b4bf846b34e33c59e3ecd8e0eda9c7323e832d1dac408e9acee",
    ),
    "campaign-parity-candidate.json": (
        CampaignSpecV3,
        "sha256:2539a3874372f62243702fccee78138f51bf77a89c089c283913188f84a35275",
    ),
    "climb-v2.json": (
        ClimbManifest,
        "sha256:19b894d5c3d5dfbeac479c6fadbc6a702eb7064c7cdb6098c473371363e111c7",
    ),
    "climb.json": (
        ClimbManifest,
        "sha256:9cc24f6d26c7622a3b36cffffc4bf7c2419cd17425491b1cf59adbcde12f7ba4",
    ),
    "climb-summary-v2.json": (
        ClimbSummaryV2,
        "sha256:8d8e037f89576d4f53abafc085ef4f72e91c8d7faf97639a2e997f46c1f1dcdb",
    ),
    "comparison-execution.json": (
        ComparisonExecutionRecord,
        "sha256:6b1eb8e54d4c86f51615c3a7c30f9c0f916d8db13071c565aa7f961c9b026815",
    ),
    "data-policy.json": (
        DataPolicy,
        "sha256:f61fff0ff5941205fca8fc044c81e7a56aed9017539f6927ab9df0e81f70f88b",
    ),
    "episode-receipt-v3.json": (
        ObjectEnvelope[EpisodeReceiptV3],
        "sha256:9fb2368b7451d4acb11a32455451a00ea85b24bfd4dd03a7508250f7bf32ca6e",
    ),
    "execution-plan.json": (
        ResolvedExecutionPlan,
        "sha256:01cb3af651c0c4c61686554c762a58d00734e5feeae7d9bc8cc09b197ea90d3b",
    ),
    "executor-identity.json": (
        ExecutorIdentity,
        "sha256:329813ff239795e2c765eb169a9d6d3ad3eaec263403a8ad61899bf2fbb25d77",
    ),
    "experiment-baseline-v3.json": (
        ExperimentManifestV3,
        "sha256:9c9961f4d8e6f131dd23e65fdc20a8cf5e6574298635c990646b3d0d86333976",
    ),
    "experiment-candidate-v3.json": (
        ExperimentManifestV3,
        "sha256:0eb81dbd2ce81eabe29615a4ecd4bca33a1e689e3c6f705f794699ce7b0858a4",
    ),
    "run-request-v2.json": (
        RunRequestV2,
        "sha256:a97f675dd3aada03d89387687aa9e787661b008e3c00afe109c1273cd8b8282c",
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
        "sha256:cb98aff2c90b27fb6ccfec701ae489da1e16738cd25b4a597ff9164c501cfb0e",
    ),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_golden_round_trips_to_its_bytes_and_pinned_digest(name: str) -> None:
    model, expected_digest = CASES[name]
    raw = (GOLDEN / name).read_bytes()
    parsed = model.model_validate_json(raw)
    assert canonical_json_bytes(parsed) == canonical_json_bytes(json.loads(raw))
    assert digest_object(parsed) == expected_digest
