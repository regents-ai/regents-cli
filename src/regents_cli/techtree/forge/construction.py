"""Building task packages from one reviewed proposal: review, approval, one pass.

A construction is prepared before anything leaves the machine. Preparing reads the proposal and
the Source Skill's kept copy and writes, for each task, the exact prompt the creator would be
sent: Techtree's building instructions, the claim the task tests, the task as proposed, and the
Skill's files. What an approval covers is bound by one digest: the proposal, the claims its
tasks test and the corrections it had, those prompts, the instructions and package contract,
the Hermes and model that would answer, the Docker platform, what the creator may do (answer in
text, nothing else) and the limits (one call per task, a wall time and an answer size each).

Starting a construction makes the review again from what is on disk now; anything changed,
including a new correction of the proposal, refuses the old approval. A construction is started
at most once. A call that answers with a usable package has it written by Techtree into a new
build, `task.toml` included from the pinned contract as Skill2Env's host writes it, and the
build is qualified. A call that fails, is rejected or runs out of time is kept and the pass goes
on; Ctrl-C ends it. Nothing is retried.

A person may correct a task of an ended construction: a copy of its package, edited, is admitted
into a new build and qualified, then recorded beside the construction with the build it
replaces and what changed. The newest correction is the task's package from then on.
"""

from __future__ import annotations

import json
import os
import unicodedata
from datetime import UTC, datetime
from pathlib import Path
from typing import Final, cast

from pydantic import ValidationError as ModelValidationError

from regents_cli.techtree.approval import ReviewedOn
from regents_cli.techtree.canonical import digest_object, sha256_digest_bytes
from regents_cli.techtree.errors import (
    ConflictError,
    NotFoundError,
    RunError,
    TechtreeError,
    ValidationError,
)
from regents_cli.techtree.forge import builds, calls, docker, skill2env
from regents_cli.techtree.forge.content import commit_task_set
from regents_cli.techtree.forge.models import (
    FORGE_CONSTRUCTION_PACKAGE_SCHEMA_VERSION,
    FORGE_CONSTRUCTION_RUN_SCHEMA_VERSION,
    FORGE_CONSTRUCTION_SCHEMA_VERSION,
    FORGE_TASK_CORRECTION_SCHEMA_VERSION,
    ForgeApproval,
    ForgeAuthoringCapabilities,
    ForgeConstructionCallReview,
    ForgeConstructionCallState,
    ForgeConstructionDisclosure,
    ForgeConstructionLimits,
    ForgeConstructionPackage,
    ForgeConstructionRecord,
    ForgeConstructionReview,
    ForgeConstructionRun,
    ForgeConstructionState,
    ForgeConstructionStatus,
    ForgeConstructionTaskStatus,
    ForgeCreatedPackage,
    ForgeCreatorRecipe,
    ForgeFailure,
    ForgeModelCall,
    ForgeProposalRecord,
    ForgeProposedTask,
    ForgeSkillClaim,
    ForgeTaskCorrection,
    ForgeTaskCorrectionChange,
    TaskContentManifest,
)
from regents_cli.techtree.forge.planning import read_proposal_status
from regents_cli.techtree.forge.records import (
    inspect_command,
    read_optional,
    read_record,
    write_approval,
)
from regents_cli.techtree.forge.source import read_source_status
from regents_cli.techtree.fs import atomic_write_bytes, atomic_write_json
from regents_cli.techtree.ids import new_id
from regents_cli.techtree.paths import TechtreePaths

CONSTRUCTION_FILENAME: Final = "construction.json"
APPROVAL_FILENAME: Final = "approval.json"
RUN_FILENAME: Final = "run.json"
CALL_FILENAME: Final = "call.json"
PACKAGE_FILENAME: Final = "package.json"
PROMPTS_DIR: Final = "prompts"
CALLS_DIR: Final = "calls"
CORRECTIONS_DIR: Final = "corrections"

#: How long one creator call may take, from launch to answer.
CALL_WALL_SECONDS: Final = 900
#: The largest answer read as a package.
CALL_ANSWER_BYTES: Final = 512 * 1024
#: The one base image the creator is told to build from.
_BASE_IMAGE: Final = "python:3.12-slim"
#: Where a created package's files may be; `task.toml` is Techtree's to write.
_ROOTS: Final = frozenset({"instruction.md", "environment", "tests", "solution"})
_STATE_WORDS: Final = {
    "prepared": "not yet approved",
    "running": "still running",
    "finished": "finished",
    "stopped": "stopped",
}
_CHANGED_WORDS: Final = {
    "corrected_by": "the proposal's corrections (it was corrected)",
    "recipe": "the building instructions",
    "agent": "the Hermes that would answer",
    "platform": "the Docker platform",
    "disclosure": "what would be sent",
}


def prepare_construction(
    paths: TechtreePaths,
    *,
    proposal_id: str,
    provider: str,
    model_id: str,
    reasoning: str | None,
) -> ForgeConstructionStatus:
    """Write the review of one construction, sending nothing."""
    construction_id = new_id("forgecon")
    review, prompts = _review(
        paths,
        construction_id=construction_id,
        proposal=read_proposal_status(paths, proposal_id).record,
        provider=provider,
        model_id=model_id,
        reasoning=reasoning,
    )
    directory = paths.forge_construction_dir(construction_id)
    (directory / PROMPTS_DIR).mkdir(parents=True, mode=0o700)
    for name, prompt in prompts.items():
        atomic_write_bytes(directory / PROMPTS_DIR / f"{name}.md", prompt)
    record = ForgeConstructionRecord(
        schema_version=FORGE_CONSTRUCTION_SCHEMA_VERSION,
        construction_id=construction_id,
        created_at=datetime.now(UTC),
        review=review,
        construction_digest=digest_object(review),
    )
    atomic_write_json(directory / CONSTRUCTION_FILENAME, record)
    return read_construction_status(paths, construction_id)


def check_construction(paths: TechtreePaths, construction_id: str) -> ForgeConstructionStatus:
    """Refuse a construction already started, or whose review has changed."""
    status = read_construction_status(paths, construction_id)
    if status.approval is not None or status.run is not None:
        raise ConflictError(
            f"construction {construction_id} was already started once, and an approval covers "
            "one pass. To build its tasks again, prepare a new construction",
            code="forge_construction_attempted",
            details={"construction_id": construction_id, "state": status.state},
        )
    stored = status.record.review
    current, _ = _review(
        paths,
        construction_id=construction_id,
        proposal=read_proposal_status(paths, stored.proposal_id).record,
        provider=stored.model.provider,
        model_id=stored.model.model_id,
        reasoning=stored.model.reasoning,
    )
    found = digest_object(current)
    if found != status.record.construction_digest:
        changed = [
            name
            for name in ForgeConstructionReview.model_fields
            if getattr(current, name) != getattr(stored, name)
        ]
        raise ValidationError(
            f"construction {construction_id} is no longer what was reviewed: "
            + ", ".join(_CHANGED_WORDS.get(name, name) for name in changed)
            + " changed since it was prepared. The creator was not called; prepare it again "
            "and review the new construction",
            code="forge_construction_stale",
            details={
                "construction_id": construction_id,
                "reviewed": status.record.construction_digest,
                "found": found,
                "changed": changed,
            },
        )
    return status


def _review(
    paths: TechtreePaths,
    *,
    construction_id: str,
    proposal: ForgeProposalRecord,
    provider: str,
    model_id: str,
    reasoning: str | None,
) -> tuple[ForgeConstructionReview, dict[str, bytes]]:
    """The review and each call's prompt, made from what is on disk now."""
    source = read_source_status(paths, proposal.source_id)
    if source.record.admitted_digest != proposal.source_digest:
        raise ValidationError(
            f"proposal {proposal.proposal_id} was made from a different record of Source Skill "
            f"{proposal.source_id}",
            code="forge_evidence_invalid",
            details={"proposal_id": proposal.proposal_id},
        )
    declaration = source.record.declaration
    assert declaration is not None  # an admitted source carries its declaration
    kept = calls.kept_files(source, called="The creator")
    instructions = skill2env.resource("creator-prompt.md")
    contract = skill2env.contract()
    base_image = (
        f"{_BASE_IMAGE}@" + json.loads(skill2env.resource("base-images.json"))[_BASE_IMAGE]["index"]
    )
    claims = {claim.claim_id: claim for claim in proposal.claims}
    suffix = construction_id.split("_", 1)[1][:8]
    skill = calls.skill_text(kept)
    prompts: dict[str, bytes] = {}
    reviewed: list[ForgeConstructionCallReview] = []
    for task in proposal.tasks:
        prompt = (
            instructions.replace(b"{base_image}", base_image.encode())
            + _task_text(claims[task.claim], task)
            + skill
        )
        if len(prompt) > calls.PROMPT_LIMIT:
            raise ValidationError(
                f"task {task.name} and this Skill's files make a building prompt of "
                f"{len(prompt)} bytes, and the creator is handed at most {calls.PROMPT_LIMIT}; "
                "build from a smaller Skill",
                code="forge_construction_too_large",
                details={"task_name": task.name, "prompt_bytes": len(prompt)},
            )
        prompts[task.name] = prompt
        reviewed.append(
            ForgeConstructionCallReview(
                task_name=task.name,
                claim=task.claim,
                kind=task.kind,
                package_name=f"task_{task.name}_{suffix}",
                prompt_bytes=len(prompt),
                prompt_digest=sha256_digest_bytes(prompt),
            )
        )
    review = ForgeConstructionReview(
        proposal_id=proposal.proposal_id,
        proposal_digest=proposal.proposal_digest,
        claims=proposal.claims,
        corrected_by=_corrections(paths, proposal.proposal_id),
        source_id=proposal.source_id,
        source_digest=proposal.source_digest,
        source_skill=skill2env.local_source_skill(declaration.name),
        recipe=ForgeCreatorRecipe(
            name="skill2env-creator",
            instructions_digest=sha256_digest_bytes(instructions),
            contract_digest=sha256_digest_bytes(skill2env.resource("contract.json")),
            base_image=base_image,
            upstream_url=contract["upstream_url"],
            upstream_revision=contract["upstream_revision"],
        ),
        agent=calls.agent_spec(),
        model=calls.model_spec(provider, model_id, reasoning),
        platform=builds.host_docker_platform(),
        disclosure=ForgeConstructionDisclosure(files=[file for file, _ in kept], calls=reviewed),
        egress="model-provider",
        capabilities=ForgeAuthoringCapabilities(
            tools="none", toolset=calls.TEXT_ONLY_TOOLSET, memory_enabled=False
        ),
        limits=ForgeConstructionLimits(
            calls=len(reviewed),
            attempts_per_call=1,
            wall_seconds_per_call=CALL_WALL_SECONDS,
            answer_bytes_per_call=CALL_ANSWER_BYTES,
        ),
    )
    return review, prompts


def _task_text(claim: ForgeSkillClaim, task: ForgeProposedTask) -> bytes:
    """The claim the task tests, then the task, as the proposal has them."""
    return (
        b"\n===== the claim this task tests =====\n"
        + json.dumps(claim.model_dump(mode="json"), indent=2, ensure_ascii=False).encode()
        + b"\n===== the task =====\n"
        + json.dumps(task.model_dump(mode="json"), indent=2, ensure_ascii=False).encode()
        + b"\n===== end of the task =====\n"
    )


def _corrections(paths: TechtreePaths, proposal_id: str) -> list[str]:
    """The proposals made as corrections of this one, in id order."""
    directory = paths.forge_proposal_dir(proposal_id).parent
    if not directory.is_dir():
        return []
    return sorted(
        child.name
        for child in directory.iterdir()
        if child.name != proposal_id
        and (parent := read_proposal_status(paths, child.name).record.parent) is not None
        and parent.proposal_id == proposal_id
    )


def start_construction(
    paths: TechtreePaths, construction_id: str, *, reviewed_on: ReviewedOn, yes: bool
) -> ForgeConstructionStatus:
    """Record the approval, call the creator once per task, and build what it made.

    Docker is asked first, so no call is made whose package could not be built.
    """
    review = check_construction(paths, construction_id).record.review
    docker.require_daemon()
    calls.require_signed_in(review.agent.executable, review.model.provider)
    with calls.hold_profile() as profile:
        record = check_construction(paths, construction_id).record
        _pass(paths, record, reviewed_on, yes, profile)
    return read_construction_status(paths, construction_id)


def _pass(
    paths: TechtreePaths,
    record: ForgeConstructionRecord,
    reviewed_on: ReviewedOn,
    yes: bool,
    profile: Path,
) -> None:
    directory = paths.forge_construction_dir(record.construction_id)
    write_approval(
        directory / APPROVAL_FILENAME,
        subject_id=record.construction_id,
        subject_digest=record.construction_digest,
        reviewed_on=reviewed_on,
        yes=yes,
    )
    run = ForgeConstructionRun(
        schema_version=FORGE_CONSTRUCTION_RUN_SCHEMA_VERSION,
        construction_id=record.construction_id,
        process_id=os.getpid(),
        started_at=datetime.now(UTC),
        ended_at=None,
        stopped=None,
    )
    atomic_write_json(directory / RUN_FILENAME, run)

    def end(*, stopped: bool) -> None:
        atomic_write_json(
            directory / RUN_FILENAME,
            run.model_copy(
                update={"ended_at": datetime.now(UTC), "stopped": "person" if stopped else None}
            ),
        )

    interrupted = RunError(
        "building was stopped with Ctrl-C; a call that was under way may or may not have been "
        "answered or charged, and the tasks after it were not called. Nothing is retried. "
        f"Inspect: {inspect_command(record.construction_id)}",
        code="forge_construction_interrupted",
        details={"construction_id": record.construction_id, "path": str(directory)},
    )
    for call_review in record.review.disclosure.calls:
        try:
            package = _build(paths, record, call_review, profile)
        except KeyboardInterrupt as interrupt:
            end(stopped=True)
            raise interrupted from interrupt
        except TechtreeError:
            end(stopped=False)
            raise
        # Ctrl-C while a package was being checked is recorded by the build.
        if (
            package is not None
            and package.failure
            and package.failure.code == ("forge_build_cancelled")
        ):
            end(stopped=True)
            raise interrupted
    end(stopped=False)


def _build(
    paths: TechtreePaths,
    record: ForgeConstructionRecord,
    call_review: ForgeConstructionCallReview,
    profile: Path,
) -> ForgeConstructionPackage | None:
    """Make one creator call; a usable answer is written into a new build and qualified."""
    review = record.review
    construction_dir = paths.forge_construction_dir(record.construction_id)
    call_dir = construction_dir / CALLS_DIR / call_review.task_name
    call_dir.mkdir(parents=True, mode=0o700)
    prompt_name = f"{PROMPTS_DIR}/{call_review.task_name}.md"
    build_id = new_id("build")
    written: list[tuple[str, ...]] = []

    def package(answer: bytes) -> str:
        created, bases = _created(answer, review)
        _write_package(
            builds.package_dir(paths, build_id, call_review.package_name),
            created,
            review,
            call_review,
        )
        written.append(bases)
        return call_review.package_name

    call = calls.model_call(
        calls.Call(
            subject_id=record.construction_id,
            subject_digest=record.construction_digest,
            task_name=call_review.task_name,
            agent=review.agent,
            model=review.model,
            prompt=(construction_dir / prompt_name).read_bytes(),
            prompt_name=prompt_name,
            wall_seconds=review.limits.wall_seconds_per_call,
            directory=call_dir,
        ),
        profile,
        record=call_dir / CALL_FILENAME,
        answer=package,
        who="creator",
    )
    if call.state != "succeeded":
        return None
    usable, failure = 1, None
    try:
        builds.qualify_package(
            paths,
            build_id,
            call_review.package_name,
            bases=written[0],
            source_digest=review.source_digest,
            platform=review.platform,
        )
    except RunError as error:
        usable = 0
        failure = ForgeFailure(
            code=error.code, message=error.message[:512], error_type=type(error).__name__
        )
    built = ForgeConstructionPackage(
        schema_version=FORGE_CONSTRUCTION_PACKAGE_SCHEMA_VERSION,
        construction_id=record.construction_id,
        task_name=call_review.task_name,
        claim=call_review.claim,
        kind=call_review.kind,
        package_name=call_review.package_name,
        build_id=build_id,
        usable_tasks=usable,
        failure=failure,
    )
    atomic_write_json(call_dir / PACKAGE_FILENAME, built)
    return built


def correct_task(
    paths: TechtreePaths, construction_id: str, task_name: str, task_dir: Path
) -> ForgeConstructionStatus:
    """Admit and qualify a person's edited package of one task and record it as their
    correction of that task; nothing is recorded when it is refused."""
    status = read_construction_status(paths, construction_id)
    details = {"construction_id": construction_id, "task_name": task_name}
    if status.state not in {"finished", "stopped"}:
        raise ValidationError(
            f"construction {construction_id} is {_STATE_WORDS[status.state]}, so its tasks "
            "cannot be corrected yet",
            code="forge_correction_not_ready",
            details={**details, "state": status.state},
        )
    task = next((task for task in status.tasks if task.task_name == task_name), None)
    if task is None:
        raise NotFoundError(
            f"construction {construction_id} did not build a task {task_name}; its tasks are "
            + ", ".join(task.task_name for task in status.tasks),
            code="forge_correction_no_task",
            details=details,
        )
    task_dir = task_dir.expanduser().resolve()
    if not task_dir.is_dir():
        raise NotFoundError(
            f"there is no folder {task_dir}",
            code="forge_correction_no_folder",
            details={**details, "path": str(task_dir)},
        )
    if task_dir.name != task.package_name:
        raise ValidationError(
            f"the corrected task's folder is named {task_dir.name}, and it keeps the name of "
            f"the package it corrects, {task.package_name}, which its task.toml names too. "
            "Rename the folder",
            code="forge_correction_wrong_name",
            details={**details, "path": str(task_dir)},
        )
    replaces, before = _replaced(paths, task)
    if (
        before is not None
        and commit_task_set(task_dir.parent, [task_dir.name]).tasks[0].content_digest
        == before.content_digest
    ):
        raise ValidationError(
            f"{task_dir} holds exactly the files of the package it would correct (build "
            f"{replaces}); a correction has to change something",
            code="forge_correction_unchanged",
            details={**details, "path": str(task_dir)},
        )
    review = status.record.review
    build_id = new_id("build")
    try:
        bases = skill2env.admit(
            task_dir,
            destination=builds.package_dir(paths, build_id, task_dir.name),
            source_skill=review.source_skill,
            source_digest=review.source_digest,
            platform=review.platform,
        )
        built = builds.qualify_package(
            paths,
            build_id,
            task_dir.name,
            bases=bases,
            source_digest=review.source_digest,
            platform=review.platform,
        )
    except RunError as error:
        raise RunError(
            f"the correction of {task_name} was refused and nothing was recorded: {error.message}",
            code=error.code,
            details={**error.details, **details},
        ) from error
    [after] = built.build.task_set.tasks
    correction = ForgeTaskCorrection(
        schema_version=FORGE_TASK_CORRECTION_SCHEMA_VERSION,
        construction_id=construction_id,
        task_name=task_name,
        corrected_at=datetime.now(UTC),
        replaces=replaces,
        replaced_digest=None if before is None else before.content_digest,
        build_id=build_id,
        content_digest=after.content_digest,
        changes=_changes(before, after),
    )
    directory = Path(status.path) / CORRECTIONS_DIR / task_name
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    atomic_write_json(directory / f"{build_id}.json", correction)
    return read_construction_status(paths, construction_id)


def _replaced(
    paths: TechtreePaths, task: ForgeConstructionTaskStatus
) -> tuple[str | None, TaskContentManifest | None]:
    """The build a correction replaces, and that package's files when it was committed."""
    if task.corrections:
        build_id = task.corrections[-1].build_id
    elif task.package is not None:
        build_id = task.package.build_id
    else:
        return None, None
    build = builds.read_build_record(paths, build_id)
    return build_id, None if build is None else build.task_set.tasks[0]


def _changes(
    before: TaskContentManifest | None, after: TaskContentManifest
) -> list[ForgeTaskCorrectionChange]:
    """Every entry added, removed or modified, in path order."""
    old = {} if before is None else {entry.path: entry for entry in before.entries}
    new = {entry.path: entry for entry in after.entries}
    return [
        ForgeTaskCorrectionChange(
            path=path,
            change="added" if path not in old else "removed" if path not in new else "modified",
        )
        for path in sorted(old.keys() | new.keys())
        if old.get(path) != new.get(path)
    ]


# ---------------------------------------------------------------------------
# The creator's answer and the package written from it
# ---------------------------------------------------------------------------


def _created(
    answer: bytes, review: ForgeConstructionReview
) -> tuple[ForgeCreatedPackage, tuple[str, ...]]:
    """The creator's answer as a package Techtree can write, and its recipe's base images."""
    limit = review.limits.answer_bytes_per_call
    if len(answer) > limit:
        raise ValidationError(
            f"the creator's answer is {len(answer)} bytes, over the {limit} the construction "
            "allowed",
            code="forge_creator_answer_too_large",
        )
    try:
        loaded = json.loads(answer.decode("utf-8"))
        # A JSON escape can spell a lone surrogate, which is not text.
        json.dumps(loaded, ensure_ascii=False).encode("utf-8")
    except (UnicodeError, ValueError) as error:
        raise ValidationError(
            "the creator's answer is not one JSON object of UTF-8 text",
            code="forge_creator_answer_invalid",
        ) from error
    try:
        created = ForgeCreatedPackage.model_validate(loaded, strict=True)
    except ModelValidationError as error:
        issue = error.errors(include_input=False, include_url=False)[0]
        place = ".".join(
            f"file {item + 1}" if isinstance(item, int) else str(item) for item in issue["loc"]
        )
        raise ValidationError(
            f"the creator's answer cannot be used: {place}: {issue['msg']}",
            code="forge_creator_answer_invalid",
        ) from error
    seen: set[str] = set()
    files = {file.path: file.text.encode("utf-8") for file in created.files}
    for path in files:
        parts = path.split("/")
        if (
            "\\" in path
            or "\x00" in path
            or any(part in {"", ".", ".."} or part.startswith(".") for part in parts)
            or parts[0] not in _ROOTS
            or (parts[0] == "instruction.md") != (path == "instruction.md")
        ):
            raise ValidationError(
                f"the creator's answer has a file Techtree does not write: {path}",
                code="forge_creator_answer_invalid",
            )
        key = unicodedata.normalize("NFC", path).casefold()
        if key in seen or any("/".join(parts[:end]) in files for end in range(1, len(parts))):
            raise ValidationError(
                f"the creator's answer has {path} twice, or inside a file",
                code="forge_creator_answer_invalid",
            )
        seen.add(key)
    missing = sorted(set(skill2env.contract()["required_files"]) - {"task.toml"} - set(files))
    if missing:
        raise ValidationError(
            "the creator's answer leaves out " + ", ".join(missing),
            code="forge_creator_answer_invalid",
        )
    members = {
        "/".join(path.split("/")[:end]) for path in files for end in range(1, path.count("/") + 1)
    }
    try:
        skill2env.check_members(files, review.source_digest)
        bases = skill2env.dockerfile_bases(
            files["environment/Dockerfile"].decode("utf-8"), members | set(files), review.platform
        )
    except ValueError as error:
        raise ValidationError(
            f"the creator's answer cannot be used: {error}", code="forge_creator_answer_invalid"
        ) from error
    return created, bases


def _write_package(
    package_dir: Path,
    created: ForgeCreatedPackage,
    review: ForgeConstructionReview,
    call_review: ForgeConstructionCallReview,
) -> None:
    """Write the creator's files and Techtree's `task.toml`, all new."""
    package_dir.mkdir(parents=True, mode=0o700)
    for file in created.files:
        parts = file.path.split("/")
        for depth in range(1, len(parts)):
            (package_dir / "/".join(parts[:depth])).mkdir(mode=0o700, exist_ok=True)
        target = package_dir / file.path
        with target.open("xb") as output:
            output.write(file.text.encode("utf-8"))
        target.chmod(0o700 if file.executable else 0o600)
    contract = skill2env.contract()
    document = {
        "schema_version": contract["task_schema"],
        "artifacts": created.artifacts,
        "task": {
            "name": f"skill2env/{call_review.package_name}",
            "description": created.description,
            "keywords": created.keywords,
            "authors": [{"name": "skill2env"}],
        },
        "metadata": {
            "source_skill": review.source_skill,
            "source_bundle_digest": review.source_digest.removeprefix("sha256:"),
        },
        **contract["fixed_sections"],
    }
    with (package_dir / "task.toml").open("xb") as output:
        output.write(_toml(document).encode("utf-8"))


# The small TOML writer stays: `tomli_w` gives different bytes for the same document (it writes
# multi-line arrays, `authors` as an inline table and a literal tab, and leaves out the empty
# `[solution]` header), and `task.toml`'s bytes feed every task's content digest and fingerprint.


def _toml(document: dict[str, object]) -> str:
    """Write the few TOML shapes a `task.toml` has: tables, strings, numbers."""
    lines: list[str] = []
    _table_body(lines, [], document)
    return "\n".join(lines).lstrip("\n") + "\n"


def _is_table(value: object) -> bool:
    return isinstance(value, dict) or (
        isinstance(value, list) and bool(value) and all(isinstance(item, dict) for item in value)
    )


def _table_body(lines: list[str], path: list[str], table: dict[str, object]) -> None:
    for key, value in table.items():
        if not _is_table(value):
            lines.append(f"{_toml_key(key)} = {_toml_value(value)}")
    for key, value in table.items():
        if not _is_table(value):
            continue
        name = ".".join(_toml_key(part) for part in [*path, key])
        items = value if isinstance(value, list) else [value]
        for item in items:
            lines.append("")
            lines.append(f"[[{name}]]" if isinstance(value, list) else f"[{name}]")
            _table_body(lines, [*path, key], cast(dict[str, object], item))


def _toml_key(key: str) -> str:
    return key if key and all(c.isalnum() or c in "_-" for c in key) else _toml_str(key)


def _toml_str(value: str) -> str:
    # A JSON string is a TOML basic string once DEL, which TOML requires escaped and JSON
    # leaves alone, is escaped too.
    return json.dumps(value, ensure_ascii=False).replace("\x7f", "\\u007f")


def _toml_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return repr(value)
    if isinstance(value, str):
        return _toml_str(value)
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(item) for item in value) + "]"
    raise TypeError(f"task.toml has no value of type {type(value).__name__}")


# ---------------------------------------------------------------------------
# Reading back
# ---------------------------------------------------------------------------


def read_construction_status(paths: TechtreePaths, construction_id: str) -> ForgeConstructionStatus:
    """A construction with every call, package and correction, and where it stands."""
    directory = paths.forge_construction_dir(construction_id)
    details = {"construction_id": construction_id, "path": str(directory)}
    record = read_record(
        ForgeConstructionRecord,
        directory / CONSTRUCTION_FILENAME,
        missing=f"no prepared construction {construction_id}",
        code="forge_construction_not_found",
        details=details,
    )
    approval = read_optional(ForgeApproval, directory / APPROVAL_FILENAME, details=details)
    run = read_optional(ForgeConstructionRun, directory / RUN_FILENAME, details=details)
    state: ForgeConstructionState
    if run is None:
        state = "prepared" if approval is None else "stopped"
    elif run.ended_at is None:
        state = "running" if calls.alive(run.process_id) else "stopped"
    else:
        state = "stopped" if run.stopped is not None else "finished"
    return ForgeConstructionStatus(
        construction_id=construction_id,
        path=str(directory),
        state=state,
        record=record,
        approval=approval,
        run=run,
        tasks=[_task_status(directory, call, details) for call in record.review.disclosure.calls],
    )


def _task_status(
    directory: Path, call_review: ForgeConstructionCallReview, details: dict[str, str]
) -> ForgeConstructionTaskStatus:
    call_dir = directory / CALLS_DIR / call_review.task_name
    corrections_dir = directory / CORRECTIONS_DIR / call_review.task_name
    call = read_optional(ForgeModelCall, call_dir / CALL_FILENAME, details=details)
    state: ForgeConstructionCallState
    if call is None:
        state = "not_called"
    elif call.state == "started":
        state = "running" if calls.alive(call.process_id) else "outcome_unknown"
    else:
        state = call.state
    corrections = [
        read_record(
            ForgeTaskCorrection,
            file,
            missing=str(file),
            code="forge_evidence_invalid",
            details=details,
        )
        for file in (sorted(corrections_dir.iterdir()) if corrections_dir.is_dir() else [])
    ]
    return ForgeConstructionTaskStatus(
        task_name=call_review.task_name,
        package_name=call_review.package_name,
        state=state,
        call=call,
        package=read_optional(
            ForgeConstructionPackage, call_dir / PACKAGE_FILENAME, details=details
        ),
        corrections=sorted(corrections, key=lambda correction: correction.corrected_at),
    )
