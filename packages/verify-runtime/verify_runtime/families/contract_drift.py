"""Deterministic built-in family used by the offline Verify operating path."""

from __future__ import annotations

from verify_runtime.model import BenchmarkRole, BenchmarkSlice, EnvironmentFamily, TaskInstance, sha256_bytes

FAMILY = EnvironmentFamily(
    schema_version=1,
    family_id="techtree.contract-drift-repair.v1",
    product_status="planned",
    kind="deterministic_contract_drift_repair",
    executor="hermes",
    intervention_artifact="SKILL.md",
    intervention_changed_file_count=1,
    verifier_protocol="deterministic_contract_drift",
    verifier_protocol_version=1,
)
FAMILY_CONTRACT = FAMILY.to_dict()

BASELINE_SKILL = b"# Contract repair\n\nEdit every file that appears related to the failure.\n"
CANDIDATE_SKILL = b"# Contract repair\n\nChange exactly the one declared SKILL.md and preserve every other file.\n"

ROLES = (
    BenchmarkRole(1, "repair-agent", "repair the declared contract drift", "task-input-only"),
    BenchmarkRole(1, "deterministic-grader", "check the one-file repair rule", "sealed-grader"),
)

_FAMILY_ID = FAMILY.family_id
_GRADER_DIGEST = sha256_bytes(b"deterministic-contract-drift-grader-v1\n")


def _task(task_id: str, partition: str, prompt: bytes) -> TaskInstance:
    return TaskInstance(1, task_id, _FAMILY_ID, f"{_FAMILY_ID}.{partition}", partition, "repair-agent", sha256_bytes(prompt), _GRADER_DIGEST)  # type: ignore[arg-type]


TASKS = (
    _task("contract-drift-development-1", "development", b"development-visible-contract-drift\n"),
    _task("contract-drift-validation-1", "validation", b"validation-contract-drift\n"),
    _task("contract-drift-untouched-1", "untouched", b"sealed-untouched-contract-drift\n"),
)

SLICES = tuple(
    BenchmarkSlice(1, f"{_FAMILY_ID}.{partition}", _FAMILY_ID, partition, ("repair-agent", "deterministic-grader"), tuple(task.task_id for task in TASKS if task.partition == partition))  # type: ignore[arg-type]
    for partition in ("development", "validation", "untouched")
)
