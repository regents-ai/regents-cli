"""Whether a Campaign sets every limit the engine enforces, and the prices results are shown at.

A run's spend is held to the Campaign's maximum while it runs, from the costs the provider
reports (`runs/spend.py`). The prices here only turn a finished run's token counts into the
figure its result shows; they are a fact about a provider's rate card on a particular day, not
protocol values.
"""

from __future__ import annotations

from typing import Final

from pydantic import Field

from regents_cli.techtree.errors import PrerequisiteError
from regents_cli.techtree.models.base import NonEmptyString, ProtocolModel
from regents_cli.techtree.models.campaign import CampaignSpecV2

CAMPAIGN_BUDGET_NOT_ENFORCED: Final = "campaign_budget_not_enforced"
SUBJECT_PRICE_PROFILE_MISSING: Final = "subject_price_profile_missing"

PRICE_PROFILE_SCHEMA_VERSION: Final = "techtree.price-profile.v1"


class PriceProfile(ProtocolModel):
    """What one subject model costs per million tokens, as its provider published it."""

    schema_version: NonEmptyString
    model_id: NonEmptyString
    input_usd_per_mtok: float = Field(gt=0.0)
    output_usd_per_mtok: float = Field(gt=0.0)
    source: NonEmptyString
    recorded_on: NonEmptyString


#: The prices this release shows results at.
RELEASE_PRICE_PROFILES: Final[tuple[PriceProfile, ...]] = (
    PriceProfile(
        schema_version=PRICE_PROFILE_SCHEMA_VERSION,
        model_id="openai/gpt-6-luna",
        input_usd_per_mtok=0.10,
        output_usd_per_mtok=0.50,
        source="Prime Intellect published rate card for openai/gpt-6-luna",
        recorded_on="2026-09-30",
    ),
)


def price_profile_for(model_id: str) -> PriceProfile:
    """The recorded prices for one subject model; a missing profile is a refusal, not a guess."""
    for profile in RELEASE_PRICE_PROFILES:
        if profile.model_id == model_id:
            return profile
    raise PrerequisiteError(
        f"this release records no provider prices for {model_id}",
        code=SUBJECT_PRICE_PROFILE_MISSING,
        details={"model_id": model_id},
    )


def require_executable_budget(campaign: CampaignSpecV2) -> None:
    """Refuse a Campaign that leaves any limit the engine can enforce empty."""
    missing: list[str] = []
    if campaign.execution.timeout_seconds <= 0:
        missing.append("execution.timeout_seconds")
    if campaign.budgets.maximum_model_calls is None:
        missing.append("budgets.maximum_model_calls")
    if campaign.budgets.maximum_input_tokens is None:
        missing.append("budgets.maximum_input_tokens")
    if campaign.budgets.maximum_output_tokens is None:
        missing.append("budgets.maximum_output_tokens")
    if missing:
        raise PrerequisiteError(
            "this public Campaign has unenforced or missing execution limits",
            code=CAMPAIGN_BUDGET_NOT_ENFORCED,
            details={"campaign_id": campaign.metadata.id, "missing": list(missing)},
        )
