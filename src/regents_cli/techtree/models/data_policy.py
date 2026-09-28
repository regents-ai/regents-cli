"""Rights and permitted future uses of Campaign artifacts.

Immutable by digest: changing any permission changes the Campaign. A policy that permits a use
is not a command that performs it; only `techtree publish` sends a run anywhere.
"""

from __future__ import annotations

from typing import Literal, Self

from pydantic import Field, model_validator

from regents_cli.techtree.models.base import NonEmptyString, ProtocolModel

type Permission = Literal["allowed", "prohibited", "consent_required"]
type Visibility = Literal["public", "private", "prohibited"]


class DataOwner(ProtocolModel):
    """Who owns the artifacts a Campaign produces."""

    kind: Literal["participant", "account", "shared"]
    account_ref: NonEmptyString | None = None

    @model_validator(mode="after")
    def _check_account_reference_matches_ownership(self) -> Self:
        if self.kind == "account" and self.account_ref is None:
            raise ValueError("account-owned data must name the owning account_ref")
        if self.kind == "participant" and self.account_ref is not None:
            raise ValueError("participant-owned data must not name an account_ref")
        return self


class RawEpisodePolicy(ProtocolModel):
    """What may happen to raw episode transcripts."""

    local_retention: Literal["allowed", "prohibited", "required"]
    server_upload: Permission
    public_release: Permission
    reproduction_access: Permission
    training_use: Permission


class DerivedArtifactPolicy(ProtocolModel):
    """What may happen to everything computed from the episodes."""

    aggregate_scores: Visibility
    uplift_report: Visibility
    redacted_trace_projection: Visibility
    anonymized_product_analytics: Permission


class CandidateSkillPolicy(ProtocolModel):
    """Who owns the submitted Skill and whether it can be published."""

    ownership: Literal["participant", "account", "shared"]
    public_release: Literal["required_for_climb", "allowed", "prohibited", "consent_required"]
    training_use: Permission


class RevocationPolicy(ProtocolModel):
    """What a participant can withdraw later, and what stays published."""

    future_use_revocable: bool
    immutable_published_proofs_remain: bool


class DataPolicy(ProtocolModel):
    """The complete rights statement a Campaign runs under."""

    schema_version: Literal["techtree.data-policy.v1alpha1"]
    id: NonEmptyString
    version: int = Field(ge=1)
    owner: DataOwner
    raw_episodes: RawEpisodePolicy
    derived_artifacts: DerivedArtifactPolicy
    candidate_skill: CandidateSkillPolicy
    revocation: RevocationPolicy

    @model_validator(mode="after")
    def _check_internal_consistency(self) -> Self:
        """Reject a policy that permits a use it also makes impossible."""
        if self.raw_episodes.local_retention == "prohibited":
            for name in ("server_upload", "public_release", "reproduction_access", "training_use"):
                if getattr(self.raw_episodes, name) != "prohibited":
                    raise ValueError(
                        f"raw_episodes.{name} cannot be permitted while local_retention is "
                        "prohibited; there would be nothing left to share"
                    )
        return self
