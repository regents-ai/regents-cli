"""Cut the ReleaseCore the package ships, or with `--check` say whether the shipped one is current.

Founder decisions come from release-inputs.json beside this file, edited by hand once per
release. Everything else is read out of this source tree: the CLI version from pyproject.toml,
and the protocol version, engine digest, catalog digest and subject harness from the packaged
resources. The same tree and inputs give the same bytes anywhere.
"""

from __future__ import annotations

import argparse
import json
import tomllib
from pathlib import Path
from typing import Final

from regents_cli.techtree.release.checks import local_release_facts
from regents_cli.techtree.release.document import (
    RELEASE_CORE_FILENAME,
    document_digest,
    render_release_core,
)
from regents_cli.techtree.release.models import RELEASE_CORE_SCHEMA_VERSION, ReleaseCore

ROOT: Final = Path(__file__).resolve().parents[2]
INPUTS: Final = Path(__file__).resolve().parent / "release-inputs.json"
SHIPPED: Final = ROOT / "src/regents_cli/techtree/resources/release" / RELEASE_CORE_FILENAME


def pyproject_version() -> str:
    """The version this source tree declares, read from the tree rather than an install."""
    with (ROOT / "pyproject.toml").open("rb") as handle:
        return str(tomllib.load(handle)["project"]["version"])


def release_core_bytes() -> bytes:
    """The ReleaseCore this tree and the founder's inputs produce."""
    inputs = json.loads(INPUTS.read_bytes())
    facts = local_release_facts()
    core = ReleaseCore.model_validate(
        {
            **inputs,
            "schema_version": RELEASE_CORE_SCHEMA_VERSION,
            "cli_version": pyproject_version(),
            "protocol_version": facts.protocol_version,
            "engine_digest": facts.engine_digest,
            "catalog_digest": facts.catalog_digest,
            "subject_hermes_version": facts.subject_hermes_versions[
                inputs["intro_climb_reference"]
            ],
        }
    )
    return render_release_core(core)


def main() -> int:
    """Write the ReleaseCore and print its digest, or report drift and write nothing."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Report drift and write nothing.")
    arguments = parser.parse_args()
    generated = release_core_bytes()
    if arguments.check:
        if SHIPPED.is_file() and SHIPPED.read_bytes() == generated:
            print(f"release-core: {document_digest(generated)} is what this source tree generates")
            return 0
        print("release-core: the shipped ReleaseCore is not what this source tree generates")
        return 1
    SHIPPED.write_bytes(generated)
    print(document_digest(generated))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
