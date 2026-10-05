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
from regents_cli.techtree.models.uplift_report import UpliftReportV3
from regents_cli.techtree.models.validation import TasksetLock, TasksetValidationReceipt
from regents_cli.techtree.receipts.execution import ComparisonExecutionRecord

GOLDEN = Path(__file__).parent / "fixtures" / "golden"

CASES: dict[str, tuple[type[BaseModel], str]] = {
    "campaign-v3.json": (
        CampaignSpecV3,
        "sha256:b25a827fdc96680f2f327a89202a3d4c763e2682ac1aaa84b601310b4fcedba9",
    ),
    "campaign-parity-candidate.json": (
        CampaignSpecV3,
        "sha256:7c42c8d9c3cd707f1d586ab52b49c7946ef343cab527aca7cab10a5a847fdaef",
    ),
    "climb-v2.json": (
        ClimbManifest,
        "sha256:3cefb33803371e3e949b65acfaab32b910f2e939d5d3e09d2c1b4ccef655900d",
    ),
    "climb.json": (
        ClimbManifest,
        "sha256:9cc24f6d26c7622a3b36cffffc4bf7c2419cd17425491b1cf59adbcde12f7ba4",
    ),
    "climb-summary-v2.json": (
        ClimbSummaryV2,
        "sha256:b669bc55a348633f9ab7a62d9c3bb2d24569f249413388de3f910b99e95d3f6a",
    ),
    "comparison-execution.json": (
        ComparisonExecutionRecord,
        "sha256:e79ac8ba594cb9c8352fb6935f61f7b87c10c521d69fde4af689d753a40aaaca",
    ),
    "data-policy.json": (
        DataPolicy,
        "sha256:f61fff0ff5941205fca8fc044c81e7a56aed9017539f6927ab9df0e81f70f88b",
    ),
    "episode-receipt-v3.json": (
        ObjectEnvelope[EpisodeReceiptV3],
        "sha256:2d8324621eef4531c3b3d5ba812b3a65c771b792a4e2500a828ba608249b995a",
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
        "sha256:8e272f017e5e30d430e4f65267eedc2ef8c1e0c2d9949e21453e4b69f4f08dc9",
    ),
    "experiment-candidate-v3.json": (
        ExperimentManifestV3,
        "sha256:e2a8a425de5316504bf00a052a733fb3f6cb4c6c3db27ef3ecb06642b4b998bc",
    ),
    "run-request-v2.json": (
        RunRequestV2,
        "sha256:3d1859258c4d84d72e91ece4f7d0fde77f67712c32dfce7d0cbc3028e874b137",
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
        "sha256:b1396cdb89b56b79199ce52133918dbedafdfb8e1619e1870226b3e14e4b1a4d",
    ),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_golden_round_trips_to_its_bytes_and_pinned_digest(name: str) -> None:
    model, expected_digest = CASES[name]
    raw = (GOLDEN / name).read_bytes()
    parsed = model.model_validate_json(raw)
    assert canonical_json_bytes(parsed) == canonical_json_bytes(json.loads(raw))
    assert digest_object(parsed) == expected_digest
