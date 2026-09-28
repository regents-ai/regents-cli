"""Which engines are installed and where they live: `<home>/engines/sha256-<hex>/`.

An engine counts as installed only when its `installed.json` is present, parses, and names the
directory it sits in. That file is written last, after verification, so a directory left behind
by an interrupted install reads as absent, and the next install replaces it.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

from regents_cli.techtree.canonical import validate_digest
from regents_cli.techtree.engines.bundle import ENGINE_TOOLS, INSTALLATION_FILENAME
from regents_cli.techtree.errors import EngineError, NotFoundError, ValidationError
from regents_cli.techtree.fs import atomic_write_json
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.engine import EngineInstallation, EngineStatus
from regents_cli.techtree.paths import TechtreePaths

#: uv's project environment, relative to the engine root.
VENV_DIRECTORY: Final = ".venv"
_BIN_DIRECTORY: Final = "bin"
_TOOLS_DIRECTORY: Final = "tools"


class EngineRegistry:
    """Locates installed engines and their executables."""

    def __init__(self, paths: TechtreePaths) -> None:
        self._paths = paths

    def installed(self) -> list[Digest]:
        """The digests of complete installations."""
        if not self._paths.engines_dir.is_dir():
            return []
        found: list[Digest] = []
        for directory in sorted(self._paths.engines_dir.iterdir()):
            if not directory.is_dir():
                continue
            digest = digest_from_directory_name(directory.name)
            if digest is not None and self.installation(digest) is not None:
                found.append(digest)
        return found

    def installation(self, digest: Digest) -> EngineInstallation | None:
        """The recorded installation, or None; a record naming another engine is not this one's."""
        marker = self.path(digest) / INSTALLATION_FILENAME
        try:
            raw = marker.read_bytes()
        except (FileNotFoundError, NotADirectoryError):
            return None
        try:
            installation = EngineInstallation.model_validate_json(raw)
        except ValueError:
            return None
        return installation if installation.digest == digest else None

    def record(self, installation: EngineInstallation) -> None:
        """Write the installation marker that completes an install."""
        atomic_write_json(self.path(installation.digest) / INSTALLATION_FILENAME, installation)

    def path(self, digest: Digest) -> Path:
        return self._paths.engine_dir(validate_digest(digest))

    def python(self, digest: Digest) -> Path:
        """The engine's managed interpreter."""
        return self.path(digest) / VENV_DIRECTORY / _BIN_DIRECTORY / "python"

    def executable(self, digest: Digest, name: str) -> Path:
        """One console script inside the engine environment, by absolute path, never via PATH.

        The pinned Verifiers build installs its scripts under generic names such as `vf-eval`.
        """
        return self.path(digest) / VENV_DIRECTORY / _BIN_DIRECTORY / _plain(name)

    def tool_path(self, digest: Digest, tool: str) -> Path:
        """One helper shipped inside the bundle; only the declared helpers can be addressed."""
        if tool not in ENGINE_TOOLS:
            raise NotFoundError(
                f"the engine bundle ships no tool named {tool!r}",
                code="engine_tool_unknown",
                details={"tool": tool, "available": list(ENGINE_TOOLS)},
            )
        return self.path(digest) / _TOOLS_DIRECTORY / tool

    def status(self, digest: Digest) -> EngineStatus:
        """What is currently true about one engine."""
        installation = self.installation(digest)
        if installation is None:
            return EngineStatus(
                digest=digest,
                installed=False,
                verified=False,
                path=str(self.path(digest)),
                python_executable=None,
                detail="not installed",
            )
        return EngineStatus(
            digest=digest,
            installed=True,
            verified=installation.verified,
            path=str(self.path(digest)),
            python_executable=installation.python_executable,
            detail=(
                "installed and verified" if installation.verified else "installed but not verified"
            ),
        )


def _plain(name: str) -> str:
    """Reject anything that is not a bare file name."""
    if not name or "/" in name or name in {".", ".."}:
        raise EngineError(
            f"{name!r} is not an engine executable name",
            code="engine_executable_invalid",
            details={"name": name},
        )
    return name


def digest_from_directory_name(name: str) -> Digest | None:
    """The digest a directory name encodes, or None if it encodes none."""
    algorithm, separator, hexadecimal = name.partition("-")
    if separator != "-" or algorithm != "sha256":
        return None
    try:
        return validate_digest(f"{algorithm}:{hexadecimal}")
    except ValidationError:
        return None
