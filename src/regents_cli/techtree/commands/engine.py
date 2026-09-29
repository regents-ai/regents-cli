"""`regents techtree engine install | status | verify`: the pinned evaluation engines here."""

from __future__ import annotations

import click

from regents_cli.techtree import paths
from regents_cli.techtree.canonical import validate_digest
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.engines.bundle import shipped_engines
from regents_cli.techtree.engines.installer import EngineInstaller, find_uv
from regents_cli.techtree.engines.registry import EngineRegistry
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.models.engine import EngineStatus

DIGEST = click.Argument(["digest"], required=False, metavar="[DIGEST]")


def install(digest: str | None, as_json: bool) -> None:
    home = paths.home()
    installer = EngineInstaller(home, EngineRegistry(home), find_uv())
    engines = [installer.install(selected) for selected in _selected(digest)]
    _emit(engines, "installed and verified", as_json=as_json)


def status(digest: str | None, as_json: bool) -> None:
    registry = EngineRegistry(paths.home())
    engines = [registry.status(selected) for selected in _selected(digest)]
    lines = [f"Evaluation engine {engine.digest} is {engine.detail}." for engine in engines]
    _emit_report(engines, lines, as_json=as_json)


def verify(digest: str | None, as_json: bool) -> None:
    home = paths.home()
    installer = EngineInstaller(home, EngineRegistry(home), find_uv())
    engines = [installer.verify(selected) for selected in _selected(digest)]
    _emit(
        engines,
        "unchanged since installation, with the pinned validator in place",
        as_json=as_json,
    )


def engine_lines(status: EngineStatus) -> list[str]:
    """One engine's state, for a person."""
    name = shipped_engines().get(status.digest)
    lines = [
        f"- Engine: {status.digest}" if name is None else f"- Engine: {name} ({status.digest})",
        f"- Location: {status.path}",
        f"- Installed: {'yes' if status.installed else 'no'}",
        f"- Verified: {'yes' if status.verified else 'no'}",
    ]
    if status.python_executable is not None:
        lines.append(f"- Python: {status.python_executable}")
    return lines


def _selected(digest: str | None) -> list[Digest]:
    """The engines a command is about: the one named, or every engine this build ships."""
    return list(shipped_engines()) if digest is None else [validate_digest(digest)]


def _emit(engines: list[EngineStatus], state: str, *, as_json: bool) -> None:
    count = (
        "The evaluation engine is"
        if len(engines) == 1
        else f"All {len(engines)} evaluation engines are"
    )
    _emit_report(engines, [f"{count} {state}."], as_json=as_json)


def _emit_report(engines: list[EngineStatus], headline: list[str], *, as_json: bool) -> None:
    answer: dict[str, JsonValue] = {
        "engines": [engine.model_dump(mode="json") for engine in engines]
    }
    sections = [line for engine in engines for line in ["", *engine_lines(engine)]]
    answer["report"] = "\n".join([*headline, *sections])
    emit(answer, as_json=as_json)


ENGINE = click.Group(
    "engine", help="Install, inspect and verify the pinned evaluation engines, one per Climb."
)
ENGINE.add_command(
    click.Command(
        "install",
        callback=install,
        help="Install the engines this build ships, or the one named, into ~/.regents/techtree "
        "(runs `uv sync --frozen`).",
        params=[DIGEST, JSON],
    )
)
ENGINE.add_command(
    click.Command(
        "status",
        callback=status,
        help="Whether each engine is installed and verified here.",
        params=[DIGEST, JSON],
    )
)
ENGINE.add_command(
    click.Command(
        "verify",
        callback=verify,
        help="Recompute each installed bundle's digest and check its live environment.",
        params=[DIGEST, JSON],
    )
)
