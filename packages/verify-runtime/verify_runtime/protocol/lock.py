"""Lock a matched protocol before any baseline or candidate execution."""

from __future__ import annotations

from verify_runtime.families import FAMILY, TASKS
from verify_runtime.model import Capsule, EvaluationProtocol, MatchedSelection, VerifyPolicy, content_id

FOUNDER_DEFAULT_POLICY = VerifyPolicy(
    policy_id="verify-public-default-v1",
    attempts_per_task=1,
    max_task_wall_seconds=600,
    max_comparison_spend_usd_cents=1_000,
    timeout_treatment="terminal-timeout-not-scored",
    missing_result_treatment="terminal-invalid-not-scored",
    infrastructure_failure_treatment="terminal-infrastructure-failure-not-scored",
)


def lock_builtin_protocol(baseline: Capsule, candidate: Capsule) -> EvaluationProtocol:
    if baseline.resolved.skill_digest == candidate.resolved.skill_digest:
        raise ValueError("baseline and candidate must differ in SKILL.md")
    if baseline.declared.to_dict() | {"skill_source": candidate.declared.skill_source} != candidate.declared.to_dict():
        raise ValueError("built-in comparison must change only SKILL.md")
    baseline_resolved = baseline.resolved.to_dict()
    candidate_resolved = candidate.resolved.to_dict()
    baseline_resolved["skill"] = candidate_resolved["skill"]
    if baseline_resolved != candidate_resolved:
        raise ValueError("built-in comparison resolved more than SKILL.md differently")

    partitions = {
        partition: tuple(task.task_id for task in TASKS if task.partition == partition)
        for partition in ("development", "validation", "untouched")
    }
    selections = tuple(
        MatchedSelection(task_id, partition, order)
        for order, (partition, task_id) in enumerate(
            (("validation", partitions["validation"][0]), ("untouched", partitions["untouched"][0]))
        )
    )
    identity = {
        "family_id": FAMILY.family_id,
        "capsules": {"baseline": baseline.capsule_id, "candidate": candidate.capsule_id},
        "selections": [selection.to_dict() for selection in selections],
        "policy": FOUNDER_DEFAULT_POLICY.to_dict(),
    }
    return EvaluationProtocol(
        schema_version=1,
        protocol_id=content_id("protocol", identity),
        family_id=FAMILY.family_id,
        baseline_capsule_id=baseline.capsule_id,
        candidate_capsule_id=candidate.capsule_id,
        intervention_class="skill",
        changed_files=("SKILL.md",),
        baseline_class="canonical-community-baseline",
        baseline_justification="current Hermes hosted default resolved at capsule resolution",
        selections=selections,
        development_task_ids=partitions["development"],
        validation_task_ids=partitions["validation"],
        untouched_task_ids=partitions["untouched"],
        optimizer_method="manual",
        optimizer_candidate_count=1,
        rejected_candidate_ids=(),
        policy=FOUNDER_DEFAULT_POLICY,
    )
