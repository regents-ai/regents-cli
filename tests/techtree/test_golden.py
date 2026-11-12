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
        "sha256:d5501072559eba3eccbe1c932d7e026ff656125799564dc388e78d819e521866",
    ),
    "campaign-parity-candidate.json": (
        CampaignSpecV4,
        "sha256:637a19d051c28811cb7b9726d7a38cb90b75ceed52976bc53ab7d6ee5b7d9f23",
    ),
    "climb-v2.json": (
        ClimbManifest,
        "sha256:59e847f0e9539a8633cadbbd0ebe404de9e1236adc296ca276e2169d44d664c3",
    ),
    "climb.json": (
        ClimbManifest,
        "sha256:9cc24f6d26c7622a3b36cffffc4bf7c2419cd17425491b1cf59adbcde12f7ba4",
    ),
    "climb-summary-v2.json": (
        ClimbSummaryV2,
        "sha256:27c8ae25b75547efc569ed59fdaecad675167459147d5b14744907646af06e5c",
    ),
    "comparison-execution.json": (
        ComparisonExecutionRecord,
        "sha256:17ef5a0b8709f1129d9782ab04e540b259f106f3c195714f754279c482bafe92",
    ),
    "data-policy.json": (
        DataPolicy,
        "sha256:f61fff0ff5941205fca8fc044c81e7a56aed9017539f6927ab9df0e81f70f88b",
    ),
    "episode-receipt-v3.json": (
        ObjectEnvelope[EpisodeReceiptV3],
        "sha256:01592dfeed17739ac98ba07cb39933de9ddd41d1267ee321fa7df1c1593c3287",
    ),
    "execution-plan.json": (
        ResolvedExecutionPlan,
        "sha256:a51eb5e4e8e9e86abb51050d192266bbf54d8afdd454183fd2f4f17996aa4e0c",
    ),
    "executor-identity.json": (
        ExecutorIdentity,
        "sha256:329813ff239795e2c765eb169a9d6d3ad3eaec263403a8ad61899bf2fbb25d77",
    ),
    "experiment-baseline-v4.json": (
        ExperimentManifestV4,
        "sha256:61bf5e1e571b64c015a1f9191ddffebb891d8db23ccaece5e8294c4fe90d34b5",
    ),
    "experiment-candidate-v4.json": (
        ExperimentManifestV4,
        "sha256:123a76672e6eb33b5eff195920784d78447b553caeb009e027b1373068565e7e",
    ),
    "run-request-v2.json": (
        RunRequestV2,
        "sha256:f37bf8846a958272375ac2f3441ea356b429cbc4ed7b2d8ebd1a3ae780648506",
    ),
    "taskset-lock.json": (
        TasksetLock,
        "sha256:6b9044be827c645e165347bf40d9fcb744c132eb8066c92bb5ed2834d6db5543",
    ),
    "taskset-validation-receipt.json": (
        TasksetValidationReceipt,
        "sha256:11370b593f9369a76e0a26af287f7359210994dab7e2ae9c4bbc1c1b1e9eadcc",
    ),
    "uplift-report-v3.json": (
        ObjectEnvelope[UpliftReportV3],
        "sha256:13459d281b191e222f128e4947d7b4f843bf272aa0cd0f4bd1311d2d81517e36",
    ),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_golden_round_trips_to_its_bytes_and_pinned_digest(name: str) -> None:
    model, expected_digest = CASES[name]
    raw = (GOLDEN / name).read_bytes()
    parsed = model.model_validate_json(raw)
    assert canonical_json_bytes(parsed) == canonical_json_bytes(json.loads(raw))
    assert digest_object(parsed) == expected_digest
