"""Whether this machine can reach the subject model on a route, and what a child may inherit.

A run reaches the subject model on one of two routes, both paid for by the person running it:

- Own Prime key: read the way Prime reads it, `PRIME_API_KEY` when this shell sets it, else the
  Prime CLI configuration `~/.prime/config.json` that `prime login` writes. The file is found,
  never opened.
- ChatGPT plan: the sign-in `regents techtree model login` saved. Whether it is set up is read
  from that file alone, with no network call.

A secret is checked, never carried: nothing here returns a credential value or puts one in a
message, a detail or a log line. Each check is the subject model's, unrelated to whatever the
person's own agent is signed in with, and the wording keeps the two apart. The pinned client
returns the literal `"EMPTY"` when it finds no Prime key, so a missing key would fail at the
first model call, after the containers are up; that is why a run checks its route first.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Final

from regents_cli.techtree.chatgpt.signin import MODEL_SIGN_IN_REQUIRED, local_sign_in
from regents_cli.techtree.errors import AuthenticationError, UsageError
from regents_cli.techtree.models.base import NonEmptyString, ProtocolModel
from regents_cli.techtree.models.campaign import ModelAccess
from regents_cli.techtree.models.engine import EngineInstallation

PRIME_KEY_MISSING: Final = "prime_key_missing"
MODEL_ACCESS_REQUIRED: Final = "model_access_required"
MODEL_ACCESS_NOT_OFFERED: Final = "model_access_not_offered"

PRIME_KEY_ENV: Final = "PRIME_API_KEY"
PRIME_CONFIG_RELATIVE_PATH: Final = (".prime", "config.json")

#: What each route is called wherever a person reads it.
ROUTE_NAMES: Final[dict[ModelAccess, str]] = {
    "chatgpt_plan": "ChatGPT plan",
    "prime_key": "own Prime key",
}

#: The only host variables a child inherits: PATH so system tools and the container runtime
#: resolve, HOME because the Prime CLI configuration hangs off it, TMPDIR for scratch files.
_BASE_ENVIRONMENT: Final[tuple[str, ...]] = ("PATH", "HOME", "TMPDIR")


class RouteStatus(ProtocolModel):
    """Whether one route is set up on this machine, and in what words; never a value."""

    access: ModelAccess
    ready: bool
    detail: NonEmptyString


def route_status(access: ModelAccess, home: Path) -> RouteStatus:
    """Whether `access` is set up here, read without opening a key or calling a network."""
    if access == "prime_key":
        if os.environ.get(PRIME_KEY_ENV):
            return RouteStatus(access=access, ready=True, detail=f"set up ({PRIME_KEY_ENV})")
        if Path.home().joinpath(*PRIME_CONFIG_RELATIVE_PATH).is_file():
            return RouteStatus(access=access, ready=True, detail="set up (prime login)")
        return RouteStatus(
            access=access,
            ready=False,
            detail=f"not set up: set {PRIME_KEY_ENV} or run `prime login`",
        )
    try:
        sign_in = local_sign_in(home)
    except AuthenticationError:
        return RouteStatus(
            access=access,
            ready=False,
            detail="not set up: the saved sign-in can't be read; run "
            "`regents techtree model login`",
        )
    if sign_in is None:
        return RouteStatus(
            access=access, ready=False, detail="not set up: run `regents techtree model login`"
        )
    if not sign_in.ready:
        return RouteStatus(
            access=access,
            ready=False,
            detail=f"signed in as {sign_in.email}, but the sign-in has lapsed: run "
            "`regents techtree model login`",
        )
    return RouteStatus(access=access, ready=True, detail=f"signed in as {sign_in.email}")


def require_route(access: ModelAccess, home: Path) -> RouteStatus:
    """The route's status, or a refusal to go further on a route that is not set up."""
    status = route_status(access, home)
    if status.ready:
        return status
    if access == "prime_key":
        raise AuthenticationError(
            f"the subject model's own-Prime-key route is {status.detail}. This key pays for "
            "the evaluated subject's model calls; it is separate from whatever your own agent "
            "is signed in with.",
            code=PRIME_KEY_MISSING,
        )
    raise AuthenticationError(
        f"the subject model's ChatGPT plan route is {status.detail}.",
        code=MODEL_SIGN_IN_REQUIRED,
    )


def choose_route(
    offered: list[ModelAccess], requested: ModelAccess | None, home: Path
) -> RouteStatus:
    """The route a run uses: the one asked for, or the only one offered, and set up here."""
    if requested is None:
        if len(offered) > 1:
            listed = " / ".join(
                f"{ROUTE_NAMES[access]}: {route_status(access, home).detail}" for access in offered
            )
            raise UsageError(
                "this Climb runs on more than one route; choose one with --access "
                f"{' or '.join(_flag(access) for access in offered)} ({listed})",
                code=MODEL_ACCESS_REQUIRED,
                details={
                    "offered": list(offered),
                    "ready": [access for access in offered if route_status(access, home).ready],
                },
            )
        requested = offered[0]
    if requested not in offered:
        raise UsageError(
            f"this Climb does not run on the {ROUTE_NAMES[requested]}; it offers "
            f"{', '.join(ROUTE_NAMES[access] for access in offered)}",
            code=MODEL_ACCESS_NOT_OFFERED,
            details={"requested": requested, "offered": list(offered)},
        )
    return require_route(requested, home)


def prime_key_environment() -> dict[str, str]:
    """`PRIME_API_KEY` when this shell sets it, for the child's client to read as Prime does;
    otherwise nothing, and the client reads the Prime CLI configuration under HOME."""
    key = os.environ.get(PRIME_KEY_ENV)
    return {PRIME_KEY_ENV: key} if key else {}


def scrubbed_child_environment(
    *, engine: EngineInstallation, extra: Mapping[str, str] | None = None
) -> dict[str, str]:
    """A Verifiers child's environment, built from an allow-list rather than copied.

    The engine's own `bin` goes first on PATH so the child resolves the pinned engine's tools
    before anything else installed on the machine. The only credential a child receives is the
    one its route passes in `extra`.
    """
    environment = {name: os.environ[name] for name in _BASE_ENVIRONMENT if name in os.environ}
    environment["PATH"] = _engine_first_path(engine, environment.get("PATH"))
    for name, value in (extra or {}).items():
        environment[name] = value
    return environment


def _flag(access: ModelAccess) -> str:
    return access.replace("_", "-")


def _engine_first_path(engine: EngineInstallation, inherited: str | None) -> str:
    engine_bin = str(Path(engine.python_executable).parent)
    if not inherited:
        return engine_bin
    entries = [engine_bin, *(part for part in inherited.split(os.pathsep) if part)]
    return os.pathsep.join(dict.fromkeys(entries))
