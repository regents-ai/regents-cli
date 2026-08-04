"""Canonical run record and terminal outcome vocabulary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from .base import require_bounded_int, require_exact_keys, require_int, require_record, require_schema_version, require_string, require_type

TerminalStatus = Literal["completed", "timeout", "invalid", "agent_failure", "infrastructure_failure"]
TERMINAL_STATUSES = {"completed", "timeout", "invalid", "agent_failure", "infrastructure_failure"}


@dataclass(frozen=True)
class RunRecord:
    schema_version: int
    run_id: str
    protocol_id: str
    capsule_id: str
    side: str
    task_id: str
    attempt: int
    status: TerminalStatus
    score_millis: int | None
    detail: str
    artifacts: tuple[tuple[str, str, int], ...]
    cost_usd_cents: int
    wall_time_ms: int
    executor: str
    process_exit_code: int | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "run_id": self.run_id,
            "protocol_id": self.protocol_id,
            "capsule_id": self.capsule_id,
            "side": self.side,
            "task_id": self.task_id,
            "attempt": self.attempt,
            "status": self.status,
            "outcome": {"score_millis": self.score_millis, "detail": self.detail},
            "artifacts": [{"name": name, "digest": digest, "size_bytes": size} for name, digest, size in self.artifacts],
            "cost": {"usd_cents": self.cost_usd_cents},
            "timing": {"wall_time_ms": self.wall_time_ms},
            "execution": {"executor": self.executor, "process_exit_code": self.process_exit_code},
        }

    @classmethod
    def from_dict(cls, value: Any) -> "RunRecord":
        record = require_record(value, "run")
        require_exact_keys(record, {"schema_version", "run_id", "protocol_id", "capsule_id", "side", "task_id", "attempt", "status", "outcome", "artifacts", "cost", "timing", "execution"}, "run")
        status = require_string(record["status"], "run.status")
        if status not in TERMINAL_STATUSES:
            raise ValueError("run.status is not terminal")
        outcome = require_record(record["outcome"], "run.outcome"); require_exact_keys(outcome, {"score_millis", "detail"}, "run.outcome")
        score = outcome["score_millis"]
        if score is not None:
            score = require_bounded_int(score, "run.outcome.score_millis")
        cost = require_record(record["cost"], "run.cost"); require_exact_keys(cost, {"usd_cents"}, "run.cost")
        timing = require_record(record["timing"], "run.timing"); require_exact_keys(timing, {"wall_time_ms"}, "run.timing")
        execution = require_record(record["execution"], "run.execution"); require_exact_keys(execution, {"executor", "process_exit_code"}, "run.execution")
        exit_code = execution["process_exit_code"]
        if exit_code is not None:
            exit_code = require_bounded_int(exit_code, "run.execution.process_exit_code")
        require_type(record["artifacts"], list, "run.artifacts")
        artifacts = []
        for index, item in enumerate(record["artifacts"]):
            artifact = require_record(item, f"run.artifacts[{index}]"); require_exact_keys(artifact, {"name", "digest", "size_bytes"}, f"run.artifacts[{index}]")
            artifacts.append((require_string(artifact["name"], f"run.artifacts[{index}].name"), require_string(artifact["digest"], f"run.artifacts[{index}].digest"), require_int(artifact["size_bytes"], f"run.artifacts[{index}].size_bytes")))
        return cls(
            require_schema_version(record["schema_version"], "run.schema_version"), require_string(record["run_id"], "run.run_id"), require_string(record["protocol_id"], "run.protocol_id"), require_string(record["capsule_id"], "run.capsule_id"), require_string(record["side"], "run.side"), require_string(record["task_id"], "run.task_id"), require_int(record["attempt"], "run.attempt", minimum=1), status, score, require_string(outcome["detail"], "run.outcome.detail", allow_empty=True), tuple(artifacts), require_int(cost["usd_cents"], "run.cost.usd_cents"), require_int(timing["wall_time_ms"], "run.timing.wall_time_ms"), require_string(execution["executor"], "run.execution.executor"), exit_code,
        )  # type: ignore[arg-type]
