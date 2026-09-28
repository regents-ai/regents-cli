"""Planning tasks from an inspected Source Skill: review, approval, one call.

A plan is prepared before anything leaves the machine. Preparing reads the Source Skill's kept
copy, checks every file still hashes to its record, writes the exact prompt that would be sent,
and records what an approval covers: that prompt and the files in it, the planning
instructions, the Hermes and model that would answer, where the call goes, what the planner may
do (answer in text, nothing else) and the limits. The digest of that review is the approval.

Starting a plan makes the review again from what is on disk now; anything changed refuses the
old approval. A plan is started at most once, and nothing is retried: trying again is a new
plan.

The planner answers with what the Skill claims to improve and what observable behavior would
show it, then tasks that each test one claim as a positive, boundary or counterexample case. A
usable answer becomes a proposal and stops there for the contributor. A contributor's
correction is a new proposal naming its parent; no proposal is ever changed.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from pydantic import ValidationError as ModelValidationError

from regents_cli.techtree.approval import ReviewedOn
from regents_cli.techtree.canonical import digest_object, sha256_digest_bytes
from regents_cli.techtree.errors import ConflictError, NotFoundError, RunError, ValidationError
from regents_cli.techtree.forge import calls, skill2env
from regents_cli.techtree.forge.models import (
    FORGE_PLAN_SCHEMA_VERSION,
    FORGE_PROPOSAL_SCHEMA_VERSION,
    ForgeApproval,
    ForgeAuthoringCapabilities,
    ForgeModelCall,
    ForgePlanDisclosure,
    ForgePlanLimits,
    ForgePlanningRecipe,
    ForgePlanRecord,
    ForgePlanReview,
    ForgePlanState,
    ForgePlanStatus,
    ForgeProposalContent,
    ForgeProposalParent,
    ForgeProposalRecord,
    ForgeProposalStatus,
    proposal_content,
)
from regents_cli.techtree.forge.records import (
    inspect_command,
    read_optional,
    read_record,
    write_approval,
)
from regents_cli.techtree.forge.source import read_source_status
from regents_cli.techtree.fs import atomic_write_bytes, atomic_write_json
from regents_cli.techtree.ids import new_id
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.paths import TechtreePaths

PLAN_FILENAME: Final = "plan.json"
PROMPT_FILENAME: Final = "prompt.md"
APPROVAL_FILENAME: Final = "approval.json"
CALL_FILENAME: Final = "call.json"
PROPOSAL_FILENAME: Final = "proposal.json"
#: The proposal's claims and tasks alone, in the shape a correction is written in.
CONTENT_FILENAME: Final = "claims-and-tasks.json"

#: How long the planner may take, from launch to answer.
PLAN_WALL_SECONDS: Final = 600
#: The largest answer read as a proposal.
ANSWER_BYTES: Final = 64 * 1024

_CHANGED_WORDS: Final = {
    "recipe": "the planning instructions",
    "agent": "the Hermes that would answer",
    "disclosure": "what would be sent",
}


def prepare_plan(
    paths: TechtreePaths,
    *,
    source_id: str,
    provider: str,
    model_id: str,
    reasoning: str | None,
    max_tasks: int,
) -> ForgePlanStatus:
    """Write the review of one planning call, sending nothing."""
    review, prompt = _review(
        paths,
        source_id=source_id,
        provider=provider,
        model_id=model_id,
        reasoning=reasoning,
        max_tasks=max_tasks,
    )
    plan_id = new_id("forgeplan")
    directory = paths.forge_plan_dir(plan_id)
    directory.mkdir(parents=True, mode=0o700)
    atomic_write_bytes(directory / PROMPT_FILENAME, prompt)
    record = ForgePlanRecord(
        schema_version=FORGE_PLAN_SCHEMA_VERSION,
        plan_id=plan_id,
        created_at=datetime.now(UTC),
        review=review,
        planning_digest=digest_object(review),
    )
    atomic_write_json(directory / PLAN_FILENAME, record)
    return read_plan_status(paths, plan_id)


def check_plan(paths: TechtreePaths, plan_id: str) -> ForgePlanStatus:
    """Refuse a plan that was already started, or whose review has changed."""
    status = read_plan_status(paths, plan_id)
    if status.approval is not None or status.call is not None:
        raise ConflictError(
            f"plan {plan_id} was already sent to the planner once, and an approval covers one "
            "attempt. To try again, prepare a new plan",
            code="forge_planning_attempted",
            details={"plan_id": plan_id, "state": status.state},
        )
    stored = status.record.review
    current, _ = _review(
        paths,
        source_id=stored.source_id,
        provider=stored.model.provider,
        model_id=stored.model.model_id,
        reasoning=stored.model.reasoning,
        max_tasks=stored.limits.max_tasks,
    )
    found = digest_object(current)
    if found != status.record.planning_digest:
        changed = [
            name
            for name in ForgePlanReview.model_fields
            if getattr(current, name) != getattr(stored, name)
        ]
        raise ValidationError(
            f"plan {plan_id} is no longer what was reviewed: "
            + ", ".join(_CHANGED_WORDS.get(name, name) for name in changed)
            + " changed since it was prepared. The planner was not called; prepare it again "
            "and review the new plan",
            code="forge_planning_stale",
            details={
                "plan_id": plan_id,
                "reviewed": status.record.planning_digest,
                "found": found,
                "changed": changed,
            },
        )
    return status


def _review(
    paths: TechtreePaths,
    *,
    source_id: str,
    provider: str,
    model_id: str,
    reasoning: str | None,
    max_tasks: int,
) -> tuple[ForgePlanReview, bytes]:
    """The review and the prompt, made from what is on disk now."""
    source = read_source_status(paths, source_id)
    kept = calls.kept_files(source, called="The planner")
    instructions = skill2env.resource("planner-prompt.md")
    contract = skill2env.contract()
    prompt = instructions.replace(b"{max_tasks}", str(max_tasks).encode()) + calls.skill_text(kept)
    if len(prompt) > calls.PROMPT_LIMIT:
        raise ValidationError(
            f"this Skill's files make a planning prompt of {len(prompt)} bytes, and the "
            f"planner is handed at most {calls.PROMPT_LIMIT}; plan from a smaller Skill",
            code="forge_planning_too_large",
            details={"source_id": source_id, "prompt_bytes": len(prompt)},
        )
    review = ForgePlanReview(
        source_id=source_id,
        source_digest=source.record.admitted_digest,
        recipe=ForgePlanningRecipe(
            name="skill2env-planner",
            instructions_digest=sha256_digest_bytes(instructions),
            upstream_url=contract["upstream_url"],
            upstream_revision=contract["upstream_revision"],
        ),
        agent=calls.agent_spec(),
        model=calls.model_spec(provider, model_id, reasoning),
        disclosure=ForgePlanDisclosure(
            files=[file for file, _ in kept],
            prompt_bytes=len(prompt),
            prompt_digest=sha256_digest_bytes(prompt),
        ),
        egress="model-provider",
        capabilities=ForgeAuthoringCapabilities(
            tools="none", toolset=calls.TEXT_ONLY_TOOLSET, memory_enabled=False
        ),
        limits=ForgePlanLimits(
            max_tasks=max_tasks,
            attempts=1,
            wall_seconds=PLAN_WALL_SECONDS,
            answer_bytes=ANSWER_BYTES,
        ),
    )
    return review, prompt


def start_plan(
    paths: TechtreePaths, plan_id: str, *, reviewed_on: ReviewedOn, yes: bool
) -> ForgePlanStatus:
    """Record the approval, make the one planner call, and keep what it left."""
    review = check_plan(paths, plan_id).record.review
    calls.require_signed_in(review.agent.executable, review.model.provider)
    with calls.hold_profile() as profile:
        plan = check_plan(paths, plan_id).record
        directory = paths.forge_plan_dir(plan_id)
        write_approval(
            directory / APPROVAL_FILENAME,
            subject_id=plan_id,
            subject_digest=plan.planning_digest,
            reviewed_on=reviewed_on,
            yes=yes,
        )
        call = calls.Call(
            subject_id=plan_id,
            subject_digest=plan.planning_digest,
            task_name=None,
            agent=review.agent,
            model=review.model,
            prompt=(directory / PROMPT_FILENAME).read_bytes(),
            prompt_name=PROMPT_FILENAME,
            wall_seconds=review.limits.wall_seconds,
            directory=directory,
        )

        def proposal(answer: bytes) -> str:
            return _write_proposal(
                paths,
                source_id=review.source_id,
                source_digest=review.source_digest,
                plan_id=plan_id,
                parent=None,
                content=_planner_content(answer, review.limits),
            ).proposal_id

        try:
            calls.model_call(
                call,
                profile,
                record=directory / CALL_FILENAME,
                answer=proposal,
                who="planner",
            )
        except KeyboardInterrupt as interrupt:
            raise RunError(
                "planning was stopped with Ctrl-C while the planner was working, so the "
                "provider may or may not have answered or charged. It is not retried. "
                f"Inspect: {inspect_command(plan_id)}",
                code="forge_planning_interrupted",
                details={"plan_id": plan_id, "path": str(directory)},
            ) from interrupt
    return read_plan_status(paths, plan_id)


def _planner_content(answer: bytes, limits: ForgePlanLimits) -> ForgeProposalContent:
    """The planner's answer as claims and tasks within the plan's limits."""
    if len(answer) > limits.answer_bytes:
        raise ValidationError(
            f"the planner's answer is {len(answer)} bytes, over the {limits.answer_bytes} the "
            "plan allowed",
            code="forge_planner_answer_too_large",
        )
    return _within_limit(
        _content(answer, who="the planner's answer"),
        limits.max_tasks,
        who="the planner's answer",
        code="forge_planner_too_many_tasks",
    )


def _within_limit(
    content: ForgeProposalContent, max_tasks: int, *, who: str, code: str
) -> ForgeProposalContent:
    if len(content.tasks) > max_tasks:
        raise ValidationError(
            f"{who} proposes {len(content.tasks)} tasks, over the {max_tasks} the plan allowed",
            code=code,
        )
    return content


def _content(data: bytes, *, who: str) -> ForgeProposalContent:
    """Read `{"claims": [...], "tasks": [...]}` and nothing else."""
    try:
        loaded = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise ValidationError(
            f"{who} is not one JSON object", code="forge_proposal_invalid"
        ) from error
    if not isinstance(loaded, dict) or set(loaded) != {"claims", "tasks"}:
        raise ValidationError(
            f'{who} is not one JSON object with "claims" and "tasks" and nothing else',
            code="forge_proposal_invalid",
        )
    try:
        return ForgeProposalContent.model_validate(loaded, strict=True)
    except ModelValidationError as error:
        issue = error.errors(include_input=False, include_url=False)[0]
        reason = issue["msg"].removeprefix("Value error, ")
        if not issue["loc"]:
            raise ValidationError(
                f"{who} cannot be used: {reason}", code="forge_proposal_invalid"
            ) from error
        place: list[str] = []
        for item in issue["loc"]:
            if isinstance(item, int) and place[-1:] in (["claims"], ["tasks"]):
                place[-1] = f"{place[-1].removesuffix('s')} {item + 1}"
            else:
                place.append(str(item))
        raise ValidationError(
            f"{who} cannot be used: {'.'.join(place)}: {reason}",
            code="forge_proposal_invalid",
        ) from error


def correct_proposal(
    paths: TechtreePaths, proposal_id: str, correction_file: Path
) -> ForgeProposalStatus:
    """Record a contributor's correction as a new proposal naming its parent.

    A correction may change the claims, the tasks, or both; it is checked as the planner's
    answer is.
    """
    parent = read_proposal_status(paths, proposal_id).record
    try:
        data = correction_file.read_bytes()
    except OSError as error:
        raise NotFoundError(
            f"cannot read {correction_file}",
            code="forge_proposal_file_unreadable",
            details={"path": str(correction_file)},
        ) from error
    content = _within_limit(
        _content(data, who=str(correction_file)),
        read_plan_status(paths, parent.plan_id).record.review.limits.max_tasks,
        who=str(correction_file),
        code="forge_proposal_too_many_tasks",
    )
    found = digest_object(proposal_content(parent.source_digest, content.claims, content.tasks))
    if found == parent.proposal_digest:
        raise ValidationError(
            f"{correction_file} states exactly the claims and tasks of {proposal_id}; a "
            "correction has to change something",
            code="forge_proposal_unchanged",
            details={"proposal_id": proposal_id},
        )
    return _write_proposal(
        paths,
        source_id=parent.source_id,
        source_digest=parent.source_digest,
        plan_id=parent.plan_id,
        parent=ForgeProposalParent(
            proposal_id=parent.proposal_id, proposal_digest=parent.proposal_digest
        ),
        content=content,
    )


def _write_proposal(
    paths: TechtreePaths,
    *,
    source_id: str,
    source_digest: Digest,
    plan_id: str,
    parent: ForgeProposalParent | None,
    content: ForgeProposalContent,
) -> ForgeProposalStatus:
    proposal_id = new_id("forgeprop")
    directory = paths.forge_proposal_dir(proposal_id)
    directory.mkdir(parents=True, mode=0o700)
    record = ForgeProposalRecord(
        schema_version=FORGE_PROPOSAL_SCHEMA_VERSION,
        proposal_id=proposal_id,
        created_at=datetime.now(UTC),
        source_id=source_id,
        source_digest=source_digest,
        plan_id=plan_id,
        origin="planner" if parent is None else "contributor",
        parent=parent,
        claims=content.claims,
        tasks=content.tasks,
        proposal_digest=digest_object(
            proposal_content(source_digest, content.claims, content.tasks)
        ),
    )
    atomic_write_json(directory / CONTENT_FILENAME, content)
    atomic_write_json(directory / PROPOSAL_FILENAME, record)
    return ForgeProposalStatus(proposal_id=proposal_id, path=str(directory), record=record)


def read_plan_status(paths: TechtreePaths, plan_id: str) -> ForgePlanStatus:
    """A plan, its approval and its call, and where it stands."""
    directory = paths.forge_plan_dir(plan_id)
    details = {"plan_id": plan_id, "path": str(directory)}
    record = read_record(
        ForgePlanRecord,
        directory / PLAN_FILENAME,
        missing=f"no prepared plan {plan_id}",
        code="forge_plan_not_found",
        details=details,
    )
    call = read_optional(ForgeModelCall, directory / CALL_FILENAME, details=details)
    state: ForgePlanState
    if call is None:
        state = "prepared"
    elif call.state == "started":
        state = "running" if calls.alive(call.process_id) else "outcome_unknown"
    else:
        state = call.state
    return ForgePlanStatus(
        plan_id=plan_id,
        path=str(directory),
        state=state,
        record=record,
        approval=read_optional(ForgeApproval, directory / APPROVAL_FILENAME, details=details),
        call=call,
    )


def read_proposal_status(paths: TechtreePaths, proposal_id: str) -> ForgeProposalStatus:
    directory = paths.forge_proposal_dir(proposal_id)
    return ForgeProposalStatus(
        proposal_id=proposal_id,
        path=str(directory),
        record=read_record(
            ForgeProposalRecord,
            directory / PROPOSAL_FILENAME,
            missing=f"no recorded proposal {proposal_id}",
            code="forge_proposal_not_found",
            details={"proposal_id": proposal_id, "path": str(directory)},
        ),
    )
