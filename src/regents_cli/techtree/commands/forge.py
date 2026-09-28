"""`regents techtree forge …`: tasks from a Skill, and experiments on them.

The steps that call a model or accept tasks (plan-start, construct-start, accept, run) go
through `approve()`. Every answer is the record as Techtree keeps it, its `warnings`, the
`next_command` when there is one to run, and `report`, the Markdown a person reads.
"""

from __future__ import annotations

import shlex
from collections.abc import Callable
from pathlib import Path
from typing import Final

import click
from pydantic import BaseModel

from regents_cli.techtree import paths
from regents_cli.techtree.approval import REVIEWED_ON, YES, ReviewedOn, approve
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.errors import RunError, ValidationError
from regents_cli.techtree.forge.builds import read_build_status
from regents_cli.techtree.forge.calls import PROFILE_NAME
from regents_cli.techtree.forge.collection import (
    accept_collection,
    check_collection,
    prepare_collection,
    read_collection_status,
    verify_collection,
)
from regents_cli.techtree.forge.compare import compare_runs, read_comparison_status
from regents_cli.techtree.forge.construction import (
    check_construction,
    correct_task,
    prepare_construction,
    read_construction_status,
    start_construction,
)
from regents_cli.techtree.forge.experiment import declare_run_spec
from regents_cli.techtree.forge.export import export_collection
from regents_cli.techtree.forge.models import (
    MAX_PLANNED_TASKS,
    MINIMUM_COLLECTION_TASKS,
    TASK_KIND_WORDS,
    TASK_KINDS_EXPLAINED,
    VERDICT_MINIMUM_PAIRS,
    ForgeApproval,
    ForgeArm,
    ForgeArmTotals,
    ForgeAttemptOutcome,
    ForgeBuildStatus,
    ForgeCollectionCandidate,
    ForgeCollectionStatus,
    ForgeComparisonStatus,
    ForgeConstructionStatus,
    ForgeConstructionTaskStatus,
    ForgeModelSpec,
    ForgePartSummary,
    ForgePlanStatus,
    ForgeProposalStatus,
    ForgeRevisionStatus,
    ForgeRunSpec,
    ForgeRunStatus,
    ForgeSkillClaim,
    ForgeSkillRef,
    ForgeSourceStatus,
    ForgeSubjectToolset,
    ForgeTaskCorrection,
    ForgeTaskKind,
    ForgeUsage,
)
from regents_cli.techtree.forge.planning import (
    check_plan,
    correct_proposal,
    prepare_plan,
    read_plan_status,
    read_proposal_status,
    start_plan,
)
from regents_cli.techtree.forge.report import (
    FEW_TASKS,
    OUTCOME_WORDS,
    OUTPUT_FAILURE_WORDS,
    PART_WORDS,
    first_failed_check,
    task_verdict,
    verdict_words,
)
from regents_cli.techtree.forge.revision import read_revision_status
from regents_cli.techtree.forge.run import read_run_status, run_arm
from regents_cli.techtree.forge.source import inspect_source_skill, read_source_status
from regents_cli.techtree.ids import id_prefix
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.skills.scanner import UNSUPPORTED_WORDS

#: What every model call says about money before it asks.
COST_LINE: Final = (
    "Cost: nothing is quoted in advance. What each attempt used is recorded afterwards from "
    "Hermes' own usage report, including whether Hermes could put a dollar figure on it."
)
_KINDS_EXPLAINED: Final = f"Each task tests one claim. {TASK_KINDS_EXPLAINED}"
_PLAN_STATE_WORDS: Final = {
    "prepared": "prepared; the planner has not been called",
    "running": "the planner is working",
    "succeeded": "answered; the proposed claims and tasks wait for your review",
    "rejected": "answered, but not with tasks Techtree can use",
    "failed": "failed",
    "outcome_unknown": "outcome unknown",
}
_CONSTRUCTION_STATE_WORDS: Final = {
    "prepared": "prepared; the creator has not been called",
    "running": "the creator is working",
    "finished": "finished",
    "stopped": "stopped before it finished",
}
_CALL_STATE_WORDS: Final = {
    "not_called": "not called",
    "running": "the creator is working on it",
    "succeeded": "written, not yet checked",
    "rejected": "answered, but not with a package Techtree can use",
    "failed": "failed",
    "outcome_unknown": "outcome unknown",
}
_TOOLSET_WORDS: Final[dict[ForgeSubjectToolset, str]] = {
    "terminal": "a shell",
    "file": "files",
    "code_execution": "code",
    "skills": "Skills",
}

type Answer = dict[str, JsonValue]


# ---------------------------------------------------------------------------
# The answer every command gives
# ---------------------------------------------------------------------------


def _answer(
    record: BaseModel,
    report: list[str],
    *,
    warnings: list[tuple[str, str]] | None = None,
    next_command: str | None = None,
    next_words: str | None = None,
) -> Answer:
    """The record, its warnings, the next command, and the report ending on a `Next:` line.

    `next_words` is a next step a person or agent completes (a provider to choose, a folder to
    write), said in the report only.
    """
    answer: Answer = record.model_dump(mode="json")
    if warnings:
        answer["warnings"] = [{"id": warning_id, "text": text} for warning_id, text in warnings]
        report = [*report, "", *(f"- {text}" for _, text in warnings)]
    if next_command is not None:
        answer["next_command"] = next_command
    step = next_command or next_words
    answer["report"] = "\n".join([*report, *(["", f"Next: {step}"] if step else [])])
    return answer


def _warning(warning_id: str, text: str) -> tuple[str, str]:
    return warning_id, text


def _command(*words: str) -> str:
    return shlex.join(["regents", "techtree", *words])


def _plural(count: int, one: str, many: str) -> str:
    return one if count == 1 else many


def _approved_words(approval: ForgeApproval) -> str:
    how = (
        "answered at the prompt"
        if approval.answered_with == "prompt"
        else f"answered on {approval.reviewed_on} and confirmed with --yes"
    )
    return f"{approval.approved_at:%Y-%m-%d %H:%M:%S} UTC, {how}"


def _model_words(model: ForgeModelSpec) -> str:
    reasoning = f", reasoning {model.reasoning}" if model.reasoning else ""
    return f"{model.model_id} from {model.provider}{reasoning}"


def _model_options(model: ForgeModelSpec) -> list[str]:
    reasoning = ["--reasoning", model.reasoning] if model.reasoning else []
    return ["--provider", model.provider, "--model", model.model_id, *reasoning]


def _cost_words(usage: ForgeUsage | None) -> str:
    if usage is None:
        return "no usage report"
    if usage.estimated_cost_usd is None:
        return "no dollar figure"
    status = f" ({usage.cost_status})" if usage.cost_status else ""
    return f"about ${usage.estimated_cost_usd:.4f}{status}"


# ---------------------------------------------------------------------------
# inspect-skill
# ---------------------------------------------------------------------------


def inspect_skill(path: Path, as_json: bool) -> None:
    status = inspect_source_skill(paths.home(), path)
    record = status.record
    if record.state == "refused":
        raise ValidationError(
            "Techtree cannot use this Skill as it is: "
            + "; ".join(refusal.message for refusal in record.refusals)
            + ". Nothing in it was run and no model was asked about it. Fix this and look at "
            "the Skill again.",
            code="forge_skill_unsupported",
            details={
                "source_id": status.source_id,
                "path": status.path,
                "refusals": [refusal.model_dump(mode="json") for refusal in record.refusals],
            },
        )
    emit(_source_answer(status), as_json=as_json)


def _source_answer(status: ForgeSourceStatus) -> Answer:
    record = status.record
    declaration = record.declaration
    kept = [entry for entry in record.entries if entry.disposition == "admitted"]
    lines = [
        f"- Skill: {status.source_id}",
        f"- State: {'can be used' if record.state == 'admitted' else 'cannot be used'}",
        f"- From: {record.origin}",
    ]
    if declaration is not None:
        lines += [f"- Name: {declaration.name}", f"- Description: {declaration.description}"]
        if declaration.allowed_tools:
            lines.append(
                f"- Asks for tools: {' '.join(declaration.allowed_tools)} (asked for, not granted)"
            )
    if record.state == "admitted":
        lines += [
            f"- Kept: {len(kept)} {_plural(len(kept), 'file', 'files')}",
            f"- Fingerprint: {record.admitted_digest}",
        ]
    else:
        lines.append("- Kept: nothing, because the Skill cannot be used as it is")
    lines.append(f"- Evidence: {status.path}")
    lines += [
        f"  - left out {entry.path}: {UNSUPPORTED_WORDS[entry.reason]}"
        for entry in record.entries
        if entry.reason is not None and not entry.required
    ]
    lines += [f"  - cannot use: {refusal.message}" for refusal in record.refusals]
    left_out = [entry.path for entry in record.entries if entry.disposition == "unsupported"]
    warnings = (
        [
            _warning(
                "forge_source_files_left_out",
                f"{len(left_out)} {_plural(len(left_out), 'file', 'files')} the instructions "
                f"never name {_plural(len(left_out), 'is', 'are')} left out: "
                + ", ".join(left_out)
                + ". Each is listed with the reason.",
            )
        ]
        if record.state == "admitted" and left_out
        else []
    )
    return _answer(
        status,
        lines,
        warnings=warnings,
        next_words=(
            _command("forge", "plan", status.source_id)
            + " --provider PROVIDER --model MODEL, with the provider and model the person chooses"
            if record.state == "admitted"
            else None
        ),
    )


# ---------------------------------------------------------------------------
# plan, plan-start, correct-proposal
# ---------------------------------------------------------------------------


def plan(
    source_id: str, provider: str, model: str, reasoning: str | None, tasks: int, as_json: bool
) -> None:
    home = paths.home()
    status = prepare_plan(
        home,
        source_id=source_id,
        provider=provider,
        model_id=model,
        reasoning=reasoning,
        max_tasks=tasks,
    )
    emit(_plan_answer(status), as_json=as_json)


def plan_start(plan_id: str, yes: bool, reviewed_on: ReviewedOn, as_json: bool) -> None:
    home = paths.home()
    status = check_plan(home, plan_id)
    reviewed_on = approve(
        yes=yes,
        reviewed_on=reviewed_on,
        as_json=as_json,
        review=_plan_review(status),
        command=["forge", "plan-start", plan_id],
        question="Send this to the planner?",
        why="Planning sends the Skill's files to the planner once, on the person's own account.",
    )
    started = start_plan(home, plan_id, reviewed_on=reviewed_on, yes=yes)
    call = started.call
    if started.state != "succeeded" and call is not None:
        again = (
            "The planner is not called again; to try again, prepare a new plan with "
            + _new_plan_command(started)
        )
        raise RunError(
            f"{call.failure.message}. {again}"
            if call.failure is not None
            else "the planner was stopped at its time limit, so the provider may or may not "
            f"have answered or charged. {again}",
            code="forge_planning_outcome_unknown" if call.failure is None else call.failure.code,
            details={"plan_id": plan_id, "path": started.path},
        )
    emit(_plan_answer(started), as_json=as_json)


def _plan_review(status: ForgePlanStatus) -> list[str]:
    """What sending this plan would do, in the words a person approves."""
    record = status.record
    review = record.review
    disclosure = review.disclosure
    limits = review.limits
    files = len(disclosure.files)
    return [
        f"Skill: {review.source_id}, {files} {_plural(files, 'file', 'files')} "
        f"({sum(file.size for file in disclosure.files)} bytes)",
        "What the model is sent: those files, word for word, inside Techtree's planning "
        f"instructions; {disclosure.prompt_bytes} bytes in all, kept beside the plan as "
        "prompt.md.",
        *(f"  {file.path}, {file.size} bytes" for file in disclosure.files),
        f"Model: {_model_words(review.model)}",
        "The model call goes to that provider only, on the sign-in of your Hermes profile "
        f"{PROFILE_NAME} (Hermes Agent v{review.agent.version}); Techtree copies no credential "
        "and reads none.",
        "What the planner can do: answer in text. It has no tools, so it cannot run commands, "
        "read or change files, search the web or remember anything.",
        f"Limits: one attempt, at most {limits.max_tasks} proposed "
        f"{_plural(limits.max_tasks, 'task', 'tasks')}, {limits.wall_seconds} seconds, an "
        f"answer of at most {limits.answer_bytes} bytes. Nothing is retried; trying again "
        "needs a new plan and a new approval.",
        "Afterwards: the planner's answer says what the Skill claims to improve and what would "
        "show it, then proposes tasks that each test one of those claims. The claims and tasks "
        "wait for you to review or correct. Nothing is built from them without a further "
        "approval.",
        "Cost: nothing is quoted in advance. What the call used is recorded afterwards from "
        "Hermes' own usage report.",
        f"This approval covers exactly this: {record.planning_digest[:19]}",
    ]


def _new_plan_command(status: ForgePlanStatus) -> str:
    review = status.record.review
    return _command(
        "forge",
        "plan",
        review.source_id,
        *_model_options(review.model),
        "--tasks",
        str(review.limits.max_tasks),
    )


def _plan_answer(status: ForgePlanStatus) -> Answer:
    lines = [f"- Plan: {status.plan_id}", f"- State: {_PLAN_STATE_WORDS[status.state]}"]
    if status.approval is not None:
        lines.append(f"- Approved: {_approved_words(status.approval)}")
    call = status.call
    if call is not None:
        if call.seconds is not None:
            lines.append(f"- Took: {call.seconds:.0f} seconds")
        if call.stopped is not None:
            stopped = "at its time limit" if call.stopped == "wall_time" else "with Ctrl-C"
            lines.append(f"- Stopped: {stopped}")
        lines.append(f"- Cost: {_cost_words(call.usage)}")
        if call.failure is not None:
            lines.append(f"- Why: {call.failure.message}")
        if call.result is not None:
            lines.append(f"- Proposal: {call.result}")
    lines += [f"- Evidence: {status.path}", "", *_plan_review(status)]
    warnings = (
        [
            _warning(
                "forge_planning_outcome_unknown",
                "The planner call began and its end was never seen, so the provider may or may "
                "not have answered or charged. Techtree does not call it again on its own.",
            )
        ]
        if status.state == "outcome_unknown"
        else []
    )
    next_command = {
        "prepared": _command("forge", "plan-start", status.plan_id),
        "succeeded": _command("forge", "status", call.result) if call and call.result else None,
        "rejected": _new_plan_command(status),
        "failed": _new_plan_command(status),
        "outcome_unknown": _new_plan_command(status),
    }.get(status.state)
    answer = _answer(status, lines, warnings=warnings, next_command=next_command)
    answer["review"] = list(_plan_review(status))
    return answer


def correct(proposal_id: str, file: Path, as_json: bool) -> None:
    home = paths.home()
    emit(_proposal_answer(home, correct_proposal(home, proposal_id, file)), as_json=as_json)


def _claim_lines(claims: list[ForgeSkillClaim]) -> list[str]:
    return [
        line
        for claim in claims
        for line in (f"{claim.claim_id}: {claim.statement}", f"  Shown by: {claim.observable}")
    ]


def _task_label(name: str, claim: str, kind: ForgeTaskKind) -> str:
    return f"{name} ({claim}, {TASK_KIND_WORDS[kind]})"


def _proposal_answer(home: TechtreePaths, status: ForgeProposalStatus) -> Answer:
    record = status.record
    source = (
        f"the planner, plan {record.plan_id}"
        if record.parent is None
        else f"your correction of {record.parent.proposal_id}"
    )
    lines = [
        f"- Proposal: {status.proposal_id}",
        f"- From: {source}",
        f"- Skill: {record.source_id}",
        f"- Claims: {len(record.claims)}",
        f"- Tasks: {len(record.tasks)}",
        f"- Digest: {record.proposal_digest[:19]}",
        f"- To correct: edit a copy of {Path(status.path) / 'claims-and-tasks.json'}",
        "",
        "What this Skill claims to improve:",
        *(f"  {line}" for line in _claim_lines(record.claims)),
        "",
        _KINDS_EXPLAINED,
    ]
    for task in record.tasks:
        lines += [
            "",
            f"{_task_label(task.name, task.claim, task.kind)}: {task.summary}",
            f"  Starts from: {task.scenario}",
            *(f"  - {criterion}" for criterion in task.success_criteria),
            f"  Checked by: {task.verifier_strategy}",
        ]
    model = read_plan_status(home, record.plan_id).record.review.model
    return _answer(
        status,
        lines,
        next_command=_command("forge", "construct", status.proposal_id, *_model_options(model)),
    )


# ---------------------------------------------------------------------------
# construct, construct-start, correct-task
# ---------------------------------------------------------------------------


def construct(
    proposal_id: str, provider: str, model: str, reasoning: str | None, as_json: bool
) -> None:
    home = paths.home()
    status = prepare_construction(
        home, proposal_id=proposal_id, provider=provider, model_id=model, reasoning=reasoning
    )
    emit(_construction_answer(status), as_json=as_json)


def construct_start(
    construction_id: str, yes: bool, reviewed_on: ReviewedOn, as_json: bool
) -> None:
    home = paths.home()
    status = check_construction(home, construction_id)
    reviewed_on = approve(
        yes=yes,
        reviewed_on=reviewed_on,
        as_json=as_json,
        review=_construction_review(status),
        command=["forge", "construct-start", construction_id],
        question="Send these tasks to the creator?",
        why="Building sends each proposed task with the Skill's files to the creator once, on "
        "the person's own account.",
    )
    started = start_construction(home, construction_id, reviewed_on=reviewed_on, yes=yes)
    if not any(_usable(task) for task in started.tasks):
        raise RunError(
            "no task of this construction got a usable package. The creator is not called "
            "again; to try again, correct the proposal with forge correct-proposal, or prepare "
            "a new construction",
            code="forge_construction_nothing_usable",
            details={"construction_id": construction_id, "path": started.path},
        )
    emit(_construction_answer(started), as_json=as_json)


def fix_task(construction_id: str, task_name: str, folder: Path, as_json: bool) -> None:
    status = correct_task(paths.home(), construction_id, task_name, folder)
    [task] = [task for task in status.tasks if task.task_name == task_name]
    answer = _construction_answer(status)
    answer["report"] = (
        f"Recorded your correction of {task_name}: {_correction_words(task.corrections[-1])}\n\n"
        + str(answer["report"])
    )
    emit(answer, as_json=as_json)


def _construction_review(status: ForgeConstructionStatus) -> list[str]:
    """What sending this construction would do, in the words a person approves."""
    record = status.record
    review = record.review
    disclosure = review.disclosure
    limits = review.limits
    calls = len(disclosure.calls)
    files = len(disclosure.files)
    image, digest = review.recipe.base_image.split("@")
    corrected = (
        [
            "Corrected since: " + ", ".join(review.corrected_by) + ". This builds the proposal "
            "as it stands, not those corrections."
        ]
        if review.corrected_by
        else []
    )
    return [
        f"Proposal: {review.proposal_id}, {calls} {_plural(calls, 'task', 'tasks')} to build",
        f"Skill: {review.source_id}, {files} {_plural(files, 'file', 'files')} "
        f"({sum(file.size for file in disclosure.files)} bytes)",
        *corrected,
        "What this Skill claims to improve:",
        *(f"  {line}" for line in _claim_lines(review.claims)),
        _KINDS_EXPLAINED,
        "What the model is sent, once for each task: that task as proposed, the claim it "
        "tests, and the Skill's files, word for word, inside Techtree's building instructions. "
        "Each prompt is kept in the construction's prompts folder.",
        *(
            f"  {_task_label(call.task_name, call.claim, call.kind)}, {call.prompt_bytes} bytes"
            for call in disclosure.calls
        ),
        f"Model: {_model_words(review.model)}",
        "The model calls go to that provider only, on the sign-in of your Hermes profile "
        f"{PROFILE_NAME} (Hermes Agent v{review.agent.version}); Techtree copies no credential "
        "and reads none.",
        "What the creator can do: answer in text. It has no tools, so it cannot run commands, "
        "read or change files, search the web or remember anything. Techtree writes the files "
        "it answers with.",
        f"Limits: one call per task, {limits.calls} in all, each of at most "
        f"{limits.wall_seconds_per_call} seconds and an answer of at most "
        f"{limits.answer_bytes_per_call} bytes. Nothing is retried; trying again needs a new "
        "construction and a new approval.",
        "Afterwards: each package is checked on this computer with Docker, with no network: "
        f"its image is built from {image} at the exact version {digest[:19]}, downloaded first "
        "if Docker does not have it, and its tests must fail when nothing is done, pass for its "
        "solution and for its other correct solution, and fail for its deliberately wrong one. "
        "Only a package that passes is usable.",
        "Cost: nothing is quoted in advance. What each call used is recorded afterwards from "
        "Hermes' own usage report.",
        f"This approval covers exactly this: {record.construction_digest[:19]}",
    ]


def _usable(task: ForgeConstructionTaskStatus) -> bool:
    return bool(task.corrections) or (task.package is not None and task.package.usable_tasks > 0)


def _task_words(task: ForgeConstructionTaskStatus) -> str:
    package = task.package
    if task.corrections:
        return f"corrected by a person, usable, checked as build {task.corrections[-1].build_id}"
    if package is None:
        return _CALL_STATE_WORDS[task.state]
    if package.failure is None:
        return f"usable, checked as build {package.build_id}"
    return f"written, but not usable: {package.failure.message}"


def _correction_words(correction: ForgeTaskCorrection) -> str:
    replacing = "" if correction.replaces is None else f", replacing build {correction.replaces}"
    return (
        f"{correction.corrected_at:%Y-%m-%d %H:%M:%S} UTC, checked as build "
        f"{correction.build_id}{replacing}; {_changes_words(correction)}"
    )


def _changes_words(correction: ForgeTaskCorrection) -> str:
    """Each changed file by name when there are few, else how many of each kind."""
    changes = correction.changes
    if len(changes) <= 4:
        return ", ".join(f"{change.path} {change.change}" for change in changes)
    counts = {
        kind: sum(change.change == kind for change in changes)
        for kind in ("added", "modified", "removed")
    }
    return ", ".join(
        f"{count} {_plural(count, 'file or folder', 'files and folders')} {kind}"
        for kind, count in counts.items()
        if count
    )


def _construction_answer(status: ForgeConstructionStatus) -> Answer:
    lines = [
        f"- Construction: {status.construction_id}",
        f"- State: {_CONSTRUCTION_STATE_WORDS[status.state]}",
        f"- Proposal: {status.record.review.proposal_id}",
    ]
    if status.approval is not None:
        lines.append(f"- Approved: {_approved_words(status.approval)}")
    if status.run is not None and status.run.stopped is not None:
        lines.append("- Stopped: with Ctrl-C")
    lines.append(f"- Evidence: {status.path}")
    if status.state != "prepared":
        for task in status.tasks:
            lines += ["", f"{task.task_name}: {_task_words(task)}"]
            call = task.call
            if call is not None:
                lines.append(f"  - Package: {task.package_name}")
                if call.seconds is not None:
                    lines.append(f"  - Took: {call.seconds:.0f} seconds")
                if call.stopped is not None:
                    stopped = "at its time limit" if call.stopped == "wall_time" else "with Ctrl-C"
                    lines.append(f"  - Stopped: {stopped}")
                lines.append(f"  - Cost: {_cost_words(call.usage)}")
                if call.failure is not None:
                    lines.append(f"  - Why: {call.failure.message}")
            if task.package is not None and task.corrections:
                package = task.package
                created = (
                    f"usable, checked as build {package.build_id}"
                    if package.failure is None
                    else f"not usable, build {package.build_id}; forge status "
                    f"{package.build_id} says why"
                )
                lines.append(f"  - As the creator wrote it: {created}")
            lines += [
                f"  - Corrected: {_correction_words(correction)}" for correction in task.corrections
            ]
    lines += ["", *_construction_review(status)]
    ended = status.state in {"finished", "stopped"}
    usable = sum(_usable(task) for task in status.tasks)
    unknown = [task.task_name for task in status.tasks if task.state == "outcome_unknown"]
    warnings = []
    if unknown:
        warnings.append(
            _warning(
                "forge_construction_outcome_unknown",
                "The creator call for "
                + ", ".join(unknown)
                + " began and its end was never seen, so the provider may or may not have "
                "answered or charged. Techtree does not call it again on its own.",
            )
        )
    if ended and usable < MINIMUM_COLLECTION_TASKS:
        warnings.append(
            _warning(
                "forge_construction_too_few_usable",
                f"{usable} usable {_plural(usable, 'task', 'tasks')} so far, and a collection "
                f"needs at least {MINIMUM_COLLECTION_TASKS}: some the improving agent may study "
                "and some held out from it. Correct the proposal to add tasks with forge "
                "correct-proposal and build it again with forge construct, or correct one "
                "yourself with forge correct-task.",
            )
        )
    next_command = (
        _command("forge", "construct-start", status.construction_id)
        if status.state == "prepared"
        else _command("forge", "collect", status.construction_id)
        if ended and usable >= MINIMUM_COLLECTION_TASKS
        else None
    )
    answer = _answer(status, lines, warnings=warnings, next_command=next_command)
    answer["review"] = list(_construction_review(status))
    return answer


# ---------------------------------------------------------------------------
# collect, accept, verify, export
# ---------------------------------------------------------------------------


def collect(construction_id: str, task: tuple[str, ...], as_json: bool) -> None:
    status = prepare_collection(
        paths.home(), construction_id=construction_id, task_names=list(task) or None
    )
    emit(_collection_answer(status), as_json=as_json)


def accept(collection_id: str, yes: bool, reviewed_on: ReviewedOn, as_json: bool) -> None:
    home = paths.home()
    status = check_collection(home, collection_id)
    reviewed_on = approve(
        yes=yes,
        reviewed_on=reviewed_on,
        as_json=as_json,
        review=_collection_review(status),
        command=["forge", "accept", collection_id],
        question="Accept these tasks as the collection?",
        why="Accepting is the person's decision about which tasks make the collection, and it "
        "freezes them.",
    )
    emit(
        _collection_answer(
            accept_collection(home, collection_id, reviewed_on=reviewed_on, yes=yes)
        ),
        as_json=as_json,
    )


def verify(collection_id: str, as_json: bool) -> None:
    status = verify_collection(paths.home(), collection_id)
    members = status.record.review.members
    held_out = sum(member.part == "held_out" for member in members)
    answer = _collection_answer(status)
    answer["report"] = (
        f"Verified: collection {collection_id} holds exactly the files and qualification "
        f"accepted for its {len(members)} {_plural(len(members), 'task', 'tasks')}, {held_out} "
        "of them held out.\n\n" + str(answer["report"])
    )
    emit(answer, as_json=as_json)


def export(collection_id: str, to: Path, as_json: bool) -> None:
    exported = export_collection(paths.home(), collection_id, to)
    members = exported.collection.review.members
    held_out = sum(member.part == "held_out" for member in members)
    folder = str(to.expanduser().absolute())
    answer: Answer = {
        "collection_id": collection_id,
        "collection_digest": exported.collection.collection_digest,
        "path": folder,
        "tasks": len(members),
        "held_out": held_out,
        "report": "\n".join(
            [
                f"Exported: collection {collection_id}, with its {len(members)} "
                f"{_plural(len(members), 'task', 'tasks')}, {held_out} of them held out, into a "
                "new folder only you can open. It stays on this computer until you share it.",
                "",
                f"- Folder: {folder}",
                f"- Fingerprint: {exported.collection.collection_digest}",
                "",
                "Left out: the Skill's text, the logs from writing and checking the tasks, and "
                "everything else in this Techtree home. The tests and reference solutions are in "
                "it, so anyone who has the folder can read the answers.",
            ]
        ),
    }
    emit(answer, as_json=as_json)


def _collection_review(status: ForgeCollectionStatus) -> list[str]:
    """What accepting this collection does, in the words a person accepts."""
    record = status.record
    review = record.review
    proposed = len(review.tasks)
    members = review.members
    held_out = [member.task_name for member in members if member.part == "held_out"]
    study = [member.task_name for member in members if member.part == "study"]
    return [
        f"Proposal: {review.proposal_id}, {proposed} proposed "
        f"{_plural(proposed, 'task', 'tasks')}, each as it went the last time it was tried:",
        *(f"  {task.task_name}: {_candidate_words(task)}" for task in review.tasks),
        f"In the collection: {len(members)} {_plural(len(members), 'task', 'tasks')}, "
        + ", ".join(member.task_name for member in members),
        f"Held out: {', '.join(held_out)}. The agent that improves the Skill will never see "
        "these tasks, and a revised Skill's verdict is worked out on them alone.",
        f"The improving agent may see: {', '.join(study)}.",
        "Which tasks are held out follows from the tasks' fingerprints; nobody chooses it.",
        "The automatic checks show that each task's grader agrees with its own sample "
        "solutions, not that it accepts every correct answer, so read each task, and correct "
        "any with forge correct-task and collect again, before accepting.",
        "Accepting freezes exactly these tasks' files and qualification. Accepting runs nothing "
        "and calls no model.",
        f"This acceptance covers exactly this: {record.collection_digest[:19]}",
    ]


def _candidate_words(task: ForgeCollectionCandidate) -> str:
    """How a task went, and whether a person corrected it."""
    if task.corrections:
        times = "" if len(task.corrections) == 1 else f" {len(task.corrections)} times"
        return f"qualified; corrected by a person{times}, last on " + _correction_words(
            task.corrections[-1]
        )
    went = (
        f"qualified, checked as build {task.build_id}"
        if task.usable
        else _CALL_STATE_WORDS[task.state]
        if task.build_id is None
        else f"built, but did not qualify; forge status {task.build_id} says why"
    )
    return went + ("" if task.why is None else f": {task.why}") + "; not corrected by a person"


def _collection_answer(status: ForgeCollectionStatus) -> Answer:
    state = "prepared; not accepted yet" if status.acceptance is None else "accepted; frozen"
    lines = [f"- Collection: {status.collection_id}", f"- State: {state}"]
    if status.acceptance is not None:
        lines.append(f"- Accepted: {_approved_words(status.acceptance)}")
    lines += [f"- Evidence: {status.path}", "", *_collection_review(status)]
    members = status.record.review.members
    held_out = sum(member.part == "held_out" for member in members)
    warnings = []
    if len(members) < FEW_TASKS:
        warnings.append(
            _warning(
                "forge_few_tasks",
                f"Only {len(members)} {_plural(len(members), 'task is', 'tasks are')} in this "
                "collection. A run on so few can say how one attempt went, not whether a Skill "
                "helps.",
            )
        )
    if held_out < VERDICT_MINIMUM_PAIRS:
        warnings.append(
            _warning(
                "forge_few_held_out",
                f"Only {held_out} {_plural(held_out, 'task is', 'tasks are')} held out. A "
                f"revised Skill's verdict needs at least {VERDICT_MINIMUM_PAIRS} graded attempts "
                "on them, so runs for one need at least "
                f"{-(-VERDICT_MINIMUM_PAIRS // held_out)} repetitions per task.",
            )
        )
    verb = "accept" if status.acceptance is None else "verify"
    answer = _answer(
        status, lines, warnings=warnings, next_command=_command("forge", verb, status.collection_id)
    )
    answer["review"] = list(_collection_review(status))
    return answer


# ---------------------------------------------------------------------------
# run, compare
# ---------------------------------------------------------------------------


def run(
    arm: str,
    collection_id: str,
    provider: str,
    model: str,
    reasoning: str | None,
    tasks: str | None,
    skill: Path | None,
    repetitions: int,
    yes: bool,
    reviewed_on: ReviewedOn,
    as_json: bool,
) -> None:
    home = paths.home()
    skill = None if skill is None else skill.expanduser().absolute()
    spec = declare_run_spec(
        home,
        arm=ForgeArm(arm),
        collection_id=collection_id,
        task_ids=tasks.split(",") if tasks is not None else None,
        skill_root=skill,
        provider=provider,
        model_id=model,
        reasoning=reasoning,
        repetitions=repetitions,
    )
    approve(
        yes=yes,
        reviewed_on=reviewed_on,
        as_json=as_json,
        review=run_review_lines(spec),
        command=[
            "forge",
            "run",
            "--arm",
            arm,
            "--collection",
            collection_id,
            *_model_options(spec.model),
            *(["--tasks", tasks] if tasks is not None else []),
            *(["--skill", str(skill)] if skill is not None else []),
            *(["--repetitions", str(repetitions)] if repetitions != 1 else []),
        ],
        question="Start this experiment?",
        why="An experiment makes model calls on the person's own account.",
    )
    emit(_run_answer(run_arm(home, spec, skill)), as_json=as_json)


def run_review_lines(spec: ForgeRunSpec, *, hidden: frozenset[str] = frozenset()) -> list[str]:
    """What running this arm would do; `hidden` tasks are counted, not named."""
    shown = [task_id for task_id in spec.task_ids if task_id not in hidden]
    count = len(spec.task_ids) - len(shown)
    listed = ", ".join(shown) + (
        f", and {count} held-out {_plural(count, 'task', 'tasks')} the improving agent never sees"
        if count
        else ""
    )
    skill = (
        f", with Skill {spec.skill.name} ({spec.skill.root_digest[:12]})"
        if spec.skill is not None
        else ", without a Skill"
    )
    limits = spec.limits
    return [
        f"Arm: {spec.arm.value}{skill}",
        f"Collection: {spec.tasks_from.collection_id}, as accepted",
        f"Tasks: {len(spec.task_ids)} ({listed})",
        f"Attempts: {len(spec.task_ids) * spec.sampling.repetitions} "
        f"({spec.sampling.repetitions} per task)",
        f"Agent: {spec.agent.executable} (Hermes Agent v{spec.agent.version})",
        f"Model: {_model_words(spec.model)}",
        "Model calls go to that provider on the sign-in of your Hermes profile "
        f"{PROFILE_NAME}; Techtree copies no credential and reads none.",
        "Each attempt empties that profile of everything but the sign-in, so it starts from a "
        "fresh Hermes state with memory off, in a sandbox with no network, "
        f"{limits.container_cpus} CPUs and {limits.container_memory_mb} MB, for the task's own "
        "time limit.",
        f"The agent can use {_toolset_words(spec)}, all inside that sandbox, and nothing else.",
        "The agent works in the task's own working directory. Before any test runs, everything "
        "it added, changed or deleted there is recorded, keeping up to "
        f"{_size_words(limits.outputs.kept_bytes)} of the files it left; an attempt whose "
        "outputs cannot be recorded as they are is not graded.",
        COST_LINE,
    ]


def _size_words(size: int) -> str:
    megabyte = 1024 * 1024
    if size % (1024 * megabyte) == 0:
        return f"{size // (1024 * megabyte)} GB"
    if size % megabyte == 0:
        return f"{size // megabyte} MB"
    return f"{size} bytes"


def _toolset_words(spec: ForgeRunSpec) -> str:
    words = [_TOOLSET_WORDS[toolset] for toolset in spec.toolsets]
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def _run_answer(status: ForgeRunStatus) -> Answer:
    spec = status.spec
    record = status.record
    limits = spec.limits
    outputs = limits.outputs
    skill = f" with Skill {spec.skill.name}" if spec.skill is not None else ""
    lines = [
        f"- Run: {status.run_id}",
        f"- Outcome: {record.state}",
        f"- Arm: {spec.arm.value}{skill}",
        f"- Collection: {spec.tasks_from.collection_id}",
        f"- Model: {_model_words(spec.model)}",
        f"- Agent: Hermes Agent v{spec.agent.version}",
        f"- Tools: {_toolset_words(spec)}",
        f"- Limits: {limits.container_cpus} CPUs, {limits.container_memory_mb} MB, "
        f"{'network' if limits.network else 'no network'}, the task's own time limit; outputs "
        f"read up to {outputs.entries} entries and {_size_words(outputs.checked_bytes)}, "
        f"keeping up to {_size_words(outputs.kept_bytes)}",
        f"- Attempts: {len(record.attempts)} of "
        f"{len(spec.task_ids) * spec.sampling.repetitions} recorded",
        f"- Evidence: {status.path}",
    ]
    if record.state == "unfinished":
        lines += [
            "",
            "No end is recorded for this run. If it is not still running somewhere, it was "
            "stopped before it could record one, for example when its window was closed. Its "
            "recorded attempts stay as they are; start a new run to try again.",
        ]
    if record.failure is not None:
        lines += ["", f"{record.failure.code}: {record.failure.message}"]
    if record.attempts:
        lines.append("")
    for attempt in record.attempts:
        usage = attempt.usage
        parts = [f"{attempt.task_id} #{attempt.attempt}: {OUTCOME_WORDS[attempt.outcome]}"]
        if attempt.reward is not None:
            parts.append(f"reward {attempt.reward:g}")
        parts.append(f"{attempt.agent_seconds:.0f}s")
        if usage is not None and usage.total_tokens is not None:
            parts.append(f"{usage.total_tokens} tokens")
        parts.append(_cost_words(usage))
        changed = attempt.outputs
        parts.append(
            f"{changed.added} added, {changed.modified} changed, {changed.deleted} deleted in "
            f"{changed.work_dir}"
        )
        lines.append("- " + ", ".join(parts))
        lines += [
            "  - "
            + (f"{failure.path}: " if failure.path is not None else "")
            + f"{OUTPUT_FAILURE_WORDS[failure.kind]} ({failure.detail})"
            for failure in changed.failures
        ]
    ungraded = sum(attempt.outcome is not ForgeAttemptOutcome.GRADED for attempt in record.attempts)
    warnings = (
        [
            _warning(
                "forge_attempts_ungraded",
                f"{ungraded} of {len(record.attempts)} attempts ended without a verdict; each "
                "says why in the run's evidence.",
            )
        ]
        if ungraded
        else []
    )
    pair = (
        f"BASELINE_RUN_ID {status.run_id}"
        if spec.arm is ForgeArm.CANDIDATE
        else f"{status.run_id} CANDIDATE_RUN_ID"
    )
    return _answer(
        status,
        lines,
        warnings=warnings,
        next_words=f"{_command('forge', 'compare')} {pair}, once both arms have run",
    )


def compare(baseline_run: str, candidate_run: str, as_json: bool) -> None:
    emit(
        _comparison_answer(compare_runs(paths.home(), baseline_run, candidate_run)), as_json=as_json
    )


def _skill_words(skill: ForgeSkillRef) -> str:
    return f"{skill.name} ({skill.digest[:19]})"


def _arm_pair(baseline: float | None, candidate: float | None, unit: str = "") -> str:
    def one(value: float | None) -> str:
        if value is None:
            return "unknown"
        return f"{value:g}{unit}" if isinstance(value, int) else f"{value:.3g}{unit}"

    return f"{one(baseline)} → {one(candidate)}"


def _totals_cost(totals: ForgeArmTotals) -> str:
    statuses = f" ({', '.join(totals.cost_statuses)})" if totals.cost_statuses else ""
    if totals.cost_usd is None:
        return "no dollar figure" + statuses
    return f"${totals.cost_usd:.4f}{statuses}"


def _part_words(part: ForgePartSummary, baseline_skill: ForgeSkillRef | None) -> str:
    tasks = len(part.task_ids)
    return (
        f"{tasks} {_plural(tasks, 'task', 'tasks')}; {verdict_words(part.verdict, baseline_skill)}"
        f"; {part.wins} won, {part.losses} lost, {part.ties} tied, {part.unresolved} unresolved "
        f"of {part.pairs_planned}; mean reward "
        + _arm_pair(part.baseline_mean_reward, part.candidate_mean_reward)
    )


def _attempts(attempts: list[int]) -> str:
    return f"{_plural(len(attempts), 'attempt', 'attempts')} {', '.join(map(str, attempts))}"


def _comparison_answer(status: ForgeComparisonStatus) -> Answer:
    record = status.record
    baseline_skill = record.baseline_skill
    lines = [
        f"- Comparison: {status.comparison_id}",
        f"- Baseline run: {record.baseline_run_id}",
        f"- Candidate run: {record.candidate_run_id}",
        f"- Collection: {record.tasks_from.collection_id}",
        f"- Tasks written from: {_skill_words(record.source_skill)}",
        f"- Baseline Skill: {'none' if baseline_skill is None else _skill_words(baseline_skill)}",
        f"- Candidate Skill: {_skill_words(record.candidate_skill)}",
        f"- Result: {'complete' if record.complete else 'partial'}",
        f"- Verdict: {verdict_words(record.verdict, baseline_skill)}",
        f"- Pairs: {record.wins} won, {record.losses} lost, {record.ties} tied, "
        f"{record.unresolved} unresolved of {record.pairs_planned} planned",
        f"- {PART_WORDS['study']}: {_part_words(record.study, baseline_skill)}",
        f"- {PART_WORDS['held_out']}: {_part_words(record.held_out, baseline_skill)}",
        f"- Mean reward: {_arm_pair(record.baseline.mean_reward, record.candidate.mean_reward)}",
        "- Agent time: "
        + _arm_pair(record.baseline.agent_seconds, record.candidate.agent_seconds, "s"),
        f"- Model calls: {_arm_pair(record.baseline.api_calls, record.candidate.api_calls)}",
        f"- Tokens: {_arm_pair(record.baseline.total_tokens, record.candidate.total_tokens)}",
        f"- Cost: {_totals_cost(record.baseline)} → {_totals_cost(record.candidate)}",
        f"- Report: {status.report_path}",
        f"- Record: {status.path}",
        "",
        record.summary,
        "",
    ]
    if record.regressions:
        lines.append("Where the Skill lost:")
        for regression in record.regressions:
            won = f"; won {_attempts(regression.attempts_won)}" if regression.attempts_won else ""
            lines.append(f"- {regression.task_id}: lost {_attempts(regression.attempts_lost)}{won}")
    else:
        lines.append("The Skill lost no graded pair.")
    lines.append("")
    if record.repetitions == 1:
        lines.append("One attempt per task; consistency across attempts was not measured.")
    else:
        lines.append("Across attempts:")
        lines += [
            f"- {task.task_id}: {task.wins} won, {task.losses} lost, {task.ties} tied, "
            f"{task.unresolved} unresolved" + ("; went both ways" if task.went_both_ways else "")
            for task in record.consistency
        ]
    lines.append("")
    for pair in record.pairs:
        delta = f" ({pair.delta:+g})" if pair.delta is not None else ""
        lines.append(
            f"- {pair.task_id} #{pair.attempt}: {pair.result.value}{delta}; baseline "
            f"{_side_words(pair.baseline_outcome, pair.baseline_reward)}, candidate "
            f"{_side_words(pair.candidate_outcome, pair.candidate_reward)}"
        )
    warnings = (
        []
        if record.complete
        else [
            _warning(
                "forge_comparison_partial",
                f"{record.unresolved} of {record.pairs_planned} planned pairs have no verdict on "
                "both arms; the counts are over the graded pairs only and this is not a "
                "complete result.",
            )
        ]
    )
    return _answer(
        status,
        lines,
        warnings=warnings,
        next_words="show the person the verdicts and the report, and let them decide; to revise "
        f"the Skill, {_command('uplift', 'context', status.comparison_id)}",
    )


def _side_words(outcome: ForgeAttemptOutcome | None, reward: float | None) -> str:
    if outcome is None:
        return "not attempted"
    return f"reward {reward:g}" if reward is not None else OUTCOME_WORDS[outcome]


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------


def _build_answer(status: ForgeBuildStatus) -> Answer:
    source = status.build.source
    qualification = status.qualification
    committed = len(status.build.task_set.tasks)
    lines = [
        f"- Build: {status.build_id}",
        f"- Source Skill: {source.source_skill_digest}",
        f"- Recipe: {source.recipe} {source.recipe_version}",
        f"- Producer: {source.producer} {source.producer_version}",
        f"- Base images: {', '.join(image.reference for image in source.base_images)}",
        f"- Committed tasks: {committed}",
        f"- Evidence: {status.path}",
        f"- Tasks: {status.tasks_path}",
        "",
    ]
    if qualification is None:
        lines.append(
            f"{committed} {_plural(committed, 'task', 'tasks')}; qualification has not finished"
        )
    else:
        lines.append(
            f"{len(qualification.qualified_task_ids)} of {committed} "
            f"{_plural(committed, 'task', 'tasks')} qualified"
        )
        for task in qualification.tasks:
            lines.append(f"- {task_verdict(task)}")
            failed = first_failed_check(task)
            if failed is not None:
                lines.append(f"  ({failed.name}: {failed.detail})")
    warnings = (
        [
            _warning(
                "forge_nothing_qualified",
                "Every task was rejected at qualification; each task says why.",
            )
        ]
        if qualification is not None and not qualification.qualified_task_ids
        else []
    )
    return _answer(status, lines, warnings=warnings)


def _revision_answer(status: ForgeRevisionStatus) -> Answer:
    """A revision as a person sees it: every screening finding, held-out tasks included."""
    record = status.record
    shared = len(record.screening)
    lines = [
        f"- Revision: {status.revision_id}",
        f"- State: {record.state}",
        f"- Revised Skill: {record.skill.name} ({record.skill.root_digest[:19]})",
        f"- Revises: {record.parent_skill_digest[:19]} from {record.comparison_id}",
        f"- Baseline run: {record.baseline_run_id}",
        f"- Collection: {record.tasks_from.collection_id}",
        f"- Controlled: {'yes' if record.comparability.controlled else 'no'}",
        "- Screening: "
        + (
            f"{shared} shared {_plural(shared, 'line', 'lines')} with hidden material"
            if shared
            else "no line shared with hidden material"
        ),
    ]
    if record.measured_run_id is not None:
        lines.append(f"- Measured run: {record.measured_run_id}")
    if record.measured_comparison_id is not None:
        lines.append(f"- Comparison: {record.measured_comparison_id}")
    lines.append(f"- Evidence: {status.path}")
    lines += [
        f"  - {finding.skill_path}:{finding.line} matches the "
        f"{finding.material.replace('_', ' ')} of {finding.task_id}: {finding.excerpt}"
        for finding in record.screening
    ]
    lines += ["", *(verdict for verdict in (record.verdict, record.study_verdict) if verdict)]
    warnings = (
        [
            _warning(
                "forge_revision_shares_hidden_material",
                f"{shared} line(s) of the revised Skill also occur in material hidden from the "
                "agent that improved it: a task's reference answer or tests, or a held-out "
                "task's instruction or inputs. A result with it may measure recall rather than "
                "method. Each is listed on the revision.",
            )
        ]
        if shared
        else []
    )
    return _answer(status, lines, warnings=warnings)


#: One reader per ID prefix, each giving the answer that record's own command gives.
_STATUS: Final[dict[str, Callable[[TechtreePaths, str], Answer]]] = {
    "forgesrc": lambda home, record_id: _source_answer(read_source_status(home, record_id)),
    "forgeplan": lambda home, record_id: _plan_answer(read_plan_status(home, record_id)),
    "forgeprop": lambda home, record_id: _proposal_answer(
        home, read_proposal_status(home, record_id)
    ),
    "forgecon": lambda home, record_id: _construction_answer(
        read_construction_status(home, record_id)
    ),
    "build": lambda home, record_id: _build_answer(read_build_status(home, record_id)),
    "forgecol": lambda home, record_id: _collection_answer(read_collection_status(home, record_id)),
    "forgerun": lambda home, record_id: _run_answer(read_run_status(home, record_id)),
    "forgecmp": lambda home, record_id: _comparison_answer(read_comparison_status(home, record_id)),
    "forgerev": lambda home, record_id: _revision_answer(read_revision_status(home, record_id)),
}


def status(record_id: str, as_json: bool) -> None:
    reader = _STATUS.get(id_prefix(record_id))
    if reader is None:
        raise ValidationError(
            f"{record_id} is not a forge record; forge status shows a looked-at Skill, plan, "
            "proposal, construction, build, collection, run, comparison or revision",
            code="forge_record_unknown",
            details={"id": record_id},
        )
    emit(reader(paths.home(), record_id), as_json=as_json)


# ---------------------------------------------------------------------------
# The group
# ---------------------------------------------------------------------------

PROVIDER = click.Option(
    ["--provider"],
    required=True,
    help="The provider Hermes will be asked for, by the name Hermes uses.",
)
MODEL = click.Option(["--model"], required=True, help="The model Hermes will be asked for.")
REASONING = click.Option(
    ["--reasoning"],
    type=click.Choice(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]),
    help="Hermes' reasoning setting, if one.",
)


def _id(name: str, metavar: str) -> click.Argument:
    return click.Argument([name], metavar=metavar)


FORGE = click.Group("forge", help="Build tasks from a Skill and run experiments on them.")
for _command_ in (
    click.Command(
        "inspect-skill",
        callback=inspect_skill,
        help="Look at a Skill without running any of it, and record what it holds.",
        params=[
            click.Argument(["path"], metavar="PATH", type=click.Path(path_type=Path)),
            JSON,
        ],
    ),
    click.Command(
        "plan",
        callback=plan,
        help="Prepare the planning of tasks from a Skill, without calling the planner.",
        params=[
            _id("source_id", "SOURCE_ID"),
            PROVIDER,
            MODEL,
            REASONING,
            click.Option(
                ["--tasks"],
                type=click.IntRange(1, MAX_PLANNED_TASKS),
                default=3,
                show_default=True,
                help="The most tasks the planner may propose.",
            ),
            JSON,
        ],
    ),
    click.Command(
        "plan-start",
        callback=plan_start,
        help="Review a prepared plan, approve it, and send it to the planner once.",
        params=[_id("plan_id", "PLAN_ID"), YES, REVIEWED_ON, JSON],
    ),
    click.Command(
        "correct-proposal",
        callback=correct,
        help="Record your corrections to proposed claims and tasks as a new proposal.",
        params=[
            _id("proposal_id", "PROPOSAL_ID"),
            click.Argument(["file"], metavar="FILE", type=click.Path(path_type=Path)),
            JSON,
        ],
    ),
    click.Command(
        "construct",
        callback=construct,
        help="Prepare the building of proposed tasks, without calling the creator.",
        params=[_id("proposal_id", "PROPOSAL_ID"), PROVIDER, MODEL, REASONING, JSON],
    ),
    click.Command(
        "construct-start",
        callback=construct_start,
        help="Review a prepared construction, approve it, and build its tasks once.",
        params=[_id("construction_id", "CONSTRUCTION_ID"), YES, REVIEWED_ON, JSON],
    ),
    click.Command(
        "correct-task",
        callback=fix_task,
        help="Check your corrected copy of a built task and record it as your correction.",
        params=[
            _id("construction_id", "CONSTRUCTION_ID"),
            _id("task_name", "TASK_NAME"),
            click.Argument(["folder"], metavar="DIR", type=click.Path(path_type=Path)),
            JSON,
        ],
    ),
    click.Command(
        "collect",
        callback=collect,
        help="Prepare the acceptance of qualified tasks as one collection.",
        params=[
            _id("construction_id", "CONSTRUCTION_ID"),
            click.Option(
                ["--task"],
                multiple=True,
                metavar="NAME",
                help="A qualified task to accept. Repeatable; without it, every task that "
                "qualified.",
            ),
            JSON,
        ],
    ),
    click.Command(
        "accept",
        callback=accept,
        help="Review a prepared collection and accept it, which freezes it.",
        params=[_id("collection_id", "COLLECTION_ID"), YES, REVIEWED_ON, JSON],
    ),
    click.Command(
        "verify",
        callback=verify,
        help="Check that an accepted collection is unchanged since its acceptance.",
        params=[_id("collection_id", "COLLECTION_ID"), JSON],
    ),
    click.Command(
        "export",
        callback=export,
        help="Write a private copy of an accepted collection into a new folder.",
        params=[
            _id("collection_id", "COLLECTION_ID"),
            click.Option(
                ["--to"],
                required=True,
                metavar="FOLDER",
                type=click.Path(path_type=Path),
                help="A new folder to write the copy into. It must not exist yet.",
            ),
            JSON,
        ],
    ),
    click.Command(
        "run",
        callback=run,
        help="Run one arm of an experiment on qualified tasks with your Hermes.",
        params=[
            click.Option(
                ["--arm"],
                required=True,
                type=click.Choice([arm.value for arm in ForgeArm]),
                help="Which side of the comparison this run is: the candidate carries the Skill "
                "being measured, the baseline no Skill or the earlier Skill it is measured "
                "against.",
            ),
            click.Option(
                ["--collection", "collection_id"],
                required=True,
                metavar="COLLECTION_ID",
                help="The accepted collection to run.",
            ),
            PROVIDER,
            MODEL,
            REASONING,
            click.Option(
                ["--tasks"],
                metavar="TASK_ID[,TASK_ID...]",
                help="The tasks to run, in order. Every one of them when omitted.",
            ),
            click.Option(
                ["--skill"],
                metavar="PATH",
                type=click.Path(path_type=Path),
                help="The Skill directory this arm carries. Required on the candidate arm; on "
                "the baseline arm, only to measure against an earlier Skill.",
            ),
            click.Option(
                ["--repetitions"],
                type=click.IntRange(min=1),
                default=1,
                show_default=True,
                help="Attempts per task.",
            ),
            YES,
            REVIEWED_ON,
            JSON,
        ],
    ),
    click.Command(
        "compare",
        callback=compare,
        help="Compare a baseline run with a candidate run and write the report.",
        params=[
            _id("baseline_run", "BASELINE_RUN_ID"),
            _id("candidate_run", "CANDIDATE_RUN_ID"),
            JSON,
        ],
    ),
    click.Command(
        "status",
        callback=status,
        help="Show one forge record: a looked-at Skill, plan, proposal, construction, build, "
        "collection, run, comparison or revision.",
        params=[_id("record_id", "ID"), JSON],
    ),
):
    FORGE.add_command(_command_)
