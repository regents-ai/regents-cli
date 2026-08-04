"""Canonical evaluation receipt covering one matched task pair."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .base import require_bounded_int, require_exact_keys, require_int, require_record, require_schema_version, require_string
from .capsule import Capsule
from .protocol import EvaluationProtocol
from .run import RunRecord


@dataclass(frozen=True)
class EvaluationReceipt:
    schema_version: int
    receipt_id: str
    task_id: str
    protocol: EvaluationProtocol
    baseline_capsule: Capsule
    candidate_capsule: Capsule
    baseline_run: RunRecord
    candidate_run: RunRecord
    comparison_result: str
    baseline_score_millis: int | None
    candidate_score_millis: int | None
    total_cost_usd_cents: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "receipt_id": self.receipt_id,
            "task_id": self.task_id,
            "protocol": self.protocol.to_dict(),
            "capsules": {"baseline": self.baseline_capsule.to_dict(), "candidate": self.candidate_capsule.to_dict()},
            "runs": {"baseline": self.baseline_run.to_dict(), "candidate": self.candidate_run.to_dict()},
            "outcome": {"comparison_result": self.comparison_result, "baseline_score_millis": self.baseline_score_millis, "candidate_score_millis": self.candidate_score_millis},
            "cost": {"total_usd_cents": self.total_cost_usd_cents},
        }

    @classmethod
    def from_dict(cls, value: Any) -> "EvaluationReceipt":
        record = require_record(value, "receipt")
        require_exact_keys(record, {"schema_version", "receipt_id", "task_id", "protocol", "capsules", "runs", "outcome", "cost"}, "receipt")
        capsules = require_record(record["capsules"], "receipt.capsules"); require_exact_keys(capsules, {"baseline", "candidate"}, "receipt.capsules")
        runs = require_record(record["runs"], "receipt.runs"); require_exact_keys(runs, {"baseline", "candidate"}, "receipt.runs")
        outcome = require_record(record["outcome"], "receipt.outcome"); require_exact_keys(outcome, {"comparison_result", "baseline_score_millis", "candidate_score_millis"}, "receipt.outcome")
        cost = require_record(record["cost"], "receipt.cost"); require_exact_keys(cost, {"total_usd_cents"}, "receipt.cost")
        scores = []
        for name in ("baseline_score_millis", "candidate_score_millis"):
            score = outcome[name]
            scores.append(None if score is None else require_bounded_int(score, f"receipt.outcome.{name}"))
        return cls(require_schema_version(record["schema_version"], "receipt.schema_version"), require_string(record["receipt_id"], "receipt.receipt_id"), require_string(record["task_id"], "receipt.task_id"), EvaluationProtocol.from_dict(record["protocol"]), Capsule.from_dict(capsules["baseline"]), Capsule.from_dict(capsules["candidate"]), RunRecord.from_dict(runs["baseline"]), RunRecord.from_dict(runs["candidate"]), require_string(outcome["comparison_result"], "receipt.outcome.comparison_result"), scores[0], scores[1], require_int(cost["total_usd_cents"], "receipt.cost.total_usd_cents"))
