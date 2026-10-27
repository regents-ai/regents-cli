"""A task the provider cut off is never counted as finished.

The costly failure: the provider stops answering partway through a task, the harness stops
cleanly, the engine counts that as handled, and the run scores what was left as the subject's
result. Two published Results each hold one task scored this way.

The engine helper imports Verifiers, which only an installed engine holds; the helper reads a
trace's fields alone, so these tests stand in for the two Verifiers names it imports.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

ENGINES = Path(__file__).parents[2] / "src/regents_cli/techtree/resources/engines"


def load_normalizer(engine: str, monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    for name, attribute in (
        ("verifiers.v1.trace", "WireTrace"),
        ("verifiers.v1.utils.trace_store", "read_episodes"),
    ):
        stand_in = ModuleType(name)
        setattr(stand_in, attribute, object())
        monkeypatch.setitem(sys.modules, name, stand_in)
    path = ENGINES / engine / "tools/normalize_eval_output.py"
    spec = importlib.util.spec_from_file_location(f"normalize_{engine}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def trace(*, ok: bool, last_status: int | None, failed: bool = True) -> Any:
    error = SimpleNamespace(status_code=last_status) if failed else None
    return SimpleNamespace(ok=ok, calls=[SimpleNamespace(error=None), SimpleNamespace(error=error)])


@pytest.mark.parametrize("engine", ["default", "frontier-cs", "tasksmith"])
@pytest.mark.parametrize("status", [None, 429, 500, 502, 503])
def test_a_finished_task_whose_provider_stopped_answering_is_a_failure(
    engine: str, status: int | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    normalizer = load_normalizer(engine, monkeypatch)
    cut_off = trace(ok=True, last_status=status)

    assert normalizer.provider_failure(cut_off) is cut_off.calls[-1].error


@pytest.mark.parametrize("engine", ["default", "frontier-cs", "tasksmith"])
def test_the_subjects_own_mistakes_and_clean_endings_still_count(
    engine: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    normalizer = load_normalizer(engine, monkeypatch)

    assert normalizer.provider_failure(trace(ok=True, last_status=400)) is None
    assert normalizer.provider_failure(trace(ok=True, last_status=None, failed=False)) is None
    assert normalizer.provider_failure(SimpleNamespace(ok=True, calls=[])) is None
