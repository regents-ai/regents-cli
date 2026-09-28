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
from regents_cli.techtree.models.skill import SkillArtifact
from regents_cli.techtree.models.uplift_report import UpliftReportV2
from regents_cli.techtree.models.validation import TasksetLock, TasksetValidationReceipt
from regents_cli.techtree.receipts.execution import ComparisonExecutionRecord

GOLDEN = Path(__file__).parent / "fixtures" / "golden"

CASES: dict[str, tuple[type[BaseModel], str]] = {
    "campaign-v2.json": (
        CampaignSpecV2,
        "sha256:6c3032e1d63ee66c5d95b4030ead1b45d692c98277ac5916c1069e9b0d03c533",
    ),
    "campaign-parity-candidate.json": (
        CampaignSpecV2,
        "sha256:d5ce5c10ceea63d28ed5c2218f80485eac517b1c2227e4e2b36e7b73cf472513",
    ),
    "climb-v2.json": (
        ClimbManifest,
        "sha256:5b9a4949ed7ab1202187435e59165f3f07bac8b438fad858729dcdad21c47bfd",
    ),
    "climb.json": (
        ClimbManifest,
        "sha256:8a98cf28affe2de98e3431db3b2a26b0a6dc60861fc9fb0f264d8ca044c217ba",
    ),
    "climb-summary-v2.json": (
        ClimbSummaryV2,
        "sha256:48f6ed43c270ffa63450eb36cae4315b8ffc3c9e68fd4f0a1dedcb3fab82eb5c",
    ),
    "comparison-execution.json": (
        ComparisonExecutionRecord,
        "sha256:1b6ee9f2ec389ccc3fa09f3d08db4d9d610da4f2ca1af0b4bc9c98985c890ef7",
    ),
    "data-policy.json": (
        DataPolicy,
        "sha256:f61fff0ff5941205fca8fc044c81e7a56aed9017539f6927ab9df0e81f70f88b",
    ),
    "episode-receipt-v2.json": (
        ObjectEnvelope[EpisodeReceiptV2],
        "sha256:0b3e62efc593c3359d215ed9accbaa485e8b62e81b6fbfccfb92d6e3051c97bc",
    ),
    "execution-plan.json": (
        ResolvedExecutionPlan,
        "sha256:50c38344ecac5aae0fa2a5ab46320871e8e1268a9e033e7446d561576414c030",
    ),
    "executor-identity.json": (
        ExecutorIdentity,
        "sha256:329813ff239795e2c765eb169a9d6d3ad3eaec263403a8ad61899bf2fbb25d77",
    ),
    "experiment-baseline-v2.json": (
        ExperimentManifestV2,
        "sha256:26ea14d44fae660caf948e0659115865f1c17bd850a5100dd04a39a3e3ab0d30",
    ),
    "experiment-candidate-v2.json": (
        ExperimentManifestV2,
        "sha256:566d3b07ea3ecb99f961fb34a6e3e63f82edb3a912f630b2b93484f315f93170",
    ),
    "run-request-v2.json": (
        RunRequestV2,
        "sha256:12fc14514a4990b3a791c7b93d8d50488b3f65f196cdd65197ed279376424f0c",
    ),
    "skill-artifact.json": (
        SkillArtifact,
        "sha256:d7c564b2bf0c5fd51417ca1dae8e5ea49997338a9eb281372622fb0cb674a4c0",
    ),
    "taskset-lock.json": (
        TasksetLock,
        "sha256:6b9044be827c645e165347bf40d9fcb744c132eb8066c92bb5ed2834d6db5543",
    ),
    "taskset-validation-receipt.json": (
        TasksetValidationReceipt,
        "sha256:b0ff34a2b54a35ea85856babdf86b4a93c6ef86c9a7fc33d2c7fa230490e3c94",
    ),
    "uplift-report-v2.json": (
        ObjectEnvelope[UpliftReportV2],
        "sha256:f86ddb858626d2548615bb3bd1fa8d1f4811f528af82c586934d5bcf174ae063",
    ),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_golden_round_trips_to_the_bytes_and_digest_0_3_0_computed(name: str) -> None:
    model, expected_digest = CASES[name]
    raw = (GOLDEN / name).read_bytes()
    parsed = model.model_validate_json(raw)
    assert canonical_json_bytes(parsed) == canonical_json_bytes(json.loads(raw))
    assert digest_object(parsed) == expected_digest
