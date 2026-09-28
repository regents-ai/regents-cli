"""A run's publication journal: `publication.jsonl`, beside the run's own records.

A finished run's own files are final, so what happened when somebody published it goes in a
journal of its own: canonical JSON one line at a time, sequence numbers from zero, an O_APPEND
write followed by an fsync. A run's publication status is derived from this file alone; the
signed report inside the proof says `not_requested` permanently and correctly. No contributor
address is ever written here.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Final, Literal, Self

from pydantic import Field, model_validator
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import canonical_json_bytes
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.fs import fsync_directory
from regents_cli.techtree.models.base import Digest, NonEmptyString, ProtocolModel, UtcDateTime
from regents_cli.techtree.models.uplift_report import PublicationStatus

PUBLICATION_JOURNAL_FILENAME: Final = "publication.jsonl"
PUBLICATION_JOURNAL_CORRUPT: Final = "publication_journal_corrupt"

_FILE_MODE: Final = 0o600

#: An attempt is pending, published or failed; `not_requested` and `blocked` describe a report.
ATTEMPT_STATUSES: Final[frozenset[PublicationStatus]] = frozenset(
    {PublicationStatus.PENDING, PublicationStatus.PUBLISHED, PublicationStatus.FAILED}
)


class PublicationJournalEntry(ProtocolModel):
    """One thing that happened when somebody published this run."""

    schema_version: Literal["techtree.publication-journal.v1alpha1"]
    sequence: int = Field(ge=0)
    at: UtcDateTime
    run_id: NonEmptyString
    status: PublicationStatus
    bundle_digest: Digest
    endpoint: NonEmptyString
    file_count: int = Field(gt=0)
    byte_count: int = Field(gt=0)
    entry_url: NonEmptyString | None = None
    log_sequence: int | None = Field(default=None, ge=0)
    error_code: NonEmptyString | None = None

    @model_validator(mode="after")
    def _check_the_outcome_carries_what_it_means(self) -> Self:
        if self.status not in ATTEMPT_STATUSES:
            raise ValueError("a journal entry records an attempt: pending, published or failed")
        published = self.status is PublicationStatus.PUBLISHED
        landed = self.entry_url is not None or self.log_sequence is not None
        if published and (self.entry_url is None or self.log_sequence is None):
            raise ValueError("a published entry records where it landed and its log position")
        if not published and landed:
            raise ValueError("only a published entry has somewhere it landed and a log position")
        failed = self.status is PublicationStatus.FAILED
        if failed and self.error_code is None:
            raise ValueError("a failed entry records why it failed")
        if not failed and self.error_code is not None:
            raise ValueError("only a failed entry carries a failure code")
        return self


class PublicationJournal:
    """The append-only record of what has been published about one run."""

    def __init__(self, run_root: Path) -> None:
        self._path = run_root / PUBLICATION_JOURNAL_FILENAME

    @property
    def path(self) -> Path:
        return self._path

    def entries(self) -> list[PublicationJournalEntry]:
        """Every entry, refusing a history with a hole in it."""
        try:
            raw = self._path.read_bytes()
        except FileNotFoundError:
            return []
        entries: list[PublicationJournalEntry] = []
        for position, line in enumerate(raw.splitlines()):
            if not line.strip():
                continue
            try:
                entry = PublicationJournalEntry.model_validate_json(line)
            except PydanticValidationError as error:
                raise ValidationError(
                    f"line {position + 1} of this run's publication journal cannot be read",
                    code=PUBLICATION_JOURNAL_CORRUPT,
                    details={"path": str(self._path), "line": position + 1},
                ) from error
            if entry.sequence != len(entries):
                raise ValidationError(
                    f"this run's publication journal jumps from {len(entries) - 1} to "
                    f"{entry.sequence}, so a line is missing",
                    code=PUBLICATION_JOURNAL_CORRUPT,
                    details={"path": str(self._path), "sequence": entry.sequence},
                )
            entries.append(entry)
        return entries

    def status(self) -> PublicationStatus:
        """Where this run stands; a run nobody has published has no journal."""
        entries = self.entries()
        if not entries:
            return PublicationStatus.NOT_REQUESTED
        return entries[-1].status

    def published(self) -> PublicationJournalEntry | None:
        """The entry that published this run, if one did."""
        for entry in reversed(self.entries()):
            if entry.status is PublicationStatus.PUBLISHED:
                return entry
        return None

    def next_sequence(self) -> int:
        return len(self.entries())

    def append(self, entry: PublicationJournalEntry) -> None:
        """Append one whole line with O_APPEND, then fsync."""
        line = canonical_json_bytes(entry) + b"\n"
        descriptor = os.open(self._path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, _FILE_MODE)
        try:
            written = 0
            while written < len(line):
                written += os.write(descriptor, line[written:])
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        fsync_directory(self._path.parent)
