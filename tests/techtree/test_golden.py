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
        "sha256:7a856fc9a5d1d1ccd6feb52daaa35bc4188e437cef81667fcf19e37454c8a3fd",
    ),
    "campaign-parity-candidate.json": (
        CampaignSpecV4,
        "sha256:eb85e175ef94f573f980fba3b3f758e9f2bb32f93002a905754611b1acb134de",
    ),
    "climb-v2.json": (
        ClimbManifest,
        "sha256:6f6b71b5322b39a886b60b57f57cc7a68c2cdca52351fab2ce9e3096c6f7072f",
    ),
    "climb.json": (
        ClimbManifest,
        "sha256:9cc24f6d26c7622a3b36cffffc4bf7c2419cd17425491b1cf59adbcde12f7ba4",
    ),
    "climb-summary-v2.json": (
        ClimbSummaryV2,
        "sha256:5f468a0ff40156c45bcc95cb1a39804fcc24c18feb6a8ecb57c9f4db477cf906",
    ),
    "comparison-execution.json": (
        ComparisonExecutionRecord,
        "sha256:3c8c470d58491b4b48b8241d476c3fdb7719592153a7a510b4fbedfbc5210f66",
    ),
    "data-policy.json": (
        DataPolicy,
        "sha256:f61fff0ff5941205fca8fc044c81e7a56aed9017539f6927ab9df0e81f70f88b",
    ),
    "episode-receipt-v3.json": (
        ObjectEnvelope[EpisodeReceiptV3],
        "sha256:ef218050f56ff8c477c8627dcca3fdf63a2d73414ae7d42c7b9932b7d96511a0",
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
        "sha256:54bb3813b5469edbddc80224e33f9969a54adc645631f52c304666c1d849b209",
    ),
    "experiment-candidate-v4.json": (
        ExperimentManifestV4,
        "sha256:31f7376c763b97b915928c46268c801b78c34a22989af80c2b7f28c18a9275e8",
    ),
    "run-request-v2.json": (
        RunRequestV2,
        "sha256:a23dd025e8270d53f6fc32d2262eea7109fa4da4e52c1b848ac70252f15436a8",
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
        "sha256:605144e6a1362ab411e4f122d8b681b506a1b02c2c5a9261bb06a4711815169e",
    ),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_golden_round_trips_to_its_bytes_and_pinned_digest(name: str) -> None:
    model, expected_digest = CASES[name]
    raw = (GOLDEN / name).read_bytes()
    parsed = model.model_validate_json(raw)
    assert canonical_json_bytes(parsed) == canonical_json_bytes(json.loads(raw))
    assert digest_object(parsed) == expected_digest
