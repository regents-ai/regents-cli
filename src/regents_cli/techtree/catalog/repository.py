"""Reading the embedded catalog: every object is re-digested, and nothing outside the root is read.

The index maps a public reference, and every object digest it depends on, to a file inside
the package. Each object is parsed into its model and re-digested from the canonical form; a
file whose bytes drifted from the digest it is filed under is a VerificationError.
"""

from __future__ import annotations

import json
from importlib import resources
from importlib.resources.abc import Traversable
from pathlib import Path
from typing import Final

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object, sha256_digest_bytes
from regents_cli.techtree.errors import NotFoundError, ValidationError, VerificationError
from regents_cli.techtree.fs import realpath_within
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.models.campaign import CampaignSpecV2
from regents_cli.techtree.models.catalog import (
    CatalogClimbEntry,
    CatalogIndexV2,
    CatalogObjectLocationV2,
)
from regents_cli.techtree.models.climb import ClimbManifest
from regents_cli.techtree.models.data_policy import DataPolicy
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.validation import TasksetValidationReceipt, ValidationEvidence

CATALOG_INDEX_FILENAME: Final = "catalog.json"

_KIND_FOR_MODEL: Final[dict[type[BaseModel], str]] = {
    CampaignSpecV2: "campaign",
    DataPolicy: "data_policy",
    ResolvedExecutionPlan: "execution_plan",
    TasksetValidationReceipt: "taskset_validation",
    ValidationEvidence: "validation_evidence",
}
_REFERENCE_SEPARATOR: Final = "@"
_CLIMB_ID_PREFIX: Final = "climb_"


def packaged_catalog_root() -> Traversable:
    """The catalog directory shipped inside the installed package."""
    return resources.files("regents_cli.techtree") / "resources" / "catalog"


def climb_reference(climb: ClimbManifest) -> str:
    """The public reference a Climb manifest spells out: `slug@version`."""
    return f"{climb.metadata.slug}{_REFERENCE_SEPARATOR}{climb.metadata.version}"


class EmbeddedCatalogRepository:
    """Loads and verifies the objects one catalog directory contains."""

    def __init__(self, resource_root: Traversable) -> None:
        self._root = resource_root
        self._index: CatalogIndexV2 | None = None

    @classmethod
    def packaged(cls) -> EmbeddedCatalogRepository:
        return cls(packaged_catalog_root())

    def index(self) -> CatalogIndexV2:
        """The validated index, read once; every path it names is checked at the door."""
        if self._index is not None:
            return self._index
        raw = self._read_bytes(CATALOG_INDEX_FILENAME, self._resolve(CATALOG_INDEX_FILENAME))
        try:
            index = CatalogIndexV2.model_validate_json(raw)
        except PydanticValidationError as error:
            raise ValidationError(
                f"the catalog index is not a valid catalog: {_first_problem(error)}",
                code="catalog_index_invalid",
                details={"path": CATALOG_INDEX_FILENAME},
            ) from error
        for entry in index.climbs:
            self._resolve(entry.path)
        for location in index.objects.values():
            self._resolve(location.path)
        self._index = index
        return index

    def list_climb_references(self) -> list[str]:
        return [entry.reference for entry in self.index().climbs]

    def climb_entry(self, reference: str) -> CatalogClimbEntry:
        """Resolve a slug (its highest version), a `slug@version`, or an exact public id."""
        index = self.index()
        for entry in index.climbs:
            if entry.reference == reference:
                return entry
        by_slug = [entry for entry in index.climbs if _reference_slug(entry.reference) == reference]
        if by_slug:
            return max(by_slug, key=lambda entry: _reference_version(entry.reference))
        if reference.startswith(_CLIMB_ID_PREFIX):
            for entry in index.climbs:
                if self._load_climb_entry(entry).metadata.id == reference:
                    return entry
        raise NotFoundError(
            f"this build ships no Climb called {reference!r}",
            code="climb_not_found",
            details={
                "reference": reference,
                "available": [entry.reference for entry in index.climbs],
            },
        )

    def load_climb(self, reference: str) -> ClimbManifest:
        return self._load_climb_entry(self.climb_entry(reference))

    def load_object(self, digest: Digest) -> JsonValue:
        """The JSON document filed under one digest, verified over its canonical form."""
        location = self._object_location(digest)
        raw = self._read_bytes(location.path, self._resolve(location.path))
        document = _parse_json(raw, location.path)
        recomputed = sha256_digest_bytes(canonical_json_bytes(document))
        if recomputed != digest:
            raise _digest_mismatch(digest, recomputed, location.path)
        return document

    def load_campaign(self, digest: Digest) -> CampaignSpecV2:
        return self._load_model(digest, CampaignSpecV2)

    def load_data_policy(self, digest: Digest) -> DataPolicy:
        return self._load_model(digest, DataPolicy)

    def load_execution_plan(self, digest: Digest) -> ResolvedExecutionPlan:
        return self._load_model(digest, ResolvedExecutionPlan)

    def load_validation_receipt(self, digest: Digest) -> TasksetValidationReceipt:
        return self._load_model(digest, TasksetValidationReceipt)

    def load_validation_evidence(self, digest: Digest) -> ValidationEvidence:
        return self._load_model(digest, ValidationEvidence)

    def _load_climb_entry(self, entry: CatalogClimbEntry) -> ClimbManifest:
        climb = _parse_model(
            self._read_bytes(entry.path, self._resolve(entry.path)), ClimbManifest, entry.path
        )
        recomputed = digest_object(climb)
        if recomputed != entry.digest:
            raise _digest_mismatch(entry.digest, recomputed, entry.path)
        stated = climb_reference(climb)
        if stated != entry.reference:
            raise ValidationError(
                f"the catalog lists {entry.reference!r} but the manifest at that path calls "
                f"itself {stated!r}",
                code="catalog_reference_mismatch",
                details={"indexed": entry.reference, "manifest": stated},
            )
        return climb

    def _load_model[ModelT: BaseModel](self, digest: Digest, model: type[ModelT]) -> ModelT:
        """Load, type-check, and digest-verify one content-addressed object."""
        location = self._object_location(digest)
        expected_kind = _KIND_FOR_MODEL[model]
        if location.kind != expected_kind:
            raise ValidationError(
                f"the catalog files {digest} as a {location.kind} object, and a "
                f"{expected_kind} object was asked for",
                code="catalog_kind_mismatch",
                details={
                    "digest": digest,
                    "indexed_kind": location.kind,
                    "requested_kind": expected_kind,
                },
            )
        raw = self._read_bytes(location.path, self._resolve(location.path))
        loaded = _parse_model(raw, model, location.path)
        recomputed = digest_object(loaded)
        if recomputed != digest:
            raise _digest_mismatch(digest, recomputed, location.path)
        return loaded

    def _object_location(self, digest: Digest) -> CatalogObjectLocationV2:
        location = self.index().objects.get(digest)
        if location is None:
            raise NotFoundError(
                f"the catalog has no object filed under {digest}",
                code="catalog_object_not_found",
                details={"digest": digest},
            )
        return location

    def _resolve(self, relative: str) -> Traversable:
        """The file one index path names, refusing a link that leaves the catalog."""
        child = self._root
        for segment in relative.split("/"):
            if segment in ("", ".", ".."):
                raise ValidationError(
                    f"catalog path {relative!r} is not a normalized relative path",
                    code="catalog_path_traversal",
                    details={"path": relative},
                )
            child = child / segment
        if (
            isinstance(child, Path)
            and isinstance(self._root, Path)
            and not realpath_within(child, self._root)
        ):
            raise ValidationError(
                f"catalog path {relative!r} resolves outside the catalog",
                code="catalog_path_traversal",
                details={"path": relative},
            )
        if not child.is_file():
            raise NotFoundError(
                f"the catalog lists {relative!r}, and this build does not ship it",
                code="catalog_file_missing",
                details={"path": relative},
            )
        return child

    def _read_bytes(self, relative: str, source: Traversable) -> bytes:
        try:
            return source.read_bytes()
        except FileNotFoundError as error:
            raise NotFoundError(
                f"the catalog lists {relative!r}, and this build does not ship it",
                code="catalog_file_missing",
                details={"path": relative},
            ) from error
        except OSError as error:
            raise ValidationError(
                f"the catalog file {relative!r} could not be read: {error.strerror or error}",
                code="catalog_file_unreadable",
                details={"path": relative},
            ) from error


def _parse_model[ModelT: BaseModel](raw: bytes, model: type[ModelT], relative: str) -> ModelT:
    try:
        return model.model_validate_json(raw)
    except PydanticValidationError as error:
        raise ValidationError(
            f"the catalog file {relative!r} is not a valid {model.__name__}: "
            f"{_first_problem(error)}",
            code="catalog_object_invalid",
            details={"path": relative, "expected": model.__name__},
        ) from error


def _digest_mismatch(expected: Digest, recomputed: Digest, relative: str) -> VerificationError:
    return VerificationError(
        f"the catalog file {relative!r} does not match the digest it is filed under",
        code="catalog_digest_mismatch",
        details={"path": relative, "expected_digest": expected, "computed_digest": recomputed},
    )


def _parse_json(raw: bytes, relative: str) -> JsonValue:
    try:
        document: JsonValue = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValidationError(
            f"the catalog file {relative!r} is not valid JSON",
            code="catalog_object_invalid",
            details={"path": relative},
        ) from error
    return document


def _reference_slug(reference: str) -> str:
    return reference.partition(_REFERENCE_SEPARATOR)[0]


def _reference_version(reference: str) -> int:
    _, _, version = reference.partition(_REFERENCE_SEPARATOR)
    return int(version) if version.isdigit() else 0


def _first_problem(error: PydanticValidationError) -> str:
    first = error.errors()[0]
    location = ".".join(str(part) for part in first["loc"])
    return f"{location}: {first['msg']}" if location else str(first["msg"])
