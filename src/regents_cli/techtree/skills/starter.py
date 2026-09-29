"""Obtaining a Climb's starter Skill from the address the release pins.

The release names each Climb's Skill by its `starter_skill_digest` and where to fetch it by
`starter_skill_object_url`. What arrives is checked twice: the bytes against the digest the
address itself ends in, and then, scanned like any other Skill, the content-tree digest against
the pin. The cache lives under the Techtree home, in a folder named after the Skill as the Agent
Skills specification asks, and is re-scanned before it is reused, so an edited cache entry is not
a shortcut past the check.
"""

from __future__ import annotations

import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal

from filelock import FileLock, Timeout

from regents_cli.techtree.canonical import sha256_digest_bytes
from regents_cli.techtree.constants import MAX_SKILL_TOTAL_BYTES
from regents_cli.techtree.errors import (
    NotFoundError,
    PrerequisiteError,
    ValidationError,
    VerificationError,
)
from regents_cli.techtree.fs import ensure_private_directory, remove_tree
from regents_cli.techtree.manifests.builder import skill_content_digest
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.skill import SKILL_ENTRY_FILE, SkillFile
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.release.models import ClimbCoordinates, object_url_digest
from regents_cli.techtree.skills.scanner import SkillScanResult, scan_skill

STARTER_SKILL_UNAVAILABLE: Final = "starter_skill_unavailable"
STARTER_SKILL_SOURCE_REFUSED: Final = "starter_skill_source_refused"
STARTER_SKILL_DIGEST_MISMATCH: Final = "starter_skill_digest_mismatch"

DOWNLOAD_TIMEOUT_SECONDS: Final = 60.0
_CACHE_LOCK_FILENAME: Final = ".skills.lock"
_CACHE_LOCK_TIMEOUT_SECONDS: Final = 120.0
_STAGING_PREFIX: Final = ".materializing-"


@dataclass(frozen=True)
class StarterSkill:
    """How one Climb's starter Skill is named and described. `name` is the one its SKILL.md
    declares, so the cached folder carries it as the Agent Skills specification asks."""

    name: str
    candidate_label: str
    purpose: str


#: Keyed by Climb reference, one per Climb the catalog ships.
STARTER_SKILLS: Final[dict[str, StarterSkill]] = {
    "hello-world-climb@1": StarterSkill(
        name="hello-world-starter-v1",
        candidate_label="hello-world-v1",
        purpose="intentionally incomplete introductory Skill",
    ),
    "frontier-cs-open-ended-climb@1": StarterSkill(
        name="frontier-cs-starter-v2",
        candidate_label="frontier-cs-v2",
        purpose="a plain first approach to improve on",
    ),
}


@dataclass(frozen=True)
class MaterializedStarterSkill:
    """Where the pinned starter Skill is, and what proved it is that Skill."""

    root: Path
    entrypoint: Path
    root_digest: Digest
    file_count: int
    total_bytes: int
    origin: Literal["cache", "release"]


class StarterSkillService:
    """Materializes a Climb's starter Skill into the Techtree home."""

    def __init__(self, paths: TechtreePaths) -> None:
        self._paths = paths

    def materialize(self, climb: ClimbCoordinates, skill: StarterSkill) -> MaterializedStarterSkill:
        """The pinned starter Skill, fetched from the release's address if this home lacks it."""
        pinned = climb.starter_skill_digest
        ensure_private_directory(self._paths.cache_dir)
        ensure_private_directory(self._paths.skills_cache_dir())
        ensure_private_directory(self._paths.skill_cache_dir(pinned))
        destination = self._paths.skill_cache_dir(pinned) / skill.name
        with self._cache_lock():
            cached = _verified_cache_entry(destination, pinned)
            if cached is not None:
                return _describe(cached, origin="cache")
            source = climb.starter_skill_object_url
            staging = destination.parent / f"{_STAGING_PREFIX}{destination.name}"
            remove_tree(staging)
            try:
                _stage_document(_fetched(source), staging)
                _verify_scan(staging, pinned, source=source)
                remove_tree(destination)
                staging.replace(destination)
            except BaseException:
                remove_tree(staging)
                raise
            published = _verified_cache_entry(destination, pinned)
        if published is None:
            raise VerificationError(
                "the starter Skill did not survive being written to the cache",
                code=STARTER_SKILL_DIGEST_MISMATCH,
                details={"expected": pinned, "cache": str(destination)},
            )
        return _describe(published, origin="release")

    @contextmanager
    def _cache_lock(self) -> Iterator[None]:
        """Serialize materialization within one Techtree home."""
        lock = FileLock(
            str(self._paths.skills_cache_dir() / _CACHE_LOCK_FILENAME),
            timeout=_CACHE_LOCK_TIMEOUT_SECONDS,
        )
        try:
            lock.acquire()
        except Timeout as error:
            raise PrerequisiteError(
                "another Techtree process is materializing a Skill",
                code=STARTER_SKILL_UNAVAILABLE,
                details={"path": str(self._paths.skills_cache_dir())},
            ) from error
        try:
            yield
        finally:
            lock.release()


def _fetched(url: str) -> bytes:
    """The bytes the release's content address serves, checked against the digest it ends in."""
    data = _download_document(url)
    promised = object_url_digest(url)
    served = sha256_digest_bytes(data)
    if served != promised:
        raise VerificationError(
            f"{url} promises the bytes it serves are {promised}, and it served {served}",
            code=STARTER_SKILL_DIGEST_MISMATCH,
            details={"url": url, "expected": promised, "computed": served},
        )
    return data


def _stage_document(data: bytes, staging: Path) -> None:
    """A fetched starter Skill is a single SKILL.md document."""
    ensure_private_directory(staging)
    entrypoint = staging / SKILL_ENTRY_FILE
    entrypoint.write_bytes(data)
    entrypoint.chmod(0o600)


def _verify_scan(root: Path, expected: Digest, *, source: str) -> None:
    computed = _root_digest(_scan(root, source=source))
    if computed != expected:
        raise VerificationError(
            "what was obtained is not the starter Skill this release pins",
            code=STARTER_SKILL_DIGEST_MISMATCH,
            details={"expected": expected, "computed": computed, "source": source},
        )


def _verified_cache_entry(root: Path, expected: Digest) -> SkillScanResult | None:
    """A cached Skill that still is what its directory name claims."""
    if not (root / SKILL_ENTRY_FILE).is_file():
        return None
    try:
        scan = scan_skill(root)
    except (NotFoundError, ValidationError):
        return None
    return scan if _root_digest(scan) == expected else None


def _scan(root: Path, *, source: str) -> SkillScanResult:
    """The ordinary scanner over a Skill; a release named it, but it gets no privileged path."""
    try:
        return scan_skill(root)
    except ValidationError as error:
        raise ValidationError(
            f"the starter Skill obtained from {source} is not a Skill Techtree would accept "
            f"from anyone: {error.message}",
            code=STARTER_SKILL_SOURCE_REFUSED,
            details={"source": source},
        ) from error


def _root_digest(scan: SkillScanResult) -> Digest:
    return skill_content_digest(
        [
            SkillFile(
                path=item.relative_path.as_posix(),
                media_type=item.media_type,
                size=item.size,
                digest=item.digest,
            )
            for item in scan.files
        ]
    )


def _describe(
    scan: SkillScanResult, *, origin: Literal["cache", "release"]
) -> MaterializedStarterSkill:
    return MaterializedStarterSkill(
        root=scan.root,
        entrypoint=scan.root / SKILL_ENTRY_FILE,
        root_digest=_root_digest(scan),
        file_count=len(scan.files),
        total_bytes=sum(item.size for item in scan.files),
        origin=origin,
    )


def _download_document(url: str) -> bytes:
    """Fetch one document over https, bounded; the digest check afterwards is what buys trust."""
    request = urllib.request.Request(
        url, method="GET", headers={"Accept": "text/markdown, text/plain, */*"}
    )
    try:
        with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            data: bytes = response.read(MAX_SKILL_TOTAL_BYTES + 1)
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise PrerequisiteError(
            f"the starter Skill could not be fetched from {url}: "
            f"{getattr(error, 'reason', None) or error}",
            code=STARTER_SKILL_SOURCE_REFUSED,
            details={"url": url},
        ) from error
    if len(data) > MAX_SKILL_TOTAL_BYTES:
        raise ValidationError(
            f"{url} served more than the {MAX_SKILL_TOTAL_BYTES} bytes a Skill may hold, so it "
            "is not the starter Skill",
            code=STARTER_SKILL_SOURCE_REFUSED,
            details={"url": url, "maximum_total_bytes": MAX_SKILL_TOTAL_BYTES},
        )
    return data
