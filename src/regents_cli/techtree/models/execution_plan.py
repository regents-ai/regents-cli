"""The four-plane execution plan a Campaign binds by digest.

Evaluation engine, execution backend, subject backend and evidence backend, each validated on
its own. This build runs locally, reaching the subject directly, and the model says so.
"""

from __future__ import annotations

import re
from typing import Literal, Self

from pydantic import model_validator

from regents_cli.techtree.models.base import Digest, NonEmptyString, ProtocolModel

#: An engine is pinned to a commit, never a branch or tag: a moving name cannot say what ran.
_SOURCE_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


class EvaluationEngineRef(ProtocolModel):
    """Which Verifiers build supplies task identity, task results, and reward."""

    kind: Literal["verifiers"]
    api_generation: Literal["v1"]
    package_version: NonEmptyString
    source_commit: NonEmptyString
    engine_digest: Digest

    @model_validator(mode="after")
    def _check_the_engine_is_pinned_to_content(self) -> Self:
        if _SOURCE_COMMIT_RE.fullmatch(self.source_commit) is None:
            raise ValueError(
                "source_commit must be a full 40-character lowercase commit hash; "
                f"got {self.source_commit!r}"
            )
        return self


class ExecutionBackendSpec(ProtocolModel):
    """Who runs the comparison: the participant's own machine, with no provider."""

    kind: Literal["local"]
    provider: None
    provider_environment_coordinate: None


class SubjectBackendSpec(ProtocolModel):
    """The harness that is measured, reached directly, with no adapter in front of it."""

    kind: Literal["direct"]
    harness_id: NonEmptyString
    harness_version: NonEmptyString
    adapter_id: None
    adapter_version: None
    adapter_contract_version: None


class EvidenceBackendSpec(ProtocolModel):
    """Which evidence the run must produce; coverage is a request, never an outcome."""

    native_evidence: Literal["required"]
    trace_coverage: Literal["not_requested", "requested"]
    coverage_profile_digest: Digest | None

    @model_validator(mode="after")
    def _check_coverage_names_a_profile(self) -> Self:
        if (self.trace_coverage == "requested") != (self.coverage_profile_digest is not None):
            raise ValueError("a coverage profile is named exactly when trace coverage is requested")
        return self


class ResolvedExecutionPlan(ProtocolModel):
    """All four planes, resolved, immutable, and digestible as one object."""

    schema_version: Literal["techtree.execution-plan.v1"]
    kind: Literal["ResolvedExecutionPlan"]
    evaluation: EvaluationEngineRef
    execution: ExecutionBackendSpec
    subject: SubjectBackendSpec
    evidence: EvidenceBackendSpec
