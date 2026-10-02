"""Whether a Campaign sets every limit the engine enforces.

A run's spend is held to the Campaign's maximum while it runs, from the costs the provider
reports (`runs/spend.py`), and a result shows those same reported costs: nothing in this build
prices tokens.
"""

from __future__ import annotations

from typing import Final

from regents_cli.techtree.errors import PrerequisiteError
from regents_cli.techtree.models.campaign import CampaignSpecV3

CAMPAIGN_BUDGET_NOT_ENFORCED: Final = "campaign_budget_not_enforced"


def require_executable_budget(campaign: CampaignSpecV3) -> None:
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
