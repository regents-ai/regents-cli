"""Accepting qualified tasks as one frozen collection, and checking it again.

Qualification says which built tasks work; it accepts nothing. A collection is prepared from an
ended construction: its review lists every task of the proposal with how it went, failures
included, and a person's corrections of it, the newest of which is the task's package; and the
exact members, the qualified tasks being accepted (all of them unless a person names fewer),
each by the digest of its files and of its qualification.

Every member is in one of two parts, given by a fixed rule rather than chosen by anyone
(`collection_parts`): the tasks an improving agent may study, and the tasks held out from it, on
which a revised Skill's verdict is computed. A collection holds at least one task in each part
and no two tasks with the same files.

Accepting records a person's decision on exactly that review, by its digest, and freezes the
collection. Verifying an accepted collection makes its review again from what is on disk now,
leaving out corrections made after the acceptance: every member's files are hashed against their
build's commitment, every qualification is read back, and the digest must be the one accepted.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Final

from regents_cli.techtree.approval import ReviewedOn
from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.errors import ConflictError, TechtreeError, ValidationError
from regents_cli.techtree.forge.builds import read_build_status
from regents_cli.techtree.forge.construction import read_construction_status
from regents_cli.techtree.forge.content import task_fingerprint, verify_task_set
from regents_cli.techtree.forge.models import (
    FORGE_COLLECTION_SCHEMA_VERSION,
    MINIMUM_COLLECTION_TASKS,
    ForgeApproval,
    ForgeCollectionCandidate,
    ForgeCollectionMember,
    ForgeCollectionRecord,
    ForgeCollectionReview,
    ForgeCollectionStatus,
    ForgeConstructionCallReview,
    ForgeConstructionTaskStatus,
    collection_parts,
)
from regents_cli.techtree.forge.planning import read_proposal_status
from regents_cli.techtree.forge.records import read_optional, read_record, write_approval
from regents_cli.techtree.forge.source import read_source_status
from regents_cli.techtree.fs import atomic_write_json
from regents_cli.techtree.ids import new_id
from regents_cli.techtree.paths import TechtreePaths

COLLECTION_FILENAME: Final = "collection.json"
ACCEPTANCE_FILENAME: Final = "acceptance.json"

#: Every part of a review that can differ when it is made again, in words.
_CHANGED_WORDS: Final = {
    "proposal_id": "the proposal",
    "proposal_digest": "the proposal",
    "claims": "the proposal",
    "source_id": "the Skill",
    "source_name": "the Skill",
    "source_digest": "the Skill",
    "construction_id": "the construction",
    "tasks": "the tasks' outcomes",
    "members": "the accepted tasks' files or qualification",
}


def prepare_collection(
    paths: TechtreePaths, *, construction_id: str, task_names: list[str] | None
) -> ForgeCollectionStatus:
    """Write the review of one collection, accepting nothing."""
    review = _review(
        paths, construction_id=construction_id, task_names=task_names, accepted_before=None
    )
    collection_id = new_id("forgecol")
    directory = paths.forge_collection_dir(collection_id)
    directory.mkdir(parents=True, mode=0o700)
    record = ForgeCollectionRecord(
        schema_version=FORGE_COLLECTION_SCHEMA_VERSION,
        collection_id=collection_id,
        created_at=datetime.now().astimezone(),
        review=review,
        collection_digest=digest_object(review),
    )
    atomic_write_json(directory / COLLECTION_FILENAME, record)
    return read_collection_status(paths, collection_id)


def check_collection(paths: TechtreePaths, collection_id: str) -> ForgeCollectionStatus:
    """Refuse a collection already accepted, or whose review has changed."""
    status = read_collection_status(paths, collection_id)
    if status.acceptance is not None:
        raise ConflictError(
            f"collection {collection_id} was accepted and is frozen. To accept other tasks, "
            "prepare a new collection with forge collect",
            code="forge_collection_accepted",
            details={"collection_id": collection_id},
        )
    _require_same(paths, status, code="forge_collection_stale", accepted_before=None)
    return status


def accept_collection(
    paths: TechtreePaths, collection_id: str, *, reviewed_on: ReviewedOn, yes: bool
) -> ForgeCollectionStatus:
    """Record a person's acceptance of exactly the reviewed collection."""
    status = check_collection(paths, collection_id)
    write_approval(
        Path(status.path) / ACCEPTANCE_FILENAME,
        subject_id=collection_id,
        subject_digest=status.record.collection_digest,
        reviewed_on=reviewed_on,
        yes=yes,
    )
    return read_collection_status(paths, collection_id)


def verify_collection(paths: TechtreePaths, collection_id: str) -> ForgeCollectionStatus:
    """Check an accepted collection against its files and records, byte for byte."""
    status = read_collection_status(paths, collection_id)
    if status.acceptance is None:
        raise ValidationError(
            f"collection {collection_id} has not been accepted, so there is no frozen "
            "collection to verify yet",
            code="forge_collection_not_accepted",
            details={"collection_id": collection_id},
        )
    if status.acceptance.subject_digest != status.record.collection_digest:
        raise ValidationError(
            f"collection {collection_id} was changed after its acceptance: its review no "
            "longer has the digest a person accepted",
            code="forge_collection_changed",
            details={
                "collection_id": collection_id,
                "accepted": status.acceptance.subject_digest,
                "found": status.record.collection_digest,
            },
        )
    _require_same(
        paths,
        status,
        code="forge_collection_changed",
        accepted_before=status.acceptance.approved_at,
    )
    return status


def _require_same(
    paths: TechtreePaths,
    status: ForgeCollectionStatus,
    *,
    code: str,
    accepted_before: datetime | None,
) -> None:
    """Make the review again from disk and refuse it when it differs."""
    stored = status.record.review
    try:
        current = _review(
            paths,
            construction_id=stored.construction_id,
            task_names=[member.task_name for member in stored.members],
            accepted_before=accepted_before,
        )
    except TechtreeError as error:
        raise ValidationError(
            f"collection {status.collection_id} no longer matches its records: {error.message}",
            code=code,
            details={"collection_id": status.collection_id, "cause": error.code},
        ) from error
    found = digest_object(current)
    if found != status.record.collection_digest:
        changed = [
            name for name in _CHANGED_WORDS if getattr(current, name) != getattr(stored, name)
        ]
        raise ValidationError(
            f"collection {status.collection_id} no longer matches its records: "
            + ", ".join(dict.fromkeys(_CHANGED_WORDS[name] for name in changed))
            + " changed",
            code=code,
            details={
                "collection_id": status.collection_id,
                "reviewed": status.record.collection_digest,
                "found": found,
                "changed": changed,
            },
        )


def _review(
    paths: TechtreePaths,
    *,
    construction_id: str,
    task_names: list[str] | None,
    accepted_before: datetime | None,
) -> ForgeCollectionReview:
    construction = read_construction_status(paths, construction_id)
    if construction.state in {"prepared", "running"}:
        raise ValidationError(
            f"construction {construction_id} is "
            + ("not started" if construction.state == "prepared" else "still running")
            + ", so its tasks have no outcome to accept yet",
            code="forge_collection_not_ready",
            details={"construction_id": construction_id, "state": construction.state},
        )
    built = construction.record.review
    proposal = read_proposal_status(paths, built.proposal_id).record
    candidates = [_candidate(task, accepted_before) for task in construction.tasks]
    by_name = {candidate.task_name: candidate for candidate in candidates}
    usable = [candidate.task_name for candidate in candidates if candidate.usable]
    names = usable if task_names is None else task_names
    if not names:
        raise ValidationError(
            f"no task of proposal {proposal.proposal_id} qualified, so there is nothing to "
            f"accept. Every task's outcome is shown by forge status {construction_id}",
            code="forge_collection_empty",
            details={"construction_id": construction_id},
        )
    for name in names:
        if name not in by_name or not by_name[name].usable:
            raise ValidationError(
                f"{name} is not a qualified task of proposal {proposal.proposal_id}; only "
                "qualified tasks can be accepted",
                code="forge_collection_task_not_usable",
                details={"task_name": name, "proposal_id": proposal.proposal_id},
            )
    if len(names) < MINIMUM_COLLECTION_TASKS:
        left_out = [name for name in usable if name not in names]
        raise ValidationError(
            f"this collection would hold only {', '.join(names)}, and a collection needs at "
            f"least {MINIMUM_COLLECTION_TASKS} tasks: some the improving agent may study, and "
            "some held out from it that decide whether a revised Skill improved. "
            + (
                f"{', '.join(left_out)} also qualified but "
                f"{'was' if len(left_out) == 1 else 'were'} left out by --task; name more "
                "tasks, or leave out --task to collect every one that qualified"
                if left_out
                else "Propose more tasks, or correct the ones that did not qualify with "
                "forge correct-task, then collect again"
            ),
            code="forge_collection_too_few",
            details={
                "construction_id": construction_id,
                "tasks": names,
                "left_out": left_out,
                "minimum": MINIMUM_COLLECTION_TASKS,
            },
        )
    calls = {call.task_name: call for call in built.disclosure.calls}
    committed = [_member(paths, by_name[name], calls[name]) for name in names]
    for index, member in enumerate(committed):
        if same := next(
            (other for other in committed[:index] if other.fingerprint == member.fingerprint),
            None,
        ):
            raise ValidationError(
                f"{same.task_name} and {member.task_name} have exactly the same files, so they "
                "are one task twice; a collection holds each task once. Leave one out with "
                "--task",
                code="forge_collection_duplicate_task",
                details={
                    "tasks": [same.task_name, member.task_name],
                    "fingerprint": member.fingerprint,
                },
            )
    parts = collection_parts(
        proposal.proposal_digest, [(member.task_name, member.fingerprint) for member in committed]
    )
    members = [
        member.model_copy(update={"part": part})
        for member, part in zip(committed, parts, strict=True)
    ]
    source = read_source_status(paths, built.source_id).record
    # Only an admitted Source Skill is planned from, and it carries its declaration.
    assert source.declaration is not None
    return ForgeCollectionReview(
        proposal_id=proposal.proposal_id,
        proposal_digest=proposal.proposal_digest,
        claims=proposal.claims,
        source_id=built.source_id,
        source_name=source.declaration.name,
        source_digest=built.source_digest,
        construction_id=construction_id,
        tasks=candidates,
        members=members,
        membership_digest=digest_object(members),
    )


def _candidate(
    task: ForgeConstructionTaskStatus, accepted_before: datetime | None
) -> ForgeCollectionCandidate:
    """How a task went, with a person's corrections of it; the newest correction wins.

    `accepted_before` leaves out the corrections made at or after it, so a collection verified
    later is made again from the package it accepted.
    """
    package = task.package
    corrections = [
        correction
        for correction in task.corrections
        if accepted_before is None or correction.corrected_at < accepted_before
    ]
    build_id: str | None
    if corrections:
        build_id, usable = corrections[-1].build_id, True
    else:
        build_id = None if package is None else package.build_id
        usable = package is not None and package.usable_tasks > 0
    return ForgeCollectionCandidate(
        task_name=task.task_name,
        state=task.state,
        corrections=corrections,
        build_id=build_id,
        usable=usable,
        why=None if task.call is None or task.call.failure is None else task.call.failure.message,
    )


def _member(
    paths: TechtreePaths,
    candidate: ForgeCollectionCandidate,
    call: ForgeConstructionCallReview,
) -> ForgeCollectionMember:
    """One qualified task by the claim it was built for, its files, checked on disk, and its
    qualification; its part is set once every member is known."""
    assert candidate.build_id is not None  # a qualified task names its build
    status = read_build_status(paths, candidate.build_id)
    assert status.qualification is not None  # it qualified
    verify_task_set(Path(status.tasks_path), status.build.task_set)
    [manifest] = status.build.task_set.tasks
    evidence = next(task for task in status.qualification.tasks if task.task_id == manifest.task_id)
    return ForgeCollectionMember(
        task_name=candidate.task_name,
        claim=call.claim,
        kind=call.kind,
        build_id=candidate.build_id,
        task_id=manifest.task_id,
        content_digest=manifest.content_digest,
        fingerprint=task_fingerprint(manifest),
        qualification_digest=digest_object(evidence),
        part="study",
    )


def read_collection_status(paths: TechtreePaths, collection_id: str) -> ForgeCollectionStatus:
    """A collection and its acceptance."""
    directory = paths.forge_collection_dir(collection_id)
    details = {"collection_id": collection_id, "path": str(directory)}
    acceptance = read_optional(ForgeApproval, directory / ACCEPTANCE_FILENAME, details=details)
    return ForgeCollectionStatus(
        collection_id=collection_id,
        path=str(directory),
        state="prepared" if acceptance is None else "accepted",
        record=read_record(
            ForgeCollectionRecord,
            directory / COLLECTION_FILENAME,
            missing=f"no prepared collection {collection_id}",
            code="forge_collection_not_found",
            details=details,
        ),
        acceptance=acceptance,
    )
