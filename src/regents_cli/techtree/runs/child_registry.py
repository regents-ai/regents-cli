"""Which evaluation children a run currently owns, and the diagnostic record of them.

The journal records that a run was asked to stop; only the process that started the children
knows which processes those are. What survives the worker is ``execution/children.json``,
written once both children are up so the write lands outside the launch-skew interval.
"""

from __future__ import annotations

import threading
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Final

from regents_cli.techtree.canonical import to_json_value
from regents_cli.techtree.fs import atomic_write_json, ensure_private_directory
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.models.campaign import VariantSchedule
from regents_cli.techtree.verifiers.child import VerifiersChild
from regents_cli.techtree.verifiers.models import VariantName

EXECUTION_DIRECTORY: Final = "execution"
CHILDREN_FILENAME: Final = "children.json"
CHILDREN_RECORD_SCHEMA_VERSION: Final = "techtree.run-children.v1"

_VARIANT_ORDER: Final[tuple[VariantName, ...]] = (VariantName.BASELINE, VariantName.CANDIDATE)


@dataclass(frozen=True)
class LaunchedChild:
    """One child as the parent observed it the instant ``start`` returned."""

    variant: VariantName
    pid: int | None
    argv_digest: Digest
    started_at: datetime


class ChildRegistry:
    """The live evaluation children of every run this process is executing."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._children: dict[str, dict[VariantName, VerifiersChild]] = {}

    def register(self, run_id: str, child: VerifiersChild) -> None:
        """Record that this run owns one child process; a variant is held once."""
        with self._lock:
            self._children.setdefault(run_id, {})[child.variant] = child

    def children(self, run_id: str) -> tuple[VerifiersChild, ...]:
        """Return this run's live children, in comparison order."""
        with self._lock:
            registered = dict(self._children.get(run_id, {}))
        return tuple(registered[variant] for variant in _VARIANT_ORDER if variant in registered)

    def terminate_all(self, run_id: str, grace_seconds: float) -> None:
        """Stop every child this run owns, each with the same grace, then forget them."""
        failures: list[BaseException] = []
        for child in self.children(run_id):
            try:
                child.terminate(grace_seconds)
            except BaseException as error:
                failures.append(error)
            finally:
                self.unregister(run_id, child.variant)
        if failures:
            raise failures[0]

    def unregister(self, run_id: str, variant: VariantName) -> None:
        """Forget one child, and the run itself once it owns none."""
        with self._lock:
            registered = self._children.get(run_id)
            if registered is None:
                return
            registered.pop(variant, None)
            if not registered:
                del self._children[run_id]


def execution_dir(run_root: Path) -> Path:
    """Return where one run records what its execution did."""
    return run_root / EXECUTION_DIRECTORY


def children_record_path(run_root: Path) -> Path:
    """Return where one run's diagnostic child record lives."""
    return execution_dir(run_root) / CHILDREN_FILENAME


def write_children_record(
    *,
    run_root: Path,
    run_id: str,
    schedule: VariantSchedule,
    children: Sequence[LaunchedChild],
    launch_skew_seconds: float | None,
) -> Path:
    """Write the diagnostic record of what this run started."""
    path = children_record_path(run_root)
    ensure_private_directory(path.parent)
    rows: list[JsonValue] = [
        {
            "variant": child.variant.value,
            "pid": child.pid,
            "argv_digest": child.argv_digest,
            "started_at": to_json_value(child.started_at),
        }
        for child in children
    ]
    document: dict[str, JsonValue] = {
        "schema_version": CHILDREN_RECORD_SCHEMA_VERSION,
        "run_id": run_id,
        "schedule": schedule.value,
        "launch_skew_seconds": launch_skew_seconds,
        "children": rows,
    }
    atomic_write_json(path, document)
    return path
