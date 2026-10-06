"""Running the checks in one order and saying which of them stop a run."""

from __future__ import annotations

import platform
from importlib.metadata import version

from regents_cli.techtree.doctor.checks import (
    CheckStatus,
    DoctorCheck,
    check_docker,
    check_engine,
    check_engine_eval,
    check_hermes_cli,
    check_hermes_plugin,
    check_host_platform,
    check_live_campaign,
    check_model_routes,
    check_python_version,
    check_subject_images,
    check_techtree_home,
    check_uv_cli,
    detect_host_platform,
)
from regents_cli.techtree.models.base import NonEmptyString, ProtocolModel
from regents_cli.techtree.models.campaign import SUBJECT_AGENT, CampaignSpecV4
from regents_cli.techtree.paths import TechtreePaths


class DoctorReport(ProtocolModel):
    """Everything one Doctor run found; `docker_platform` is where a subject would run."""

    techtree_home: NonEmptyString
    host_platform: NonEmptyString | None
    docker_platform: NonEmptyString | None
    versions: dict[str, NonEmptyString]
    checks: list[DoctorCheck]


class DoctorService:
    """Runs the checks and projects them into a report."""

    def __init__(self, paths: TechtreePaths) -> None:
        self._paths = paths

    def run(
        self, *, for_evaluation: bool = False, campaign: CampaignSpecV4 | None = None
    ) -> list[DoctorCheck]:
        """The checks in a fixed order; `for_evaluation` adds the gate in front of a real run."""
        checks = [
            check_python_version(),
            check_host_platform(detect_host_platform()),
            check_techtree_home(self._paths),
            check_uv_cli(),
            check_docker(for_evaluation=for_evaluation),
            check_hermes_cli(),
            check_hermes_plugin(),
            check_engine(self._paths),
        ]
        subject = campaign.agents.get(SUBJECT_AGENT) if campaign is not None else None
        checks.extend(
            check_model_routes(self._paths, subject.model if subject is not None else None)
        )
        if not for_evaluation:
            return checks
        checks.append(check_engine_eval(self._paths))
        if campaign is None:
            return checks
        checks.append(check_live_campaign(campaign))
        if subject is not None:
            checks.append(check_subject_images(campaign))
        return checks

    def report(self, checks: list[DoctorCheck]) -> DoctorReport:
        return DoctorReport(
            techtree_home=str(self._paths.root),
            host_platform=_metadata_string(checks, "host_platform", "host_platform"),
            docker_platform=_metadata_string(checks, "docker", "docker_platform"),
            versions={"regents_cli": version("regents-cli"), "python": platform.python_version()},
            checks=list(checks),
        )

    def blocking_failures(self, checks: list[DoctorCheck]) -> list[DoctorCheck]:
        return [check for check in checks if check.blocking]

    def warning_checks(self, checks: list[DoctorCheck]) -> list[DoctorCheck]:
        """What did not stop this host and must still be seen."""
        return [
            check
            for check in checks
            if check.status is CheckStatus.WARN
            or (check.status is CheckStatus.FAIL and not check.blocking)
        ]


def _metadata_string(checks: list[DoctorCheck], check_id: str, key: str) -> str | None:
    for check in checks:
        if check.id == check_id:
            value = check.metadata.get(key)
            return value if isinstance(value, str) else None
    return None
