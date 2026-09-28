"""Each release check fails on its own, and a check that could not run is never a pass.

The costly failures: a drifted engine or catalog is reported under the wrong check and goes
unfixed, or a Skill digest the CLI cannot settle is reported as verified.
"""

from __future__ import annotations

from typing import Any

from regents_cli.techtree.release.checks import (
    RELEASE_CORE_DIGEST_MISMATCH,
    ReleaseCheck,
    ReleaseFacts,
    ReleaseVerification,
    verify_release_core,
)
from regents_cli.techtree.release.document import document_digest, render_release_core
from regents_cli.techtree.release.models import ReleaseCore
from tests.techtree.run_log import COORDINATES

ENGINE_DIGEST = "sha256:" + "1a" * 32
CATALOG_DIGEST = "sha256:" + "2b" * 32
SKILL_DIGEST = "sha256:" + "3c" * 32
INTRO_CLIMB = "hello-world-climb@1"
SKILL_OBJECT_URL = f"https://techtree.sh/api/v1/objects/sha256:{'4d' * 32}"


def bound_core(**overrides: Any) -> ReleaseCore:
    fields: dict[str, Any] = {
        "schema_version": "techtree.release-core.v2",
        "release_id": "climb-v0.1.0",
        "cli_version": "0.1.0",
        "protocol_version": "v1alpha1",
        "engine_digest": ENGINE_DIGEST,
        "catalog_digest": CATALOG_DIGEST,
        "intro_climb_reference": INTRO_CLIMB,
        "starter_skill_digest": SKILL_DIGEST,
        "starter_skill_object_url": SKILL_OBJECT_URL,
        "minimum_host_hermes_version": "0.19.0",
        "maximum_tested_host_hermes_version": "0.19.3",
        "subject_hermes_version": "v2026.7.20",
        "publication": COORDINATES,
    }
    return ReleaseCore(**{**fields, **overrides})


def agreeing_facts() -> ReleaseFacts:
    return ReleaseFacts(
        package_version="0.1.0",
        protocol_version="v1alpha1",
        engine_digest=ENGINE_DIGEST,
        catalog_digest=CATALOG_DIGEST,
        climb_references=(INTRO_CLIMB,),
        subject_hermes_versions={INTRO_CLIMB: "v2026.7.20"},
    )


def by_id(result: ReleaseVerification) -> dict[str, ReleaseCheck]:
    checks = {check.id: check for check in result.checks}
    assert len(checks) == len(result.checks), "check identifiers must be unique"
    return checks


def test_an_unexpected_digest_fails_only_the_digest_check() -> None:
    result = verify_release_core(
        render_release_core(bound_core()), agreeing_facts(), expected_digest="sha256:" + "7d" * 32
    )
    assert [check.id for check in result.failures] == ["release_core_digest"]
    assert by_id(result)["release_core_digest"].code == RELEASE_CORE_DIGEST_MISMATCH
    assert result.verified is False


def test_the_expected_digest_is_the_digest_of_the_stored_bytes() -> None:
    raw = render_release_core(bound_core())
    result = verify_release_core(raw, agreeing_facts(), expected_digest=document_digest(raw))
    assert result.verified is True
    assert by_id(result)["release_core_digest"].status == "passed"


def test_a_check_that_could_not_run_is_never_reported_as_a_pass() -> None:
    result = verify_release_core(render_release_core(bound_core()), agreeing_facts())
    assert {check.id for check in result.skipped} == {
        "release_core_digest",
        "starter_skill_digest",
        "starter_skill_object_url",
    }
    assert all(check.status != "passed" for check in result.skipped)
