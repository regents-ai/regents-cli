"""Submitting a training attempt to a provider exactly once (contract section 5).

Each attempt keeps a journal, one JSON line per fact, appended and synced before the attempt's
state advances: the intent before the submission, the upstream job id as soon as it is known.
A submission whose outcome is unknown, such as a timeout after the request left, makes the
attempt `indeterminate`. From then on the engine only looks the intent up at the provider; it
never submits again on its own, because a second submission could start a second paid job.
A person decides what follows a lookup that finds nothing.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal, Protocol

from regents_cli.techtree.errors import TechtreeError
from regents_cli.techtree.models.base import NonEmptyString, ProtocolModel

JOB_INDETERMINATE: Final = "job_indeterminate"


class JournalFact(ProtocolModel):
    state: Literal["intent", "submitted", "indeterminate"]
    intent_id: NonEmptyString
    upstream_job_id: NonEmptyString | None = None


class SubmissionOutcomeUnknownError(Exception):
    """The provider may or may not have created the job."""


class Provider(Protocol):
    def submit(self, intent_id: str) -> str:
        """Create the job under `intent_id` and return its upstream id, or raise
        `SubmissionOutcomeUnknownError` when that cannot be known."""
        ...

    def find(self, intent_id: str) -> str | None:
        """The upstream id of the job created under `intent_id`, if the provider has one."""
        ...


@dataclass(frozen=True)
class Journal:
    path: Path

    def facts(self) -> list[JournalFact]:
        if not self.path.exists():
            return []
        lines = self.path.read_text(encoding="utf-8").splitlines()
        return [JournalFact.model_validate_json(line) for line in lines if line]

    def latest(self) -> JournalFact | None:
        facts = self.facts()
        return facts[-1] if facts else None

    def append(self, fact: JournalFact) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(fact.model_dump_json() + "\n")
            handle.flush()
            os.fsync(handle.fileno())


def submit_once(journal: Journal, provider: Provider, intent_id: str) -> str:
    """The upstream job id for `intent_id`, submitting only if this attempt never has."""
    latest = journal.latest()
    if latest is not None and latest.upstream_job_id is not None:
        return latest.upstream_job_id
    if latest is not None:
        # An intent with no outcome after it is a submission whose outcome is unknown.
        if latest.state == "intent":
            journal.append(JournalFact(state="indeterminate", intent_id=intent_id))
        return _look_up(journal, provider, intent_id)
    journal.append(JournalFact(state="intent", intent_id=intent_id))
    try:
        upstream = provider.submit(intent_id)
    except SubmissionOutcomeUnknownError:
        journal.append(JournalFact(state="indeterminate", intent_id=intent_id))
        return _look_up(journal, provider, intent_id)
    journal.append(JournalFact(state="submitted", intent_id=intent_id, upstream_job_id=upstream))
    return upstream


def _look_up(journal: Journal, provider: Provider, intent_id: str) -> str:
    upstream = provider.find(intent_id)
    if upstream is None:
        raise TechtreeError(
            f"the provider has no job for intent {intent_id} yet, and the submission's outcome "
            "is unknown, so nothing was submitted again. Look again later, or decide whether "
            "to start a new attempt.",
            code=JOB_INDETERMINATE,
            details={"intent_id": intent_id},
        )
    journal.append(JournalFact(state="submitted", intent_id=intent_id, upstream_job_id=upstream))
    return upstream
