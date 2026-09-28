"""Where Techtree keeps its state: `~/.regents/techtree`.

The identity key is created by whatever first signs (`identities/`), never by the layout, so a
machine without a key doesn't look as though it holds one.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from regents_cli import siwa
from regents_cli.techtree.canonical import validate_digest
from regents_cli.techtree.errors import PrerequisiteError
from regents_cli.techtree.fs import ensure_private_directory
from regents_cli.techtree.ids import validate_id
from regents_cli.techtree.models.base import Digest


@dataclass(frozen=True)
class TechtreePaths:
    """Every directory Techtree owns, derived from one root."""

    root: Path

    @property
    def cache_dir(self) -> Path:
        return self.root / "cache"

    @property
    def drafts_dir(self) -> Path:
        return self.root / "drafts"

    @property
    def runs_dir(self) -> Path:
        return self.root / "runs"

    @property
    def engines_dir(self) -> Path:
        return self.root / "engines"

    @property
    def identities_dir(self) -> Path:
        return self.root / "identities"

    @property
    def forge_dir(self) -> Path:
        return self.root / "forge"

    def draft_dir(self, draft_id: str) -> Path:
        return self.drafts_dir / validate_id(draft_id, "draft")

    def run_dir(self, run_id: str) -> Path:
        return self.runs_dir / validate_id(run_id, "run")

    def skills_cache_dir(self) -> Path:
        return self.cache_dir / "skills"

    def skill_cache_dir(self, digest: Digest) -> Path:
        """A materialized Skill, in a directory named by its root digest."""
        return self.skills_cache_dir() / _digest_dirname(digest)

    def engine_dir(self, digest: Digest) -> Path:
        """One engine install, in a directory named by its bundle digest."""
        return self.engines_dir / _digest_dirname(digest)

    def _forge(self, kind: str, record_id: str, prefix: str) -> Path:
        return self.forge_dir / kind / validate_id(record_id, prefix)

    def forge_run_dir(self, run_id: str) -> Path:
        return self._forge("runs", run_id, "forgerun")

    def forge_comparison_dir(self, comparison_id: str) -> Path:
        return self._forge("comparisons", comparison_id, "forgecmp")

    def forge_revision_dir(self, revision_id: str) -> Path:
        return self._forge("revisions", revision_id, "forgerev")

    def forge_source_dir(self, source_id: str) -> Path:
        return self._forge("sources", source_id, "forgesrc")

    def forge_plan_dir(self, plan_id: str) -> Path:
        return self._forge("plans", plan_id, "forgeplan")

    def forge_proposal_dir(self, proposal_id: str) -> Path:
        return self._forge("proposals", proposal_id, "forgeprop")

    def forge_construction_dir(self, construction_id: str) -> Path:
        return self._forge("constructions", construction_id, "forgecon")

    def forge_collection_dir(self, collection_id: str) -> Path:
        return self._forge("collections", collection_id, "forgecol")


def _digest_dirname(digest: Digest) -> str:
    """`sha256-<hex>`: a colon isn't a legal file-name character everywhere."""
    return validate_digest(digest).replace(":", "-", 1)


def home() -> TechtreePaths:
    """This machine's Techtree home, with its top-level directories made private."""
    paths = TechtreePaths(root=siwa.home() / "techtree")
    try:
        for directory in (
            paths.root,
            paths.cache_dir,
            paths.drafts_dir,
            paths.runs_dir,
            paths.engines_dir,
        ):
            ensure_private_directory(directory)
    except OSError as error:
        raise PrerequisiteError(
            f"cannot create the Techtree home {paths.root}: {error.strerror}",
            code="techtree_home_unusable",
            details={"path": str(paths.root)},
        ) from error
    return paths
