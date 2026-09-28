"""`regents techtree release info|verify`: what release is this build, and is it still that?

Both read the ReleaseCore, engine and catalog this build ships and nothing else: no state, no
prompt, no network, no model. The stamped commit is a fact about this artifact rather than
about the release, so a source checkout says it has none rather than naming one nobody stamped.
"""

from __future__ import annotations

from importlib.metadata import version
from typing import Final

import click

from regents_cli import output
from regents_cli.techtree.canonical import validate_digest
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.errors import VerificationError
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.release.checks import (
    ReleaseCheckStatus,
    local_release_facts,
    verify_release_core,
)
from regents_cli.techtree.release.document import (
    document_digest,
    packaged_release_core_bytes,
    parse_release_core,
)
from regents_cli.techtree.release.provenance import BuildProvenance, packaged_build_provenance

RELEASE_NOT_VERIFIED: Final = "release_not_verified"
_MARK: Final[dict[ReleaseCheckStatus, output.CheckStatus]] = {
    "passed": "pass",
    "failed": "fail",
    "skipped": "skip",
}


def info(as_json: bool) -> None:
    raw = packaged_release_core_bytes()
    core = parse_release_core(raw)
    stamp = packaged_build_provenance()
    answer: dict[str, JsonValue] = {
        "release_id": core.release_id,
        "cli_version": core.cli_version,
        "package_version": version("regents-cli"),
        "source_commit": None if stamp is None else stamp.source_commit,
        "protocol_version": core.protocol_version,
        "release_core_digest": document_digest(raw),
        "engine_digest": core.engine_digest,
        "catalog_digest": core.catalog_digest,
        "intro_climb_reference": core.intro_climb_reference,
    }
    _warn_if_unstamped(answer, stamp)
    commit = "not stamped: this is a source checkout" if stamp is None else stamp.source_commit
    answer["report"] = "\n".join(
        [
            f"- Release: {core.release_id}",
            f"- CLI version: {core.cli_version}",
            f"- Installed package: {answer['package_version']}",
            f"- Source commit: {commit}",
            f"- Protocol: {core.protocol_version}",
            f"- ReleaseCore: {answer['release_core_digest']}",
            f"- Engine: {core.engine_digest}",
            f"- Catalog: {core.catalog_digest}",
            f"- Introductory Climb: {core.intro_climb_reference}",
        ]
    )
    emit(answer, as_json=as_json)


def verify(expected: str | None, as_json: bool) -> None:
    expected_digest = None if expected is None else validate_digest(expected)
    raw = packaged_release_core_bytes()
    result = verify_release_core(raw, local_release_facts(), expected_digest=expected_digest)
    checks: list[JsonValue] = [check.model_dump(mode="json") for check in result.checks]
    if not result.verified:
        raise VerificationError(
            f"this release does not verify: {result.failures[0].detail}",
            code=RELEASE_NOT_VERIFIED,
            details={
                "failed_checks": [check.id for check in result.failures],
                "codes": sorted({check.code for check in result.failures}),
                "checks": checks,
            },
        )
    answer: dict[str, JsonValue] = {
        "release_core_digest": document_digest(raw),
        "expected_digest": expected_digest,
        "verified": True,
        "checks": checks,
    }
    _warn_if_unstamped(answer, packaged_build_provenance())
    facts = [
        f"This release verifies: {len(result.checks)} checks, {len(result.skipped)} of them "
        "not applicable to an installed CLI, with nothing fetched.",
        "",
        f"ReleaseCore: {answer['release_core_digest']}",
    ]
    answer["report"] = "\n".join(
        [*facts, "", *(f"- **{c.status.upper()}** {c.id}: {c.detail}" for c in result.checks)]
    )

    emit(
        answer,
        as_json=as_json,
        shown=[
            output.report("\n".join(facts)),
            output.checks(
                output.Check(c.id.replace("_", " "), _MARK[c.status], c.detail)
                for c in result.checks
            ),
        ],
    )


def _warn_if_unstamped(answer: dict[str, JsonValue], stamp: BuildProvenance | None) -> None:
    """Say when this is not a built artifact, so nothing claims a commit."""
    if stamp is None:
        answer["warnings"] = [
            {
                "id": "release_source_commit_unstamped",
                "text": "This is running from a source checkout rather than an installed build, "
                "so no source commit was stamped into it and none is reported.",
            }
        ]


RELEASE = click.Group("release", help="The release this build belongs to, and whether it holds.")
RELEASE.add_command(
    click.Command(
        "info",
        callback=info,
        params=[JSON],
        help="Report the release coordinates this build was generated with.",
    )
)
RELEASE.add_command(
    click.Command(
        "verify",
        callback=verify,
        params=[
            click.Option(
                ["--expected"],
                metavar="DIGEST",
                help="The ReleaseCore digest the website published for this release.",
            ),
            JSON,
        ],
        help="Check every release coordinate against the thing it names.",
    )
)
