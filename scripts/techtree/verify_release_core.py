"""Verify the shipped ReleaseCore from the repository, which can check more than an install can.

`regents techtree release verify` asks whether the ReleaseCore still agrees with the installed
build. This adds the question only the repository can answer: is it the ReleaseCore this source
tree and the founder's inputs generate? Nothing is written, published or fetched.
"""

from __future__ import annotations

import argparse
import sys

from build_release_core import SHIPPED, release_core_bytes

from regents_cli.techtree.canonical import validate_digest
from regents_cli.techtree.release.checks import (
    ReleaseCheck,
    local_release_facts,
    verify_release_core,
)
from regents_cli.techtree.release.document import document_digest


def generated_check(raw: bytes) -> ReleaseCheck:
    """The shipped bytes must be the ones this tree generates."""
    if raw == release_core_bytes():
        return ReleaseCheck(
            id="release_core_current",
            status="passed",
            code="ok",
            detail="the shipped ReleaseCore is the one this source tree generates.",
        )
    return ReleaseCheck(
        id="release_core_current",
        status="failed",
        code="release_core_stale",
        detail="the shipped ReleaseCore is not the one this source tree generates; run "
        "scripts/techtree/build_release_core.py.",
    )


def main() -> int:
    """Run every check and print one line per check."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--expected", metavar="DIGEST", help="The ReleaseCore digest published for this release."
    )
    arguments = parser.parse_args()
    expected = None if arguments.expected is None else validate_digest(arguments.expected)
    raw = SHIPPED.read_bytes()
    result = verify_release_core(raw, local_release_facts(), expected_digest=expected)
    checks = [*result.checks, generated_check(raw)]
    for check in checks:
        print(f"{check.status:<7} {check.id}: {check.detail}")
    failed = [check for check in checks if check.status == "failed"]
    if failed:
        print(f"release: {len(failed)} of {len(checks)} checks failed")
        return 1
    print(f"release: {document_digest(raw)} verifies, {len(checks)} checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
