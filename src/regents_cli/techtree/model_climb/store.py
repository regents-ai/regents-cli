"""Model Climb's local store, under `<techtree home>/model-climb/`.

`objects/` holds every scientific object in a file named by its digest, written once: an object
is never edited, and a second write of the same digest must be the same bytes. `grants/` holds
signed grants by id, and beside them the ledger of what happened to each. Reading an object
checks it twice: validation recomputes its digest, and that digest must be the one its file is
named by.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from pydantic import TypeAdapter
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import validate_digest
from regents_cli.techtree.errors import (
    ConflictError,
    NotFoundError,
    ValidationError,
    VerificationError,
)
from regents_cli.techtree.fs import atomic_write_bytes
from regents_cli.techtree.ids import validate_id
from regents_cli.techtree.model_climb.contracts import (
    DIGEST_MISMATCH,
    ExecutionGrant,
    ScientificObject,
)
from regents_cli.techtree.models.base import Digest, ObjectEnvelope

_OBJECT = TypeAdapter[ScientificObject](ScientificObject)
_GRANT = TypeAdapter(ObjectEnvelope[ExecutionGrant])


@dataclass(frozen=True)
class ModelClimbStore:
    root: Path

    @property
    def objects_dir(self) -> Path:
        return self.root / "objects"

    @property
    def grants_dir(self) -> Path:
        return self.root / "grants"

    @property
    def ledger_path(self) -> Path:
        return self.grants_dir / "ledger.jsonl"

    @property
    def profiles_dir(self) -> Path:
        return self.root / "profiles"

    def object_path(self, digest: Digest) -> Path:
        return self.objects_dir / f"{validate_digest(digest).replace(':', '-', 1)}.json"

    def grant_path(self, grant_id: str) -> Path:
        return self.grants_dir / f"{validate_id(grant_id, 'grant')}.json"

    def put(self, value: ScientificObject) -> Path:
        path = self.object_path(value.digest)
        data = _OBJECT.dump_json(value, indent=2) + b"\n"
        if path.exists():
            if path.read_bytes() != data:
                raise ConflictError(
                    f"a different object is already stored under {value.digest}",
                    details={"digest": value.digest, "path": str(path)},
                )
            return path
        atomic_write_bytes(path, data)
        return path

    def get(self, digest: Digest) -> ScientificObject:
        path = self.object_path(digest)
        try:
            raw = path.read_bytes()
        except FileNotFoundError as error:
            raise NotFoundError(
                f"no Model Climb object {digest} on this machine", details={"digest": digest}
            ) from error
        try:
            value = _OBJECT.validate_json(raw)
        except PydanticValidationError as error:
            if any(problem["type"] == DIGEST_MISMATCH for problem in error.errors()):
                raise VerificationError(
                    f"the stored object {digest} was changed after it was sealed",
                    code=DIGEST_MISMATCH,
                    details={"digest": digest, "path": str(path)},
                ) from error
            raise ValidationError(
                f"the stored object {digest} does not hold: {error.errors()[0]['msg']}",
                details={"digest": digest, "path": str(path)},
            ) from error
        if value.digest != digest:
            raise VerificationError(
                f"the file for {digest} holds a different object, {value.digest}",
                code=DIGEST_MISMATCH,
                details={"digest": digest, "path": str(path)},
            )
        return value

    def put_grant(self, envelope: ObjectEnvelope[ExecutionGrant]) -> Path:
        path = self.grant_path(envelope.payload.grant_id)
        if path.exists():
            raise ConflictError(
                f"grant {envelope.payload.grant_id} already exists",
                details={"path": str(path)},
            )
        atomic_write_bytes(path, _GRANT.dump_json(envelope, indent=2) + b"\n")
        return path

    def get_grant(self, grant_id: str) -> ObjectEnvelope[ExecutionGrant]:
        path = self.grant_path(grant_id)
        try:
            raw = path.read_bytes()
        except FileNotFoundError as error:
            raise NotFoundError(
                f"no grant {grant_id} on this machine", details={"grant_id": grant_id}
            ) from error
        try:
            return _GRANT.validate_json(raw)
        except PydanticValidationError as error:
            raise ValidationError(
                f"the stored grant {grant_id} does not hold: {error.errors()[0]['msg']}",
                details={"grant_id": grant_id, "path": str(path)},
            ) from error
