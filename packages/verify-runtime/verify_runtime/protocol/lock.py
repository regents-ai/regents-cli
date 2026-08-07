"""Lock a matched protocol before any baseline or candidate execution."""

from __future__ import annotations

from dataclasses import replace
from typing import Sequence

from verify_runtime.families import (
    CANDIDATE_SKILL,
    CHALLENGE_REVISION_ID,
    DECISION_RULE,
    FAMILY,
    TASKS,
    TASKSET_PACKAGE,
    TREATMENT_DIFF,
)
from verify_runtime.model import (
    AuthoredQuestion,
    BenchmarkFamily,
    Capsule,
    EnvironmentFamily,
    EvaluationProtocol,
    MatchedSelection,
    ModelValidationError,
    TaskInstance,
    TasksetPackageReference,
    VerifyPolicy,
)


FOUNDER_DEFAULT_POLICY = VerifyPolicy(
    policy_id="verify-public-default-v1",
    attempts_per_task=1,
    max_task_wall_seconds=600,
    max_comparison_spend_usd_cents=1_000,
    timeout_treatment="terminal-timeout-not-scored",
    missing_result_treatment="terminal-invalid-not-scored",
    infrastructure_failure_treatment="terminal-infrastructure-failure-not-scored",
)


def _validate_capsules(baseline: Capsule, candidate: Capsule) -> None:
    if baseline.resolved.skill_digest == candidate.resolved.skill_digest:
        raise ValueError("baseline and candidate must differ in SKILL.md")
    if baseline.declared.to_dict() | {"skill_source": candidate.declared.skill_source} != candidate.declared.to_dict():
        raise ValueError("built-in comparison must change only SKILL.md")
    baseline_resolved = baseline.resolved.to_dict()
    candidate_resolved = candidate.resolved.to_dict()
    baseline_resolved["skill"] = candidate_resolved["skill"]
    if baseline_resolved != candidate_resolved:
        raise ValueError("built-in comparison resolved more than SKILL.md differently")


def _normalized_tasks(tasks: Sequence[TaskInstance], family_id: str) -> tuple[TaskInstance, ...]:
    normalized = tuple(
        replace(TaskInstance.from_dict(task.to_dict()), answer_key_commitment=task.answer_key_commitment)
        for task in tasks
    )
    task_ids = tuple(task.task_id for task in normalized)
    if len(set(task_ids)) != len(task_ids):
        raise ModelValidationError("lock taskset contains duplicate task identities")
    if any(task.family_id != family_id for task in normalized):
        raise ModelValidationError("lock taskset contains a task from another family")
    return normalized


def _validate_authored_questions(
    authored_questions: Sequence[AuthoredQuestion],
    task_ids: set[str],
) -> None:
    normalized = tuple(AuthoredQuestion.from_dict(question.to_dict()) for question in authored_questions)
    question_ids = tuple(question.question_id for question in normalized)
    if len(set(question_ids)) != len(question_ids):
        raise ModelValidationError("lock authored questions contain duplicate identities")
    if any(question.acceptance_decision != "accepted" for question in normalized):
        raise ModelValidationError("only accepted authored questions can enter held-out locking")
    if any(question_id not in task_ids for question_id in question_ids):
        raise ModelValidationError("accepted authored question is absent from the locked taskset")


def _validate_reference_commitments(
    family: BenchmarkFamily,
    tasks: Sequence[TaskInstance],
) -> None:
    references = {question.question_id: question.answer_key_commitment for question in family.reference_questions}
    for task in tasks:
        reference_commitment = references.get(task.task_id)
        if task.provenance == "public_reference":
            if reference_commitment is None:
                raise ModelValidationError("public_reference task is not declared by the family")
            if task.answer_key_commitment != reference_commitment:
                raise ModelValidationError("public_reference answer-key commitment does not match the family")
        elif reference_commitment is not None:
            raise ModelValidationError("family reference task was relabeled as held_out")


def _selections(tasks: Sequence[TaskInstance]) -> tuple[MatchedSelection, ...]:
    matched_tasks = tuple(task for task in tasks if task.partition != "development")
    return tuple(
        MatchedSelection(
            task_id=task.task_id,
            partition=task.partition,
            matched_order=order,
            provenance=task.provenance,
            answer_key_commitment=task.answer_key_commitment,
        )
        for order, task in enumerate(matched_tasks)
    )


def _protocol(
    *,
    family_id: str,
    baseline: Capsule,
    candidate: Capsule,
    selections: tuple[MatchedSelection, ...],
    development_task_ids: tuple[str, ...],
    validation_task_ids: tuple[str, ...],
    untouched_task_ids: tuple[str, ...],
    taskset_package: TasksetPackageReference,
    challenge_revision_id: str,
    decision_rule,
    treatment_skill_content: str,
) -> EvaluationProtocol:
    protocol = EvaluationProtocol(
        schema_version=1,
        protocol_id="pending",
        family_id=family_id,
        baseline_capsule_id=baseline.capsule_id,
        candidate_capsule_id=candidate.capsule_id,
        intervention_class="skill",
        changed_files=("SKILL.md",),
        baseline_class="canonical-community-baseline",
        baseline_justification="current Hermes hosted default resolved at capsule resolution",
        selections=selections,
        development_task_ids=development_task_ids,
        validation_task_ids=validation_task_ids,
        untouched_task_ids=untouched_task_ids,
        optimizer_method="manual",
        optimizer_candidate_count=1,
        rejected_candidate_ids=(),
        policy=FOUNDER_DEFAULT_POLICY,
        taskset_version=taskset_package,
        challenge_revision_id=challenge_revision_id,
        treatment_skill_source="builtin://candidate/SKILL.md",
        treatment_skill_content=treatment_skill_content,
        treatment_diff=TREATMENT_DIFF,
        exact_commands=(
            "regents techtree verify run --builtin --executor <fixture|hermes|prime> --json",
            "regents techtree uplift report " + " ".join("--receipt-digest <sha256>" for _ in selections) + " --json",
        ),
        harness_settings=(("profile", "default"),),
        seeds=(),
        expected_output_schema="verify_runtime.execution_result.v1",
        decision_rule=decision_rule,
    )
    return EvaluationProtocol.from_dict(replace(protocol, protocol_id=protocol.expected_protocol_id()).to_dict())


def _lock_from_records(
    baseline: Capsule,
    candidate: Capsule,
    *,
    family_id: str,
    tasks: Sequence[TaskInstance],
    taskset_package: TasksetPackageReference,
    challenge_revision_id: str,
    decision_rule,
    authored_questions: Sequence[AuthoredQuestion] = (),
) -> EvaluationProtocol:
    _validate_capsules(baseline, candidate)
    normalized_tasks = _normalized_tasks(tasks, family_id)
    _validate_authored_questions(authored_questions, {task.task_id for task in normalized_tasks})
    selections = _selections(normalized_tasks)
    if not selections:
        raise ModelValidationError("lock taskset contains no scored or calibration tasks")
    partitions = {
        partition: tuple(task.task_id for task in normalized_tasks if task.partition == partition)
        for partition in ("development", "validation", "untouched")
    }
    return _protocol(
        family_id=family_id,
        baseline=baseline,
        candidate=candidate,
        selections=selections,
        development_task_ids=partitions["development"],
        validation_task_ids=partitions["validation"],
        untouched_task_ids=partitions["untouched"],
        taskset_package=taskset_package,
        challenge_revision_id=challenge_revision_id,
        decision_rule=decision_rule,
        treatment_skill_content=CANDIDATE_SKILL.decode("utf-8"),
    )


def lock_benchmark_protocol(
    baseline: Capsule,
    candidate: Capsule,
    *,
    family: BenchmarkFamily,
    tasks: Sequence[TaskInstance],
    authored_questions: Sequence[AuthoredQuestion] = (),
) -> EvaluationProtocol:
    """Lock a family using only its rule, revision, package, and task provenance."""

    locked_family = BenchmarkFamily.from_dict(family.to_dict())
    normalized_tasks = _normalized_tasks(tasks, locked_family.family_id)
    _validate_reference_commitments(locked_family, normalized_tasks)
    return _lock_from_records(
        baseline,
        candidate,
        family_id=locked_family.family_id,
        tasks=normalized_tasks,
        taskset_package=locked_family.taskset_package,
        challenge_revision_id=locked_family.challenge_contract.challenge_revision_id,
        decision_rule=locked_family.challenge_contract.decision_rule,
        authored_questions=authored_questions,
    )


def lock_builtin_protocol(baseline: Capsule, candidate: Capsule) -> EvaluationProtocol:
    """Lock the existing offline family while carrying the new commitments."""

    family = EnvironmentFamily.from_dict(FAMILY.to_dict())
    tasks = TASKS
    return _lock_from_records(
        baseline,
        candidate,
        family_id=family.family_id,
        tasks=tasks,
        taskset_package=TASKSET_PACKAGE,
        challenge_revision_id=CHALLENGE_REVISION_ID,
        decision_rule=DECISION_RULE,
    )
