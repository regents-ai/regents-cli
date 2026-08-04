"""Canonical locked evaluation protocol and founder-default policy records."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .base import require_exact_keys, require_identifier, require_identifier_list, require_int, require_record, require_schema_version, require_string, require_string_list, require_type
from .benchmark import PARTITIONS


@dataclass(frozen=True)
class VerifyPolicy:
    policy_id: str
    attempts_per_task: int
    max_task_wall_seconds: int
    max_comparison_spend_usd_cents: int
    timeout_treatment: str
    missing_result_treatment: str
    infrastructure_failure_treatment: str

    def to_dict(self) -> dict[str, Any]:
        return {"policy_id": self.policy_id, "attempts_per_task": self.attempts_per_task, "max_task_wall_seconds": self.max_task_wall_seconds, "max_comparison_spend_usd_cents": self.max_comparison_spend_usd_cents, "timeout_treatment": self.timeout_treatment, "missing_result_treatment": self.missing_result_treatment, "infrastructure_failure_treatment": self.infrastructure_failure_treatment}

    @classmethod
    def from_dict(cls, value: Any) -> "VerifyPolicy":
        record = require_record(value, "protocol.policy")
        require_exact_keys(record, {"policy_id", "attempts_per_task", "max_task_wall_seconds", "max_comparison_spend_usd_cents", "timeout_treatment", "missing_result_treatment", "infrastructure_failure_treatment"}, "protocol.policy")
        return cls(require_identifier(record["policy_id"], "protocol.policy.policy_id"), require_int(record["attempts_per_task"], "protocol.policy.attempts_per_task", minimum=1), require_int(record["max_task_wall_seconds"], "protocol.policy.max_task_wall_seconds", minimum=1), require_int(record["max_comparison_spend_usd_cents"], "protocol.policy.max_comparison_spend_usd_cents", minimum=1), require_string(record["timeout_treatment"], "protocol.policy.timeout_treatment"), require_string(record["missing_result_treatment"], "protocol.policy.missing_result_treatment"), require_string(record["infrastructure_failure_treatment"], "protocol.policy.infrastructure_failure_treatment"))


@dataclass(frozen=True)
class MatchedSelection:
    task_id: str
    partition: str
    matched_order: int

    def to_dict(self) -> dict[str, Any]:
        return {"task_id": self.task_id, "partition": self.partition, "matched_order": self.matched_order}

    @classmethod
    def from_dict(cls, value: Any, path: str) -> "MatchedSelection":
        record = require_record(value, path)
        require_exact_keys(record, {"task_id", "partition", "matched_order"}, path)
        partition = require_string(record["partition"], f"{path}.partition")
        if partition not in PARTITIONS:
            raise ValueError(f"{path}.partition is invalid")
        return cls(require_identifier(record["task_id"], f"{path}.task_id"), partition, require_int(record["matched_order"], f"{path}.matched_order", minimum=0))


@dataclass(frozen=True)
class EvaluationProtocol:
    schema_version: int
    protocol_id: str
    family_id: str
    baseline_capsule_id: str
    candidate_capsule_id: str
    intervention_class: str
    changed_files: tuple[str, ...]
    baseline_class: str
    baseline_justification: str
    selections: tuple[MatchedSelection, ...]
    development_task_ids: tuple[str, ...]
    validation_task_ids: tuple[str, ...]
    untouched_task_ids: tuple[str, ...]
    optimizer_method: str
    optimizer_candidate_count: int
    rejected_candidate_ids: tuple[str, ...]
    policy: VerifyPolicy

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "protocol_id": self.protocol_id,
            "family_id": self.family_id,
            "capsules": {"baseline": self.baseline_capsule_id, "candidate": self.candidate_capsule_id},
            "intervention": {"class": self.intervention_class, "changed_files": list(self.changed_files)},
            "baseline": {"class": self.baseline_class, "justification": self.baseline_justification},
            "matched_selections": [selection.to_dict() for selection in self.selections],
            "partitions": {"development": list(self.development_task_ids), "validation": list(self.validation_task_ids), "untouched": list(self.untouched_task_ids)},
            "optimizer_disclosure": {"method": self.optimizer_method, "candidate_count": self.optimizer_candidate_count, "rejected_candidate_ids": list(self.rejected_candidate_ids)},
            "policy": self.policy.to_dict(),
        }

    @classmethod
    def from_dict(cls, value: Any) -> "EvaluationProtocol":
        record = require_record(value, "protocol")
        require_exact_keys(record, {"schema_version", "protocol_id", "family_id", "capsules", "intervention", "baseline", "matched_selections", "partitions", "optimizer_disclosure", "policy"}, "protocol")
        capsules = require_record(record["capsules"], "protocol.capsules"); require_exact_keys(capsules, {"baseline", "candidate"}, "protocol.capsules")
        intervention = require_record(record["intervention"], "protocol.intervention"); require_exact_keys(intervention, {"class", "changed_files"}, "protocol.intervention")
        baseline = require_record(record["baseline"], "protocol.baseline"); require_exact_keys(baseline, {"class", "justification"}, "protocol.baseline")
        partitions = require_record(record["partitions"], "protocol.partitions"); require_exact_keys(partitions, {"development", "validation", "untouched"}, "protocol.partitions")
        optimizer = require_record(record["optimizer_disclosure"], "protocol.optimizer_disclosure"); require_exact_keys(optimizer, {"method", "candidate_count", "rejected_candidate_ids"}, "protocol.optimizer_disclosure")
        require_type(record["matched_selections"], list, "protocol.matched_selections")
        return cls(
            require_schema_version(record["schema_version"], "protocol.schema_version"), require_identifier(record["protocol_id"], "protocol.protocol_id"), require_identifier(record["family_id"], "protocol.family_id"),
            require_identifier(capsules["baseline"], "protocol.capsules.baseline"), require_identifier(capsules["candidate"], "protocol.capsules.candidate"),
            require_string(intervention["class"], "protocol.intervention.class"), tuple(require_string_list(intervention["changed_files"], "protocol.intervention.changed_files")),
            require_string(baseline["class"], "protocol.baseline.class"), require_string(baseline["justification"], "protocol.baseline.justification"),
            tuple(MatchedSelection.from_dict(item, f"protocol.matched_selections[{index}]") for index, item in enumerate(record["matched_selections"])),
            tuple(require_identifier_list(partitions["development"], "protocol.partitions.development")), tuple(require_identifier_list(partitions["validation"], "protocol.partitions.validation")), tuple(require_identifier_list(partitions["untouched"], "protocol.partitions.untouched")),
            require_string(optimizer["method"], "protocol.optimizer_disclosure.method"), require_int(optimizer["candidate_count"], "protocol.optimizer_disclosure.candidate_count", minimum=1), tuple(require_identifier_list(optimizer["rejected_candidate_ids"], "protocol.optimizer_disclosure.rejected_candidate_ids")), VerifyPolicy.from_dict(record["policy"]),
        )
