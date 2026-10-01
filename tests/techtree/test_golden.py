"""Every V2 golden document round-trips to the same bytes and the digest this build pins.

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
        "sha256:f98deac51576f45213e3f857a5a551a480ae7a26cff6bd6aab24a4058922477d",
    ),
    "campaign-parity-candidate.json": (
        CampaignSpecV2,
        "sha256:e11a9c320e6237dcc9d79508d684205448f1b9463af97d4ce9eb5e45fd149eb5",
    ),
    "climb-v2.json": (
        ClimbManifest,
        "sha256:6871e49083e0315ce309b9bbe7e26d3e7f89fe32ee98efbaa8bbceb08c8214c7",
    ),
    "climb.json": (
        ClimbManifest,
        "sha256:8a98cf28affe2de98e3431db3b2a26b0a6dc60861fc9fb0f264d8ca044c217ba",
    ),
    "climb-summary-v2.json": (
        ClimbSummaryV2,
        "sha256:85ae90cab8f3e7f074ed7fb2f3b64fb7b1cb8e633f11cb1cc5ea626fb152ffbc",
    ),
    "comparison-execution.json": (
        ComparisonExecutionRecord,
        "sha256:3875776f31cf6564df49b0b83329abfa346d8b7e863caad1bc8ec397bc5a3bb2",
    ),
    "data-policy.json": (
        DataPolicy,
        "sha256:f61fff0ff5941205fca8fc044c81e7a56aed9017539f6927ab9df0e81f70f88b",
    ),
    "episode-receipt-v2.json": (
        ObjectEnvelope[EpisodeReceiptV2],
        "sha256:d5abde920e2562ec36ea8573b4c82d4e241f2186ba7ae0ddbea1b605d4608c34",
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
        "sha256:448044c74d0e9f861d9cf1d52d80de43a0b83e3d95aadf2c7595ffeadc057e9c",
    ),
    "experiment-candidate-v2.json": (
        ExperimentManifestV2,
        "sha256:b0c3a9018566c84e3cc2cabc8dd2d40fc53e2eabc07ce42df988f212f4c5d545",
    ),
    "run-request-v2.json": (
        RunRequestV2,
        "sha256:f8cef4bd0c2ec84c6511403366791964fba226e29714bda2427816bd6dd5ad08",
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
        "sha256:ae9b2a0186da8a09c16a56c7fd367ac610a24688373cdd6bc6ae75f527c045f7",
    ),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_golden_round_trips_to_its_bytes_and_pinned_digest(name: str) -> None:
    model, expected_digest = CASES[name]
    raw = (GOLDEN / name).read_bytes()
    parsed = model.model_validate_json(raw)
    assert canonical_json_bytes(parsed) == canonical_json_bytes(json.loads(raw))
    assert digest_object(parsed) == expected_digest
