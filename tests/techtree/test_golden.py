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
        "sha256:272d2eeec064fd691a38bedf6d61fea9bc86f25d064f2fe990f5d74e450cd1c6",
    ),
    "campaign-parity-candidate.json": (
        CampaignSpecV4,
        "sha256:3ac6cde0a8e4f631522dd4d70c5664ab42d01b20fba10f03c8be7b04bea09b52",
    ),
    "climb-v2.json": (
        ClimbManifest,
        "sha256:0503c05ff07d0f69527eb9a237be93cdd9c06eafb769f3e8b81493d10505a176",
    ),
    "climb.json": (
        ClimbManifest,
        "sha256:9cc24f6d26c7622a3b36cffffc4bf7c2419cd17425491b1cf59adbcde12f7ba4",
    ),
    "climb-summary-v2.json": (
        ClimbSummaryV2,
        "sha256:6e328626981da5cdf9c6b148d6dc9ece512a6bcdcf210626f07be751803e6981",
    ),
    "comparison-execution.json": (
        ComparisonExecutionRecord,
        "sha256:02955987b5218251eb436bc3639b4ac6a53f6d00b866866b845ec193fa1af9c4",
    ),
    "data-policy.json": (
        DataPolicy,
        "sha256:f61fff0ff5941205fca8fc044c81e7a56aed9017539f6927ab9df0e81f70f88b",
    ),
    "episode-receipt-v3.json": (
        ObjectEnvelope[EpisodeReceiptV3],
        "sha256:2f24f9f089d0b1d093b43d23a476177986798d3eebe072199b3dba6ed290ba46",
    ),
    "execution-plan.json": (
        ResolvedExecutionPlan,
        "sha256:05dc6e435f47900628f5419136145076d5e73e2d87b75321fd857e3f1f248a77",
    ),
    "executor-identity.json": (
        ExecutorIdentity,
        "sha256:329813ff239795e2c765eb169a9d6d3ad3eaec263403a8ad61899bf2fbb25d77",
    ),
    "experiment-baseline-v4.json": (
        ExperimentManifestV4,
        "sha256:1b3c6f7b65580862bb2112f15374bec27d60f7c6c2e797bf0f0d60f449d0e138",
    ),
    "experiment-candidate-v4.json": (
        ExperimentManifestV4,
        "sha256:aada407bf7a0a51f249ef4f4edb1af3856222c11e766a06e90c97e1f096d60b6",
    ),
    "run-request-v2.json": (
        RunRequestV2,
        "sha256:b05b2362ec67a7fdb2ddad66ff5fd2da22a6046a78acc9b057165b67f8e37bde",
    ),
    "taskset-lock.json": (
        TasksetLock,
        "sha256:6b9044be827c645e165347bf40d9fcb744c132eb8066c92bb5ed2834d6db5543",
    ),
    "taskset-validation-receipt.json": (
        TasksetValidationReceipt,
        "sha256:fc5cbf94d4ba04811410cd5370ed6aaee3f51966df46de746592c7047533a214",
    ),
    "uplift-report-v3.json": (
        ObjectEnvelope[UpliftReportV3],
        "sha256:a67c72299c6662f34dcfe4e73bbe56f9303152c23563b6d5f8452875bd6eb654",
    ),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_golden_round_trips_to_its_bytes_and_pinned_digest(name: str) -> None:
    model, expected_digest = CASES[name]
    raw = (GOLDEN / name).read_bytes()
    parsed = model.model_validate_json(raw)
    assert canonical_json_bytes(parsed) == canonical_json_bytes(json.loads(raw))
    assert digest_object(parsed) == expected_digest
