"""Stamp the source commit into the wheel while the wheel is being built.

One git question, answered only when it is beyond doubt: `git rev-parse HEAD` gives the
candidate, and every path the wheel packages must be exactly what that commit holds. If git is
missing, there is no commit, or one packaged file differs by a byte, the build fails and says
which. An editable install is the working tree, not an artifact, and is not stamped.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Final

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

#: Everything a built wheel is made of. The stamp claims these are the named commit's.
PACKAGED_PATHS: Final = ("src/regents_cli", "pyproject.toml", "README.md", "LICENSE")

#: Inside the package so the wheel carries it; in .gitignore so it is never committed.
STAMP_PATH: Final = "src/regents_cli/techtree/resources/release/build-provenance.json"

EDITABLE: Final = "editable"


class StampProvenanceHook(BuildHookInterface):  # type: ignore[type-arg]
    """Write the source commit into the package before the wheel is zipped."""

    PLUGIN_NAME = "custom"

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        stamp = Path(self.root) / STAMP_PATH
        stamp.unlink(missing_ok=True)
        if version == EDITABLE:
            return
        stamp.write_bytes(_stamp_bytes(source_commit(Path(self.root))))

    def finalize(self, version: str, build_data: dict[str, Any], artifact_path: str) -> None:
        """Leave the working tree as it was found."""
        (Path(self.root) / STAMP_PATH).unlink(missing_ok=True)


def source_commit(root: Path) -> str:
    """The commit this tree is, refusing anything less than certainty."""
    commit = _git(root, "rev-parse", "--verify", "HEAD^{commit}").strip()
    if len(commit) != 40 or not all(c in "0123456789abcdef" for c in commit):
        raise BuildProvenanceError(
            f"git named the source commit as {commit!r}, which is not a full 40-character commit"
        )
    changed = _git(root, "status", "--porcelain", "--untracked-files=all", "--", *PACKAGED_PATHS)
    if changed:
        # Porcelain lines are two status characters, a space, then the path.
        paths = ", ".join(sorted(line.split(maxsplit=1)[-1] for line in changed.splitlines()))
        raise BuildProvenanceError(
            f"this wheel would be stamped {commit}, but it is not built from that commit: "
            f"{paths} differ from it. Commit the tree, then build; a wheel may only claim a "
            "commit it really holds."
        )
    return commit


class BuildProvenanceError(RuntimeError):
    """The build cannot establish which commit it is building."""


def _git(root: Path, *arguments: str) -> str:
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), *arguments], capture_output=True, check=False, text=True
        )
    except OSError as error:
        raise BuildProvenanceError(
            "git is not available, so this build cannot establish which commit it is building "
            f"from: {error}"
        ) from error
    if completed.returncode != 0:
        raise BuildProvenanceError(
            f"`git {' '.join(arguments)}` failed in {root}, so this build cannot establish which "
            f"commit it is building from: {completed.stderr.strip()}"
        )
    # Only the trailing newline goes: porcelain status lines begin with significant spaces.
    return completed.stdout.rstrip("\n")


def _stamp_bytes(commit: str) -> bytes:
    """The stamp exactly as the package reads it back."""
    document = {"schema_version": "techtree.build-provenance.v1", "source_commit": commit}
    text = json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False)
    return f"{text}\n".encode()
