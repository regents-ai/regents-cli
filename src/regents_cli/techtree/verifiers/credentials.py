"""Whether the evaluation endpoint can authenticate.

A secret is checked, never carried: nothing here returns a credential value, writes one, or
puts one in a message, a detail or a log line. A real run reads the key from the Prime CLI
configuration, `~/.prime/config.json`, only; Techtree checks that the file is there and never
opens it, and the child's environment is an allow-list that carries no credential.

The credential pays for the evaluated subject's model calls. It is unrelated to whatever the
person's own agent is signed in with, and the wording of every message here keeps them apart.
The pinned client returns the literal `"EMPTY"` when it finds no key; a missing key therefore
fails at the first model call, after the container is up, which is why this runs before a
child is launched.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Final, Literal

from regents_cli.techtree.errors import AuthenticationError
from regents_cli.techtree.models.base import NonEmptyString, ProtocolModel
from regents_cli.techtree.models.campaign import ModelSpec
from regents_cli.techtree.models.engine import EngineInstallation

MODEL_CREDENTIALS_MISSING: Final = "model_credentials_missing"

PRIME_CREDENTIAL_ENV: Final = "PRIME_API_KEY"
PRIME_CONFIG_RELATIVE_PATH: Final = (".prime", "config.json")

#: The only host variables a child inherits: PATH so system tools and the container runtime
#: resolve, HOME because the Prime CLI configuration hangs off it, TMPDIR for scratch files.
_BASE_ENVIRONMENT: Final[tuple[str, ...]] = ("PATH", "HOME", "TMPDIR")


class CredentialStatus(ProtocolModel):
    """Whether one model endpoint can authenticate, and from where; never a value."""

    provider: NonEmptyString
    credential_env: NonEmptyString
    available: bool
    source: Literal["prime_config", "missing"]
    detail: NonEmptyString


def credential_status(model: ModelSpec) -> CredentialStatus:
    """Whether the Prime CLI configuration is present; its contents are never read."""
    name = model.credential_env
    if name == PRIME_CREDENTIAL_ENV and Path.home().joinpath(*PRIME_CONFIG_RELATIVE_PATH).is_file():
        return CredentialStatus(
            provider=model.provider,
            credential_env=name,
            available=True,
            source="prime_config",
            detail="the Prime CLI configuration is present; the pinned evaluation client "
            "resolves the key from it.",
        )
    return CredentialStatus(
        provider=model.provider,
        credential_env=name,
        available=False,
        source="missing",
        detail=f"no active Prime CLI configuration supplies {name}. This credential pays for "
        "the evaluated subject's model calls; it is separate from whatever your own agent is "
        "signed in with.",
    )


def require_credentials(model: ModelSpec) -> CredentialStatus:
    """The status, or a refusal to go further without a credential."""
    status = credential_status(model)
    if status.available:
        return status
    raise AuthenticationError(
        f"the evaluation model endpoint has no credential: {status.detail}",
        code=MODEL_CREDENTIALS_MISSING,
        details={
            "provider": model.provider,
            "model_id": model.model_id,
            "credential_env": model.credential_env,
        },
    )


def scrubbed_child_environment(
    *, engine: EngineInstallation, extra: Mapping[str, str] | None = None
) -> dict[str, str]:
    """A Verifiers child's environment, built from an allow-list rather than copied.

    The engine's own `bin` goes first on PATH so the child resolves the pinned engine's tools
    before anything else installed on the machine. No credential is forwarded: the pinned
    client reads the key from the Prime CLI configuration under HOME for itself.
    """
    environment = {name: os.environ[name] for name in _BASE_ENVIRONMENT if name in os.environ}
    environment["PATH"] = _engine_first_path(engine, environment.get("PATH"))
    for name, value in (extra or {}).items():
        environment[name] = value
    return environment


def _engine_first_path(engine: EngineInstallation, inherited: str | None) -> str:
    engine_bin = str(Path(engine.python_executable).parent)
    if not inherited:
        return engine_bin
    entries = [engine_bin, *(part for part in inherited.split(os.pathsep) if part)]
    return os.pathsep.join(dict.fromkeys(entries))
