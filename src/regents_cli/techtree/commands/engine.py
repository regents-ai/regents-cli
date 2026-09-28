"""`regents techtree engine install | status | verify`: the pinned evaluation engine here."""

from __future__ import annotations

import click

from regents_cli.techtree import paths
from regents_cli.techtree.canonical import validate_digest
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.engines.bundle import default_engine_digest
from regents_cli.techtree.engines.installer import EngineInstaller, find_uv
from regents_cli.techtree.engines.registry import EngineRegistry
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.models.engine import EngineStatus

DIGEST = click.Argument(["digest"], required=False, metavar="[DIGEST]")


def install(digest: str | None, as_json: bool) -> None:
    home = paths.home()
    installer = EngineInstaller(home, EngineRegistry(home), find_uv())
    status = installer.install(None if digest is None else validate_digest(digest))
    _emit(
        status,
        f"Evaluation engine {status.digest} is installed and verified at {status.path}.",
        as_json=as_json,
    )


def status(digest: str | None, as_json: bool) -> None:
    home = paths.home()
    engine = EngineRegistry(home).status(_selected(digest))
    _emit(engine, f"Evaluation engine {engine.digest} is {engine.detail}.", as_json=as_json)


def verify(digest: str | None, as_json: bool) -> None:
    home = paths.home()
    installer = EngineInstaller(home, EngineRegistry(home), find_uv())
    engine = installer.verify(_selected(digest))
    _emit(
        engine,
        f"Evaluation engine {engine.digest} holds the files it was installed with and runs "
        "the pinned validator.",
        as_json=as_json,
    )


def engine_lines(status: EngineStatus) -> list[str]:
    """One engine's state, for a person."""
    lines = [
        f"- Engine: {status.digest}",
        f"- Location: {status.path}",
        f"- Installed: {'yes' if status.installed else 'no'}",
        f"- Verified: {'yes' if status.verified else 'no'}",
    ]
    if status.python_executable is not None:
        lines.append(f"- Python: {status.python_executable}")
    return lines


def _selected(digest: str | None) -> Digest:
    """The engine a command without an argument is about: the one this build ships."""
    return default_engine_digest() if digest is None else validate_digest(digest)


def _emit(status: EngineStatus, headline: str, *, as_json: bool) -> None:
    answer: dict[str, JsonValue] = status.model_dump(mode="json")
    answer["report"] = "\n".join([headline, "", *engine_lines(status)])
    emit(answer, as_json=as_json)


ENGINE = click.Group("engine", help="Install, inspect and verify the pinned evaluation engine.")
ENGINE.add_command(
    click.Command(
        "install",
        callback=install,
        help="Install the embedded engine into ~/.regents/techtree (runs `uv sync --frozen`).",
        params=[DIGEST, JSON],
    )
)
ENGINE.add_command(
    click.Command(
        "status",
        callback=status,
        help="Whether the engine is installed and verified here.",
        params=[DIGEST, JSON],
    )
)
ENGINE.add_command(
    click.Command(
        "verify",
        callback=verify,
        help="Recompute the installed bundle's digest and check the live environment.",
        params=[DIGEST, JSON],
    )
)
