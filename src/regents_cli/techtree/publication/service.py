"""Publishing one run to the public log.

The order of the steps is the product. The proof is verified before anything is offered. What
is sent is the proof directory's own bytes, read once when the plan is made; what a person is
shown is listed from that same reading. The pending journal line goes down before the request
is made. Nothing is written down that was not checked against the pinned network key. A retry
after a lost answer converges: the log answers with the same entry, so the receipt write finds
the same bytes already there.
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import canonical_json_bytes
from regents_cli.techtree.constants import (
    PUBLICATION_JOURNAL_SCHEMA_VERSION,
    PUBLICATION_SUBMISSION_SCHEMA_VERSION,
)
from regents_cli.techtree.errors import (
    ConflictError,
    NotFoundError,
    PolicyError,
    TechtreeError,
    ValidationError,
    VerificationError,
)
from regents_cli.techtree.fs import fsync_directory, open_exclusive
from regents_cli.techtree.identity.models import VerificationResult
from regents_cli.techtree.models.base import Digest, ObjectEnvelope
from regents_cli.techtree.models.experiment import ExperimentManifestV4
from regents_cli.techtree.models.skill import SubmissionDraft
from regents_cli.techtree.models.uplift_report import PublicationStatus, UpliftReportV3
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.publication.journal import PublicationJournal, PublicationJournalEntry
from regents_cli.techtree.publication.models import (
    PublicationReceiptPayload,
    PublicationSubmission,
)
from regents_cli.techtree.publication.transport import (
    HttpsPublicationTransport,
    publication_endpoint,
)
from regents_cli.techtree.publication.verify import (
    PUBLICATION_RECEIPT_INVALID,
    verify_publication_receipt,
)
from regents_cli.techtree.receipts.bundle import (
    BUNDLE_MANIFEST_FILENAME,
    PROOF_BUNDLE_INVALID,
    REPORT_FILENAME,
    LocalProofBundleManifest,
    proof_bundle_dir,
)
from regents_cli.techtree.receipts.uplift import publication_eligible_for
from regents_cli.techtree.receipts.verify import LocalProofVerifier
from regents_cli.techtree.release.models import PublicationCoordinates

#: The countersigned receipt, written into the run directory as a new file.
PUBLICATION_RECEIPT_FILENAME: Final = "publication-receipt.json"

PUBLICATION_PROOF_NOT_FOUND: Final = "publication_proof_not_found"
PUBLICATION_NOT_ELIGIBLE: Final = "publication_not_eligible"
PUBLICATION_RECEIPT_CONFLICT: Final = "publication_receipt_conflict"
RUN_ALREADY_PUBLISHED: Final = "run_already_published"

_INPUTS_DIRECTORY: Final = "inputs"
_DRAFT_FILENAME: Final = "draft.json"
_CANDIDATE_MANIFEST_FILENAME: Final = "candidate-experiment.json"
_SKILL_NAME_PATTERN: Final = re.compile(r"\A[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}\Z")


@dataclass(frozen=True)
class PublicationFile:
    """One file a publication would send: its path in the proof directory and its stored size."""

    path: str
    size: int


@dataclass(frozen=True)
class PublicationPlan:
    """Exactly what one publication would send, worked out before anybody is asked."""

    run_id: str
    bundle_digest: Digest
    endpoint: str
    files: tuple[PublicationFile, ...]
    #: The exact bytes the request carries.
    body: bytes = field(repr=False)
    report: UpliftReportV3
    verification: VerificationResult
    skill_name: str

    @property
    def file_count(self) -> int:
        return len(self.files)

    @property
    def byte_count(self) -> int:
        return sum(file.size for file in self.files)


@dataclass(frozen=True)
class PublicationOutcome:
    """What one completed publication produced. The address itself is nowhere."""

    run_id: str
    receipt: PublicationReceiptPayload
    receipt_path: Path
    status: PublicationStatus
    contributor_address_sent: bool


class PublicationService:
    """Plans and performs the publication of one finished run."""

    def __init__(
        self,
        *,
        paths: TechtreePaths,
        coordinates: PublicationCoordinates,
        transport: HttpsPublicationTransport,
    ) -> None:
        self._paths = paths
        self._coordinates = coordinates
        self._transport = transport

    def plan(self, run_id: str) -> PublicationPlan:
        """What publishing this run would send, or a refusal reached without a network."""
        directory = self._bundle_dir(run_id)
        verification = LocalProofVerifier().verify_bundle(directory)
        if not verification.verified:
            raise VerificationError(
                f"run {run_id}'s own proof does not verify, so there is nothing here that could "
                f"honestly be published: {verification.failures[0].detail}",
                code=PROOF_BUNDLE_INVALID,
                details={
                    "run_id": run_id,
                    "failed_checks": [message.id for message in verification.failures],
                },
            )

        report = self._report(directory, run_id)
        # Decided from the report's grade and rights, never from the stored flag: every report
        # signed before publishing existed stores false.
        if not publication_eligible_for(
            grade=report.proof_grade, publication=report.statuses.publication
        ):
            raise PolicyError(
                f"run {run_id}'s report may not be published: "
                + (
                    "its rights statement blocks publication"
                    if report.statuses.publication is PublicationStatus.BLOCKED
                    else f"it is graded {report.proof_grade}, and only a P1 report is evidence "
                    "of anything"
                ),
                code=PUBLICATION_NOT_ELIGIBLE,
                details={
                    "run_id": run_id,
                    "proof_grade": report.proof_grade,
                    "publication": report.statuses.publication.value,
                },
            )

        published = PublicationJournal(self._paths.run_dir(run_id)).published()
        if published is not None:
            raise ConflictError(
                f"run {run_id} is already in the public log, at {published.entry_url}. "
                "A published entry stays where it is",
                code=RUN_ALREADY_PUBLISHED,
                details={"run_id": run_id, "entry_url": published.entry_url},
            )

        stored = _proof_files(directory)
        bundle_digest = _bundle_digest(stored, run_id)
        return PublicationPlan(
            run_id=run_id,
            bundle_digest=bundle_digest,
            endpoint=self.endpoint,
            files=tuple(
                PublicationFile(path=path, size=len(data)) for path, data in stored.items()
            ),
            body=_submission(run_id, bundle_digest, stored),
            report=report,
            verification=verification,
            skill_name=self._skill_name(run_id, directory),
        )

    def publish(
        self,
        plan: PublicationPlan,
        *,
        contributor_address: str | None = None,
        skill_github_url: str | None = None,
    ) -> PublicationOutcome:
        """Send the planned submission, record what happened, and return it.

        SECURITY: `contributor_address` is already canonical; here it travels beside the
        request and nowhere else: not into the submission, the journal or a log line.
        """
        journal = PublicationJournal(self._paths.run_dir(plan.run_id))
        self._record(journal, plan, status=PublicationStatus.PENDING)
        try:
            response = self._transport.submit(
                endpoint=plan.endpoint,
                body=plan.body,
                contributor_address=contributor_address,
                skill_name=plan.skill_name,
                skill_github_url=skill_github_url,
            )
            envelope = self._receipt(response, plan)
            path = self._write_receipt(plan.run_id, envelope)
        except TechtreeError as error:
            self._record(journal, plan, status=PublicationStatus.FAILED, error_code=error.code)
            raise
        receipt = envelope.payload
        self._record(
            journal,
            plan,
            status=PublicationStatus.PUBLISHED,
            entry_url=receipt.entry_url,
            log_sequence=receipt.log_sequence,
        )
        return PublicationOutcome(
            run_id=plan.run_id,
            receipt=receipt,
            receipt_path=path,
            status=PublicationStatus.PUBLISHED,
            contributor_address_sent=contributor_address is not None,
        )

    def publication_eligible(self, run_id: str) -> bool:
        """Whether this run's own report says it may be published; no proof here means no."""
        try:
            directory = self._bundle_dir(run_id)
        except NotFoundError:
            return False
        report = self._report(directory, run_id)
        return publication_eligible_for(
            grade=report.proof_grade, publication=report.statuses.publication
        )

    @property
    def endpoint(self) -> str:
        return publication_endpoint(self._coordinates)

    def _receipt(
        self, response: bytes, plan: PublicationPlan
    ) -> ObjectEnvelope[PublicationReceiptPayload]:
        """Parse the answer and refuse everything that is not this run's receipt."""
        try:
            envelope = ObjectEnvelope[PublicationReceiptPayload].model_validate_json(response)
        except PydanticValidationError as error:
            raise ValidationError(
                "the run log answered with something that is not a publication receipt, so "
                "nothing was recorded",
                code=PUBLICATION_RECEIPT_INVALID,
                details={"run_id": plan.run_id},
            ) from error
        verify_publication_receipt(
            envelope,
            coordinates=self._coordinates,
            run_id=plan.run_id,
            bundle_digest=plan.bundle_digest,
        )
        return envelope

    def _write_receipt(
        self, run_id: str, receipt: ObjectEnvelope[PublicationReceiptPayload]
    ) -> Path:
        """Write the receipt with O_EXCL; the same bytes already there is a retry that succeeded."""
        path = self._paths.run_dir(run_id) / PUBLICATION_RECEIPT_FILENAME
        data = canonical_json_bytes(receipt)
        try:
            with open_exclusive(path) as handle:
                handle.write(data)
                handle.flush()
        except ConflictError as error:
            if path.read_bytes() == data:
                return path
            raise ConflictError(
                f"run {run_id} already holds a different publication receipt, so this one was "
                "not written: two receipts for one run cannot both be its record",
                code=PUBLICATION_RECEIPT_CONFLICT,
                details={"run_id": run_id, "path": str(path)},
            ) from error
        fsync_directory(path.parent)
        return path

    def _record(
        self,
        journal: PublicationJournal,
        plan: PublicationPlan,
        *,
        status: PublicationStatus,
        entry_url: str | None = None,
        log_sequence: int | None = None,
        error_code: str | None = None,
    ) -> None:
        journal.append(
            PublicationJournalEntry(
                schema_version=PUBLICATION_JOURNAL_SCHEMA_VERSION,
                sequence=journal.next_sequence(),
                at=datetime.now(UTC),
                run_id=plan.run_id,
                status=status,
                bundle_digest=plan.bundle_digest,
                endpoint=plan.endpoint,
                file_count=plan.file_count,
                byte_count=plan.byte_count,
                entry_url=entry_url,
                log_sequence=log_sequence,
                error_code=error_code,
            )
        )

    def _skill_name(self, run_id: str, directory: Path) -> str:
        """The candidate Skill's public name, from the run's immutable inputs.

        The verified candidate manifest names one Skill by digest; the draft the run started
        from must name the same one, and its name is what travels. A run whose inputs are
        missing or disagree has no name to send and is refused.
        """
        draft_path = self._paths.run_dir(run_id) / _INPUTS_DIRECTORY / _DRAFT_FILENAME
        try:
            draft = _load(draft_path, SubmissionDraft)
            candidate = _load(directory / _CANDIDATE_MANIFEST_FILENAME, ExperimentManifestV4)
        except (OSError, PydanticValidationError) as error:
            raise ValidationError(
                f"run {run_id}'s inputs do not name its candidate Skill, so there is no Skill "
                "name to publish it under",
                details={"run_id": run_id, "path": str(draft_path)},
            ) from error
        skill = draft.skill_artifact
        subject = candidate.configuration.agents.get("subject")
        if (
            subject is None
            or len(subject.harness.skills) != 1
            or subject.harness.skills[0].digest != skill.root_digest
            or _SKILL_NAME_PATTERN.fullmatch(skill.name) is None
        ):
            raise ValidationError(
                f"run {run_id}'s draft does not name the Skill its candidate experiment ran, so "
                "there is no Skill name to publish it under",
                details={"run_id": run_id, "skill_root_digest": skill.root_digest},
            )
        return skill.name

    def _bundle_dir(self, run_id: str) -> Path:
        directory = proof_bundle_dir(self._paths.run_dir(run_id))
        if not (directory / BUNDLE_MANIFEST_FILENAME).is_file():
            raise NotFoundError(
                f"run {run_id} has no proof to publish on this machine",
                code=PUBLICATION_PROOF_NOT_FOUND,
                details={"run_id": run_id},
            )
        return directory

    @staticmethod
    def _report(directory: Path, run_id: str) -> UpliftReportV3:
        raw = (directory / REPORT_FILENAME).read_bytes()
        try:
            envelope = ObjectEnvelope[UpliftReportV3].model_validate_json(raw)
        except PydanticValidationError as error:
            raise VerificationError(
                f"run {run_id}'s report cannot be read out of its own proof",
                code=PROOF_BUNDLE_INVALID,
                details={"run_id": run_id},
            ) from error
        return envelope.payload


def _submission(run_id: str, bundle_digest: Digest, stored: dict[str, bytes]) -> bytes:
    """One reading of the proof directory as the wire carries it: path against base64 bytes."""
    submission = PublicationSubmission(
        schema_version=PUBLICATION_SUBMISSION_SCHEMA_VERSION,
        run_id=run_id,
        bundle_digest=bundle_digest,
        files={path: base64.b64encode(data).decode("ascii") for path, data in stored.items()},
    )
    return canonical_json_bytes(submission)


def _proof_files(directory: Path) -> dict[str, bytes]:
    """Every file in the proof directory against its stored bytes, ordered by path."""
    stored = {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in directory.rglob("*")
        if path.is_file()
    }
    return dict(sorted(stored.items()))


def _bundle_digest(stored: dict[str, bytes], run_id: str) -> Digest:
    """The digest of the signed manifest that commits to the bundle, from the same reading."""
    raw = stored.get(BUNDLE_MANIFEST_FILENAME, b"")
    try:
        envelope = ObjectEnvelope[LocalProofBundleManifest].model_validate_json(raw)
    except PydanticValidationError as error:
        raise VerificationError(
            f"run {run_id}'s proof manifest cannot be read",
            code=PROOF_BUNDLE_INVALID,
            details={"run_id": run_id},
        ) from error
    return envelope.payload_digest


def _load[ModelT: BaseModel](path: Path, model: type[ModelT]) -> ModelT:
    return model.model_validate_json(path.read_bytes())
