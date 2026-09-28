"""The managed Verifiers engine bundle and the one host-platform vocabulary.

The bundle's digest covers its static files and is never stored inside the descriptor, because
a document cannot contain its own hash.
"""

from __future__ import annotations

from typing import Final, Literal, Self

from pydantic import model_validator

from regents_cli.techtree.errors import PrerequisiteError
from regents_cli.techtree.models.base import (
    Digest,
    NonEmptyString,
    ProtocolModel,
    StateModel,
    UtcDateTime,
)

type HostPlatform = Literal["darwin/amd64", "darwin/arm64", "linux/amd64", "linux/arm64"]

_ARCHITECTURES: Final[dict[str, str]] = {
    "aarch64": "arm64",
    "amd64": "amd64",
    "arm64": "arm64",
    "x86_64": "amd64",
}

#: A table rather than string concatenation, so only the four protocol values can come out.
_HOST_PLATFORMS: Final[dict[tuple[str, str], HostPlatform]] = {
    ("darwin", "amd64"): "darwin/amd64",
    ("darwin", "arm64"): "darwin/arm64",
    ("linux", "amd64"): "linux/amd64",
    ("linux", "arm64"): "linux/arm64",
}


def normalize_host_platform(sys_platform: str, machine: str) -> HostPlatform:
    """Return the `<os>/<arch>` name for a host, or refuse rather than guess."""
    operating_system = sys_platform.strip().lower()
    architecture = _ARCHITECTURES.get(machine.strip().lower(), "")
    normalized = _HOST_PLATFORMS.get((operating_system, architecture))
    if normalized is None:
        raise PrerequisiteError(
            f"unsupported host platform {sys_platform}/{machine}; Techtree supports darwin "
            "and linux on arm64 and amd64",
            code="unsupported_host_platform",
            details={"sys_platform": sys_platform, "machine": machine},
        )
    return normalized


class EnginePackage(ProtocolModel):
    """One package shipped inside the engine bundle."""

    name: NonEmptyString
    version: NonEmptyString
    source_digest: Digest


class EngineDescriptor(ProtocolModel):
    """What one engine bundle is, without saying what it hashes to."""

    schema_version: Literal["techtree.engine.v1alpha1"]
    name: NonEmptyString
    python_version: NonEmptyString
    verifiers_version: NonEmptyString
    verifiers_revision: NonEmptyString
    supported_hosts: list[HostPlatform]
    packages: list[EnginePackage]

    @model_validator(mode="after")
    def _check_hosts_and_packages_are_listed_once(self) -> Self:
        if not self.supported_hosts:
            raise ValueError("an engine must support at least one host platform")
        if len(set(self.supported_hosts)) != len(self.supported_hosts):
            raise ValueError("supported_hosts must not repeat a platform")
        names = [package.name for package in self.packages]
        if len(set(names)) != len(names):
            raise ValueError("an engine ships each package exactly once")
        return self


class EngineInstallation(StateModel):
    """A locally installed engine, as the registry records it."""

    digest: Digest
    installed_at: UtcDateTime
    python_executable: NonEmptyString
    descriptor_digest: Digest
    verified: bool


class EngineStatus(ProtocolModel):
    """What the CLI reports about one engine."""

    digest: Digest
    installed: bool
    verified: bool
    path: NonEmptyString
    python_executable: NonEmptyString | None
    detail: NonEmptyString

    @model_validator(mode="after")
    def _check_status_is_coherent(self) -> Self:
        if not self.installed and self.verified:
            raise ValueError("an engine that is not installed cannot be verified")
        return self
