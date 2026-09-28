"""What a host agent may be told about a finished forge comparison.

It starts from what the comparison recorded and subtracts everything a revised Skill must not be
allowed to learn. What comes out is a `ForgeImprovementContext`: the objective, the headline
result, and a bounded, ordered list of task pairs worth looking at, each with the task's own
instruction, which is the text the agent was shown and nothing more.

What never comes out: a task's reference solutions and tests, what either arm left, any
transcript, any local path. Nothing at all comes out about the collection's held-out tasks, not
even when the runs covered them: no id, no name, no instruction and no result; only how many
there are. They are the tasks a revision's verdict is computed on, so the agent writing it never
sees them. The headline and the examples are the tasks it may study alone. Both runs must have
covered every task, the ones it may study and the ones held out, or nothing is written: a
revision is learned from the first and judged on the second.

Every free-text field is checked for control sequences and absolute paths before the context is
returned, and a value that carries one is refused, not edited. The one exception is a task's own
sandbox: its instruction may name paths under the folders its required outputs go in, such as
`/app`, because those are inside the task, not on anyone's computer.

The context is derived, not evidence: it is rewritten on every call, nothing signs it, and
nothing uploads it.
"""

from __future__ import annotations

import re
from pathlib import Path, PurePosixPath
from typing import Final, Literal, NamedTuple

from pydantic import Field

from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.forge.collection import read_collection_status
from regents_cli.techtree.forge.compare import read_comparison_status
from regents_cli.techtree.forge.models import (
    ForgeAttemptOutcome,
    ForgeAttemptPair,
    ForgeAttemptRecord,
    ForgeComparisonRecord,
    ForgePairResult,
    ForgeRunSpec,
    ForgeTaskId,
)
from regents_cli.techtree.forge.qualify import read_skill_task_facts
from regents_cli.techtree.forge.run import read_run_status
from regents_cli.techtree.models.base import Digest, NonEmptyString, ProtocolModel
from regents_cli.techtree.models.skill import SKILL_ENTRY_FILE
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.presentation.sanitize import (
    ensure_no_control_or_local_path,
    sanitize_label,
)

FORGE_IMPROVEMENT_CONTEXT_SCHEMA_VERSION: Final = "techtree.forge-improvement-context.v1alpha3"

#: How much of a task's instruction a context carries.
PROMPT_LIMIT: Final = 600

IMPROVEMENT_CONTEXT_INVALID: Final = "improvement_context_invalid"
IMPROVEMENT_CONTEXT_FORBIDDEN_MATERIAL: Final = "improvement_context_forbidden_material"

#: How many pairs a context carries at most. A context is read by a model with a finite window,
#: and a run with hundreds of tasks would otherwise push the regressions, the part that matters
#: most, out of reach.
EXAMPLE_LIMIT: Final = 20

#: How many stable successes ride along as contrast; small is what keeps the list about failures.
EXAMPLE_CONTRAST_LIMIT: Final = 3

#: What a revision is allowed to be. Stated on the context because the model reading it is being
#: asked to produce a Skill, and a constraint it was never told about is a constraint it will
#: break. The hidden material is a real answer and real tests, and a Skill that carries either is
#: measuring recall, not method.
REVISION_CONSTRAINTS: Final[tuple[str, ...]] = (
    "The revision is an instruction Skill: Markdown and plain text files, with SKILL.md as its "
    "entry point.",
    "The revision changes only the Skill's own files. Nothing else about the experiment may "
    "differ, and nothing else will be allowed to.",
    "The revision must not encode answers to specific tasks. It is measured on the same "
    "committed tasks, and a Skill that memorizes them measures nothing.",
    "The revision must not contain credentials, keys, tokens, or absolute local paths. Nothing "
    "checks for them, so writing one in puts it in the record.",
    "The revision must differ from the Skill it replaces. An identical tree would compare a "
    "Skill against itself.",
    "The revision must not carry the tasks' reference solutions or their tests, in whole or in "
    "part. It is screened against both before it runs, and every line it shares with them is "
    "recorded on the revision.",
    "The revision is judged on held-out tasks this context does not show. A Skill that fits "
    "only the tasks shown here will not carry over.",
)

#: What this context does not carry, stated to whoever reads it.
PROHIBITED_MATERIAL: Final[tuple[str, ...]] = (
    "the reference solutions of any task",
    "the tests of any task",
    "what either arm left in its working directory",
    "agent transcripts and logs",
    "any local path",
    "private environment values",
    "anything about the held-out tasks but how many there are",
)


class ForgeImprovementExample(ProtocolModel):
    """One paired attempt, as a model proposing a revision may see it."""

    task_id: ForgeTaskId
    attempt: int
    public_prompt: NonEmptyString
    baseline_outcome: ForgeAttemptOutcome | None
    baseline_reward: float | None
    candidate_outcome: ForgeAttemptOutcome | None
    candidate_reward: float | None
    delta: float | None
    result: ForgePairResult
    candidate_agent_seconds: float | None
    candidate_api_calls: int | None


class ForgeImprovementResult(ProtocolModel):
    """The headline the revision has to beat: the part the reviser may study, never the whole,
    with the means over that part's graded pairs."""

    pairs_planned: int
    pairs_graded: int
    wins: int
    losses: int
    ties: int
    unresolved: int
    baseline_mean_reward: float | None
    candidate_mean_reward: float | None
    mean_delta: float | None
    complete: bool


class ForgeImprovementCollection(ProtocolModel):
    """A collection of tasks written from a Skill, by its id.

    `held_out_tasks` is how many of its tasks are held out; nothing else about them is here.
    """

    collection_id: NonEmptyString
    held_out_tasks: int = Field(ge=1)


class ForgeImprovementContext(ProtocolModel):
    """Everything a host agent is given to propose one forge Skill revision.

    The fingerprints a proposal binds to are all here: the comparison, both runs, the
    collection, and the parent Skill's root and entrypoint digests. None of them is the Skill's
    text; that is read through `regents techtree uplift skill-source <candidate run>`, which
    verifies it against these same digests.
    """

    schema_version: Literal["techtree.forge-improvement-context.v1alpha3"]
    comparison_id: NonEmptyString
    baseline_run_id: NonEmptyString
    candidate_run_id: NonEmptyString
    tasks_from: ForgeImprovementCollection
    parent_skill_name: NonEmptyString
    parent_skill_digest: Digest
    parent_skill_entrypoint_digest: Digest
    objective: NonEmptyString
    current_result: ForgeImprovementResult
    examples: list[ForgeImprovementExample]
    constraints: list[NonEmptyString]
    prohibited_material: list[NonEmptyString]


def build_forge_improvement_context(
    paths: TechtreePaths, comparison_id: str
) -> ForgeImprovementContext:
    """Build the sanitized local context for one recorded comparison."""
    comparison = read_comparison_status(paths, comparison_id).record
    candidate = read_run_status(paths, comparison.candidate_run_id)
    skill = candidate.spec.skill
    if skill is None:
        raise ValidationError(
            "the candidate run carries no Skill, so there is nothing to revise",
            code=IMPROVEMENT_CONTEXT_INVALID,
            details={"comparison_id": comparison_id},
        )
    require_whole_collection(paths, comparison)
    tasks_from, tasks = _tasks(paths, candidate.spec)
    entrypoint = next((file.digest for file in skill.files if file.path == SKILL_ENTRY_FILE), None)
    if entrypoint is None:
        raise ValidationError(
            f"the Skill this comparison measured lists no {SKILL_ENTRY_FILE}",
            code=IMPROVEMENT_CONTEXT_INVALID,
            details={"comparison_id": comparison_id, "skill": skill.root_digest},
        )

    prompts = {
        task_id: (task.directory / "instruction.md").read_text(encoding="utf-8")
        for task_id, task in tasks.items()
    }
    examples = _select(
        [
            _example(
                pair,
                prompts[pair.task_id],
                tasks[pair.task_id].sandbox,
                candidate.record.attempts,
            )
            for pair in comparison.pairs
            if pair.task_id in tasks
        ]
    )
    context = ForgeImprovementContext(
        schema_version=FORGE_IMPROVEMENT_CONTEXT_SCHEMA_VERSION,
        comparison_id=comparison.comparison_id,
        baseline_run_id=comparison.baseline_run_id,
        candidate_run_id=comparison.candidate_run_id,
        tasks_from=tasks_from,
        parent_skill_name=skill.name,
        parent_skill_digest=skill.root_digest,
        parent_skill_entrypoint_digest=entrypoint,
        objective=_objective(comparison, tasks_from),
        current_result=_current_result(comparison),
        examples=examples,
        constraints=list(REVISION_CONSTRAINTS),
        prohibited_material=list(PROHIBITED_MATERIAL),
    )
    for label, value in _free_text(context):
        _forbid(label, value)
    return context


def require_whole_collection(paths: TechtreePaths, comparison: ForgeComparisonRecord) -> None:
    """Refuse a comparison whose runs left any of the collection's tasks out.

    The agent revising the Skill learns from the tasks it may study, and the revision is judged
    on the ones held out from it.
    """
    collection_id = comparison.tasks_from.collection_id
    tasks = len(read_collection_status(paths, collection_id).record.review.members)
    covered = len({pair.task_id for pair in comparison.pairs})
    if covered == tasks:
        return
    raise ValidationError(
        f"the runs compared in {comparison.comparison_id} cover {covered} of the "
        f"{tasks} tasks of collection {collection_id}. A revision is learned "
        "from the tasks the agent may study and judged on the ones held out "
        "from it, so both runs cover every task. Run the baseline and the "
        "candidate on the whole collection, without --tasks, compare them, and "
        "revise from that comparison",
        code="forge_revision_partial_collection",
        details={
            "comparison_id": comparison.comparison_id,
            "collection_id": collection_id,
            "covered": covered,
            "tasks": tasks,
        },
    )


# ---------------------------------------------------------------------------
# The pieces
# ---------------------------------------------------------------------------


class _Task(NamedTuple):
    """Where one task's files are, and the sandbox folders its text may name."""

    directory: Path
    sandbox: tuple[str, ...]


def _tasks(
    paths: TechtreePaths, spec: ForgeRunSpec
) -> tuple[ForgeImprovementCollection, dict[str, _Task]]:
    """Name the collection, and find the files of each task the reviser may study."""
    collection_id = spec.tasks_from.collection_id
    members = read_collection_status(paths, collection_id).record.review.members
    # Only the tasks the reviser may study are read at all.
    study = {member.task_id: member.build_id for member in members if member.part == "study"}
    directories = {
        task_id: paths.forge_build_dir(study[task_id]) / "tasks" / task_id
        for task_id in spec.task_ids
        if task_id in study
    }
    return (
        ForgeImprovementCollection(
            collection_id=collection_id,
            held_out_tasks=sum(member.part == "held_out" for member in members),
        ),
        {
            task_id: _Task(directory, _sandbox(directory))
            for task_id, directory in directories.items()
        },
    )


def _sandbox(task_dir: Path) -> tuple[str, ...]:
    """The folders a task's required outputs go in, never the root."""
    parents = {
        PurePosixPath(artifact).parent for artifact in read_skill_task_facts(task_dir).artifacts
    }
    return tuple(sorted(str(parent) for parent in parents if parent.parent != parent))


def _outside(text: str, sandbox: tuple[str, ...]) -> str:
    """`text` without the paths it names inside the task's sandbox."""
    for root in sandbox:
        text = re.sub(
            rf"(?<![\w.\-/\\]){re.escape(root)}(?![\w.\-])(?:/[\w.\-]*)*",
            " ",
            text,
        )
    return text


def _example(
    pair: ForgeAttemptPair,
    prompt: str,
    sandbox: tuple[str, ...],
    attempts: list[ForgeAttemptRecord],
) -> ForgeImprovementExample:
    """Describe one pair; the whole prompt is checked before it is shortened.

    The instruction is a document, so its line breaks are flattened before the check; a local
    path anywhere in it, including past where the example is cut, is refused unless it is inside
    the task's own sandbox.
    """
    _forbid(f"{pair.task_id}.public_prompt", _outside(" ".join(prompt.split()), sandbox))
    attempt = next(
        (a for a in attempts if a.task_id == pair.task_id and a.attempt == pair.attempt),
        None,
    )
    usage = attempt.usage if attempt is not None else None
    return ForgeImprovementExample(
        task_id=pair.task_id,
        attempt=pair.attempt,
        public_prompt=sanitize_label(prompt, maximum=PROMPT_LIMIT),
        baseline_outcome=pair.baseline_outcome,
        baseline_reward=pair.baseline_reward,
        candidate_outcome=pair.candidate_outcome,
        candidate_reward=pair.candidate_reward,
        delta=pair.delta,
        result=pair.result,
        candidate_agent_seconds=attempt.agent_seconds if attempt is not None else None,
        candidate_api_calls=usage.api_calls if usage is not None else None,
    )


def _rank(example: ForgeImprovementExample) -> tuple[int, float]:
    """Order the pairs a reviser reads: what the Skill hurt first.

    Losses worst-first, then pairs the candidate could not finish, then the tasks it still earns
    nothing on, then the narrowest wins. A tie the candidate already scores on is contrast only.
    """
    delta = example.delta if example.delta is not None else 0.0
    if example.result is ForgePairResult.LOSS:
        return (0, delta)
    if example.result is ForgePairResult.UNRESOLVED:
        return (1, 0.0)
    if example.result is ForgePairResult.TIE and not example.candidate_reward:
        return (2, 0.0)
    if example.result is ForgePairResult.WIN:
        return (3, delta)
    return (4, 0.0)


def _select(examples: list[ForgeImprovementExample]) -> list[ForgeImprovementExample]:
    ranked = sorted(enumerate(examples), key=lambda item: (*_rank(item[1]), item[0]))
    chosen: list[ForgeImprovementExample] = []
    contrast = 0
    for _, example in ranked:
        if _rank(example)[0] == 4:
            if contrast >= EXAMPLE_CONTRAST_LIMIT:
                continue
            contrast += 1
        chosen.append(example)
        if len(chosen) >= EXAMPLE_LIMIT:
            break
    return chosen


def _current_result(comparison: ForgeComparisonRecord) -> ForgeImprovementResult:
    """The study part's headline."""
    study = comparison.study
    return ForgeImprovementResult(
        pairs_planned=study.pairs_planned,
        pairs_graded=study.pairs_graded,
        wins=study.wins,
        losses=study.losses,
        ties=study.ties,
        unresolved=study.unresolved,
        baseline_mean_reward=study.baseline_mean_reward,
        candidate_mean_reward=study.candidate_mean_reward,
        mean_delta=study.mean_delta,
        complete=study.complete,
    )


def _objective(comparison: ForgeComparisonRecord, tasks_from: ForgeImprovementCollection) -> str:
    """State, in one sentence a model can act on, what a revision has to beat."""
    name = comparison.candidate_skill.name
    result = _current_result(comparison)
    current = result.candidate_mean_reward
    held_out = tasks_from.held_out_tasks
    seen = f"its mean reward is {current:.3f}" if current is not None else "no pair was graded yet"
    return sanitize_label(
        f"Revise {name} so that it does better on the {held_out} held-out "
        f"{'task' if held_out == 1 else 'tasks'} this context does not show, without changing "
        f"anything else about the experiment. Over the {result.pairs_planned} task attempts "
        f"shown here, {seen}.",
        maximum=400,
    )


def _free_text(context: ForgeImprovementContext) -> list[tuple[str, str]]:
    """Every free-text field but the examples, whose whole prompts were checked."""
    return [
        ("objective", context.objective),
        *((f"constraints[{index}]", value) for index, value in enumerate(context.constraints)),
        *(
            (f"prohibited_material[{index}]", value)
            for index, value in enumerate(context.prohibited_material)
        ),
    ]


def _forbid(label: str, value: str) -> None:
    try:
        ensure_no_control_or_local_path(value, field=label)
    except ValidationError as error:
        raise ValidationError(
            "a value bound for an improvement context carries material the context excludes: "
            f"{error.message}",
            code=IMPROVEMENT_CONTEXT_FORBIDDEN_MATERIAL,
            details={"field": label},
        ) from error
