"""Model Climb proofs (contract model-climb-v1, section 3.5): a `ModelUpliftReport`, every object
it reaches by digest, and a manifest signed with this machine's Techtree identity key.

On disk a proof is `manifest.json` and `objects/<64 hex>.json`, one file per object named by its
digest. Sent to Techtree it is one document, `{schema_version, manifest, objects}`, objects
sorted by digest, as canonical bytes whose digest is also the request's `Idempotency-Key`.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Final, Literal

from pydantic import TypeAdapter

from regents_cli.techtree.canonical import canonical_json_bytes
from regents_cli.techtree.errors import ConflictError, NotFoundError, ValidationError
from regents_cli.techtree.fs import atomic_write_bytes, read_json
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.model_climb.contracts import ModelUpliftReport, ScientificObject
from regents_cli.techtree.model_climb.store import ModelClimbStore
from regents_cli.techtree.models.base import (
    Base64String,
    Digest,
    JsonValue,
    NonEmptyString,
    ObjectEnvelope,
    ProtocolModel,
)

PROOF_SCHEMA_VERSION: Final = "techtree.model-climb.proof.v1alpha1"
#: The largest document Techtree keeps, and the most objects it may carry (contract 3.5, check 1).
MAX_DOCUMENT_BYTES: Final = 1_048_576
MAX_OBJECTS: Final = 64

#: The spec fields that name another object, by kind (contract 3.2, "Refers to"). Every other
#: digest in a spec names bytes, not an object.
REFERENCES: Final[dict[str, tuple[str, ...]]] = {
    "ModelStudySpec": ("dataset_release", "benchmark_release"),
    "DatasetRelease": (),
    "BenchmarkRelease": ("dataset_release",),
    "TrainingRecipe": (),
    "ResolvedModelPlan": ("study", "dataset_release", "benchmark_release", "recipe"),
    "ModelArtifact": ("plan", "attempt"),
    "TrainingAttempt": ("plan", "predecessor"),
    "ModelUpliftReport": ("artifact", "benchmark_release"),
}

_OBJECT_FILE: Final = re.compile(r"^([0-9a-f]{64})\.json$")
_OBJECT = TypeAdapter[ScientificObject](ScientificObject)


class ProofSigner(ProtocolModel):
    kind: Literal["local_ed25519"]
    algorithm: Literal["ed25519"]
    key_id: NonEmptyString
    public_key: Base64String


class ProofManifest(ProtocolModel):
    schema_version: Literal["techtree.model-climb.proof.v1alpha1"]
    report: Digest
    objects: list[Digest]
    signer: ProofSigner


_MANIFEST = TypeAdapter(ObjectEnvelope[ProofManifest])


def write(
    store: ModelClimbStore, service: IdentityService, report: Digest, folder: Path
) -> ObjectEnvelope[ProofManifest]:
    """Write the proof of `report` into the new folder `folder`, signed with this machine's key."""
    if folder.exists():
        raise ConflictError(
            f"{folder} already exists; a proof is written into a new folder",
            details={"folder": str(folder)},
        )
    head = store.get(report)
    if not isinstance(head, ModelUpliftReport):
        raise ValidationError(
            f"{report} is a {head.kind}, not a ModelUpliftReport", details={"digest": report}
        )
    carried = _reachable(store, head)
    identity = service.ensure()
    envelope = service.sign_object(
        ProofManifest(
            schema_version=PROOF_SCHEMA_VERSION,
            report=report,
            objects=sorted(carried),
            signer=ProofSigner(
                kind=identity.kind,
                algorithm=identity.algorithm,
                key_id=identity.key_id,
                public_key=identity.public_key,
            ),
        )
    )
    for digest, value in carried.items():
        name = digest.removeprefix("sha256:")
        atomic_write_bytes(folder / "objects" / f"{name}.json", _OBJECT.dump_json(value, indent=2))
    atomic_write_bytes(folder / "manifest.json", _MANIFEST.dump_json(envelope, indent=2))
    return envelope


def _reachable(store: ModelClimbStore, head: ScientificObject) -> dict[Digest, ScientificObject]:
    """`head` and every object it reaches by digest, each read and checked from the store."""
    found: dict[Digest, ScientificObject] = {}
    waiting: list[ScientificObject] = [head]
    while waiting:
        value = waiting.pop()
        if value.digest in found:
            continue
        found[value.digest] = value
        for field in REFERENCES.get(value.kind, ()):
            named: Digest | None = getattr(value.spec, field)
            if named is None or named in found:
                continue
            try:
                waiting.append(store.get(named))
            except NotFoundError as error:
                raise NotFoundError(
                    f"the {value.kind} {value.digest} names {field} {named}, which is not on "
                    "this machine, so the proof would be incomplete",
                    details={"digest": named, "named_by": value.digest, "field": field},
                ) from error
    return found


def document(folder: Path) -> bytes:
    """The proof in `folder` as the canonical bytes sent to Techtree, refused here when it is
    larger than Techtree keeps."""
    manifest = read_json(folder / "manifest.json")
    objects_dir = folder / "objects"
    if not objects_dir.is_dir():
        raise ValidationError(f"{folder} has no objects/ folder", details={"folder": str(folder)})
    objects: dict[str, JsonValue] = {}
    for path in objects_dir.iterdir():
        named = _OBJECT_FILE.fullmatch(path.name)
        value = read_json(path) if named else None
        if (
            named is None
            or not isinstance(value, dict)
            or value.get("digest") != (f"sha256:{named[1]}")
        ):
            raise ValidationError(
                f"{path} is not an object file named by its own digest",
                details={"path": str(path)},
            )
        objects[f"sha256:{named[1]}"] = value
    if len(objects) > MAX_OBJECTS:
        raise ValidationError(
            f"the proof carries {len(objects)} objects; Techtree keeps at most {MAX_OBJECTS}",
            details={"check": "document", "objects": len(objects)},
        )
    data = canonical_json_bytes(
        {
            "schema_version": PROOF_SCHEMA_VERSION,
            "manifest": manifest,
            "objects": [objects[digest] for digest in sorted(objects)],
        }
    )
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValidationError(
            f"the proof is {len(data)} bytes; Techtree keeps at most {MAX_DOCUMENT_BYTES}",
            details={"check": "document", "bytes": len(data)},
        )
    return data
