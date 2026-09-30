"""A run is refused before it starts when its enforced limits could outspend what it declares.

The costly failure: a Campaign whose per-episode limits add up past the maximum it declares is
started anyway, and a provider that charges for tokens bills the difference to the participant.
"""

from __future__ import annotations

import pytest

from regents_cli.techtree.catalog.repository import EmbeddedCatalogRepository
from regents_cli.techtree.errors import PrerequisiteError
from regents_cli.techtree.models.campaign import CampaignSpecV2
from regents_cli.techtree.verifiers.budget import (
    CAMPAIGN_COST_BOUND_EXCEEDED,
    price_profile_for,
    require_cost_bound,
)


def shipped_campaign() -> CampaignSpecV2:
    repository = EmbeddedCatalogRepository.packaged()
    climb = repository.load_climb(repository.climb_entry("hello-world-climb").reference)
    return repository.load_campaign(climb.campaign_spec_digest)


def test_the_shipped_campaign_cannot_outspend_what_it_declares() -> None:
    """The bound is pessimistic (whole context window, one more sampled reply, every episode)
    and still lands under the declared maximum; a regeneration that broke that is refused here
    rather than by a run that already started."""
    shipped = shipped_campaign()

    bound = require_cost_bound(shipped, price_profile_for(shipped.subject.model.model_id))

    assert bound == pytest.approx(6.2717184)
    assert shipped.budgets.maximum_usd == 6.50


def test_a_comparison_that_could_outspend_its_declared_limit_is_refused() -> None:
    """A declared maximum below the bound refuses the run and quotes the bound rounded up to
    the cent, so the figure quoted is never below the figure computed."""
    shipped = shipped_campaign()
    lowered = shipped.model_copy(
        update={"budgets": shipped.budgets.model_copy(update={"maximum_usd": 6.27})}
    )

    with pytest.raises(PrerequisiteError) as caught:
        require_cost_bound(lowered, price_profile_for(shipped.subject.model.model_id))

    assert caught.value.code == CAMPAIGN_COST_BOUND_EXCEEDED
    assert caught.value.details["maximum_usd"] == 6.27
    assert caught.value.details["calculated_bound_usd"] == 6.28
