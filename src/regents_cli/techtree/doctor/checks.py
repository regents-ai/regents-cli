"""One function per thing that can be wrong with a host.

No check raises: Doctor reports every problem at once. `blocking` is a claim about this
moment: Python and a usable home block everything, the evaluation checks block only when a run
is about to spend money, and the Hermes checks are observations that never make a ready host
unready. Every external tool runs as an argument vector with stdin closed and a timeout, so no
probe can block on a prompt.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, Self

from pydantic import Field, model_validator

from regents_cli.techtree.engines.bundle import read_engine_descriptor, shipped_engines
from regents_cli.techtree.engines.registry import EngineRegistry
from regents_cli.techtree.errors import PrerequisiteError, ValidationError
from regents_cli.techtree.models.base import Digest, JsonValue, NonEmptyString, ProtocolModel
from regents_cli.techtree.models.campaign import (
    SUBJECT_AGENT,
    CampaignSpecV3,
    ModelSpec,
)
from regents_cli.techtree.models.engine import normalize_host_platform
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.verifiers.child import EVAL_EXECUTABLE
from regents_cli.techtree.verifiers.credentials import credential_status
from regents_cli.techtree.verifiers.image import pinned_images, resolve_images
from regents_cli.techtree.verifiers.models import VariantName

VERSION_TIMEOUT_SECONDS: Final = 10.0
#: Reaching the Docker daemon can involve starting a VM on macOS.
DAEMON_TIMEOUT_SECONDS: Final = 20.0
SUPPORTED_PYTHON: Final[tuple[tuple[int, int], tuple[int, int]]] = ((3, 12), (3, 14))
TECHTREE_PLUGIN_NAME: Final = "techtree"
START_PAGE_URL: Final = "https://techtree.sh/start"
DEVELOPMENT_PLACEHOLDER_MARKERS: Final[tuple[str, ...]] = (
    "development-placeholder",
    "not-executed",
)

_PRIVATE_DIRECTORY_MODE: Final = 0o700
_ENABLED: Final = "enabled"
_NOT_ENABLED: Final[frozenset[str]] = frozenset({"not enabled", "disabled"})
_SUPPORTED_SUBJECT_PLATFORMS: Final[tuple[str, ...]] = ("linux/arm64", "linux/amd64")


class CheckStatus(StrEnum):
    """The outcome of one Doctor check."""

    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"
    SKIP = "skip"


class DoctorCheck(ProtocolModel):
    """One environment check and what it found."""

    id: NonEmptyString
    label: NonEmptyString
    status: CheckStatus
    detail: NonEmptyString
    blocking: bool = False
    metadata: dict[str, JsonValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_blocking_implies_failure(self) -> Self:
        if self.blocking and self.status in (CheckStatus.PASS, CheckStatus.SKIP):
            raise ValueError("a blocking check must report a failure")
        return self


@dataclass(frozen=True)
class _Probe:
    """What running one external tool told us; `output` is the first non-blank line."""

    executable: str | None
    exit_code: int | None
    output: str
    stdout: str
    timed_out: bool

    @property
    def succeeded(self) -> bool:
        return self.exit_code == 0


def _probe(argv: list[str], *, timeout: float) -> _Probe:
    """Run one argument vector with stdin closed and a hard timeout."""
    executable = shutil.which(argv[0])
    if executable is None:
        return _Probe(executable=None, exit_code=None, output="", stdout="", timed_out=False)
    try:
        completed = subprocess.run(
            [executable, *argv[1:]],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        return _Probe(executable=executable, exit_code=None, output="", stdout="", timed_out=True)
    except OSError as error:
        return _Probe(
            executable=executable,
            exit_code=None,
            output=str(error.strerror or error),
            stdout="",
            timed_out=False,
        )
    return _Probe(
        executable=executable,
        exit_code=completed.returncode,
        output=_first_line(completed.stdout) or _first_line(completed.stderr),
        stdout=completed.stdout,
        timed_out=False,
    )


def _first_line(text: str) -> str:
    for line in text.splitlines():
        if line.strip():
            return line.strip()
    return ""


def _probe_failure_detail(name: str, probe: _Probe) -> str:
    if probe.timed_out:
        return f"{name} did not answer within the time allowed"
    if probe.output:
        return f"{name} failed: {probe.output}"
    return f"{name} failed with exit code {probe.exit_code}"


def detect_host_platform() -> str | None:
    """The normalized `<os>/<arch>` host name, or None if unsupported."""
    try:
        return normalize_host_platform(sys.platform, platform.machine())
    except PrerequisiteError:
        return None


def check_python_version() -> DoctorCheck:
    """Require Python >=3.12,<3.14."""
    version = platform.python_version()
    minimum, exclusive_maximum = SUPPORTED_PYTHON
    supported = minimum <= sys.version_info[:2] < exclusive_maximum
    detail = (
        f"Python {version}"
        if supported
        else (
            f"Python {version} is outside the supported range "
            f">={minimum[0]}.{minimum[1]},<{exclusive_maximum[0]}.{exclusive_maximum[1]}"
        )
    )
    return DoctorCheck(
        id="python_version",
        label="Python version",
        status=CheckStatus.PASS if supported else CheckStatus.FAIL,
        detail=detail,
        blocking=not supported,
        metadata={"python_version": version, "executable": sys.executable},
    )


def check_host_platform(host_platform: str | None) -> DoctorCheck:
    """Report the normalized host platform Techtree runs on."""
    if host_platform is None:
        return DoctorCheck(
            id="host_platform",
            label="Host platform",
            status=CheckStatus.FAIL,
            detail=(
                f"{sys.platform}/{platform.machine()} is not a supported host; Techtree "
                "supports darwin and linux on arm64 and amd64"
            ),
            blocking=True,
            metadata={"sys_platform": sys.platform, "machine": platform.machine()},
        )
    return DoctorCheck(
        id="host_platform",
        label="Host platform",
        status=CheckStatus.PASS,
        detail=host_platform,
        metadata={"host_platform": host_platform},
    )


def check_techtree_home(paths: TechtreePaths) -> DoctorCheck:
    """The home exists, is writable, and is private to this user."""
    root = paths.root
    metadata: dict[str, JsonValue] = {"path": str(root)}
    if not root.is_dir():
        return DoctorCheck(
            id="techtree_home",
            label="Techtree home",
            status=CheckStatus.FAIL,
            detail=f"{root} does not exist as a directory",
            blocking=True,
            metadata=metadata,
        )
    try:
        with tempfile.NamedTemporaryFile(dir=root, prefix=".doctor-", suffix=".probe"):
            pass
    except OSError as error:
        return DoctorCheck(
            id="techtree_home",
            label="Techtree home",
            status=CheckStatus.FAIL,
            detail=f"{root} is not writable: {error.strerror or error}",
            blocking=True,
            metadata=metadata,
        )
    mode = stat.S_IMODE(os.stat(root).st_mode)
    metadata["mode"] = f"0o{mode:03o}"
    if mode != _PRIVATE_DIRECTORY_MODE:
        return DoctorCheck(
            id="techtree_home",
            label="Techtree home",
            status=CheckStatus.WARN,
            detail=(
                f"{root} is writable but its permissions are 0o{mode:03o}; Techtree state is "
                "single-user and should be 0o700"
            ),
            metadata=metadata,
        )
    return DoctorCheck(
        id="techtree_home",
        label="Techtree home",
        status=CheckStatus.PASS,
        detail=f"{root} is writable and private",
        metadata=metadata,
    )


def check_uv_cli() -> DoctorCheck:
    """Find uv, which installs the managed engine; warning only."""
    probe = _probe(["uv", "--version"], timeout=VERSION_TIMEOUT_SECONDS)
    if probe.executable is None:
        return DoctorCheck(
            id="uv",
            label="uv",
            status=CheckStatus.WARN,
            detail="uv was not found on PATH; installing the managed evaluation engine requires it",
        )
    if not probe.succeeded:
        return DoctorCheck(
            id="uv",
            label="uv",
            status=CheckStatus.WARN,
            detail=_probe_failure_detail("uv", probe),
            metadata={"executable": probe.executable},
        )
    return DoctorCheck(
        id="uv",
        label="uv",
        status=CheckStatus.PASS,
        detail=probe.output or "uv is available",
        metadata={"executable": probe.executable, "version": probe.output},
    )


def check_docker(*, for_evaluation: bool) -> DoctorCheck:
    """The Docker daemon is reachable and serves a platform an evaluated subject can run on.

    An ordinary Doctor notes a missing or unreachable Docker; an evaluation Doctor stops on
    it, because the subject runs in a container and a run would otherwise fail after it began.
    """
    metadata: dict[str, JsonValue] = {"host_platform": detect_host_platform()}
    failure = CheckStatus.FAIL if for_evaluation else CheckStatus.WARN
    if shutil.which("docker") is None:
        return DoctorCheck(
            id="docker",
            label="Docker",
            status=failure,
            detail="docker was not found on PATH; an evaluated subject runs in a container here",
            blocking=for_evaluation,
            metadata=metadata,
        )
    probe = _probe(
        ["docker", "version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"],
        timeout=DAEMON_TIMEOUT_SECONDS,
    )
    if not probe.succeeded or not probe.output:
        return DoctorCheck(
            id="docker",
            label="Docker",
            status=failure,
            detail=_probe_failure_detail("the Docker daemon", probe),
            blocking=for_evaluation,
            metadata=metadata,
        )
    metadata["docker_platform"] = probe.output
    if for_evaluation and probe.output not in _SUPPORTED_SUBJECT_PLATFORMS:
        return DoctorCheck(
            id="docker",
            label="Docker",
            status=CheckStatus.FAIL,
            detail=(
                f"the Docker daemon serves {probe.output}; an evaluated subject needs one of "
                f"{', '.join(_SUPPORTED_SUBJECT_PLATFORMS)}"
            ),
            blocking=True,
            metadata=metadata,
        )
    return DoctorCheck(
        id="docker",
        label="Docker",
        status=CheckStatus.PASS,
        detail=f"reachable, serving {probe.output}",
        metadata=metadata,
    )


def check_hermes_cli() -> DoctorCheck:
    """Find Hermes; warning only, because the command line works without it."""
    probe = _probe(["hermes", "--version"], timeout=VERSION_TIMEOUT_SECONDS)
    if probe.executable is None:
        return DoctorCheck(
            id="hermes",
            label="Hermes",
            status=CheckStatus.WARN,
            detail=(
                "hermes was not found on PATH. Techtree runs inside Hermes, an open-source agent "
                "made by Nous Research; the command line also works on its own. The pinned "
                f"installation guide for this release is {START_PAGE_URL}"
            ),
        )
    if not probe.succeeded:
        return DoctorCheck(
            id="hermes",
            label="Hermes",
            status=CheckStatus.WARN,
            detail=_probe_failure_detail("hermes", probe),
            metadata={"executable": probe.executable},
        )
    return DoctorCheck(
        id="hermes",
        label="Hermes",
        status=CheckStatus.PASS,
        detail=probe.output or "hermes is available",
        metadata={"executable": probe.executable, "version": probe.output},
    )


def check_hermes_plugin() -> DoctorCheck:
    """Whether the Techtree plugin is installed and switched on for the Hermes on PATH.

    A listing this build cannot read is reported as unknown, never guessed at: an unfounded
    "not installed" sends someone to reinstall what they have.
    """
    if shutil.which("hermes") is None:
        return DoctorCheck(
            id="hermes_plugin",
            label="Techtree plugin",
            status=CheckStatus.SKIP,
            detail="Skipped because the hermes executable was not found",
        )
    probe = _probe(["hermes", "plugins", "list", "--json"], timeout=VERSION_TIMEOUT_SECONDS)
    listing = _plugin_states(probe)
    if listing is None:
        return DoctorCheck(
            id="hermes_plugin",
            label="Techtree plugin",
            status=CheckStatus.SKIP,
            detail="Skipped because this Hermes did not return a plugin list this build can read",
            metadata={"timed_out": probe.timed_out, "exit_code": probe.exit_code},
        )
    if TECHTREE_PLUGIN_NAME not in listing:
        return DoctorCheck(
            id="hermes_plugin",
            label="Techtree plugin",
            status=CheckStatus.WARN,
            detail=(
                "The Techtree plugin is not installed for this Hermes. The command line works "
                "without it, and installing it is what lets your agent drive Techtree for you. "
                f"The pinned installation guide for this release is {START_PAGE_URL}"
            ),
            metadata={"plugin_name": TECHTREE_PLUGIN_NAME, "installed": False},
        )
    state = listing[TECHTREE_PLUGIN_NAME]
    if state == _ENABLED:
        return DoctorCheck(
            id="hermes_plugin",
            label="Techtree plugin",
            status=CheckStatus.PASS,
            detail="The Techtree plugin is installed and switched on for this Hermes",
            metadata={"plugin_name": TECHTREE_PLUGIN_NAME, "installed": True, "enabled": True},
        )
    if state in _NOT_ENABLED:
        return DoctorCheck(
            id="hermes_plugin",
            label="Techtree plugin",
            status=CheckStatus.WARN,
            detail=(
                "The Techtree plugin is installed for this Hermes but is not switched on, so "
                "your agent cannot see Techtree's commands yet. Switch it on with: hermes "
                f"plugins enable {TECHTREE_PLUGIN_NAME}"
            ),
            metadata={"plugin_name": TECHTREE_PLUGIN_NAME, "installed": True, "enabled": False},
        )
    return DoctorCheck(
        id="hermes_plugin",
        label="Techtree plugin",
        status=CheckStatus.SKIP,
        detail=(
            "This Hermes lists the Techtree plugin but described its state in a word this "
            "build does not know, so whether it is switched on could not be established"
        ),
        metadata={"plugin_name": TECHTREE_PLUGIN_NAME, "installed": True},
    )


def _plugin_states(probe: _Probe) -> dict[str, str] | None:
    """Read `hermes plugins list --json` strictly: a list of objects with a name and a status."""
    if not probe.succeeded:
        return None
    try:
        document = json.loads(probe.stdout)
    except json.JSONDecodeError:
        return None
    if not isinstance(document, list):
        return None
    states: dict[str, str] = {}
    for entry in document:
        if not isinstance(entry, dict):
            return None
        name = entry.get("name")
        status = entry.get("status")
        if not isinstance(name, str) or not isinstance(status, str):
            return None
        states[name] = status.strip().lower()
    return states


def check_engine(paths: TechtreePaths) -> DoctorCheck:
    """Whether every engine this build ships is installed and verified here."""
    registry = EngineRegistry(paths)
    digests = list(shipped_engines())
    metadata: dict[str, JsonValue] = {"engine_digests": list(digests)}
    statuses = [registry.status(digest) for digest in digests]
    missing = [status.digest for status in statuses if not status.installed]
    if missing:
        return DoctorCheck(
            id="engine",
            label="Evaluation engines",
            status=CheckStatus.WARN,
            detail=f"{len(missing)} of the {len(digests)} evaluation engines are not installed "
            "yet; run regents techtree setup",
            metadata=metadata,
        )
    unverified = [status.digest for status in statuses if not status.verified]
    if unverified:
        return DoctorCheck(
            id="engine",
            label="Evaluation engines",
            status=CheckStatus.WARN,
            detail=f"engine {unverified[0]} is installed but not verified; run `regents techtree "
            "engine verify`",
            metadata=metadata,
        )
    return DoctorCheck(
        id="engine",
        label="Evaluation engines",
        status=CheckStatus.PASS,
        detail=f"all {len(digests)} evaluation engines are installed and verified",
        metadata=metadata,
    )


def check_engine_eval(paths: TechtreePaths) -> DoctorCheck:
    """Each verified engine's own `vf-eval` is where a real run will look for it."""
    registry = EngineRegistry(paths)
    checks = [_check_one_engine_eval(registry, digest) for digest in shipped_engines()]
    failed = [check for check in checks if check.status is not CheckStatus.PASS]
    if failed:
        return failed[0]
    return DoctorCheck(
        id="execution_engine_eval",
        label="Engine eval entrypoint",
        status=CheckStatus.PASS,
        detail="; ".join(check.detail for check in checks),
        metadata={"engine_digests": [check.metadata["engine_digest"] for check in checks]},
    )


def _check_one_engine_eval(registry: EngineRegistry, digest: Digest) -> DoctorCheck:
    status = registry.status(digest)
    metadata: dict[str, JsonValue] = {"engine_digest": digest}
    if not status.installed:
        return DoctorCheck(
            id="execution_engine_eval",
            label="Engine eval entrypoint",
            status=CheckStatus.FAIL,
            detail=f"engine {digest} is not installed",
            blocking=True,
            metadata=metadata,
        )
    if not status.verified:
        return DoctorCheck(
            id="execution_engine_eval",
            label="Engine eval entrypoint",
            status=CheckStatus.FAIL,
            detail=(
                f"engine {digest} is installed but has not been verified; a real run executes "
                "only a verified engine"
            ),
            blocking=True,
            metadata=metadata,
        )
    executable = registry.executable(digest, EVAL_EXECUTABLE)
    metadata["eval_executable"] = str(executable)
    if not executable.is_file():
        return DoctorCheck(
            id="execution_engine_eval",
            label="Engine eval entrypoint",
            status=CheckStatus.FAIL,
            detail=(
                f"engine {digest} has no {EVAL_EXECUTABLE} entrypoint at {executable}; install "
                "the engine again"
            ),
            blocking=True,
            metadata=metadata,
        )
    descriptor = read_engine_descriptor(registry.path(digest))
    metadata["verifiers_version"] = descriptor.verifiers_version
    metadata["verifiers_revision"] = descriptor.verifiers_revision
    return DoctorCheck(
        id="execution_engine_eval",
        label="Engine eval entrypoint",
        status=CheckStatus.PASS,
        detail=(
            f"{executable} is present, holding Verifiers {descriptor.verifiers_version} at "
            f"{descriptor.verifiers_revision}"
        ),
        metadata=metadata,
    )


def check_model_credential(model: ModelSpec) -> DoctorCheck:
    """Whether a run could authenticate; the credential is never read, only found."""
    status = credential_status(model)
    return DoctorCheck(
        id="execution_model_credential",
        label="Evaluation model credential",
        status=CheckStatus.PASS if status.available else CheckStatus.FAIL,
        detail=status.detail,
        blocking=not status.available,
        metadata={
            "provider": status.provider,
            "model_id": model.model_id,
            "credential_env": status.credential_env,
            "source": status.source,
        },
    )


def check_subject_images(campaign: CampaignSpecV3) -> DoctorCheck:
    """Whether every image the Campaign pins is on this machine, as pinned; nothing is pulled."""
    runtime = campaign.subject.runtime
    pins = pinned_images(runtime, campaign.taskset)
    metadata: dict[str, JsonValue] = {"images": len(pins)}
    try:
        resolution = resolve_images(runtime, campaign.taskset, VariantName.BASELINE)
    except ValidationError as refusal:
        image = str(refusal.details.get("image", pins[0].image))
        return DoctorCheck(
            id="execution_subject_image",
            label="Runtime images",
            status=CheckStatus.FAIL,
            detail=refusal.message,
            blocking=True,
            metadata={**metadata, "image": image, "pull": f"docker pull {image}"},
        )
    metadata["image_platform"] = resolution.platform
    return DoctorCheck(
        id="execution_subject_image",
        label="Runtime images",
        status=CheckStatus.PASS,
        detail=(
            f"the daemon holds all {len(pins)} pinned image(s) and serves them as "
            f"{resolution.platform}, which the Campaign pins manifest digests for"
        ),
        metadata=metadata,
    )


def check_live_campaign(campaign: CampaignSpecV3) -> DoctorCheck:
    """Refuse a Campaign whose coordinates are development placeholders."""
    subject = campaign.agents.get(SUBJECT_AGENT)
    metadata: dict[str, JsonValue] = {"campaign_id": campaign.metadata.id}
    if subject is None:
        return DoctorCheck(
            id="execution_live_campaign",
            label="Campaign is executable",
            status=CheckStatus.FAIL,
            detail=f"the Campaign defines no {SUBJECT_AGENT!r} agent to execute",
            blocking=True,
            metadata=metadata,
        )
    metadata["model_id"] = subject.model.model_id
    metadata["provider"] = subject.model.provider
    images = [pinned.image for pinned in pinned_images(subject.runtime, campaign.taskset)]
    metadata["images"] = len(images)
    placeholders = sorted(
        {
            f"{field}={value}"
            for field, value in (
                ("provider", subject.model.provider),
                ("model_id", subject.model.model_id),
                *(("image", image) for image in images),
            )
            for marker in DEVELOPMENT_PLACEHOLDER_MARKERS
            if marker in value
        }
    )
    if placeholders:
        return DoctorCheck(
            id="execution_live_campaign",
            label="Campaign is executable",
            status=CheckStatus.FAIL,
            detail=(
                "this Campaign carries development placeholders and must not be executed for "
                f"real: {', '.join(placeholders)}"
            ),
            blocking=True,
            metadata=metadata,
        )
    return DoctorCheck(
        id="execution_live_campaign",
        label="Campaign is executable",
        status=CheckStatus.PASS,
        detail=f"the Campaign names a real subject: {subject.model.model_id} on "
        f"{images[0] if len(images) == 1 else f'{len(images)} pinned images'}",
        metadata=metadata,
    )
