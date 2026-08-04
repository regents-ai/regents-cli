"""Canonical task-instance record."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .base import require_exact_keys, require_identifier, require_record, require_schema_version, require_sha256, require_string
from .benchmark import PARTITIONS, Partition


@dataclass(frozen=True)
class TaskInstance:
    schema_version: int
    task_id: str
    family_id: str
    slice_id: str
    partition: Partition
    role_id: str
    input_digest: str
    grader_digest: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "task_id": self.task_id,
            "family_id": self.family_id,
            "slice_id": self.slice_id,
            "partition": self.partition,
            "role_id": self.role_id,
            "input_digest": self.input_digest,
            "grader_digest": self.grader_digest,
        }

    @classmethod
    def from_dict(cls, value: Any) -> "TaskInstance":
        record = require_record(value, "task")
        require_exact_keys(
            record,
            {"schema_version", "task_id", "family_id", "slice_id", "partition", "role_id", "input_digest", "grader_digest"},
            "task",
        )
        partition = require_string(record["partition"], "task.partition")
        if partition not in PARTITIONS:
            raise ValueError("task.partition must be development, validation, or untouched")
        return cls(
            require_schema_version(record["schema_version"], "task.schema_version"),
            require_identifier(record["task_id"], "task.task_id"),
            require_identifier(record["family_id"], "task.family_id"),
            require_identifier(record["slice_id"], "task.slice_id"),
            partition,  # type: ignore[arg-type]
            require_identifier(record["role_id"], "task.role_id"),
            require_sha256(record["input_digest"], "task.input_digest"),
            require_sha256(record["grader_digest"], "task.grader_digest"),
        )
