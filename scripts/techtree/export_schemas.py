"""Regenerate the JSON Schemas of the v3 documents regents-cli writes, in schemas/techtree/v3.

Keys are sorted and the indent fixed so a reordering inside Pydantic never shows as a change,
and every schema carries an `$id` derived from its filename. Techtree's frozen v1alpha1 tree
describes documents this build has no model for, so it stays with Techtree.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Final

from pydantic import BaseModel

from regents_cli.techtree.models.campaign import CampaignSpecV3
from regents_cli.techtree.models.catalog import (
    CatalogIndexV2,
    ClimbSummaryV2,
    CompatibilityResultV2,
)
from regents_cli.techtree.models.climb import ClimbManifest
from regents_cli.techtree.models.episode_receipt import EpisodeReceiptV3
from regents_cli.techtree.models.execution_plan import ResolvedExecutionPlan
from regents_cli.techtree.models.experiment import ExperimentManifestV3
from regents_cli.techtree.models.run import RunRequestV2
from regents_cli.techtree.models.uplift_report import UpliftReportV3

VERSION: Final = "v3"
DESTINATION: Final = Path(__file__).resolve().parents[2] / "schemas/techtree" / VERSION
JSON_SCHEMA_DIALECT: Final = "https://json-schema.org/draft/2020-12/schema"
#: A name, not a location: nothing fetches it.
SCHEMA_ID_BASE: Final = "https://schemas.techtree.dev"

MODELS: Final[dict[str, type[BaseModel]]] = {
    "campaign": CampaignSpecV3,
    "catalog": CatalogIndexV2,
    "climb": ClimbManifest,
    "climb-summary": ClimbSummaryV2,
    "compatibility-result": CompatibilityResultV2,
    "episode-receipt": EpisodeReceiptV3,
    "execution-plan": ResolvedExecutionPlan,
    "experiment-manifest": ExperimentManifestV3,
    "run-request": RunRequestV2,
    "uplift-report": UpliftReportV3,
}


def rendered_schema(model: type[BaseModel], filename: str) -> str:
    """The exact text one schema file holds."""
    schema = model.model_json_schema(
        by_alias=True, ref_template="#/$defs/{model}", mode="validation"
    )
    document = {
        "$schema": JSON_SCHEMA_DIALECT,
        "$id": f"{SCHEMA_ID_BASE}/{VERSION}/{filename}",
        **schema,
    }
    return f"{json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False)}\n"


def main() -> None:
    """Write every schema file."""
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name, model in sorted(MODELS.items()):
        filename = f"{name}.schema.json"
        (DESTINATION / filename).write_text(rendered_schema(model, filename), encoding="utf-8")
    print(f"wrote {len(MODELS)} schemas to {DESTINATION}")


if __name__ == "__main__":
    main()
