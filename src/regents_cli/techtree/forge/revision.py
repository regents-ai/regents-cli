"""One revision of a measured forge Skill: prepared, screened, measured, kept.

A revision is the forge's half of `uplift prepare` and `uplift start`. It starts from a finished
comparison, takes one revised Skill a person names, and declares the run that measures it: the
candidate run's own specification with the Skill alone replaced, so the comparability gate holds
the new arm to the same baseline by construction rather than by promise. The Hermes on the path
is asked for its version again, and a different answer is a refusal, because the run would
otherwise claim an agent it did not use.

Before anything runs the revised Skill is screened against what a task hides from the agent: its
reference solutions and its tests, and for a held-out task also its instruction and its inputs,
which the agent that wrote the revision never saw. Two kinds of line are not screened, because
the reviser had them without seeing anything hidden: the lines of the Skill the collection's
tasks were written from, and the lines of the instruction and inputs of the tasks it may study.
Every other line is screened, whichever Skill the revision was made from, so material a revision
copied stays evidence in every revision made from it. Screening is recorded, not a refusal (a
Skill may legitimately name the function it repairs), so every line the Skill shares with that
material is written on the revision for the person who approves the run to see.

Measuring runs the new arm on every task and compares it against the same baseline the parent
was compared against. The revision then names its run, its comparison and a one-line verdict
against the comparison it revised from, and is kept whether it improved or regressed. That
verdict is computed on the held-out tasks alone, so a Skill that memorised the tasks it studied
cannot pass for an improvement; how it did on the tasks it could see is recorded beside it,
labelled as such. Nothing here proposes, chooses or loops.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Final, Literal, NamedTuple

from pydantic import ValidationError as ModelValidationError

from regents_cli.techtree.canonical import canonical_json_bytes, sha256_digest_bytes
from regents_cli.techtree.errors import PrerequisiteError, TechtreeError, ValidationError
from regents_cli.techtree.forge.calls import agent_spec
from regents_cli.techtree.forge.collection import read_collection_status
from regents_cli.techtree.forge.comparability import (
    assert_comparable_run_specs,
    compare_run_specs,
)
from regents_cli.techtree.forge.compare import compare_runs, read_comparison_status
from regents_cli.techtree.forge.experiment import run_spec_digest
from regents_cli.techtree.forge.improvement import require_whole_collection
from regents_cli.techtree.forge.models import (
    FORGE_REVISION_SCHEMA_VERSION,
    VERDICT_MINIMUM_PAIRS,
    ForgeCollectionMember,
    ForgeCollectionTasks,
    ForgeComparisonRecord,
    ForgeComparisonStatus,
    ForgePartSummary,
    ForgeRevisionRecord,
    ForgeRevisionStatus,
    ForgeRunSpec,
    ForgeRunStatus,
    ForgeScreeningFinding,
    ForgeSkillSpec,
)
from regents_cli.techtree.forge.records import read_record
from regents_cli.techtree.forge.run import read_run_status, run_arm
from regents_cli.techtree.forge.skill import SKILL_DIRNAME, scan_skill_spec, snapshot_skill
from regents_cli.techtree.forge.source import read_source_status
from regents_cli.techtree.fs import atomic_write_bytes, atomic_write_json
from regents_cli.techtree.ids import new_id, validate_id
from regents_cli.techtree.models.base import ProtocolModel
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.presentation.sanitize import sanitize_label

REVISION_FILENAME: Final = "revision.json"
SPEC_FILENAME: Final = "spec.json"
#: A line shorter than this is too ordinary to be evidence of copying: `import pytest` and
#: `return self` occur in any Python file.
_MINIMUM_LINE: Final = 24
_EXCERPT_LIMIT: Final = 120
#: A verdict is one sentence naming two Skills; it is never cut short.
_VERDICT_LIMIT: Final = 400


def prepare_revision(
    paths: TechtreePaths, *, comparison_id: str, skill_root: Path, label: str | None
) -> ForgeRevisionStatus:
    """Declare and screen one revised Skill against a finished comparison."""
    comparison = read_comparison_status(paths, comparison_id).record
    parent = read_run_status(paths, comparison.candidate_run_id)
    baseline = read_run_status(paths, comparison.baseline_run_id)
    if parent.spec.skill is None:
        raise ValidationError(
            "the candidate run carries no Skill, so there is nothing to revise",
            code="forge_candidate_without_skill",
            details={"comparison_id": comparison_id},
        )
    require_whole_collection(paths, comparison)
    try:
        skill, files = scan_skill_spec(skill_root, name=label)
    except ModelValidationError as error:
        raise ValidationError(
            "the label is not a name Hermes accepts for a Skill: lowercase letters, digits, "
            "dashes and underscores, starting with a letter",
            code="forge_skill_name_invalid",
            details={"label": label or ""},
        ) from error
    if skill.root_digest == parent.spec.skill.root_digest:
        raise ValidationError(
            "the revised Skill is the Skill the comparison measured; a revision has to differ "
            "from it",
            code="forge_revision_unchanged",
            details={"skill": skill.root_digest},
        )
    declared, found = parent.spec.agent, agent_spec()
    if found != declared:
        raise PrerequisiteError(
            f"the Hermes on the path is {found.executable} v{found.version}, not the "
            f"{declared.executable} v{declared.version} the comparison was made with, so a "
            "revision measured with it would not be the same experiment",
            code="forge_agent_changed",
            details={"declared": declared.version, "found": found.version},
        )

    spec = parent.spec.model_copy(update={"skill": skill})
    comparability = compare_run_specs(baseline.spec, spec)
    assert_comparable_run_specs(comparability)
    screening = screen_skill(paths, tasks_from=spec.tasks_from, task_ids=spec.task_ids, files=files)

    revision_id = new_id("forgerev")
    directory = paths.forge_revision_dir(revision_id)
    directory.mkdir(parents=True, mode=0o700)
    snapshot_skill(files, directory / SKILL_DIRNAME)
    atomic_write_bytes(directory / SPEC_FILENAME, canonical_json_bytes(spec))
    now = datetime.now(UTC)
    record = ForgeRevisionRecord(
        schema_version=FORGE_REVISION_SCHEMA_VERSION,
        revision_id=revision_id,
        created_at=now,
        updated_at=now,
        comparison_id=comparison.comparison_id,
        tasks_from=spec.tasks_from,
        baseline_run_id=comparison.baseline_run_id,
        parent_run_id=comparison.candidate_run_id,
        parent_skill_digest=parent.spec.skill.root_digest,
        skill=skill,
        spec_digest=run_spec_digest(spec),
        comparability=comparability,
        screening=screening,
        state="prepared",
        measured_run_id=None,
        measured_comparison_id=None,
        verdict=None,
        study_verdict=None,
    )
    atomic_write_json(directory / REVISION_FILENAME, record)
    return ForgeRevisionStatus(
        revision_id=revision_id, path=str(directory), spec=spec, record=record
    )


@dataclass(frozen=True)
class MeasuredRevision:
    """What measuring left: the revision as updated, its run, its comparison."""

    revision: ForgeRevisionStatus
    run: ForgeRunStatus
    comparison: ForgeComparisonStatus


def check_revision(paths: TechtreePaths, revision_id: str) -> ForgeRevisionStatus:
    """Refuse a revision that was already measured."""
    status = read_revision_status(paths, revision_id)
    record = status.record
    if record.state != "prepared":
        raise ValidationError(
            f"revision {revision_id} was already measured as run {record.measured_run_id}; "
            "prepare a new revision to measure again",
            code="forge_revision_measured",
            details={"revision_id": revision_id, "measured_run_id": record.measured_run_id or ""},
        )
    return status


def measure_revision(paths: TechtreePaths, revision_id: str) -> MeasuredRevision:
    """Run the revision's arm, compare it with the baseline, and record both."""
    status = check_revision(paths, revision_id)
    record = status.record
    run = run_arm(paths, status.spec, Path(status.path) / SKILL_DIRNAME)
    comparison = compare_runs(paths, record.baseline_run_id, run.run_id)
    parent = read_comparison_status(paths, record.comparison_id).record
    verdict, study_verdict = _verdicts(parent, comparison.record, record.screening)
    measured = record.model_copy(
        update={
            "updated_at": datetime.now(UTC),
            "state": "measured",
            "measured_run_id": run.run_id,
            "measured_comparison_id": comparison.comparison_id,
            "verdict": verdict,
            "study_verdict": study_verdict,
        }
    )
    atomic_write_json(Path(status.path) / REVISION_FILENAME, measured)
    return MeasuredRevision(
        revision=status.model_copy(update={"record": measured}), run=run, comparison=comparison
    )


def read_revision_status(paths: TechtreePaths, revision_id: str) -> ForgeRevisionStatus:
    """One revision's specification and record, read back from its directory."""
    directory = paths.forge_revision_dir(validate_id(revision_id, "forgerev"))
    details = {"revision_id": revision_id, "path": str(directory)}
    missing = f"no recorded forge revision {revision_id}"
    return ForgeRevisionStatus(
        revision_id=revision_id,
        path=str(directory),
        spec=read_record(
            ForgeRunSpec,
            directory / SPEC_FILENAME,
            missing=missing,
            code="forge_revision_not_found",
            details=details,
        ),
        record=read_record(
            ForgeRevisionRecord,
            directory / REVISION_FILENAME,
            missing=missing,
            code="forge_revision_not_found",
            details=details,
        ),
    )


# ---------------------------------------------------------------------------
# What the improving agent is shown
# ---------------------------------------------------------------------------


class ShownRevision(ProtocolModel):
    """A revision with nothing that names a held-out task: those are counted, never listed."""

    revision_id: str
    state: Literal["prepared", "measured"]
    skill: ForgeSkillSpec
    parent_skill_digest: str
    comparison_id: str
    baseline_run_id: str
    tasks_from: ForgeCollectionTasks
    task_ids: list[str]
    held_out_tasks: int
    spec_digest: str
    controlled: bool
    screening: list[ForgeScreeningFinding]
    measured_run_id: str | None
    measured_comparison_id: str | None
    verdict: str | None
    study_verdict: str | None


def held_out_members(
    paths: TechtreePaths, tasks_from: ForgeCollectionTasks
) -> list[ForgeCollectionMember]:
    """The held-out tasks of a collection."""
    members = read_collection_status(paths, tasks_from.collection_id).record.review.members
    return [member for member in members if member.part == "held_out"]


def shown_revision(paths: TechtreePaths, revision: ForgeRevisionStatus) -> ShownRevision:
    """The revision as the improving agent may see it."""
    record = revision.record
    held_out = {member.task_id for member in held_out_members(paths, record.tasks_from)}
    return ShownRevision(
        revision_id=revision.revision_id,
        state=record.state,
        skill=record.skill,
        parent_skill_digest=record.parent_skill_digest,
        comparison_id=record.comparison_id,
        baseline_run_id=record.baseline_run_id,
        tasks_from=record.tasks_from,
        task_ids=[task_id for task_id in revision.spec.task_ids if task_id not in held_out],
        held_out_tasks=len(held_out),
        spec_digest=record.spec_digest,
        controlled=record.comparability.controlled,
        screening=[finding for finding in record.screening if finding.task_id not in held_out],
        measured_run_id=record.measured_run_id,
        measured_comparison_id=record.measured_comparison_id,
        verdict=record.verdict,
        study_verdict=record.study_verdict,
    )


@contextmanager
def held_out_hidden(paths: TechtreePaths, tasks_from: ForgeCollectionTasks) -> Iterator[None]:
    """Raise an error that names a held-out task, by its id, name or build, without naming it.

    The error keeps its kind and exit code; its message says only where a person can see which
    task and why.
    """
    markers = frozenset(
        marker
        for member in held_out_members(paths, tasks_from)
        for marker in (member.task_id, member.task_name, member.build_id)
    )
    try:
        yield
    except TechtreeError as error:
        said = error.message + " " + json.dumps(error.details, default=str)
        if not any(
            re.search(rf"(?<![a-z0-9_-]){re.escape(marker)}(?![a-z0-9_-])", said)
            for marker in markers
        ):
            raise
        collection_id = tasks_from.collection_id
        if error.code == "forge_collection_changed":
            raise type(error)(
                f"collection {collection_id} changed after its acceptance, in its held-out "
                "tasks, so the revision cannot be measured on it. A person can see what changed "
                f"with regents techtree forge verify {collection_id}",
                code=error.code,
                details={"collection_id": collection_id},
            ) from None
        run_id = error.details.get("run_id")
        raise type(error)(
            "a held-out task failed while the revised Skill was measured, so the revision was "
            "not measured. A person can see which task and why with "
            + (
                f"regents techtree forge status {run_id}"
                if run_id
                else "regents techtree forge status on the run"
            ),
            code="forge_held_out_task_failed",
            details={"collection_id": collection_id},
        ) from None


# ---------------------------------------------------------------------------
# Screening
# ---------------------------------------------------------------------------


_Material = Literal["reference_solution", "tests", "instruction", "inputs"]


def screen_skill(
    paths: TechtreePaths,
    *,
    tasks_from: ForgeCollectionTasks,
    task_ids: list[str],
    files: list[tuple[Path, str]],
) -> list[ForgeScreeningFinding]:
    """Record every line of a revised Skill that also occurs in a task's hidden material.

    A task hides every line of every file under `solution` and under `tests`; a held-out task
    also hides every line of its `instruction.md` and of its inputs, the files under
    `environment` other than the `Dockerfile` that only builds its image. A Skill line is
    compared after stripping, and only when it is long enough to be more than coincidence. Lines
    of the Skill the tasks were written from and of the instruction or inputs of a task the
    reviser may study are not screened: the reviser had them without seeing anything hidden.
    """
    hidden, given = _material(paths, tasks_from, task_ids)
    screened = [
        (relative, number, stripped)
        for source, relative in files
        for number, line in _text_lines(source)
        if len(stripped := line.strip()) >= _MINIMUM_LINE and stripped not in given
    ]
    return [
        ForgeScreeningFinding(
            task_id=task_id,
            material=material,
            skill_path=relative,
            line=number,
            excerpt=sanitize_label(stripped, maximum=_EXCERPT_LIMIT),
        )
        for task_id, materials in hidden
        for relative, number, stripped in screened
        for material, haystack in materials
        if stripped in haystack
    ]


def _material(
    paths: TechtreePaths, tasks_from: ForgeCollectionTasks, task_ids: list[str]
) -> tuple[list[tuple[str, list[tuple[_Material, set[str]]]]], set[str]]:
    """Per task, the hidden lines by kind; and the lines the reviser was given: those of the
    Skill the tasks were written from and of the instruction and inputs of the tasks it may
    study."""
    review = read_collection_status(paths, tasks_from.collection_id).record.review
    members = {member.task_id: member for member in review.members}
    hidden: list[tuple[str, list[tuple[_Material, set[str]]]]] = []
    given = _source_lines(paths, review.source_id)
    for task_id in task_ids:
        member = members[task_id]
        task_dir = paths.forge_build_dir(member.build_id) / "tasks" / task_id
        instruction = _lines_of(task_dir / "instruction.md")
        inputs = _lines_under(task_dir / "environment", "Dockerfile")
        materials: list[tuple[_Material, set[str]]] = [
            ("reference_solution", _lines_under(task_dir / "solution")),
            ("tests", _lines_under(task_dir / "tests")),
        ]
        if member.part == "held_out":
            materials += [("instruction", instruction), ("inputs", inputs)]
        else:
            given |= instruction | inputs
        hidden.append((task_id, materials))
    return hidden, given


def _source_lines(paths: TechtreePaths, source_id: str) -> set[str]:
    """Every stripped line of the Source Skill a collection's tasks were
    written from, as its look kept it, each file proved against the digest
    the look recorded."""
    source = read_source_status(paths, source_id)
    directory = Path(source.path) / SKILL_DIRNAME
    lines: set[str] = set()
    for file in source.record.admitted_files:
        data = _kept(directory / file.path)
        if len(data) != file.size or sha256_digest_bytes(data) != file.digest:
            raise ValidationError(
                f"Techtree's kept copy of {file.path} no longer matches what "
                f"Source Skill {source_id} recorded, so the revision cannot be "
                "screened against it. Nothing was written",
                code="forge_source_changed",
                details={"source_id": source_id, "path": file.path},
            )
        lines |= {line.strip() for line in data.decode("utf-8").splitlines()}
    return lines


def _kept(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError:
        return b""


def _lines_under(directory: Path, *leaving_out: str) -> set[str]:
    """Return every stripped line of every text file under ``directory``,
    except the files at ``leaving_out``, relative to it."""
    return {
        line
        for path in sorted(p for p in directory.rglob("*") if p.is_file())
        if path.relative_to(directory).as_posix() not in leaving_out
        for line in _lines_of(path)
    }


def _lines_of(path: Path) -> set[str]:
    """Return every stripped line of one text file."""
    return {line.strip() for _, line in _text_lines(path)}


def _text_lines(path: Path) -> list[tuple[int, str]]:
    """Return a file's lines numbered from one, or nothing for non-text."""
    try:
        text = path.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    return list(enumerate(text.splitlines(), start=1))


# ---------------------------------------------------------------------------
# The verdict
# ---------------------------------------------------------------------------


class _Measure(NamedTuple):
    """What one comparison says about its candidate on the tasks a verdict is over."""

    mean: float | None
    wins: int
    losses: int
    ties: int
    graded: int
    planned: int
    complete: bool


def _verdicts(
    parent: ForgeComparisonRecord,
    revised: ForgeComparisonRecord,
    screening: list[ForgeScreeningFinding],
) -> tuple[str, str]:
    """A revision's verdict, over the held-out pairs alone, and its study verdict, over the
    pairs of the tasks the reviser could see.

    A revised Skill that shares a line with a held-out task's material is not judged on them,
    since it may carry what it was never meant to see.
    """
    held_out = len(revised.held_out.task_ids)
    scope = (
        f"On the {held_out} held-out {'task' if held_out == 1 else 'tasks'}, "
        "which the agent that wrote the revision never saw"
    )
    carries = {finding.task_id for finding in screening} & set(revised.held_out.task_ids)
    return (
        _lead(
            "",
            scope,
            "the revision is not judged, because the revised Skill contains "
            "material from held-out tasks. Kept as measured.",
        )
        if carries
        else _verdict(scope, parent, revised, _part(parent.held_out), _part(revised.held_out)),
        _verdict(
            "On the tasks the agent that wrote the revision could see",
            parent,
            revised,
            _part(parent.study),
            _part(revised.study),
        ),
    )


def _part(part: ForgePartSummary) -> _Measure:
    return _Measure(
        mean=part.candidate_mean_reward,
        wins=part.wins,
        losses=part.losses,
        ties=part.ties,
        graded=part.pairs_graded,
        planned=part.pairs_planned,
        complete=part.complete,
    )


def _verdict(
    scope: str,
    parent: ForgeComparisonRecord,
    revised: ForgeComparisonRecord,
    before: _Measure,
    after: _Measure,
) -> str:
    """Say, in one sentence, how the revision did against the Skill it revised.

    Like every other verdict, it needs at least ``VERDICT_MINIMUM_PAIRS``
    graded pairs, here on each side, and is inconclusive below that.
    """
    partial = "" if before.complete and after.complete else "Partial evidence:"
    if before.mean is None or after.mean is None:
        return _lead(
            partial,
            scope,
            "the revision could not be placed against the Skill it revised, "
            "because one of the two has no graded pair.",
        )
    if min(before.graded, after.graded) < VERDICT_MINIMUM_PAIRS:
        return _lead(
            partial,
            scope,
            "the revision is inconclusive against the Skill it revised: "
            f"{after.graded} graded {'pair' if after.graded == 1 else 'pairs'} "
            f"for the revision and {before.graded} for the Skill it revised, "
            f"and a verdict needs at least {VERDICT_MINIMUM_PAIRS} on each. "
            "Kept as measured.",
        )
    change = after.mean - before.mean
    word = "improved on" if change > 0 else "regressed from" if change < 0 else "matched"
    return _lead(
        partial,
        scope,
        f"against the same baseline, {revised.candidate_skill.name} {word} "
        f"{parent.candidate_skill.name}: mean reward {after.mean:.2f} against "
        f"{before.mean:.2f} ({change:+.2f}); {after.wins} won, {after.losses} lost, "
        f"{after.ties} tied of {after.planned}. Kept as measured.",
    )


def _lead(partial: str, scope: str, said: str) -> str:
    """Join a verdict's parts into one sentence: what it is partial on, what
    it is over, and what it says."""
    body = f"{scope}, {said}"
    return sanitize_label(f"{partial} {body}".strip(), maximum=_VERDICT_LIMIT)
