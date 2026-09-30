"""Whether a Campaign's declared budgets are budgets, asked before a run starts and never after.

Every declared limit must be enforceable, and the dollar exposure of a comparison under those
limits must sit inside what the Campaign says it may spend. The bound is computed deliberately
high: a whole context window on top of the declared input allowance, one more sampled reply on
top of the declared output allowance, because a bound that is only usually right is not one.
The prices are a fact about a provider's rate card on a particular day, not protocol values.
"""

from __future__ import annotations

import math
from typing import Final

from pydantic import Field

from regents_cli.techtree.errors import PrerequisiteError
from regents_cli.techtree.models.base import JsonValue, NonEmptyString, ProtocolModel
from regents_cli.techtree.models.campaign import CampaignSpecV2

CAMPAIGN_BUDGET_NOT_ENFORCED: Final = "campaign_budget_not_enforced"
CAMPAIGN_COST_BOUND_EXCEEDED: Final = "campaign_cost_bound_exceeded"
SUBJECT_PRICE_PROFILE_MISSING: Final = "subject_price_profile_missing"

PRICE_PROFILE_SCHEMA_VERSION: Final = "techtree.price-profile.v1"

_VARIANTS_PER_COMPARISON: Final = 2
_TOKENS_PER_MILLION: Final = 1_000_000.0


class PriceProfile(ProtocolModel):
    """What one subject model costs; the context window is the other half of the input bound,
    because `max_input_tokens` is checked between turns and one turn may still carry a whole
    window of prompt."""

    schema_version: NonEmptyString
    model_id: NonEmptyString
    input_usd_per_mtok: float = Field(gt=0.0)
    output_usd_per_mtok: float = Field(gt=0.0)
    context_window_tokens: int = Field(ge=1)
    source: NonEmptyString
    recorded_on: NonEmptyString


#: The prices this release was bounded with. The context window is deliberately the largest in
#: common use for models of this class, which only ever makes the bound larger.
RELEASE_PRICE_PROFILES: Final[tuple[PriceProfile, ...]] = (
    PriceProfile(
        schema_version=PRICE_PROFILE_SCHEMA_VERSION,
        model_id="openai/gpt-6-luna",
        input_usd_per_mtok=0.10,
        output_usd_per_mtok=0.50,
        context_window_tokens=131072,
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
        f"this release records no provider prices for {model_id}, so no spending bound can be "
        "computed for it",
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


def calculate_release_cost_bound(campaign: CampaignSpecV2, price_profile: PriceProfile) -> float:
    """The most one comparison can cost: tasks x 2 x ((I + C)*Pi + (O + S)*Po)."""
    require_executable_budget(campaign)
    budgets = campaign.budgets
    assert budgets.maximum_input_tokens is not None
    assert budgets.maximum_output_tokens is not None

    episodes = campaign.taskset.selection.num_tasks * _VARIANTS_PER_COMPARISON
    input_tokens = budgets.maximum_input_tokens + price_profile.context_window_tokens
    output_tokens = budgets.maximum_output_tokens + campaign.subject.sampling.max_tokens
    per_episode = (
        input_tokens * price_profile.input_usd_per_mtok
        + output_tokens * price_profile.output_usd_per_mtok
    ) / _TOKENS_PER_MILLION
    return episodes * per_episode


def require_cost_bound(campaign: CampaignSpecV2, price_profile: PriceProfile) -> float:
    """Refuse a Campaign that can cost more than it says it may; return the bound otherwise."""
    bound = calculate_release_cost_bound(campaign, price_profile)
    ceiling = campaign.budgets.maximum_usd
    if ceiling is None or bound <= ceiling:
        return bound
    details: dict[str, JsonValue] = {
        "campaign_id": campaign.metadata.id,
        "calculated_bound_usd": _rounded(bound),
        "maximum_usd": ceiling,
        "model_id": price_profile.model_id,
        "prices_recorded_on": price_profile.recorded_on,
    }
    raise PrerequisiteError(
        "the most this comparison can cost under its own enforced limits — "
        f"${_rounded(bound):.2f} at the prices this release recorded — is above the "
        f"${ceiling:.2f} the Campaign declares it may spend",
        code=CAMPAIGN_COST_BOUND_EXCEEDED,
        details=details,
    )


def _rounded(amount: float) -> float:
    """Up to the cent, so a bound is never reported low."""
    return math.ceil(amount * 100.0) / 100.0
