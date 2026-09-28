"""Running one command inside the managed engine.

Executables are addressed by absolute path, never through PATH: the pinned Verifiers build
installs console scripts under generic names such as `vf-eval`. The child gets `PATH`, `HOME` and
`TMPDIR` plus whatever the caller passes by name; every other parent variable (API keys, tokens,
cloud credentials) is dropped, so a model-free engine command cannot leak one.
"""

from __future__ import annotations

import os
import subprocess
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from regents_cli.techtree.engines.registry import EngineRegistry
from regents_cli.techtree.errors import EngineError
from regents_cli.techtree.models.base import Digest

#: The only variables an engine process inherits from its parent.
INHERITED_ENVIRONMENT: Final[tuple[str, ...]] = ("PATH", "HOME", "TMPDIR")

_TECHTREE_PREFIX: Final = "TECHTREE_"


@dataclass(frozen=True)
class EngineProcessResult:
    """What one engine command did; an exit code is data here, never a verdict."""

    argv: tuple[str, ...]
    exit_code: int
    stdout: str
    stderr: str
    duration_seconds: float


class EngineRunner:
    """Runs commands inside one installed engine."""

    def __init__(self, registry: EngineRegistry, digest: Digest) -> None:
        self._registry = registry
        self._digest = digest

    def run(
        self,
        executable: str,
        args: Sequence[str],
        *,
        timeout: float,
        env: Mapping[str, str] | None = None,
        cwd: Path | None = None,
    ) -> EngineProcessResult:
        """Run one console script from the engine environment."""
        return self._execute(
            [str(self._registry.executable(self._digest, executable)), *args],
            timeout=timeout,
            env=env,
            cwd=cwd,
        )

    def run_python_script(
        self,
        script: Path,
        args: Sequence[str],
        *,
        timeout: float,
        env: Mapping[str, str] | None = None,
    ) -> EngineProcessResult:
        """Run one Python file with the engine's own interpreter."""
        return self._execute(
            [str(self._registry.python(self._digest)), str(script), *args],
            timeout=timeout,
            env=env,
        )

    def _execute(
        self,
        argv: Sequence[str],
        *,
        timeout: float,
        env: Mapping[str, str] | None,
        cwd: Path | None = None,
    ) -> EngineProcessResult:
        program = Path(argv[0])
        if not program.is_file():
            raise EngineError(
                f"engine {self._digest} has no executable at {program}; install the engine again",
                code="engine_executable_missing",
                details={"digest": self._digest, "path": str(program)},
            )
        started = time.monotonic()
        try:
            completed = subprocess.run(
                list(argv),
                capture_output=True,
                text=True,
                check=False,
                timeout=timeout,
                stdin=subprocess.DEVNULL,
                env=engine_environment(env),
                cwd=None if cwd is None else str(cwd),
            )
        except subprocess.TimeoutExpired as error:
            raise EngineError(
                f"engine command did not finish within {timeout:.0f}s: {program.name}",
                code="engine_command_timeout",
                details={"digest": self._digest, "timeout_seconds": timeout},
            ) from error
        except OSError as error:
            raise EngineError(
                f"engine command could not be started: {error.strerror or error}",
                code="engine_command_unusable",
                details={"digest": self._digest, "path": str(program)},
            ) from error
        return EngineProcessResult(
            argv=tuple(argv),
            exit_code=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
            duration_seconds=time.monotonic() - started,
        )


def engine_environment(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    """The minimal environment an engine process runs in."""
    environment = {name: os.environ[name] for name in INHERITED_ENVIRONMENT if name in os.environ}
    for name, value in (extra or {}).items():
        if not name.startswith(_TECHTREE_PREFIX) and name not in INHERITED_ENVIRONMENT:
            raise EngineError(
                f"{name} cannot be passed to an engine process; only {_TECHTREE_PREFIX}* "
                f"variables and {', '.join(INHERITED_ENVIRONMENT)} are allowed",
                code="engine_environment_rejected",
                details={"variable": name},
            )
        environment[name] = value
    return environment
