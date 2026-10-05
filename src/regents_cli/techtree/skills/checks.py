"""The checks a Skill must hold before a proof may make it public.

Techtree's site runs this same list on every published proof (cli/COMMANDS.md, decision 68 a),
so the CLI runs it where a refusal is cheapest: when a Skill is prepared, before any model is
called; when a proof is checked offline; before `climb publish` sends anything; and before
`skill fetch` writes a fetched Skill to disk. A refusal names the file and the check it failed.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from pathlib import PurePosixPath
from typing import Final

from regents_cli.techtree.canonical import sha256_digest_bytes
from regents_cli.techtree.constants import (
    MAX_SKILL_FILE_BYTES,
    MAX_SKILL_FILES,
    MAX_SKILL_TOTAL_BYTES,
)
from regents_cli.techtree.drafts.source import StagedSkill
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.manifests.builder import skill_content_digest
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.skill import (
    SKILL_ENTRY_FILE,
    SkillArtifact,
    check_relative_posix_path,
)
from regents_cli.techtree.skills.scanner import MEDIA_TYPES, SKILL_TOO_LARGE

SKILL_FINGERPRINT_MISMATCH: Final = "skill_fingerprint_mismatch"
SKILL_PATH_INVALID: Final = "skill_path_invalid"
SKILL_CONTAINS_SECRET: Final = "skill_contains_secret"

#: What a private key or an API key looks like, by the name a refusal gives it. A
#: transaction hash looks exactly like a private key, so a Skill may hold neither.
SECRET_PATTERNS: Final[dict[str, re.Pattern[str]]] = {
    "a private key block": re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"),
    "an API key (sk-)": re.compile(r"(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}"),
    "a GitHub token (ghp_)": re.compile(r"(?<![A-Za-z0-9_])ghp_[A-Za-z0-9]{36}"),
    "a GitHub token (github_pat_)": re.compile(r"(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{22,}"),
    "an AWS access key": re.compile(r"(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])"),
    "a Slack token": re.compile(r"(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}"),
    "a 32-byte hex value (a private key or a transaction hash)": re.compile(
        r"(?<![A-Za-z0-9])0x[0-9a-fA-F]{64}(?![A-Za-z0-9])"
    ),
}


def check_public_skill(
    artifact: SkillArtifact, files: Mapping[str, bytes], *, expected_root: Digest
) -> None:
    """Refuse a Skill that is not exactly `expected_root`, or that the site would refuse."""
    _check_paths(artifact, files)
    _check_sizes(artifact, files)
    _check_fingerprint(artifact, files, expected_root)
    _check_secrets(files)


def staged_skill_files(staged: StagedSkill) -> dict[str, bytes]:
    """The bytes of every file a stored Skill lists, read no further than one file may hold."""
    found: dict[str, bytes] = {}
    for entry in staged.artifact.files:
        try:
            with (staged.files / entry.path).open("rb") as handle:
                found[entry.path] = handle.read(MAX_SKILL_FILE_BYTES + 1)
        except OSError as error:
            raise ValidationError(
                f"the Skill is missing {entry.path}",
                code=SKILL_FINGERPRINT_MISMATCH,
                details={"path": entry.path},
            ) from error
    return found


def _check_paths(artifact: SkillArtifact, files: Mapping[str, bytes]) -> None:
    listed = [entry.path for entry in artifact.files]
    for path in [*listed, *files]:
        try:
            check_relative_posix_path(path)
        except ValueError as error:
            raise ValidationError(
                f"the Skill path {path!r} would land outside the Skill's folder",
                code=SKILL_PATH_INVALID,
                details={"path": path},
            ) from error
        if PurePosixPath(path).suffix.lower() not in MEDIA_TYPES:
            raise ValidationError(
                f"the Skill file {path} is not a kind of file a Skill may hold; only "
                + ", ".join(sorted(MEDIA_TYPES))
                + " are",
                code=SKILL_PATH_INVALID,
                details={"path": path},
            )
    if SKILL_ENTRY_FILE not in listed:
        raise ValidationError(
            f"the Skill has no {SKILL_ENTRY_FILE}",
            code=SKILL_PATH_INVALID,
            details={"path": SKILL_ENTRY_FILE},
        )
    if sorted(files) != listed:
        unlisted = sorted(set(files) - set(listed))
        missing = sorted(set(listed) - set(files))
        raise ValidationError(
            "the Skill's files are not exactly the ones its fingerprint lists",
            code=SKILL_FINGERPRINT_MISMATCH,
            details={"unlisted": unlisted, "missing": missing},
        )


def _check_sizes(artifact: SkillArtifact, files: Mapping[str, bytes]) -> None:
    if len(artifact.files) > MAX_SKILL_FILES:
        raise ValidationError(
            f"the Skill has {len(artifact.files)} files and a Skill may hold {MAX_SKILL_FILES}",
            code=SKILL_TOO_LARGE,
            details={"file_count": len(artifact.files), "maximum_files": MAX_SKILL_FILES},
        )
    for path, data in files.items():
        if len(data) > MAX_SKILL_FILE_BYTES:
            raise ValidationError(
                f"the Skill file {path} is larger than the {MAX_SKILL_FILE_BYTES} bytes one "
                "file may hold",
                code=SKILL_TOO_LARGE,
                details={"path": path, "maximum_file_bytes": MAX_SKILL_FILE_BYTES},
            )
    total = sum(len(data) for data in files.values())
    if total > MAX_SKILL_TOTAL_BYTES:
        raise ValidationError(
            f"the Skill holds {total} bytes and a Skill may hold {MAX_SKILL_TOTAL_BYTES}",
            code=SKILL_TOO_LARGE,
            details={"total_bytes": total, "maximum_total_bytes": MAX_SKILL_TOTAL_BYTES},
        )


def _check_fingerprint(
    artifact: SkillArtifact, files: Mapping[str, bytes], expected_root: Digest
) -> None:
    computed = skill_content_digest(artifact.files)
    if artifact.root_digest != expected_root or computed != expected_root:
        raise ValidationError(
            f"the Skill's file list gives the fingerprint {computed}, not {expected_root}",
            code=SKILL_FINGERPRINT_MISMATCH,
            details={
                "expected": expected_root,
                "stated": artifact.root_digest,
                "computed": computed,
            },
        )
    for entry in artifact.files:
        data = files[entry.path]
        if len(data) != entry.size or sha256_digest_bytes(data) != entry.digest:
            raise ValidationError(
                f"the Skill file {entry.path} is not the file its fingerprint lists",
                code=SKILL_FINGERPRINT_MISMATCH,
                details={"path": entry.path},
            )
        if MEDIA_TYPES[PurePosixPath(entry.path).suffix.lower()] != entry.media_type:
            raise ValidationError(
                f"the Skill file {entry.path} is listed as {entry.media_type}",
                code=SKILL_FINGERPRINT_MISMATCH,
                details={"path": entry.path, "media_type": entry.media_type},
            )


def _check_secrets(files: Mapping[str, bytes]) -> None:
    for path, data in files.items():
        text = data.decode("utf-8", errors="replace")
        for kind, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                raise ValidationError(
                    f"the Skill file {path} contains what looks like {kind}, and a Skill "
                    "becomes public when its Result is published; take it out and prepare again",
                    code=SKILL_CONTAINS_SECRET,
                    details={"path": path, "found": kind},
                )
