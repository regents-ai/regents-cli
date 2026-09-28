"""`regents techtree doctor`: what is installed, what is missing, and what would block a run."""

from __future__ import annotations

from typing import Final

import click

from regents_cli import output
from regents_cli.techtree import paths
from regents_cli.techtree.catalog.service import CatalogService
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.doctor.checks import CheckStatus, DoctorCheck
from regents_cli.techtree.doctor.service import DoctorReport, DoctorService
from regents_cli.techtree.errors import PrerequisiteError
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.models.campaign import CampaignSpecV2

ENVIRONMENT_NOT_READY: Final = "environment_not_ready"
_MARK: Final[dict[CheckStatus, output.CheckStatus]] = {
    CheckStatus.PASS: "pass",
    CheckStatus.WARN: "warn",
    CheckStatus.FAIL: "fail",
    CheckStatus.SKIP: "skip",
}


def doctor(for_evaluation: bool, climb: str | None, as_json: bool) -> None:
    home = paths.home()
    service = DoctorService(home)
    checks = service.run(
        for_evaluation=for_evaluation or climb is not None, campaign=_campaign_for(home, climb)
    )
    blocking = service.blocking_failures(checks)
    if blocking:
        identifiers = [check.id for check in blocking]
        raise PrerequisiteError(
            "this host is not ready: " + ", ".join(identifiers),
            code=ENVIRONMENT_NOT_READY,
            details={
                "failed_checks": list(identifiers),
                "blocking_failures": [check.model_dump(mode="json") for check in blocking],
            },
        )
    report = service.report(checks)
    answer: dict[str, JsonValue] = report.model_dump(mode="json")
    answer["blocking_failures"] = []
    warnings = service.warning_checks(checks)
    if warnings:
        answer["warnings"] = [{"id": check.id, "text": check.detail} for check in warnings]
    facts = _facts(report)
    answer["report"] = "\n".join([*facts, "", *(_check_line(check) for check in report.checks)])
    emit(
        answer,
        as_json=as_json,
        shown=[
            output.report("\n".join(facts)),
            output.checks(
                output.Check(check.label, _MARK[check.status], check.detail)
                for check in report.checks
            ),
        ],
    )


def _campaign_for(home: paths.TechtreePaths, reference: str | None) -> CampaignSpecV2 | None:
    """Which model a subject authenticates as and which image it runs in belong to a Climb."""
    if reference is None:
        return None
    return CatalogService(home).get_climb(reference).campaign


def _facts(report: DoctorReport) -> list[str]:
    lines = [
        f"All {len(report.checks)} checks ran and none of them block Techtree.",
        "",
        f"- regents-cli {report.versions['regents_cli']}, Python {report.versions['python']}",
        f"- Home: {report.techtree_home}",
        f"- Host platform: {report.host_platform or 'unsupported'}",
    ]
    if report.docker_platform is not None:
        lines.append(f"- Docker platform: {report.docker_platform}")
    return lines


def _check_line(check: DoctorCheck) -> str:
    return f"- {check.status.value.upper()} {check.label}: {check.detail}"


DOCTOR = click.Command(
    "doctor",
    callback=doctor,
    help="Check this machine: Python, platform, uv, Docker, Hermes, the engine and the home.",
    params=[
        click.Option(
            ["--for-evaluation"],
            is_flag=True,
            help="Also check what running a Climb for real needs, and treat anything missing "
            "as a reason to stop rather than a note.",
        ),
        click.Option(
            ["--climb"],
            metavar="REFERENCE",
            help="Check the subject a particular Climb would run: its model credential and "
            "its container image. Implies --for-evaluation.",
        ),
        JSON,
    ],
)
