"""Skills other people published: rerunning their Result, or fetching the Skill by itself.

Both start from what Techtree's site serves and trust none of it. A rerun's bundle is checked
offline in full before its Skill is prepared like any other; a fetched Skill is checked
against the fingerprint asked for before one file is written. Neither ever runs, renders or
imports anything a Skill holds.
"""

from __future__ import annotations

import re
from base64 import b64decode
from binascii import Error as Base64Error
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import httpx
from pydantic import ValidationError as PydanticValidationError

from regents_cli.errors import CommandError
from regents_cli.techtree.catalog.service import CatalogService
from regents_cli.techtree.errors import ConflictError, ValidationError, VerificationError
from regents_cli.techtree.fs import atomic_write_bytes, ensure_private_directory
from regents_cli.techtree.models.base import Digest, ObjectEnvelope, ProtocolModel
from regents_cli.techtree.models.skill import SkillArtifact
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.publication.downloaded import opened_submission
from regents_cli.techtree.publication.models import PublicationSubmission
from regents_cli.techtree.receipts.bundle import (
    BUNDLE_MANIFEST_FILENAME,
    PROOF_BUNDLE_INVALID,
    SKILL_DIRECTORY,
    SKILL_FILENAME,
    LocalProofBundleManifest,
)
from regents_cli.techtree.site import get_json
from regents_cli.techtree.skills.checks import (
    SKILL_FINGERPRINT_MISMATCH,
    check_public_skill,
)
from regents_cli.techtree.skills.service import (
    PreparedDraft,
    RerunOrigin,
    SkillPreparationService,
)

RERUN_CAMPAIGN_NOT_IN_RELEASE: Final = "rerun_campaign_not_in_release"
SKILL_FOLDER_NOT_EMPTY: Final = "skill_folder_not_empty"
SITE_ANSWER_INVALID: Final = "invalid_response"

_FOLDER_UNSAFE: Final = re.compile(r"[^A-Za-z0-9._-]+")
_FOLDER_DIGEST_HEX: Final = 12


@dataclass(frozen=True)
class FetchedSkill:
    """A published Skill now on this machine, and the Results it came from."""

    skill: SkillArtifact
    folder: Path
    results: list[Digest]


class _FileAnswer(ProtocolModel):
    path: str
    content_base64: str


class _SkillAnswer(ProtocolModel):
    skill: SkillArtifact
    files: list[_FileAnswer]
    results: list[Digest]


def prepare_rerun(
    paths: TechtreePaths,
    bundle_digest: str,
    *,
    base: str,
    client: httpx.Client | None = None,
) -> PreparedDraft:
    """An ordinary draft over a published Result's Campaign and Skill, recording what it reruns."""
    submission = _parse(
        get_json(base, "publications", bundle_digest, "bundle", client=client),
        PublicationSubmission,
        "a published Result's bundle",
    )
    if submission.bundle_digest != bundle_digest:
        raise VerificationError(
            f"the site answered with bundle {submission.bundle_digest} when {bundle_digest} "
            "was asked for",
            code=PROOF_BUNDLE_INVALID,
            details={"asked": bundle_digest, "served": submission.bundle_digest},
        )
    with opened_submission(submission, label=bundle_digest) as (root, result):
        if not result.verified:
            failed = [message for message in result.messages if message.status == "failed"]
            raise VerificationError(
                f"Result {bundle_digest} does not check out offline, so it is not rerun: "
                + "; ".join(message.detail for message in failed),
                code=PROOF_BUNDLE_INVALID,
                details={"failed_checks": [message.id for message in failed]},
            )
        manifest = (
            ObjectEnvelope[LocalProofBundleManifest]
            .model_validate_json((root / BUNDLE_MANIFEST_FILENAME).read_bytes())
            .payload
        )
        campaign_digest = manifest.campaign_spec_digest
        found = CatalogService(paths).climb_for_campaign(campaign_digest)
        if found is None:
            raise ValidationError(
                f"Result {bundle_digest} was made under Campaign {campaign_digest}, which is not "
                "one in this release, so this build cannot rerun it",
                code=RERUN_CAMPAIGN_NOT_IN_RELEASE,
                details={"campaign_spec_digest": campaign_digest},
            )
        climb_reference, held_out = found
        skill = SkillArtifact.model_validate_json((root / SKILL_FILENAME).read_bytes())
        return SkillPreparationService(paths).prepare(
            climb_reference=climb_reference,
            skill_path=root / SKILL_DIRECTORY,
            candidate_label=skill.name,
            held_out=held_out,
            rerun=RerunOrigin(bundle_digest=bundle_digest, skill_root_digest=skill.root_digest),
        )


def fetch_skill(
    root_digest: str,
    *,
    base: str,
    to: Path | None,
    client: httpx.Client | None = None,
) -> FetchedSkill:
    """A published Skill checked against `root_digest`, then written to a new or empty folder."""
    answer = _parse(
        get_json(base, "skills", root_digest, client=client), _SkillAnswer, "a published Skill"
    )
    skill = answer.skill
    files: dict[str, bytes] = {}
    for item in answer.files:
        if item.path in files:
            raise ValidationError(
                f"the site sent {item.path} twice",
                code=SKILL_FINGERPRINT_MISMATCH,
                details={"path": item.path},
            )
        try:
            files[item.path] = b64decode(item.content_base64, validate=True)
        except Base64Error as error:
            raise ValidationError(
                f"the site sent {item.path} in a form that is not base64",
                code=SKILL_FINGERPRINT_MISMATCH,
                details={"path": item.path},
            ) from error
    check_public_skill(skill, files, expected_root=root_digest)
    folder = to if to is not None else Path.cwd() / _default_folder(skill)
    _require_empty(folder)
    ensure_private_directory(folder)
    for path, data in files.items():
        destination = folder.joinpath(*path.split("/"))
        ensure_private_directory(destination.parent)
        atomic_write_bytes(destination, data)
    return FetchedSkill(skill=skill, folder=folder, results=list(answer.results))


def _default_folder(skill: SkillArtifact) -> str:
    """`<skill name>-<first 12 hex>`, the name spelled so it is one folder and never a path."""
    name = _FOLDER_UNSAFE.sub("-", skill.name).strip(".-") or "skill"
    return f"{name}-{skill.root_digest.removeprefix('sha256:')[:_FOLDER_DIGEST_HEX]}"


def _require_empty(folder: Path) -> None:
    if folder.is_symlink() or (folder.exists() and not folder.is_dir()):
        raise ConflictError(
            f"{folder} is already something other than a folder, so the Skill was not written",
            code=SKILL_FOLDER_NOT_EMPTY,
            details={"folder": str(folder)},
        )
    if folder.is_dir() and any(folder.iterdir()):
        raise ConflictError(
            f"{folder} already holds files, so the Skill was not written; name a new or empty "
            "folder with --to",
            code=SKILL_FOLDER_NOT_EMPTY,
            details={"folder": str(folder)},
        )


def _parse[ModelT: ProtocolModel](raw: object, model: type[ModelT], what: str) -> ModelT:
    try:
        return model.model_validate(raw)
    except PydanticValidationError as error:
        raise CommandError(
            SITE_ANSWER_INVALID, f"The site answered, but not with {what}."
        ) from error
