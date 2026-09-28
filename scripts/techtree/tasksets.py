"""The publisher's taskset check: lock the reference taskset, validate it, issue the receipt.

The lock comes from two inspections in two fresh engine processes, so a taskset whose load
order is not deterministic cannot be locked. The receipt comes from the pinned model-free
`vf-validate` run, normalized inside the engine. Nothing in the lock, the evidence or the
receipt is a path, a time or a host, so a second honest run reproduces all three byte for byte.
"""

from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Literal

from build_engine_bundle import package_source_digest

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object, validate_digest
from regents_cli.techtree.constants import DIGEST_PREFIX, TASKSET_LOCK_SCHEMA_VERSION
from regents_cli.techtree.engines.bundle import PACKAGES_DIRECTORY, read_engine_descriptor
from regents_cli.techtree.engines.registry import EngineRegistry
from regents_cli.techtree.engines.runner import EngineRunner
from regents_cli.techtree.errors import EngineError, VerificationError
from regents_cli.techtree.models.base import ArtifactRef, Digest
from regents_cli.techtree.models.campaign import TaskSelection, TasksetRef
from regents_cli.techtree.models.validation import (
    TasksetLock,
    TasksetValidationReceipt,
    UpstreamValidationSummary,
    ValidationCheck,
    ValidationEvidence,
    ValidationMethod,
)
from regents_cli.techtree.tasksets.membership import membership_digest

VALIDATE_EXECUTABLE: Final = "vf-validate"
INSPECT_TASKSET_TOOL: Final = "inspect_taskset.py"
NORMALIZE_VALIDATION_TOOL: Final = "normalize_validation.py"

#: `--output-dir` groups runs; naming the run is what makes its own directory predictable.
VALIDATION_RUN_NAME: Final = "run"
INSPECTION_TIMEOUT_SECONDS: Final = 300.0
VALIDATION_TIMEOUT_SECONDS: Final = 1800.0


@dataclass(frozen=True)
class TasksetValidation:
    """The lock, the receipt issued under it, and the evidence the receipt points at."""

    lock: TasksetLock
    receipt: TasksetValidationReceipt
    evidence: ValidationEvidence


def lock_taskset(
    registry: EngineRegistry,
    engine_digest: Digest,
    taskset_ref: TasksetRef,
    selection: TaskSelection,
) -> TasksetLock:
    """Inspect the taskset twice in fresh processes and pin what both inspections agree on."""
    runner = EngineRunner(registry, engine_digest)
    first = _inspect(registry, runner, engine_digest, taskset_ref.id, selection.num_tasks)
    second = _inspect(registry, runner, engine_digest, taskset_ref.id, selection.num_tasks)
    if first != second:
        raise VerificationError(
            f"taskset {taskset_ref.id} produced a different membership on a second load, so it "
            "cannot be locked",
            code="taskset_membership_unstable",
            details={"taskset_id": taskset_ref.id},
        )
    return TasksetLock(
        schema_version=TASKSET_LOCK_SCHEMA_VERSION,
        taskset_ref=taskset_ref,
        engine_digest=engine_digest,
        resolved_package_digest=_installed_package_digest(registry, engine_digest, taskset_ref),
        ordered_task_hashes=first,
        membership_digest=membership_digest(first),
        task_count=len(first),
    )


def validate_taskset(
    registry: EngineRegistry, engine_digest: Digest, lock: TasksetLock, work_dir: Path
) -> TasksetValidation:
    """Run the pinned model-free validation over every locked task and issue the receipt."""
    runner = EngineRunner(registry, engine_digest)
    output_dir = work_dir / "validation"
    run_dir = output_dir / VALIDATION_RUN_NAME
    process = runner.run(
        VALIDATE_EXECUTABLE,
        [
            lock.taskset_ref.id,
            "--num-tasks",
            str(lock.task_count),
            "--runtime.type",
            "subprocess",
            "--output-dir",
            str(output_dir),
            "--run.name",
            VALIDATION_RUN_NAME,
            "--rich",
            "false",
        ],
        timeout=VALIDATION_TIMEOUT_SECONDS,
    )
    # The exit code reports runner health, not validity: read the verdict from summary.json.
    summary_path = run_dir / "summary.json"
    if not summary_path.is_file():
        raise EngineError(
            f"the validator produced no summary: {_last_line(process.stderr)}",
            code="taskset_validation_failed",
            details={"exit_code": process.exit_code},
        )
    document: dict[str, Any] = json.loads(summary_path.read_bytes())
    outcomes = document["outcomes"]
    summary = UpstreamValidationSummary(
        mode=document["mode"],
        total=document["total"],
        recorded=document["recorded"],
        valid=outcomes["valid"],
        invalid=outcomes["invalid"],
        error=outcomes["error"],
        timeout=outcomes["timeout"],
        missing=outcomes["missing"],
        valid_rate=document.get("valid_rate"),
    )
    lock_digest = digest_object(lock)
    evidence = _normalize(registry, runner, engine_digest, run_dir, lock_digest)
    checks = [
        _upstream_check("upstream_gold", document["checks"]["gold"]),
        _upstream_check("upstream_setup", document["checks"]["setup"]),
        ValidationCheck(
            id="membership_repeatability",
            status="passed",
            detail=f"two independent inspections agreed on all {lock.task_count} task hashes, "
            "in order",
        ),
        ValidationCheck(
            id="task_hash_uniqueness",
            status="passed",
            detail=f"all {lock.task_count} task hashes are distinct",
        ),
        ValidationCheck(
            id="committed_membership_match",
            status="passed",
            detail=f"all {lock.task_count} task hashes match in order",
        ),
        ValidationCheck(
            id="expected_task_count",
            status="passed",
            detail=f"{lock.task_count} tasks, as the selection asks for",
        ),
    ]
    evidence_bytes = canonical_json_bytes(evidence)
    receipt = TasksetValidationReceipt(
        schema_version="techtree.taskset-validation.v1alpha1",
        taskset_lock_digest=lock_digest,
        engine_digest=lock.engine_digest,
        method=ValidationMethod(
            kind="verifiers_validate",
            mode="all",
            runtime="subprocess",
            validator_revision=evidence.method.validator_revision,
        ),
        status=_receipt_status(summary, checks),
        upstream_summary=summary,
        checks=checks,
        # No path: the catalog finds the evidence by digest.
        normalized_evidence=ArtifactRef(
            digest=digest_object(evidence),
            media_type="application/json",
            size=len(evidence_bytes),
            relative_path=None,
        ),
    )
    return TasksetValidation(lock=lock, receipt=receipt, evidence=evidence)


def _inspect(
    registry: EngineRegistry,
    runner: EngineRunner,
    engine_digest: Digest,
    taskset_id: str,
    num_tasks: int,
) -> list[Digest]:
    with tempfile.TemporaryDirectory(prefix="techtree-inspect-") as directory:
        output = Path(directory) / "inspection.json"
        process = runner.run_python_script(
            registry.tool_path(engine_digest, INSPECT_TASKSET_TOOL),
            ["--taskset-id", taskset_id, "--num-tasks", str(num_tasks), "--output", str(output)],
            timeout=INSPECTION_TIMEOUT_SECONDS,
        )
        if process.exit_code != 0:
            raise EngineError(
                f"the engine could not inspect taskset {taskset_id}: {_last_line(process.stderr)}",
                code="taskset_inspection_failed",
                details={"taskset_id": taskset_id, "exit_code": process.exit_code},
            )
        inspection: dict[str, Any] = json.loads(output.read_bytes())
    return [validate_digest(f"{DIGEST_PREFIX}{task['task_hash']}") for task in inspection["tasks"]]


def _installed_package_digest(
    registry: EngineRegistry, engine_digest: Digest, taskset_ref: TasksetRef
) -> Digest:
    """Recompute the installed package tree's digest; the descriptor and the ref must agree."""
    engine_root = registry.path(engine_digest)
    name = taskset_ref.package.name
    resolved = package_source_digest(engine_root / PACKAGES_DIRECTORY / name)
    declared = next(
        package.source_digest
        for package in read_engine_descriptor(engine_root).packages
        if package.name == name
    )
    if not resolved == declared == taskset_ref.package.digest:
        raise VerificationError(
            f"the installed {name} tree hashes to {resolved}; the engine descriptor declares "
            f"{declared} and the taskset reference commits to {taskset_ref.package.digest}",
            code="taskset_package_digest_mismatch",
            details={"package": name},
        )
    return resolved


def _normalize(
    registry: EngineRegistry,
    runner: EngineRunner,
    engine_digest: Digest,
    run_dir: Path,
    lock_digest: Digest,
) -> ValidationEvidence:
    with tempfile.TemporaryDirectory(prefix="techtree-normalize-") as directory:
        destination = Path(directory) / "evidence.json"
        process = runner.run_python_script(
            registry.tool_path(engine_digest, NORMALIZE_VALIDATION_TOOL),
            [
                "--results-dir",
                str(run_dir),
                "--taskset-lock-digest",
                lock_digest,
                "--output",
                str(destination),
            ],
            timeout=VALIDATION_TIMEOUT_SECONDS,
        )
        if process.exit_code != 0:
            raise EngineError(
                "the engine could not normalize this validation run: "
                f"{_last_line(process.stderr or process.stdout)}",
                code="validation_evidence_unavailable",
                details={"exit_code": process.exit_code},
            )
        return ValidationEvidence.model_validate_json(destination.read_bytes())


def _upstream_check(check_id: str, counts: dict[str, int]) -> ValidationCheck:
    """Every outcome the validator counted, `unchecked` included, must be `valid`."""
    total = sum(counts.values())
    if total > 0 and counts["valid"] == total:
        return ValidationCheck(
            id=check_id, status="passed", detail=f"all {total} tasks passed this check"
        )
    tally = ", ".join(f"{count} {outcome}" for outcome, count in sorted(counts.items()))
    return ValidationCheck(id=check_id, status="failed", detail=tally)


def _receipt_status(
    summary: UpstreamValidationSummary, checks: list[ValidationCheck]
) -> Literal["valid", "invalid", "errored"]:
    """`errored` means no verdict was reached; `invalid` means one was, and it was no."""
    if summary.error or summary.timeout or summary.missing or summary.recorded != summary.total:
        return "errored"
    if summary.valid != summary.total or any(check.status == "failed" for check in checks):
        return "invalid"
    return "valid"


def _last_line(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[-1] if lines else "the engine reported no diagnostics"
