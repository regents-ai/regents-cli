"""Write, or with --check compare, the JSON Schema of every Model Climb object.

One file beside the models, `model_climb/contracts.schema.json`, so Techtree's contract can pin
it by one sha256 (contract model-climb-v1, section 3.2). Keys are sorted and the indent fixed,
so only a change to a model changes the file.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Annotated, Final

from pydantic import Field, TypeAdapter

from regents_cli.techtree.model_climb import contracts

DESTINATION: Final = Path(contracts.__file__).with_name("contracts.schema.json")
JSON_SCHEMA_DIALECT: Final = "https://json-schema.org/draft/2020-12/schema"
#: A name, not a location: nothing fetches it.
SCHEMA_ID: Final = f"https://schemas.techtree.dev/{contracts.SCHEMA_VERSION}/contracts.schema.json"

DOCUMENTS = Annotated[
    contracts.ModelStudySpec
    | contracts.DatasetRelease
    | contracts.BenchmarkRelease
    | contracts.TrainingRecipe
    | contracts.ResolvedModelPlan
    | contracts.ModelArtifact
    | contracts.TrainingAttempt
    | contracts.ModelUpliftReport
    | contracts.ServiceComparisonReport
    | contracts.DeploymentRelease
    | contracts.ExecutionGrant,
    Field(discriminator="kind"),
]


def rendered() -> str:
    schema = TypeAdapter[object](DOCUMENTS).json_schema(
        ref_template="#/$defs/{model}", mode="validation"
    )
    document = {"$schema": JSON_SCHEMA_DIALECT, "$id": SCHEMA_ID, **schema}
    return f"{json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False)}\n"


def main(arguments: list[str]) -> int:
    text = rendered()
    if arguments == ["--check"]:
        if not DESTINATION.is_file() or DESTINATION.read_text(encoding="utf-8") != text:
            print(f"{DESTINATION} is out of date: run uv run {__file__}", file=sys.stderr)
            return 1
        print(f"{DESTINATION.name} matches the models")
        return 0
    DESTINATION.write_text(text, encoding="utf-8")
    print(f"wrote {DESTINATION}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
