"""Model Climb proofs (contract model-climb-v1, section 3.5): a `ModelUpliftReport`, every object
it reaches by digest, and a manifest signed with this machine's Techtree identity key.

On disk a proof is `manifest.json` and `objects/<64 hex>.json`, one file per object named by its
digest. Sent to Techtree it is one document, `{schema_version, manifest, objects}`, objects
sorted by digest, as canonical bytes whose digest is also the request's `Idempotency-Key`.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Literal, TypeGuard

from cryptography.exceptions import InvalidSignature
from pydantic import TypeAdapter
from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import (
    canonical_json_bytes,
    digest_object,
    sha256_digest_bytes,
)
from regents_cli.techtree.crypto import load_public_key
from regents_cli.techtree.errors import ConflictError, NotFoundError, ValidationError
from regents_cli.techtree.fs import atomic_write_bytes, read_json
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.model_climb.contracts import ModelUpliftReport, ScientificObject
from regents_cli.techtree.model_climb.store import ModelClimbStore
from regents_cli.techtree.models.base import (
    DIGEST_PATTERN,
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

#: The spec fields that name another object, by kind (contract 3.2, "Refers to"), each a field
#: holding a digest or a list of them, or `list[].field` inside a list of records. A
#: predecessor names an object of the same kind. Every other digest in a spec names bytes.
REFERENCES: Final[dict[str, tuple[str, ...]]] = {
    "ModelStudySpec": ("dataset_release", "benchmark_release"),
    "DatasetRelease": (),
    "BenchmarkRelease": ("dataset_release",),
    "TrainingRecipe": (),
    "ResolvedModelPlan": ("study", "dataset_release", "benchmark_release", "recipe"),
    "ModelArtifact": ("plan", "attempt"),
    "TrainingAttempt": ("plan", "predecessor"),
    "ModelUpliftReport": ("artifact", "benchmark_release"),
    "ServiceComparisonReport": ("deployments", "business_metrics[].deployment"),
    "DeploymentRelease": ("artifact", "predecessor"),
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
        for field, named in references(value.kind, value.spec.model_dump(mode="json")):
            if named in found:
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


def references(kind: str, spec: object) -> list[tuple[str, str]]:
    """Each object a spec of `kind` names, as (field, digest)."""
    if not isinstance(spec, dict):
        return []
    named: list[tuple[str, str]] = []
    for path in REFERENCES.get(kind, ()):
        field, _, inner = path.partition("[].")
        value = spec.get(field)
        items = value if isinstance(value, list) else [value]
        if inner:
            items = [item.get(inner) if isinstance(item, dict) else None for item in items]
        named += [(path, item) for item in items if isinstance(item, str)]
    return named


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
                details={"check": "objects", "path": str(path)},
            )
        objects[f"sha256:{named[1]}"] = value
    if len(objects) > MAX_OBJECTS:
        raise ValidationError(
            f"the proof carries {len(objects)} objects; Techtree keeps at most {MAX_OBJECTS}",
            details={"check": "document", "objects": len(objects)},
        )
    try:
        data = canonical_json_bytes(
            {
                "schema_version": PROOF_SCHEMA_VERSION,
                "manifest": manifest,
                "objects": [objects[digest] for digest in sorted(objects)],
            }
        )
    except ValidationError as error:
        raise _refusal(
            "document", "the document holds a value JSON cannot write canonically"
        ) from error
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValidationError(
            f"the proof is {len(data)} bytes; Techtree keeps at most {MAX_DOCUMENT_BYTES}",
            details={"check": "document", "bytes": len(data)},
        )
    return data


# -- Checking a proof ----------------------------------------------------------------------
#
# The site's eight checks (Techtree.ModelClimb.Proof), in its order, with its check names and
# sentences, so a proof this command accepts is one the site accepts. Then the two steps only
# this command runs: `graph` and `schema`.

OBJECT_SCHEMA_VERSION: Final = "techtree.model-climb.v1alpha1"
_KINDS: Final = tuple(REFERENCES)
_RESULTS: Final[dict[str, tuple[str, ...]]] = {
    "execution": ("succeeded", "failed", "cancelled", "indeterminate"),
    "integrity": ("verified", "invalid", "incomplete"),
    "comparison": ("valid", "invalid", "exploratory"),
    "outcome": ("uplift", "tie", "regression", "inconclusive"),
    "release_gate": ("pass", "fail", "insufficient_evidence", "not_evaluated"),
    "attestation": ("participant", "identified_executor", "independently_reproduced"),
}
_CELLS: Final = ("both_correct", "base_only_correct", "candidate_only_correct", "neither_correct")
_REPORT_FIELDS: Final = (
    "artifact",
    "benchmark_release",
    "evaluator_outputs",
    "paired_outcomes",
    "uncertainty",
    "results",
    "limitations",
)
_DIGEST: Final = re.compile(DIGEST_PATTERN)

#: Each check's name and what it means when it holds, in the order they run.
CHECKS: Final = (
    ("document", "at most 1,048,576 bytes, the three members, this version, at most 64 objects"),
    ("objects", "every object recomputes to its digest, once each"),
    ("manifest", "the manifest is exactly as contract 3.5 says and its payload_digest recomputes"),
    ("signature", "the signer's key_id fingerprints its key and the signature verifies"),
    ("carried", "the objects carried are exactly the ones the manifest lists"),
    ("report", "the report is a ModelUpliftReport whose numbers add up"),
    ("references", "the report's artifact and benchmark release are carried"),
    ("attestation", "the report claims only participant"),
    ("graph", "every object any carried object refers to is carried"),
    ("schema", "every object matches the pinned schema 7b38f89a field by field"),
)


def is_proof(folder: Path) -> bool:
    """Whether `folder` holds a Model Climb proof, read off its manifest's `schema_version`."""
    manifest = folder / "manifest.json"
    if not manifest.is_file():
        return False
    value = read_json(manifest)
    payload = value.get("payload") if isinstance(value, dict) else None
    return isinstance(payload, dict) and payload.get("schema_version") == PROOF_SCHEMA_VERSION


@dataclass(frozen=True)
class Verified:
    report: Digest
    signer_key_id: str
    objects: int


def verify(folder: Path) -> Verified:
    """Check the proof in `folder`; a refusal names the first check that did not hold."""
    sent = json.loads(document(folder))
    _document(sent)
    objects = _objects(sent["objects"])
    payload = _manifest(sent["manifest"])
    _signature(sent["manifest"])
    # The site names this refusal "objects" (Techtree.ModelClimb.Proof.carried/2).
    if sorted(objects) != payload["objects"]:
        raise _refusal("objects", "the objects carried are not exactly the ones the manifest lists")
    report = _report(payload, objects)
    _references(report["spec"], objects)
    if report["spec"]["results"]["attestation"] != "participant":
        raise _refusal(
            "attestation",
            "an uploaded report's attestation is participant; Techtree gives the other levels "
            "itself",
        )
    _graph(objects)
    _schema(objects)
    return Verified(report["digest"], payload["signer"]["key_id"], len(objects))


def _document(sent: object) -> None:
    if not _exact(sent, ("schema_version", "manifest", "objects")):
        raise _refusal("document", "a proof has exactly schema_version, manifest and objects")
    if sent["schema_version"] != PROOF_SCHEMA_VERSION:
        raise _refusal("document", f"this site reads proofs of version {PROOF_SCHEMA_VERSION}")
    if not isinstance(sent["objects"], list) or len(sent["objects"]) > MAX_OBJECTS:
        raise _refusal("document", f"objects is a list of at most {MAX_OBJECTS} objects")


def _objects(listed: list[object]) -> dict[str, dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    for value in listed:
        if not _exact(value, ("schema_version", "kind", "spec", "operational", "digest")):
            raise _refusal(
                "objects",
                "every object has exactly schema_version, kind, spec, operational and digest",
            )
        if value["schema_version"] != OBJECT_SCHEMA_VERSION:
            raise _refusal("objects", f"every object is of version {OBJECT_SCHEMA_VERSION}")
        if value["kind"] not in _KINDS:
            raise _refusal("objects", f"{json.dumps(value['kind'])} is not a Model Climb kind")
        claimed = value["digest"]
        body = {key: value[key] for key in ("schema_version", "kind", "spec")}
        if digest_object(body) != claimed:
            raise _refusal("objects", f"{json.dumps(claimed)} is not the digest of its object")
        if claimed in seen:
            raise _refusal("objects", f"{claimed} appears twice")
        seen[claimed] = value
    return seen


def _manifest(manifest: object) -> dict[str, Any]:
    if not _exact(manifest, ("payload", "payload_digest", "signature")):
        raise _refusal("manifest", "the manifest has exactly payload, payload_digest and signature")
    payload = manifest["payload"]
    if not _exact(payload, ("schema_version", "report", "objects", "signer")):
        raise _refusal(
            "manifest",
            "the manifest's payload has exactly schema_version, report, objects and signer",
        )
    if payload["schema_version"] != PROOF_SCHEMA_VERSION:
        raise _refusal("manifest", f"the manifest is of version {PROOF_SCHEMA_VERSION}")
    listed = payload["objects"]
    if not (
        isinstance(listed, list)
        and listed
        and all(_is_digest(item) for item in listed)
        and listed == sorted(set(listed))
    ):
        raise _refusal("manifest", "the manifest lists every object's digest once, sorted")
    if not _signer(payload["signer"]):
        raise _refusal("manifest", "the signer is a local Ed25519 key")
    if digest_object(payload) != manifest["payload_digest"]:
        raise _refusal("manifest", "payload_digest is not the digest of the payload")
    return payload


def _signer(signer: object) -> bool:
    return (
        _exact(signer, ("kind", "algorithm", "key_id", "public_key"))
        and signer["kind"] == "local_ed25519"
        and signer["algorithm"] == "ed25519"
        and _is_digest(signer["key_id"])
        and len(_base64(signer["public_key"]) or b"") == 32
    )


def _signature(manifest: dict[str, Any]) -> None:
    signer = manifest["payload"]["signer"]
    key = _base64(signer["public_key"]) or b""
    if sha256_digest_bytes(key) != signer["key_id"]:
        raise _refusal("signature", "the signer's key_id is not the digest of its public key")
    signature = manifest["signature"]
    if not (
        isinstance(signature, dict)
        and signature.get("algorithm") == "ed25519"
        and signature.get("key_id") == signer["key_id"]
        and isinstance(signature.get("signature"), str)
    ):
        raise _refusal(
            "signature", "the signature is {algorithm: ed25519, key_id, signature} by the signer"
        )
    raw = _base64(signature["signature"])
    message = str(manifest["payload_digest"]).encode("ascii")
    try:
        if raw is None or len(raw) != 64:
            raise InvalidSignature
        load_public_key(key).verify(raw, message)
    except InvalidSignature as error:
        raise _refusal(
            "signature", "the signature does not verify under the signer's key"
        ) from error


def _report(payload: dict[str, Any], objects: dict[str, dict[str, Any]]) -> dict[str, Any]:
    named = payload["report"]
    report = objects.get(named) if isinstance(named, str) else None
    if report is None or report["kind"] != "ModelUpliftReport":
        raise _refusal("report", "report names no ModelUpliftReport the proof carries")
    spec = report["spec"]
    if not _exact(spec, _REPORT_FIELDS):
        raise _refusal("report", "the report's spec has exactly the fields section 3.2 names")
    outputs = spec["evaluator_outputs"]
    if not (isinstance(outputs, list) and outputs and all(_is_digest(item) for item in outputs)):
        raise _refusal("report", "evaluator_outputs is at least one digest")
    if not _paired_outcomes(spec["paired_outcomes"]):
        raise _refusal("report", "the paired outcomes do not add up")
    if not _uncertainty(spec["uncertainty"]):
        raise _refusal(
            "report",
            "the uncertainty interval is out of order or its confidence is not between 0 and 1",
        )
    results = spec["results"]
    if not (
        _exact(results, tuple(_RESULTS))
        and all(results[field] in values for field, values in _RESULTS.items())
    ):
        raise _refusal("report", "the result fields take only the values section 3.3 lists")
    limitations = spec["limitations"]
    if not (isinstance(limitations, list) and all(_sentence(item) for item in limitations)):
        raise _refusal("report", "limitations is a list of sentences")
    return report


def _paired_outcomes(outcomes: object) -> bool:
    counts = ("cases", "positives", "negatives", *_CELLS)
    if not _exact(outcomes, counts):
        return False
    if not all(_integer(outcomes[count]) and outcomes[count] >= 0 for count in counts):
        return False
    counted: dict[str, int] = outcomes
    cases = counted["cases"]
    return (
        sum(counted[cell] for cell in _CELLS) == cases
        and counted["positives"] + counted["negatives"] == cases
    )


def _uncertainty(uncertainty: object) -> bool:
    numbers = ("confidence", "interval_low", "interval_high")
    return (
        _exact(uncertainty, ("method", *numbers))
        and _sentence(uncertainty["method"])
        and all(_number(uncertainty[field]) for field in numbers)
        and 0 < uncertainty["confidence"] < 1
        and uncertainty["interval_low"] <= uncertainty["interval_high"]
    )


def _references(spec: dict[str, Any], objects: dict[str, dict[str, Any]]) -> None:
    if not (
        _kind(objects, spec["artifact"]) == "ModelArtifact"
        and _kind(objects, spec["benchmark_release"]) == "BenchmarkRelease"
    ):
        raise _refusal(
            "references",
            "the proof carries the report's artifact as a ModelArtifact and its "
            "benchmark_release as a BenchmarkRelease",
        )


def _graph(objects: dict[str, dict[str, Any]]) -> None:
    for digest in sorted(objects):
        value = objects[digest]
        for field, named in references(str(value["kind"]), value["spec"]):
            if named not in objects:
                raise _refusal(
                    "graph",
                    f"the {value['kind']} {digest} refers to {named} as {field}, which the "
                    "proof does not carry",
                    digest=digest,
                    field=field,
                    missing=named,
                )


def _schema(objects: dict[str, dict[str, Any]]) -> None:
    for digest in sorted(objects):
        try:
            _OBJECT.validate_json(json.dumps(objects[digest]))
        except PydanticValidationError as error:
            first = error.errors()[0]
            where = ".".join(str(part) for part in first["loc"])
            raise _refusal(
                "schema",
                f"the {objects[digest]['kind']} {digest} does not match the pinned schema at "
                f"{where}: {first['msg']}",
                digest=digest,
                field=where,
            ) from error


def _kind(objects: dict[str, dict[str, Any]], named: object) -> object:
    value = objects.get(named) if isinstance(named, str) else None
    return value["kind"] if value is not None else None


def _exact(value: object, keys: tuple[str, ...]) -> TypeGuard[dict[str, Any]]:
    return isinstance(value, dict) and sorted(value) == sorted(keys)


def _is_digest(value: object) -> bool:
    return isinstance(value, str) and _DIGEST.fullmatch(value) is not None


def _base64(value: object) -> bytes | None:
    if not isinstance(value, str):
        return None
    try:
        return base64.b64decode(value, validate=True)
    except binascii.Error:
        return None


def _integer(value: object) -> TypeGuard[int]:
    return isinstance(value, int) and not isinstance(value, bool)


def _number(value: object) -> TypeGuard[int | float]:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _sentence(value: object) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _refusal(check: str, message: str, **details: JsonValue) -> ValidationError:
    return ValidationError(message, details={"check": check, **details})
