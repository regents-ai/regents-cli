"""GB-Pro challenge, authoring, source, season, and package references."""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from typing import Any

from .base import (
    ModelValidationError,
    content_id,
    require_bool,
    require_exact_keys,
    require_identifier,
    require_json_value,
    require_record,
    require_schema_version,
    require_sha256,
    require_string,
    require_type,
    sha256_bytes,
)
from .protocol import DecisionRule
from .sealed import sealed_answer_key_commitment
from .taskset import TasksetPackageReference


ACCEPTANCE_DECISIONS = {"accepted", "rejected", "pending"}
_IMMUTABLE_SOURCE_REVISIONS = {"head", "latest", "main", "master", "trunk", "default"}
_HF_REVISION_PATTERN = re.compile(
    r"^(?:hf|huggingface)://datasets/([^/@\s]+(?:/[^/@\s]+)*)@([0-9a-f]{40})$"
)
_GIT_COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")


def normalize_huggingface_dataset_revision(value: Any, path: str = "pinned_data_revision") -> str:
    """Return one immutable HuggingFace dataset repository+commit locator."""

    revision = require_string(value, path)
    match = _HF_REVISION_PATTERN.fullmatch(revision)
    if match is None:
        raise ModelValidationError(
            f"{path} must be an immutable HuggingFace dataset locator "
            "(huggingface://datasets/<repository>@<40-hex-commit>)"
        )
    repository, commit = match.groups()
    return f"huggingface://datasets/{repository}@{commit}"


def _require_external_revision(value: Any, path: str) -> str:
    revision = require_string(value, path)
    if revision != revision.strip() or any(character.isspace() for character in revision):
        raise ModelValidationError(f"{path} must be a trimmed immutable revision")
    if revision.casefold() in _IMMUTABLE_SOURCE_REVISIONS or revision.casefold().startswith("refs/heads/"):
        raise ModelValidationError(f"{path} must not be a symbolic revision")
    return revision


def _require_git_commit(value: Any, path: str) -> str:
    commit = require_string(value, path)
    if _GIT_COMMIT_PATTERN.fullmatch(commit) is None:
        raise ModelValidationError(f"{path} must be a lowercase 40-character git commit")
    return commit


@dataclass(frozen=True)
class ExternalSourceReference:
    """A digest-pinned artifact acquired outside the platform admission path."""

    schema_version: int
    storage_id: str
    revision: str
    content_digest: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "storage_id": self.storage_id,
            "revision": self.revision,
            "content_digest": self.content_digest,
        }

    def load(self, content: bytes | bytearray) -> bytes:
        """Accept only bytes matching the pinned digest; perform no acquisition."""

        if not isinstance(content, (bytes, bytearray)):
            raise ModelValidationError("external source content must be bytes")
        loaded = bytes(content)
        if sha256_bytes(loaded) != self.content_digest:
            raise ModelValidationError("external source content digest mismatch")
        return loaded

    @classmethod
    def from_dict(cls, value: Any) -> "ExternalSourceReference":
        record = require_record(value, "external_source")
        require_exact_keys(record, {"schema_version", "storage_id", "revision", "content_digest"}, "external_source")
        return cls(
            require_schema_version(record["schema_version"], "external_source.schema_version"),
            require_identifier(record["storage_id"], "external_source.storage_id"),
            _require_external_revision(record["revision"], "external_source.revision"),
            require_sha256(record["content_digest"], "external_source.content_digest"),
        )


def load_digest_pinned_source(reference: ExternalSourceReference, content: bytes | bytearray) -> bytes:
    """Pure loading seam used by runtimes after out-of-band acquisition."""

    return reference.load(content)


@dataclass(frozen=True)
class ChallengeContract:
    """Family-owned decision rule copied into the lock without caller override."""

    schema_version: int
    challenge_revision_id: str
    decision_rule: DecisionRule

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "challenge_revision_id": self.challenge_revision_id,
            "decision_rule": self.decision_rule.to_dict(),
        }

    @classmethod
    def from_dict(cls, value: Any) -> "ChallengeContract":
        record = require_record(value, "challenge_contract")
        require_exact_keys(record, {"schema_version", "challenge_revision_id", "decision_rule"}, "challenge_contract")
        return cls(
            require_schema_version(record["schema_version"], "challenge_contract.schema_version"),
            require_identifier(record["challenge_revision_id"], "challenge_contract.challenge_revision_id"),
            DecisionRule.from_dict(record["decision_rule"]),
        )


@dataclass(frozen=True)
class ReferenceQuestion:
    """Public question identity plus a sealed-side answer-key commitment."""

    schema_version: int
    question_id: str
    answer_key_commitment: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "question_id": self.question_id,
            "answer_key_commitment": self.answer_key_commitment,
        }

    @classmethod
    def from_dict(cls, value: Any, path: str = "reference_question") -> "ReferenceQuestion":
        record = require_record(value, path)
        require_exact_keys(record, {"schema_version", "question_id", "answer_key_commitment"}, path)
        return cls(
            require_schema_version(record["schema_version"], f"{path}.schema_version"),
            require_identifier(record["question_id"], f"{path}.question_id"),
            require_sha256(record["answer_key_commitment"], f"{path}.answer_key_commitment"),
        )


@dataclass(frozen=True)
class BenchmarkFamily:
    """Reusable family shape; GB-Pro construction adds its ten-reference rule."""

    schema_version: int
    family_id: str
    challenge_contract: ChallengeContract
    taskset_package: TasksetPackageReference
    taskset_source: ExternalSourceReference | None
    reference_source: ExternalSourceReference | None
    held_out_source: ExternalSourceReference | None
    reference_questions: tuple[ReferenceQuestion, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "family_id": self.family_id,
            "challenge_contract": self.challenge_contract.to_dict(),
            "taskset_package": self.taskset_package.to_dict(),
            "taskset_source": self.taskset_source.to_dict() if self.taskset_source is not None else None,
            "reference_source": self.reference_source.to_dict() if self.reference_source is not None else None,
            "held_out_source": self.held_out_source.to_dict() if self.held_out_source is not None else None,
            "reference_questions": [question.to_dict() for question in self.reference_questions],
        }

    def identity_content(self) -> dict[str, Any]:
        value = self.to_dict()
        value.pop("family_id")
        return value

    def expected_family_id(self) -> str:
        return content_id("family", self.identity_content())

    @classmethod
    def create(
        cls,
        *,
        challenge_contract: ChallengeContract,
        taskset_package: TasksetPackageReference,
        taskset_source: ExternalSourceReference | None = None,
        reference_source: ExternalSourceReference | None = None,
        held_out_source: ExternalSourceReference | None = None,
        reference_questions: tuple[ReferenceQuestion, ...] = (),
    ) -> "BenchmarkFamily":
        family = cls(
            schema_version=1,
            family_id="pending",
            challenge_contract=challenge_contract,
            taskset_package=taskset_package,
            taskset_source=taskset_source,
            reference_source=reference_source,
            held_out_source=held_out_source,
            reference_questions=reference_questions,
        )
        return replace(family, family_id=family.expected_family_id())

    @classmethod
    def from_dict(cls, value: Any) -> "BenchmarkFamily":
        record = require_record(value, "family")
        require_exact_keys(
            record,
            {
                "schema_version",
                "family_id",
                "challenge_contract",
                "taskset_package",
                "taskset_source",
                "reference_source",
                "held_out_source",
                "reference_questions",
            },
            "family",
        )
        raw_questions = require_type(record["reference_questions"], list, "family.reference_questions")
        questions = tuple(
            ReferenceQuestion.from_dict(item, f"family.reference_questions[{index}]")
            for index, item in enumerate(raw_questions)
        )
        question_ids = tuple(question.question_id for question in questions)
        if len(set(question_ids)) != len(question_ids):
            raise ModelValidationError("family.reference_questions must contain unique question identities")

        def optional_source(value: Any, path: str) -> ExternalSourceReference | None:
            return None if value is None else ExternalSourceReference.from_dict(value)

        family = cls(
            require_schema_version(record["schema_version"], "family.schema_version"),
            require_identifier(record["family_id"], "family.family_id"),
            ChallengeContract.from_dict(record["challenge_contract"]),
            TasksetPackageReference.from_dict(record["taskset_package"]),
            optional_source(record["taskset_source"], "family.taskset_source"),
            optional_source(record["reference_source"], "family.reference_source"),
            optional_source(record["held_out_source"], "family.held_out_source"),
            questions,
        )
        if questions and family.reference_source is None:
            raise ModelValidationError("family.reference_source is required when reference questions exist")
        if family.family_id != family.expected_family_id():
            raise ModelValidationError("family.family_id does not match the canonical family content")
        return family


@dataclass(frozen=True)
class AuthoredQuestion:
    """Sealed-side four-field Forge question record plus canonical identity.

    ``question_id`` is derived from the task-input digest and all four business
    fields.  Mutating the author, pinned revision, deterministic key,
    acceptance decision, or task input therefore creates a new identity;
    question text and synthetic data stay in the task input, not this record.
    The raw deterministic answer key is never an agent-visible field.
    """

    schema_version: int
    question_id: str
    task_input_digest: str
    author_identity: str
    pinned_data_revision: str
    deterministic_answer_key: Any
    acceptance_decision: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "question_id": self.question_id,
            "task_input_digest": self.task_input_digest,
            "author_identity": self.author_identity,
            "pinned_data_revision": self.pinned_data_revision,
            "deterministic_answer_key": self.deterministic_answer_key,
            "acceptance_decision": self.acceptance_decision,
        }

    def identity_content(self) -> dict[str, Any]:
        return {
            "task_input_digest": self.task_input_digest,
            "author_identity": self.author_identity,
            "pinned_data_revision": self.pinned_data_revision,
            "deterministic_answer_key": self.deterministic_answer_key,
            "acceptance_decision": self.acceptance_decision,
        }

    def expected_question_id(self) -> str:
        return content_id("authored-question", self.identity_content())

    @classmethod
    def create(
        cls,
        *,
        task_input_digest: str,
        author_identity: str,
        pinned_data_revision: str,
        deterministic_answer_key: Any,
        acceptance_decision: str,
    ) -> "AuthoredQuestion":
        question = cls(
            schema_version=1,
            question_id="pending",
            task_input_digest=require_sha256(task_input_digest, "question.task_input_digest"),
            author_identity=require_identifier(author_identity, "question.author_identity"),
            pinned_data_revision=normalize_huggingface_dataset_revision(pinned_data_revision),
            deterministic_answer_key=require_json_value(deterministic_answer_key, "question.deterministic_answer_key"),
            acceptance_decision=require_string(acceptance_decision, "question.acceptance_decision"),
        )
        if question.acceptance_decision not in ACCEPTANCE_DECISIONS:
            raise ModelValidationError("question.acceptance_decision is invalid")
        return replace(question, question_id=question.expected_question_id())

    def answer_key_commitment(
        self,
        *,
        family: dict[str, Any],
        task: dict[str, Any],
        grader_source: bytes,
    ) -> str:
        """Commit to sealed material without exposing the raw answer key."""

        return sealed_answer_key_commitment(
            family=family,
            task=task,
            grader_source=grader_source,
            answer_key=self.deterministic_answer_key,
        )

    def public_dict(self, *, answer_key_commitment: str) -> dict[str, Any]:
        """Return the public-side projection; the raw four-field record stays sealed."""

        return {
            "schema_version": self.schema_version,
            "question_id": self.question_id,
            "acceptance_decision": self.acceptance_decision,
            "answer_key_commitment": require_sha256(answer_key_commitment, "question.answer_key_commitment"),
        }

    @classmethod
    def from_dict(cls, value: Any) -> "AuthoredQuestion":
        record = require_record(value, "question")
        require_exact_keys(
            record,
            {
                "schema_version",
                "question_id",
                "task_input_digest",
                "author_identity",
                "pinned_data_revision",
                "deterministic_answer_key",
                "acceptance_decision",
            },
            "question",
        )
        acceptance = require_string(record["acceptance_decision"], "question.acceptance_decision")
        if acceptance not in ACCEPTANCE_DECISIONS:
            raise ModelValidationError("question.acceptance_decision is invalid")
        question = cls(
            require_schema_version(record["schema_version"], "question.schema_version"),
            require_identifier(record["question_id"], "question.question_id"),
            require_sha256(record["task_input_digest"], "question.task_input_digest"),
            require_identifier(record["author_identity"], "question.author_identity"),
            normalize_huggingface_dataset_revision(record["pinned_data_revision"], "question.pinned_data_revision"),
            require_json_value(record["deterministic_answer_key"], "question.deterministic_answer_key"),
            acceptance,
        )
        if question.question_id != question.expected_question_id():
            raise ModelValidationError("question.question_id does not match the canonical question content")
        return question


@dataclass(frozen=True)
class VerifiersPin:
    """The exact Prime/Verifiers v1 pin carried by a season manifest."""

    api: str
    package_version: str
    git_commit: str
    trace_version: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "api": self.api,
            "package_version": self.package_version,
            "git_commit": self.git_commit,
            "trace_version": self.trace_version,
        }

    @classmethod
    def from_dict(cls, value: Any) -> "VerifiersPin":
        record = require_record(value, "season_manifest.verifiers")
        require_exact_keys(record, {"api", "package_version", "git_commit", "trace_version"}, "season_manifest.verifiers")
        api = require_identifier(record["api"], "season_manifest.verifiers.api")
        if api != "v1":
            raise ModelValidationError("season_manifest.verifiers.api must equal v1")
        return cls(
            api,
            require_identifier(record["package_version"], "season_manifest.verifiers.package_version"),
            _require_git_commit(record["git_commit"], "season_manifest.verifiers.git_commit"),
            require_identifier(record["trace_version"], "season_manifest.verifiers.trace_version"),
        )


@dataclass(frozen=True)
class SeasonSplit:
    visibility: str
    reward_bearing: bool
    purpose: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "visibility": self.visibility,
            "reward_bearing": self.reward_bearing,
            "purpose": self.purpose,
        }

    @classmethod
    def from_dict(cls, value: Any, path: str) -> "SeasonSplit":
        record = require_record(value, path)
        require_exact_keys(record, {"visibility", "reward_bearing", "purpose"}, path)
        return cls(
            require_identifier(record["visibility"], f"{path}.visibility"),
            require_bool(record["reward_bearing"], f"{path}.reward_bearing"),
            require_identifier(record["purpose"], f"{path}.purpose"),
        )


@dataclass(frozen=True)
class SeasonManifest:
    """Immutable season identity, exact verifier pin, package reference, and three splits."""

    schema_version: int
    season_id: str
    challenge_revision_id: str
    verifiers: VerifiersPin
    benchmark_identity: str
    benchmark_public_name: str
    taskset_package: TasksetPackageReference
    development: SeasonSplit
    certification: SeasonSplit
    successor: SeasonSplit

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "season_id": self.season_id,
            "challenge_revision_id": self.challenge_revision_id,
            "verifiers": self.verifiers.to_dict(),
            "benchmark": {
                "identity": self.benchmark_identity,
                "public_name": self.benchmark_public_name,
                "taskset_package": self.taskset_package.to_dict(),
            },
            "splits": {
                "development": self.development.to_dict(),
                "certification": self.certification.to_dict(),
                "successor": self.successor.to_dict(),
            },
        }

    def identity_content(self) -> dict[str, Any]:
        value = self.to_dict()
        value.pop("season_id")
        return value

    def expected_season_id(self) -> str:
        return content_id("season-manifest", self.identity_content())

    @classmethod
    def create(
        cls,
        *,
        challenge_revision_id: str,
        verifiers: VerifiersPin,
        benchmark_identity: str,
        benchmark_public_name: str,
        taskset_package: TasksetPackageReference,
    ) -> "SeasonManifest":
        manifest = cls(
            schema_version=1,
            season_id="pending",
            challenge_revision_id=require_identifier(challenge_revision_id, "season_manifest.challenge_revision_id"),
            verifiers=verifiers,
            benchmark_identity=require_identifier(benchmark_identity, "season_manifest.benchmark.identity"),
            benchmark_public_name=require_string(benchmark_public_name, "season_manifest.benchmark.public_name"),
            taskset_package=taskset_package,
            development=SeasonSplit("public", False, "development"),
            certification=SeasonSplit("hidden", True, "certification"),
            successor=SeasonSplit("hidden", False, "anti-overfit"),
        )
        return replace(manifest, season_id=manifest.expected_season_id())

    @classmethod
    def from_dict(cls, value: Any) -> "SeasonManifest":
        record = require_record(value, "season_manifest")
        require_exact_keys(
            record,
            {"schema_version", "season_id", "challenge_revision_id", "verifiers", "benchmark", "splits"},
            "season_manifest",
        )
        benchmark = require_record(record["benchmark"], "season_manifest.benchmark")
        require_exact_keys(
            benchmark,
            {"identity", "public_name", "taskset_package"},
            "season_manifest.benchmark",
        )
        splits = require_record(record["splits"], "season_manifest.splits")
        require_exact_keys(splits, {"development", "certification", "successor"}, "season_manifest.splits")
        manifest = cls(
            require_schema_version(record["schema_version"], "season_manifest.schema_version"),
            require_identifier(record["season_id"], "season_manifest.season_id"),
            require_identifier(record["challenge_revision_id"], "season_manifest.challenge_revision_id"),
            VerifiersPin.from_dict(record["verifiers"]),
            require_identifier(benchmark["identity"], "season_manifest.benchmark.identity"),
            require_string(benchmark["public_name"], "season_manifest.benchmark.public_name"),
            TasksetPackageReference.from_dict(benchmark["taskset_package"]),
            SeasonSplit.from_dict(splits["development"], "season_manifest.splits.development"),
            SeasonSplit.from_dict(splits["certification"], "season_manifest.splits.certification"),
            SeasonSplit.from_dict(splits["successor"], "season_manifest.splits.successor"),
        )
        expected_splits = {
            "development": SeasonSplit("public", False, "development"),
            "certification": SeasonSplit("hidden", True, "certification"),
            "successor": SeasonSplit("hidden", False, "anti-overfit"),
        }
        actual_splits = {
            "development": manifest.development,
            "certification": manifest.certification,
            "successor": manifest.successor,
        }
        if actual_splits != expected_splits:
            raise ModelValidationError("season_manifest.splits must use the fixed three-split policy")
        if manifest.season_id != manifest.expected_season_id():
            raise ModelValidationError("season_manifest.season_id does not match the canonical manifest content")
        return manifest
