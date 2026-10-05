"""Whether one release still agrees with itself: each ReleaseCore claim against the thing it names.

A check is passed, failed or skipped, and a verification is verified when nothing failed. A
check that could not run is never reported as a pass: a starter Skill's digest and its address
cannot be settled from inside an installed CLI that contacts nothing, so each Climb's is skipped
with its values in the detail.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from importlib.metadata import version
from typing import Final, Literal, Self

from pydantic import model_validator

from regents_cli.techtree.engines.bundle import shipped_engines
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.execution_facts import bound_execution_plan_digest
from regents_cli.techtree.models.base import Digest, NonEmptyString, ProtocolModel
from regents_cli.techtree.models.campaign import CampaignSpecV4
from regents_cli.techtree.models.catalog import CatalogIndexV2
from regents_cli.techtree.models.climb import ClimbManifest
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.release.document import (
    document_digest,
    is_canonical_document,
    packaged_resources_root,
    parse_release_core,
)
from regents_cli.techtree.release.models import ReleaseCore

PROTOCOL_VERSION: Final = "v1alpha1"

RELEASE_CORE_INVALID: Final = "release_core_invalid"
RELEASE_CORE_NOT_CANONICAL: Final = "release_core_not_canonical"
RELEASE_CORE_DIGEST_MISMATCH: Final = "release_core_digest_mismatch"
RELEASE_COORDINATE_MISMATCH: Final = "release_coordinate_mismatch"
#: Why a check could not be run. Never a failure and never a pass.
RELEASE_CHECK_NOT_APPLICABLE: Final = "release_check_not_applicable"

type ReleaseCheckStatus = Literal["passed", "failed", "skipped"]


class ReleaseCheck(ProtocolModel):
    """One named claim, and what comparing it against reality found."""

    id: NonEmptyString
    status: ReleaseCheckStatus
    code: NonEmptyString
    detail: NonEmptyString


class ReleaseVerification(ProtocolModel):
    """Every check a release verification ran, and its single verdict."""

    verified: bool
    checks: list[ReleaseCheck]

    @property
    def failures(self) -> list[ReleaseCheck]:
        return [check for check in self.checks if check.status == "failed"]

    @property
    def skipped(self) -> list[ReleaseCheck]:
        return [check for check in self.checks if check.status == "skipped"]

    @model_validator(mode="after")
    def _check_verdict_follows_the_checks(self) -> Self:
        if self.verified != (not self.failures):
            raise ValueError(
                "a release verifies exactly when no check failed; this one claims "
                f"verified={self.verified} with {len(self.failures)} failed checks"
            )
        return self


@dataclass(frozen=True)
class ClimbFacts:
    """What one shipped Climb's Campaign actually binds."""

    engine_digest: Digest
    subject_hermes_version: str


@dataclass(frozen=True)
class ReleaseFacts:
    """What this package actually contains, as plain values, so a check is a pure comparison."""

    package_version: str
    protocol_version: str
    catalog_digest: Digest
    #: Keyed by Climb reference, in catalog order.
    climbs: Mapping[str, ClimbFacts]
    shipped_engine_digests: frozenset[Digest]


def local_release_facts() -> ReleaseFacts:
    """The facts the shipped ReleaseCore is checked against, read off the packaged resources."""
    resources = packaged_resources_root()
    catalog_root = resources / "catalog"
    index_bytes = (catalog_root / "catalog.json").read_bytes()
    index = CatalogIndexV2.model_validate_json(index_bytes)
    climbs: dict[str, ClimbFacts] = {}
    for entry in index.climbs:
        climb = ClimbManifest.model_validate_json((catalog_root / entry.path).read_bytes())
        campaign = CampaignSpecV4.model_validate_json(
            (catalog_root / _object_path(index, climb.campaign_spec_digest)).read_bytes()
        )
        plan = ResolvedExecutionPlan.model_validate_json(
            (catalog_root / _object_path(index, campaign.execution_plan_digest)).read_bytes()
        )
        bound_execution_plan_digest(campaign, plan)
        climbs[entry.reference] = ClimbFacts(
            engine_digest=plan.evaluation.engine_digest,
            subject_hermes_version=plan.subject.harness_version,
        )
    return ReleaseFacts(
        package_version=version("regents-cli"),
        protocol_version=PROTOCOL_VERSION,
        catalog_digest=document_digest(index_bytes),
        climbs=climbs,
        shipped_engine_digests=frozenset(shipped_engines()),
    )


def _object_path(index: CatalogIndexV2, digest: Digest) -> str:
    location = index.objects.get(digest)
    if location is None:
        raise ValidationError(
            f"the packaged catalog files no object under {digest}",
            details={"digest": digest},
        )
    return location.path


def verify_release_core(
    raw: bytes, facts: ReleaseFacts, *, expected_digest: Digest | None = None
) -> ReleaseVerification:
    """Check a stored ReleaseCore against the build it claims to describe."""
    checks = [_document_check(raw)]
    if checks[0].status == "failed":
        return _verification(checks)
    core = parse_release_core(raw)
    checks.extend(
        [
            _canonical_bytes_check(raw),
            _digest_check(raw, expected_digest),
            _cli_version_check(core, facts),
            _equality(
                "protocol_version",
                claimed=core.protocol_version,
                actual=facts.protocol_version,
                subject="the protocol version",
            ),
            _equality(
                "catalog_digest",
                claimed=core.catalog_digest,
                actual=facts.catalog_digest,
                subject="the catalog index",
            ),
            _climbs_check(core, facts),
            _subject_hermes_check(core, facts),
        ]
    )
    for reference in sorted(core.climbs.keys() & facts.climbs.keys()):
        checks.extend(
            [
                _engine_check(reference, core, facts),
                _starter_skill_check(reference, core),
            ]
        )
    return _verification(checks)


def _document_check(raw: bytes) -> ReleaseCheck:
    try:
        core = parse_release_core(raw)
    except ValidationError as error:
        return _failed("release_core_document", RELEASE_CORE_INVALID, str(error))
    return _passed(
        "release_core_document",
        f"the ReleaseCore is valid: release {core.release_id}, with every coordinate concrete.",
    )


def _canonical_bytes_check(raw: bytes) -> ReleaseCheck:
    if is_canonical_document(raw):
        return _passed(
            "release_core_canonical_bytes", "the stored bytes are in the one published spelling."
        )
    return _failed(
        "release_core_canonical_bytes",
        RELEASE_CORE_NOT_CANONICAL,
        "the stored bytes are not in the published spelling, so their digest is not the digest "
        "the generator would produce; regenerate rather than edit this file.",
    )


def _digest_check(raw: bytes, expected: Digest | None) -> ReleaseCheck:
    actual = document_digest(raw)
    if expected is None:
        return _skipped(
            "release_core_digest", f"no expected digest was given; these bytes are {actual}."
        )
    if actual == expected:
        return _passed("release_core_digest", f"the embedded ReleaseCore is {actual}, as expected.")
    return _failed(
        "release_core_digest",
        RELEASE_CORE_DIGEST_MISMATCH,
        f"the embedded ReleaseCore is {actual}, not the expected {expected}.",
    )


def _cli_version_check(core: ReleaseCore, facts: ReleaseFacts) -> ReleaseCheck:
    if core.cli_version == facts.package_version:
        return _passed(
            "cli_version",
            f"the installed package is {facts.package_version}, the version this release names.",
        )
    return _failed(
        "cli_version",
        RELEASE_COORDINATE_MISMATCH,
        f"this release names CLI version {core.cli_version}, but the installed package is "
        f"{facts.package_version}.",
    )


def _climbs_check(core: ReleaseCore, facts: ReleaseFacts) -> ReleaseCheck:
    claimed, shipped = sorted(core.climbs), sorted(facts.climbs)
    if claimed == shipped:
        return _passed(
            "climbs",
            f"this build ships {', '.join(shipped)}, the Climbs this release names, led by "
            f"{core.intro_climb_reference}.",
        )
    return _failed(
        "climbs",
        RELEASE_COORDINATE_MISMATCH,
        f"this release names the Climbs {claimed}, but this build ships {shipped}.",
    )


def _subject_hermes_check(core: ReleaseCore, facts: ReleaseFacts) -> ReleaseCheck:
    others = sorted(
        f"{reference} pins {climb.subject_hermes_version}"
        for reference, climb in facts.climbs.items()
        if climb.subject_hermes_version != core.subject_hermes_version
    )
    if not others:
        return _passed(
            "subject_hermes_version",
            f"every Campaign pins the subject harness {core.subject_hermes_version}, as the "
            "release says.",
        )
    return _failed(
        "subject_hermes_version",
        RELEASE_COORDINATE_MISMATCH,
        f"the release says every Campaign pins the subject harness "
        f"{core.subject_hermes_version}, but {'; '.join(others)}.",
    )


def _engine_check(reference: str, core: ReleaseCore, facts: ReleaseFacts) -> ReleaseCheck:
    """The engine a Climb names is the one its Campaign binds, and this build ships it."""
    identifier = f"engine_digest:{reference}"
    claimed = core.climbs[reference].engine_digest
    bound = facts.climbs[reference].engine_digest
    if claimed != bound:
        return _failed(
            identifier,
            RELEASE_COORDINATE_MISMATCH,
            f"the release says {reference} runs on engine {claimed}; its Campaign binds {bound}.",
        )
    if bound not in facts.shipped_engine_digests:
        return _failed(
            identifier,
            RELEASE_COORDINATE_MISMATCH,
            f"{reference} runs on engine {bound}, which this build does not ship.",
        )
    return _passed(
        identifier,
        f"{reference} runs on engine {bound}, which this build ships, as the release says.",
    )


def _starter_skill_check(reference: str, core: ReleaseCore) -> ReleaseCheck:
    """Reported rather than checked: the CLI ships no Skill bytes and `release verify` contacts
    nothing. What is served is checked against the digest when it is obtained."""
    climb = core.climbs[reference]
    return _skipped(
        f"starter_skill:{reference}",
        f"this release binds {reference}'s starter Skill to {climb.starter_skill_digest}, "
        f"published at {climb.starter_skill_object_url}; the CLI package carries no Skill "
        "bytes, so the plugin and the website verify it against the Skill they serve.",
    )


def _equality(identifier: str, *, claimed: str, actual: str, subject: str) -> ReleaseCheck:
    if claimed == actual:
        return _passed(identifier, f"{subject} is {actual}, as the release says.")
    return _failed(
        identifier,
        RELEASE_COORDINATE_MISMATCH,
        f"the release says {subject} is {claimed}; it is {actual}.",
    )


def _passed(identifier: str, detail: str) -> ReleaseCheck:
    return ReleaseCheck(id=identifier, status="passed", code="ok", detail=detail)


def _failed(identifier: str, code: str, detail: str) -> ReleaseCheck:
    return ReleaseCheck(id=identifier, status="failed", code=code, detail=detail)


def _skipped(identifier: str, detail: str) -> ReleaseCheck:
    return ReleaseCheck(
        id=identifier, status="skipped", code=RELEASE_CHECK_NOT_APPLICABLE, detail=detail
    )


def _verification(checks: list[ReleaseCheck]) -> ReleaseVerification:
    return ReleaseVerification(
        verified=not any(check.status == "failed" for check in checks), checks=checks
    )
