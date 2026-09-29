"""Turning the static bundle into a working environment.

Installing means: copy exactly the files the bundle digest covers, build an isolated environment
from the lock that shipped with them (`uv sync --frozen`, never a fresh resolution), ask that
environment what it is, and only then write `installed.json`. The environment is built at its
final content-addressed path because a virtual environment records absolute paths. A directory
without `installed.json` is not an installation: it is removed and built again.
"""

from __future__ import annotations

import json
import platform
import shutil
import subprocess
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib.resources.abc import Traversable
from pathlib import Path
from typing import Final

from filelock import FileLock, Timeout

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.engines.bundle import (
    copy_engine_bundle,
    engine_bundle_digest,
    read_engine_descriptor,
    shipped_engine_root,
)
from regents_cli.techtree.engines.registry import EngineRegistry
from regents_cli.techtree.errors import EngineError, PrerequisiteError, VerificationError
from regents_cli.techtree.fs import ensure_private_directory, remove_tree
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.engine import (
    EngineDescriptor,
    EngineInstallation,
    EngineStatus,
    normalize_host_platform,
)
from regents_cli.techtree.paths import TechtreePaths

#: A first install downloads several hundred megabytes of wheels; this ends a hung network call.
SYNC_TIMEOUT_SECONDS: Final = 1800.0
VERIFICATION_TIMEOUT_SECONDS: Final = 300.0
INSTALL_LOCK_FILENAME: Final = ".install.lock"
INSTALL_LOCK_TIMEOUT_SECONDS: Final = 1800.0

#: Asked of the engine, answered by the engine; passed with `-c` so it imports nothing of ours.
_VERIFICATION_QUERY: Final = """\
import importlib, json, platform, sys
from importlib.metadata import distribution

modules = {}
for name in sys.argv[1:]:
    modules[name] = getattr(importlib.import_module(name), "__file__", None)

verifiers = distribution("verifiers")
recorded = json.loads(verifiers.read_text("direct_url.json") or "{}")

json.dump(
    {
        "python_version": platform.python_version(),
        "python_executable": sys.executable,
        "verifiers_version": verifiers.version,
        "verifiers_commit": recorded.get("vcs_info", {}).get("commit_id"),
        "modules": modules,
    },
    sys.stdout,
)
"""

_OUTPUT_EXCERPT = 2000


@dataclass(frozen=True)
class EngineVerification:
    """What an installed engine says about itself."""

    python_version: str
    python_executable: str
    verifiers_version: str
    verifiers_commit: str
    modules: dict[str, str]


class EngineInstaller:
    """Installs and verifies the managed engine."""

    def __init__(self, paths: TechtreePaths, registry: EngineRegistry, uv_executable: Path) -> None:
        self._paths = paths
        self._registry = registry
        self._uv = uv_executable

    def install(self, digest: Digest) -> EngineStatus:
        """Copy, frozen-sync, verify and record one shipped engine; reuse one that answers."""
        root = shipped_engine_root(digest)
        descriptor = read_engine_descriptor(root)
        _require_supported_host(descriptor)
        ensure_private_directory(self._paths.engines_dir)
        with self._install_lock():
            if self._registry.installation(digest) is not None:
                verified = self._verified_status(digest, descriptor)
                if verified is not None:
                    return verified
            return self._install_fresh(root, descriptor, digest)

    def verify(self, digest: Digest) -> EngineStatus:
        """Verify the installed bundle's bytes and the live environment."""
        if self._registry.installation(digest) is None:
            raise EngineError(
                f"engine {digest} is not installed",
                code="engine_not_installed",
                details={"digest": digest, "path": str(self._registry.path(digest))},
            )
        installed_root = self._registry.path(digest)
        recomputed = engine_bundle_digest(installed_root)
        if recomputed != digest:
            raise VerificationError(
                f"the files of engine {digest} have changed since it was installed; they now "
                f"hash to {recomputed}",
                code="engine_bundle_modified",
                details={"expected": digest, "recomputed": recomputed},
            )
        self._check_environment(digest, read_engine_descriptor(installed_root))
        return self._registry.status(digest)

    def _install_fresh(
        self, root: Traversable, descriptor: EngineDescriptor, digest: Digest
    ) -> EngineStatus:
        """Build one engine from scratch at its content-addressed path."""
        destination = self._registry.path(digest)
        remove_tree(destination)
        try:
            copy_engine_bundle(root, destination)
            self._sync(destination, descriptor)
            verification = self._check_environment(digest, descriptor)
        except BaseException:
            remove_tree(destination)
            raise
        self._registry.record(
            EngineInstallation(
                digest=digest,
                installed_at=datetime.now(UTC),
                python_executable=verification.python_executable,
                descriptor_digest=digest_object(descriptor),
                verified=True,
            )
        )
        return self._registry.status(digest)

    def _sync(self, destination: Path, descriptor: EngineDescriptor) -> None:
        """Build the environment from the shipped lock and only from it."""
        completed = self._run(
            [
                str(self._uv),
                "sync",
                "--frozen",
                "--project",
                str(destination),
                "--python",
                descriptor.python_version,
            ],
            timeout=SYNC_TIMEOUT_SECONDS,
        )
        if completed.returncode == 0:
            return
        output = f"{completed.stdout}\n{completed.stderr}"
        if "uv.lock" in output or "lockfile" in output:
            raise EngineError(
                "the engine lock cannot be used with the engine project; the engine files at "
                f"{destination} are damaged or incomplete",
                code="engine_lock_mismatch",
                details={"path": str(destination), "detail": _excerpt(output)},
            )
        raise EngineError(
            f"building the engine environment failed: {_excerpt(completed.stderr)}",
            code="engine_sync_failed",
            details={"exit_code": completed.returncode},
        )

    def _check_environment(
        self, digest: Digest, descriptor: EngineDescriptor
    ) -> EngineVerification:
        """Ask the engine what it is, and refuse anything but the pinned answer."""
        verification = self._query(digest, descriptor)
        engine_root = self._registry.path(digest).resolve()
        _require(
            verification.python_version.startswith(f"{descriptor.python_version}."),
            f"engine runs Python {verification.python_version}, but the descriptor pins "
            f"{descriptor.python_version}",
            digest,
        )
        _require(
            verification.verifiers_version == descriptor.verifiers_version,
            f"engine holds Verifiers {verification.verifiers_version}, but the descriptor pins "
            f"{descriptor.verifiers_version}",
            digest,
        )
        _require(
            verification.verifiers_commit == descriptor.verifiers_revision,
            f"engine holds Verifiers commit {verification.verifiers_commit}, but the descriptor "
            f"pins {descriptor.verifiers_revision}",
            digest,
        )
        for package in descriptor.packages:
            location = verification.modules.get(_module_name(package.name))
            if location is None:
                raise EngineError(
                    f"package {package.name} did not report where it is installed",
                    code="engine_verification_mismatch",
                    details={"digest": digest, "package": package.name},
                )
            _require(
                Path(location).resolve().is_relative_to(engine_root),
                f"package {package.name} imports from {location}, which is outside the engine "
                f"at {engine_root}",
                digest,
            )
        return verification

    def _query(self, digest: Digest, descriptor: EngineDescriptor) -> EngineVerification:
        python = self._registry.python(digest)
        if not python.is_file():
            raise EngineError(
                f"engine {digest} has no interpreter at {python}",
                code="engine_python_missing",
                details={"digest": digest, "path": str(python)},
            )
        modules = [_module_name(package.name) for package in descriptor.packages]
        completed = self._run(
            [str(python), "-c", _VERIFICATION_QUERY, *modules], timeout=VERIFICATION_TIMEOUT_SECONDS
        )
        if completed.returncode != 0:
            raise EngineError(
                "the engine environment did not answer the verification query: "
                f"{_excerpt(completed.stderr)}",
                code="engine_verification_failed",
                details={"digest": digest, "exit_code": completed.returncode},
            )
        try:
            document = json.loads(completed.stdout)
            return EngineVerification(
                python_version=str(document["python_version"]),
                python_executable=str(document["python_executable"]),
                verifiers_version=str(document["verifiers_version"]),
                verifiers_commit=str(document["verifiers_commit"]),
                modules={
                    str(name): str(location)
                    for name, location in document["modules"].items()
                    if location is not None
                },
            )
        except (KeyError, TypeError, ValueError, AttributeError) as error:
            raise EngineError(
                f"the engine verification query returned unusable output: {error}",
                code="engine_verification_unreadable",
                details={"digest": digest},
            ) from error

    def _verified_status(self, digest: Digest, descriptor: EngineDescriptor) -> EngineStatus | None:
        """The status of an existing installation that still answers, else None."""
        try:
            self._check_environment(digest, descriptor)
        except EngineError:
            return None
        return self._registry.status(digest)

    @contextmanager
    def _install_lock(self) -> Iterator[None]:
        lock = FileLock(
            str(self._paths.engines_dir / INSTALL_LOCK_FILENAME),
            timeout=INSTALL_LOCK_TIMEOUT_SECONDS,
        )
        try:
            lock.acquire()
        except Timeout as error:
            raise EngineError(
                "another Techtree process is installing an engine",
                code="engine_install_locked",
                details={"path": str(self._paths.engines_dir)},
            ) from error
        try:
            yield
        finally:
            lock.release()

    def _run(self, argv: list[str], *, timeout: float) -> subprocess.CompletedProcess[str]:
        """Run one install step with the caller's own environment: uv needs the user's proxy,
        certificate, cache and index settings to reach a network the user can reach."""
        try:
            return subprocess.run(
                argv,
                capture_output=True,
                text=True,
                check=False,
                timeout=timeout,
                stdin=subprocess.DEVNULL,
            )
        except subprocess.TimeoutExpired as error:
            raise EngineError(
                f"engine installation step timed out after {timeout:.0f}s",
                code="engine_install_timeout",
                details={"timeout_seconds": timeout},
            ) from error
        except OSError as error:
            raise EngineError(
                f"engine installation step could not be started: {error.strerror or error}",
                code="engine_install_unusable",
                details={"argv0": argv[0]},
            ) from error


def find_uv() -> Path:
    """Locate uv, or say what is missing."""
    found = shutil.which("uv")
    if found is None:
        raise EngineError(
            "uv was not found on PATH; the managed evaluation engine is installed with uv "
            "(https://docs.astral.sh/uv/getting-started/installation/)",
            code="uv_not_found",
        )
    return Path(found)


def _require_supported_host(descriptor: EngineDescriptor) -> None:
    try:
        host = normalize_host_platform(sys.platform, platform.machine())
    except PrerequisiteError as error:
        raise EngineError(
            str(error), code="engine_host_unsupported", details=dict(error.details)
        ) from error
    if host not in descriptor.supported_hosts:
        raise EngineError(
            f"the managed engine does not support {host}; it supports "
            + ", ".join(descriptor.supported_hosts),
            code="engine_host_unsupported",
            details={"host_platform": host, "supported_hosts": list(descriptor.supported_hosts)},
        )


def _module_name(distribution_name: str) -> str:
    """Verifiers imports a package as its distribution name with hyphens as underscores."""
    return distribution_name.replace("-", "_")


def _require(condition: bool, message: str, digest: Digest) -> None:
    if not condition:
        raise EngineError(message, code="engine_verification_mismatch", details={"digest": digest})


def _excerpt(output: str) -> str:
    """The tail of a command's output, which is where the reason is."""
    text = output.strip()
    return text if len(text) <= _OUTPUT_EXCERPT else f"...{text[-_OUTPUT_EXCERPT:]}"
