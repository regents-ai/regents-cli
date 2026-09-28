"""`regents techtree uplift …`: revise the Skill a forge comparison measured, and measure it.

Uplift takes forge IDs only. `uplift start` makes model calls, so it goes through `approve()`.
Nothing here names a held-out task: those are counted, and an error that would name one says
only where a person can see it.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

import click

from regents_cli.techtree import paths
from regents_cli.techtree.approval import REVIEWED_ON, YES, ReviewedOn, approve
from regents_cli.techtree.canonical import canonical_json_bytes
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.commands.forge import run_review_lines
from regents_cli.techtree.errors import UsageError, ValidationError
from regents_cli.techtree.forge.collection import verify_collection
from regents_cli.techtree.forge.improvement import build_forge_improvement_context
from regents_cli.techtree.forge.models import ForgeAttemptOutcome, ForgeRevisionStatus
from regents_cli.techtree.forge.revision import (
    ShownRevision,
    check_revision,
    held_out_hidden,
    measure_revision,
    prepare_revision,
    shown_revision,
)
from regents_cli.techtree.forge.run import read_run_status
from regents_cli.techtree.forge.skill import SKILL_DIRNAME, read_owned_skill
from regents_cli.techtree.fs import atomic_write_bytes, ensure_private_directory
from regents_cli.techtree.ids import id_prefix
from regents_cli.techtree.models.base import JsonValue

#: What the loop cannot name yet: the revised Skill a person or agent has still to write.
NO_REVISION_YET: Final = (
    "No revised Skill exists yet, so the next comparison has no candidate to name."
)
_CONTEXT_PATH: Final = Path("improvement") / "context.json"

type Answer = dict[str, JsonValue]


def _plural(count: int, one: str, many: str) -> str:
    return one if count == 1 else many


def _prepare_words(comparison_id: str) -> str:
    return (
        f"regents techtree uplift prepare --from-run {comparison_id} --candidate-skill "
        f"NEW_PATH, once the revised Skill is written. {NO_REVISION_YET}"
    )


# ---------------------------------------------------------------------------
# context
# ---------------------------------------------------------------------------


def context(comparison_id: str, as_json: bool) -> None:
    home = paths.home()
    improvement = build_forge_improvement_context(home, comparison_id)
    directory = home.forge_comparison_dir(comparison_id) / _CONTEXT_PATH.parent
    ensure_private_directory(directory)
    atomic_write_bytes(
        directory / _CONTEXT_PATH.name, canonical_json_bytes(improvement), mode=0o600
    )
    result = improvement.current_result
    held_out = improvement.tasks_from.held_out_tasks
    warning = (
        "This context is working material, not evidence. It is not signed, nothing verifies "
        "it, and nothing uploads it."
    )
    next_command = f"regents techtree uplift skill-source {improvement.candidate_run_id}"
    report = [
        f"Built improvement context for {comparison_id} from {len(improvement.examples)} of "
        "its task attempts.",
        "",
        f"- Comparison: {comparison_id}",
        f"- Collection: {improvement.tasks_from.collection_id}; {held_out} held-out "
        f"{_plural(held_out, 'task', 'tasks')} not shown",
        f"- Skill being revised: {improvement.parent_skill_name} "
        f"({improvement.parent_skill_digest[:19]})",
        f"- Pairs: {result.wins} won, {result.losses} lost, {result.ties} tied, "
        f"{result.unresolved} unresolved of {result.pairs_planned}",
        f"- Written to: {_CONTEXT_PATH.as_posix()}",
        "",
        improvement.objective,
        "",
        "Task attempts worth looking at:",
        *(
            f"- {example.task_id} #{example.attempt}: {example.result.value}, reward "
            + (
                f"{example.candidate_reward:.3f}"
                if example.candidate_reward is not None
                else "none"
            )
            for example in improvement.examples
        ),
        "",
        "Not included:",
        *(f"- {item}" for item in improvement.prohibited_material),
        "",
        f"- {warning}",
        "",
        f"Next: {next_command}",
    ]
    answer: Answer = {
        "context": improvement.model_dump(mode="json"),
        "relative_path": _CONTEXT_PATH.as_posix(),
        "warnings": [{"id": "improvement_context_is_not_proof", "text": warning}],
        "next_command": next_command,
        "report": "\n".join(report),
    }
    emit(answer, as_json=as_json)


# ---------------------------------------------------------------------------
# skill-source
# ---------------------------------------------------------------------------


def skill_source(run_id: str, as_json: bool) -> None:
    run = read_run_status(paths.home(), run_id)
    if run.spec.skill is None:
        raise ValidationError(
            "this run carried no Skill, so there is no text to read; name a run that carried one",
            code="forge_run_without_skill",
            details={"run_id": run_id},
        )
    skill = read_owned_skill(run.spec.skill, Path(run.path) / SKILL_DIRNAME, owner_id=run_id)
    report = [
        f"This is run {run_id}'s own copy of {skill.entrypoint_path}, re-verified against the "
        "Skill the run measured as it was read.",
        "",
        f"- Run: {run_id}",
        f"- Skill: {skill.name}",
        f"- Skill content digest: {skill.root_digest}",
        f"- Entry file: {skill.entrypoint_path}",
        f"- Entry file digest: {skill.entrypoint_digest}",
        f"- Files in this Skill: {skill.file_count}",
        "",
        f"{skill.entrypoint_path} ({skill.entrypoint_size} bytes)",
        "",
        skill.entrypoint_text,
        "",
        "Next: write the revised Skill in a new folder, then "
        "regents techtree uplift prepare --from-run COMPARISON_ID --candidate-skill NEW_PATH, "
        f"with the comparison that measured this run. {NO_REVISION_YET}",
    ]
    answer: Answer = {
        "source_run_id": run_id,
        "skill_name": skill.name,
        "skill_root_digest": skill.root_digest,
        "entrypoint_path": skill.entrypoint_path,
        "entrypoint_digest": skill.entrypoint_digest,
        "entrypoint_size": skill.entrypoint_size,
        "entrypoint_text": skill.entrypoint_text,
        "file_count": skill.file_count,
        "report": "\n".join(report),
    }
    emit(answer, as_json=as_json)


# ---------------------------------------------------------------------------
# prepare, start
# ---------------------------------------------------------------------------


def prepare(from_run: str, candidate_skill: Path, label: str | None, as_json: bool) -> None:
    home = paths.home()
    revision = prepare_revision(
        home,
        comparison_id=from_run,
        skill_root=candidate_skill.expanduser().absolute(),
        label=label,
    )
    shown = shown_revision(home, revision)
    next_command = f"regents techtree uplift start {revision.revision_id}"
    emit(
        _revision_answer(
            shown,
            [
                f"Prepared {shown.skill.name} against the Skill comparison {from_run} "
                "measured. Nothing has run yet.",
                "",
            ],
            warnings=_screening_warnings(shown),
            next_line=next_command,
            next_command=next_command,
        ),
        as_json=as_json,
    )


def start(revision_id: str, yes: bool, reviewed_on: ReviewedOn, as_json: bool) -> None:
    if id_prefix(revision_id) != "forgerev":
        raise UsageError(
            f"{revision_id} is not a revision; uplift start takes the forgerev_ ID that "
            "uplift prepare printed. A Climb run starts with regents techtree climb start",
            code="uplift_start_needs_revision",
            details={"id": revision_id},
        )
    home = paths.home()
    revision = check_revision(home, revision_id)
    tasks_from = revision.record.tasks_from
    with held_out_hidden(home, tasks_from):
        verify_collection(home, tasks_from.collection_id)
    shown = shown_revision(home, revision)
    approve(
        yes=yes,
        reviewed_on=reviewed_on,
        as_json=as_json,
        review=_review(revision, shown),
        command=["uplift", "start", revision_id],
        question="Start this experiment?",
        why="Measuring a revision makes model calls on the person's own account.",
    )
    with held_out_hidden(home, tasks_from):
        measured = measure_revision(home, revision_id)
    shown = shown_revision(home, measured.revision)
    attempts = measured.run.record.attempts
    ungraded = sum(attempt.outcome is not ForgeAttemptOutcome.GRADED for attempt in attempts)
    run_warnings = (
        [
            (
                "forge_attempts_ungraded",
                f"{ungraded} of {len(attempts)} attempts ended without a verdict; a person "
                f"can see each and why with regents techtree forge status {measured.run.run_id}.",
            )
        ]
        if ungraded
        else []
    )
    next_command = f"regents techtree uplift context {measured.comparison.comparison_id}"
    emit(
        _revision_answer(
            shown,
            [
                f"Revision {revision_id} measured as run {shown.measured_run_id} and compared "
                f"as {shown.measured_comparison_id}.",
                "",
            ],
            warnings=[*_screening_warnings(shown), *run_warnings],
            next_line=f"{next_command}, which is where a further revision starts",
            next_command=next_command,
        ),
        as_json=as_json,
    )


def _review(revision: ForgeRevisionStatus, shown: ShownRevision) -> list[str]:
    """What measuring the revision does; held-out tasks are counted, and nothing is said of how
    they screened."""
    record = revision.record
    spec = revision.spec
    hidden = "the reference answer or tests of a task the improving agent could see"
    return [
        f"Revision: {revision.revision_id} of Skill {record.parent_skill_digest[:12]} measured "
        f"by {record.comparison_id}",
        *run_review_lines(spec, hidden=frozenset(spec.task_ids) - set(shown.task_ids)),
        f"Afterwards the run is compared against the same baseline, {record.baseline_run_id}, "
        "and the revision is kept whether it improved or regressed.",
        "Every task runs, but the revision's verdict is worked out on the held-out tasks alone, "
        "which the agent that wrote it never saw.",
        f"Screening: {len(shown.screening)} line(s) of the revised Skill also occur in {hidden}; "
        "see the revision."
        if shown.screening
        else f"Screening: no line of the revised Skill occurs in {hidden}.",
    ]


def _screening_warnings(shown: ShownRevision) -> list[tuple[str, str]]:
    shared = len(shown.screening)
    if not shared:
        return []
    return [
        (
            "forge_revision_shares_hidden_material",
            f"{shared} {_plural(shared, 'line', 'lines')} of the revised Skill also "
            f"{_plural(shared, 'occurs', 'occur')} in the reference answer or tests of a task "
            "the improving agent could see. A result with it may measure recall rather than "
            "method. Each is listed on the revision.",
        )
    ]


def _revision_answer(
    shown: ShownRevision,
    heading: list[str],
    *,
    warnings: list[tuple[str, str]],
    next_line: str,
    next_command: str,
) -> Answer:
    """A revision as the agent that wrote it may read it."""
    held_out = shown.held_out_tasks
    shared = len(shown.screening)
    lines = [
        *heading,
        f"- Revision: {shown.revision_id}",
        f"- State: {shown.state}",
        f"- Revised Skill: {shown.skill.name} ({shown.skill.root_digest[:19]})",
        f"- Revises: {shown.parent_skill_digest[:19]} from {shown.comparison_id}",
        f"- Baseline run: {shown.baseline_run_id}",
        f"- Collection: {shown.tasks_from.collection_id}",
        "- Tasks: "
        + ", ".join(shown.task_ids)
        + (
            f", and {held_out} held-out {_plural(held_out, 'task', 'tasks')} the improving "
            "agent never sees"
            if held_out
            else ""
        ),
        f"- Controlled: {'yes' if shown.controlled else 'no'}",
        "- Screening: "
        + (
            f"{shared} shared {_plural(shared, 'line', 'lines')} with hidden material"
            if shared
            else "no line shared with hidden material"
        ),
    ]
    if shown.measured_run_id is not None:
        lines.append(f"- Measured run: {shown.measured_run_id}")
    if shown.measured_comparison_id is not None:
        lines.append(f"- Comparison: {shown.measured_comparison_id}")
    lines += [
        f"  - {finding.skill_path}:{finding.line} matches the "
        f"{finding.material.replace('_', ' ')} of {finding.task_id}: {finding.excerpt}"
        for finding in shown.screening
    ]
    lines += ["", *(verdict for verdict in (shown.verdict, shown.study_verdict) if verdict)]
    if warnings:
        lines += ["", *(f"- {text}" for _, text in warnings)]
    lines += ["", f"Next: {next_line}"]
    answer: Answer = shown.model_dump(mode="json")
    if warnings:
        answer["warnings"] = [{"id": warning_id, "text": text} for warning_id, text in warnings]
    answer["next_command"] = next_command
    answer["report"] = "\n".join(lines)
    return answer


# ---------------------------------------------------------------------------
# The group
# ---------------------------------------------------------------------------

UPLIFT = click.Group("uplift", help="Improve a Skill from a finished forge comparison.")
for _command_ in (
    click.Command(
        "context",
        callback=context,
        help="Export the sanitized improvement context for a finished comparison.",
        params=[click.Argument(["comparison_id"], metavar="COMPARISON_ID"), JSON],
    ),
    click.Command(
        "skill-source",
        callback=skill_source,
        help="Show the verified text of the Skill a finished run measured.",
        params=[click.Argument(["run_id"], metavar="RUN_ID"), JSON],
    ),
    click.Command(
        "prepare",
        callback=prepare,
        help="Prepare a comparison between a run's Skill and a revision of it.",
        params=[
            click.Option(
                ["--from-run"],
                required=True,
                metavar="COMPARISON_ID",
                help="The finished comparison whose candidate Skill this revises.",
            ),
            click.Option(
                ["--candidate-skill"],
                required=True,
                metavar="PATH",
                type=click.Path(path_type=Path),
                help="The folder holding the revised Skill.",
            ),
            click.Option(
                ["--label"],
                help="A name for the revised Skill, as Hermes accepts one; its own name when "
                "omitted.",
            ),
            JSON,
        ],
    ),
    click.Command(
        "start",
        callback=start,
        help="Review a prepared revision, approve it, and measure it against the same baseline.",
        params=[
            click.Argument(["revision_id"], metavar="REVISION_ID"),
            YES,
            REVIEWED_ON,
            JSON,
        ],
    ),
):
    UPLIFT.add_command(_command_)
