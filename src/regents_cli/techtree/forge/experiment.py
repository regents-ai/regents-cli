"""Declaring one arm of a forge experiment before it runs.

A `ForgeRunSpec` is written from checked facts: the collection is accepted and still exactly
what was accepted, every named task is one of its members, the Hermes on the path answers
`--version`, and a Skill scans cleanly with a name Hermes accepts. What cannot be checked is
listed under `not_established`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.forge.calls import agent_spec, model_spec
from regents_cli.techtree.forge.capture import OUTPUT_LIMITS
from regents_cli.techtree.forge.collection import verify_collection
from regents_cli.techtree.forge.docker import CONTAINER_CPUS
from regents_cli.techtree.forge.models import (
    FORGE_RUN_SPEC_SCHEMA_VERSION,
    ForgeArm,
    ForgeCollectionTasks,
    ForgeGradingSpec,
    ForgeInitialState,
    ForgeLimits,
    ForgeRunSpec,
    ForgeSamplingSpec,
    ForgeSkillSpec,
    ForgeSubjectToolset,
)
from regents_cli.techtree.forge.skill import scan_skill_spec
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.paths import TechtreePaths

#: The sandbox memory bound in Hermes' unit: the same 4g the grading containers get.
CONTAINER_MEMORY_MB: Final = 4096

#: The tools every subject is given, each routed through its sandbox.
SUBJECT_TOOLSETS: Final[tuple[ForgeSubjectToolset, ...]] = (
    "terminal",
    "file",
    "code_execution",
    "skills",
)

#: What a local experiment cannot establish and therefore says out loud.
NOT_ESTABLISHED: Final[tuple[str, ...]] = (
    "which model the provider actually served: Hermes' usage report is the "
    "only witness, and it is self-reported",
    "that the Hermes executable is unmodified: its version is what it prints",
    "the provider's sampling settings: Hermes exposes no temperature or seed, "
    "so every attempt uses the provider's default",
)


def declare_run_spec(
    paths: TechtreePaths,
    *,
    arm: ForgeArm,
    collection_id: str,
    task_ids: list[str] | None,
    skill_root: Path | None,
    provider: str,
    model_id: str,
    reasoning: str | None,
    repetitions: int,
) -> ForgeRunSpec:
    """Declare one arm of an experiment on an accepted collection, from checked facts.

    `task_ids` are the tasks to run, in order, all of them when None. `skill_root` is required
    on the candidate arm, and on the baseline only when it measures an earlier Skill.
    """
    status = verify_collection(paths, collection_id)
    review = status.record.review
    tasks = _subset(task_ids, [member.task_id for member in review.members], collection_id)
    skill = _skill_for(arm, skill_root)
    return ForgeRunSpec(
        schema_version=FORGE_RUN_SPEC_SCHEMA_VERSION,
        arm=arm,
        tasks_from=ForgeCollectionTasks(
            kind="collection",
            collection_id=collection_id,
            collection_digest=status.record.collection_digest,
            membership_digest=review.membership_digest,
        ),
        task_ids=tasks,
        grading=ForgeGradingSpec(procedure="harbor-compatible", executed_by="local-experiment"),
        agent=agent_spec(),
        toolsets=list(SUBJECT_TOOLSETS),
        model=model_spec(provider, model_id, reasoning),
        initial_state=ForgeInitialState(home="fresh-empty", memory_enabled=False),
        skill=skill,
        limits=ForgeLimits(
            agent_budget="task-timeout",
            turns="unbounded",
            container_cpus=int(CONTAINER_CPUS),
            container_memory_mb=CONTAINER_MEMORY_MB,
            network=False,
            outputs=OUTPUT_LIMITS,
        ),
        sampling=ForgeSamplingSpec(control="provider-default", repetitions=repetitions),
        not_established=list(NOT_ESTABLISHED),
    )


def run_spec_digest(spec: ForgeRunSpec) -> Digest:
    """The digest that identifies a specification by its content."""
    return digest_object(spec)


def _subset(task_ids: list[str] | None, members: list[str], collection_id: str) -> list[str]:
    """The named tasks, each a member; every member when none is named."""
    if task_ids is None:
        return members
    unusable: list[JsonValue] = [task_id for task_id in task_ids if task_id not in members]
    if unusable:
        raise ValidationError(
            ", ".join(str(task_id) for task_id in unusable)
            + f" {'is' if len(unusable) == 1 else 'are'} not among the tasks of "
            f"collection {collection_id} that can run",
            code="forge_task_not_qualified",
            details={"collection_id": collection_id, "unqualified": unusable},
        )
    return list(task_ids)


def _skill_for(arm: ForgeArm, skill_root: Path | None) -> ForgeSkillSpec | None:
    if skill_root is None and arm is ForgeArm.BASELINE:
        return None
    if skill_root is None:
        raise ValidationError(
            "the candidate arm needs the Skill it is measuring",
            code="forge_candidate_without_skill",
        )
    spec, _ = scan_skill_spec(skill_root)
    return spec
