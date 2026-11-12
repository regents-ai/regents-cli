"""A Campaign's rerun limit reaches the engine.

The costly failure: a Campaign declares that a task the provider failed is rerun, the compiled
configuration leaves the engine at its default of no reruns, and one brief provider outage makes
the whole paid run unusable.
"""

from __future__ import annotations

from pathlib import Path

from regents_cli.techtree.models.campaign import SUBJECT_AGENT, CampaignSpecV4
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import ExperimentManifestV4
from regents_cli.techtree.verifiers.compiler import compile_variant_config, prime_key_endpoint
from regents_cli.techtree.verifiers.config import emitted_document
from regents_cli.techtree.verifiers.models import VariantName
from regents_cli.techtree.verifiers.paths import RunPaths

PROOF = Path(__file__).parent / "fixtures" / "run" / "proof"


def test_the_campaign_rerun_limit_is_compiled_into_the_subject_seat(tmp_path: Path) -> None:
    campaign = CampaignSpecV4.model_validate_json((PROOF / "campaign.json").read_bytes())
    experiment = ExperimentManifestV4.model_validate_json(
        (PROOF / "baseline-experiment.json").read_bytes()
    )
    compiled = compile_variant_config(
        campaign=campaign,
        plan=ResolvedExecutionPlan.model_validate_json(
            (PROOF / "execution-plan.json").read_bytes()
        ),
        experiment=experiment,
        run_paths=RunPaths(root=tmp_path / "run"),
        variant=VariantName.BASELINE,
        variant_max_concurrent=2,
        endpoint=prime_key_endpoint(experiment.configuration.agents[SUBJECT_AGENT].model),
    )

    assert campaign.execution.retry_limit > 0
    seat = emitted_document(compiled)["env"][compiled.env.seat_name]
    assert seat["retries"] == {
        "max_retries": 0,
        "rules": [
            {
                "type": "ProviderError",
                "status_code": ["5xx"],
                "message": None,
                "max_retries": campaign.execution.retry_limit,
            }
        ],
    }
