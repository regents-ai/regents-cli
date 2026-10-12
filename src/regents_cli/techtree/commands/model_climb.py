"""`regents techtree model-climb …` (contract model-climb-v1, M0): what this machine can run, the
model-free compatibility check, and local execution grants. None rents a machine, calls a paid
model or sends anything to the Techtree site."""

from __future__ import annotations

import re
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Final, cast, get_args

import click

from regents_cli import output
from regents_cli.techtree import fs, paths
from regents_cli.techtree.canonical import digest_object, validate_digest
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.errors import PolicyError, ValidationError
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.identity.store import IdentityStore
from regents_cli.techtree.model_climb import grants, profiles
from regents_cli.techtree.model_climb.contracts import (
    CONTRACT,
    OPERATION_SCHEMA_VERSION,
    ExecutionGrant,
    GrantedOperation,
)
from regents_cli.techtree.model_climb.store import ModelClimbStore
from regents_cli.techtree.models.base import JsonValue

#: The operations from the contract's table this build runs.
BUILT_OPERATIONS: Final = ("model_climb_capabilities",)
CONFIRMATION_LENGTH: Final = 12
_DURATION: Final = re.compile(r"^(\d+)([mhd])$")
_UNITS: Final = {"m": "minutes", "h": "hours", "d": "days"}


def _store() -> ModelClimbStore:
    return ModelClimbStore(paths.home().model_climb_dir)


# capabilities


def capabilities(as_json: bool) -> None:
    docker = profiles.docker_available()
    next_action = (
        f"regents techtree model-climb profile check {profiles.M0.name} --dry-run"
        if docker
        else "Start Docker, then run regents techtree model-climb capabilities again."
    )
    answer: dict[str, JsonValue] = {
        "schema_version": OPERATION_SCHEMA_VERSION,
        "operation_id": "model_climb_capabilities",
        "contract": CONTRACT,
        "profiles": [
            {
                "name": profile.name,
                "model_id": profile.model.model_id,
                "model_revision": profile.model.revision,
                "trainer": "prime-rl",
                "trainer_revision": profile.trainer_revision,
            }
            for profile in profiles.PROFILES.values()
        ],
        "docker": docker,
        "operations": list(BUILT_OPERATIONS),
        "next_actions": [next_action],
    }
    emit(
        answer,
        as_json=as_json,
        shown=[
            output.report(
                "\n".join(
                    [
                        f"Model Climb contract {CONTRACT}.",
                        "",
                        *(
                            f"- Profile {profile.name}: {profile.model.model_id} on prime-rl "
                            f"{profile.trainer_revision[:7]}"
                            for profile in profiles.PROFILES.values()
                        ),
                        f"- Docker: {'ready' if docker else 'not answering'}",
                        "",
                        f"Next: {next_action}",
                    ]
                )
            )
        ],
    )


# profile check


def profile_check(profile_name: str, dry_run: bool, as_json: bool) -> None:
    profile = profiles.PROFILES.get(profile_name)
    if profile is None:
        raise ValidationError(
            f"there is no profile {profile_name}; M0 has one, {profiles.M0.name}",
            details={"profiles": sorted(profiles.PROFILES)},
        )
    if not dry_run:
        raise ValidationError(
            "M0 runs only the model-free step, so --dry-run is required. The paid step is a "
            "separate command that needs its own grant."
        )
    checked_at = datetime.now(UTC)
    ran = profiles.run_check(profile)
    report, checks = _profile_report(profile, ran, checked_at)
    folder = _store().profiles_dir / profile.name
    stamp = checked_at.strftime("%Y%m%dT%H%M%SZ")
    report_path = folder / f"{stamp}-dry-run.json"
    fs.atomic_write_json(report_path, report)
    fs.atomic_write_text(folder / f"{stamp}-dry-run.log", ran.log)
    failed = [check.label for check in checks if check.status == "fail"]
    if failed:
        raise ValidationError(
            f"the {profile.name} model-free check found {len(failed)} problem(s); "
            f"the report is at {report_path}",
            code="verification_error",
            details={"report": str(report_path), "failed_checks": failed},
        )
    answer: dict[str, JsonValue] = {
        "schema_version": OPERATION_SCHEMA_VERSION,
        **report,
        "report_path": str(report_path),
        "next_actions": ["Send the report to Techtree for review (contract 7.4 step 1)."],
    }
    emit(
        answer,
        as_json=as_json,
        shown=[
            output.report(
                "\n".join(
                    [
                        f"The {profile.name} model-free check found no problem.",
                        "",
                        f"- Training configuration digest: {report['resolved_config_digest']}",
                        f"- Image: {ran.image_id}",
                        f"- Report: {report_path}",
                    ]
                )
            ),
            output.checks(checks),
        ],
    )


def _profile_report(
    profile: profiles.Profile, ran: profiles.Ran, checked_at: datetime
) -> tuple[dict[str, JsonValue], list[output.Check]]:
    """The report written under profiles/, and its checks as a person reads them."""
    answer = ran.answer
    checks: list[output.Check] = []

    def check(label: str, holds: bool, detail: str) -> None:
        checks.append(output.Check(label, "pass" if holds else "fail", detail))

    check(
        "Pinned model",
        answer.model == profile.model,
        f"{answer.model.model_id} @ {answer.model.revision}",
    )
    check(
        "Pinned trainer",
        answer.environment.prime_rl_revision == profile.trainer_revision,
        f"prime-rl {answer.environment.prime_rl_revision}",
    )
    check(
        "Dry run",
        answer.dry_run.succeeded,
        "prime-rl resolved the training configuration"
        if answer.dry_run.succeeded
        else f"prime-rl's dry run stopped (exit {answer.dry_run.exit_code})",
    )
    fixtures: list[JsonValue] = []
    for fixture in answer.fixtures or []:
        only_answers = (
            fixture.every_answer_trained and fixture.no_prompt_trained and not fixture.residue
        )
        check(
            f"Loss mask: {fixture.id}",
            only_answers,
            f"{fixture.trained_tokens} of {fixture.tokens} tokens trained, "
            + ("only the assistant's answers" if only_answers else _mask_problem(fixture)),
        )
        fixtures.append(fixture.model_dump(mode="json"))
    coverage_answer: JsonValue = None
    modules = answer.modules
    if modules is not None:
        layers = modules.language_layers
        check(
            "Text layers",
            layers == [profile.language_layers],
            ", ".join(layers) or "none found",
        )
        found = profiles.coverage(profile, modules.matched, layer_types=modules.layer_types)
        check(
            "LoRA coverage",
            found.holds,
            f"{found.matched} modules matched, {found.expected} expected"
            + (
                ""
                if found.holds
                else f"; {len(found.missing)} missing, {len(found.unexpected)} unexpected"
            ),
        )
        coverage_answer = {
            "expected": found.expected,
            "matched": found.matched,
            "missing": list(found.missing),
            "unexpected": list(found.unexpected),
        }
    resolved = answer.dry_run.resolved
    report: dict[str, JsonValue] = {
        "profile": profile.name,
        "checked_at": checked_at.isoformat(),
        "image_id": ran.image_id,
        "model": answer.model.model_dump(mode="json"),
        "environment": answer.environment.model_dump(mode="json"),
        "resolved_config_digest": digest_object(resolved) if resolved is not None else None,
        "dry_run": answer.dry_run.model_dump(mode="json"),
        "fixtures": fixtures,
        "modules": modules.model_dump(mode="json") if modules is not None else None,
        "coverage": coverage_answer,
        "checks": [
            {"label": item.label, "status": item.status, "detail": item.detail} for item in checks
        ],
    }
    return report, checks


def _mask_problem(fixture: profiles.CheckFixture) -> str:
    if not fixture.every_answer_trained:
        return "but an assistant answer is not trained"
    if not fixture.no_prompt_trained:
        return "but a prompt is trained"
    return f"but it also trains {fixture.residue!r}"


# grant issue


def grant_issue(
    plan: str | None,
    operation: str | None,
    max_usd: str | None,
    max_hours: str | None,
    max_attempts: int | None,
    expires_in: str | None,
    as_json: bool,
) -> None:
    given = {
        "--plan": plan,
        "--operation": operation,
        "--max-usd": max_usd,
        "--max-hours": max_hours,
        "--max-attempts": max_attempts,
        "--expires-in": expires_in,
    }
    missing = [name for name, value in given.items() if value is None]
    if missing:
        raise ValidationError(
            f"a grant binds every limit; give {', '.join(missing)}", details={"missing": missing}
        )
    assert plan and operation and max_usd and max_hours and max_attempts and expires_in
    plan_digest = validate_digest(plan)
    granted = cast(GrantedOperation, operation)
    limits = grants.Limits(
        max_cents=_cents(max_usd),
        max_wall_time_seconds=_seconds(max_hours),
        max_attempts=max_attempts,
        expires_in=_duration(expires_in),
    )
    store = _store()
    service = IdentityService(IdentityStore(paths.home()))
    identity = service.ensure()
    grant = grants.draft_grant(
        store,
        identity=identity,
        plan_digest=plan_digest,
        operation=granted,
        limits=limits,
        now=datetime.now(UTC),
    )
    review = _grant_review(grant)
    if as_json or not (sys.stdin.isatty() and sys.stdout.isatty()):
        raise PolicyError(
            "a grant is issued only by a person at this machine's terminal, who types the "
            "plan's first 12 characters to confirm. Show the person the review; they run this "
            "command themselves.",
            code=grants.APPROVAL_REQUIRED,
            details={"review": list(review)},
        )
    output.show(output.review(review))
    expected = plan_digest.removeprefix("sha256:")[:CONFIRMATION_LENGTH]
    typed = click.prompt(
        f"Type the plan's first {CONFIRMATION_LENGTH} characters to issue this grant",
        default="",
        show_default=False,
    )
    if typed.strip() != expected:
        raise ValidationError(
            "the typed confirmation did not match the plan, so no grant was issued"
        )
    envelope = service.sign_object(grant)
    path = store.put_grant(envelope)
    answer: dict[str, JsonValue] = {
        "schema_version": OPERATION_SCHEMA_VERSION,
        "grant_id": grant.grant_id,
        "grant": grant.model_dump(mode="json"),
        "path": str(path),
        "next_actions": [],
    }
    emit(
        answer,
        as_json=False,
        shown=[
            output.report(
                f"Grant {grant.grant_id} issued for {grant.operation} on plan "
                f"{grant.plan}, signed with this machine's key. It is at {path}."
            )
        ],
    )


def _grant_review(grant: ExecutionGrant) -> list[str]:
    dollars = Decimal(grant.max_cents) / 100
    hours = Decimal(grant.max_wall_time_seconds) / 3600
    return [
        f"Admits one operation: {grant.operation}",
        f"On plan {grant.plan}",
        f"  dataset {grant.dataset_release}",
        f"  benchmark {grant.benchmark_release}",
        f"  recipe {grant.recipe}",
        f"Compute: {grant.gpu_count} x {grant.gpu_model} at {grant.provider}, {grant.region}",
        f"Spends at most ${dollars:.2f} and runs at most {hours.normalize()} hours",
        f"At most {grant.max_attempts} attempt(s), {grant.max_parallel_jobs} at a time",
        "May reach: " + (", ".join(grant.egress) if grant.egress else "nothing beyond the job"),
        f"Workspace {grant.workspace}; for actor {grant.actor_key_id}",
        f"Approved by {grant.approving_human} on this machine, operator-attested",
        f"Valid {grant.issued_at.isoformat()} until {grant.expires_at.isoformat()}",
    ]


def _cents(value: str) -> int:
    try:
        amount = Decimal(value)
    except InvalidOperation as error:
        raise ValidationError(f"--max-usd {value!r} is not an amount in dollars") from error
    cents = amount * 100
    if not amount.is_finite() or amount <= 0 or cents != cents.to_integral_value():
        raise ValidationError(f"--max-usd {value!r} must be more than 0, in whole cents")
    return int(cents)


def _seconds(value: str) -> int:
    try:
        hours = Decimal(value)
    except InvalidOperation as error:
        raise ValidationError(f"--max-hours {value!r} is not a number of hours") from error
    seconds = hours * 3600
    if not hours.is_finite() or hours <= 0 or seconds != seconds.to_integral_value():
        raise ValidationError(f"--max-hours {value!r} must be more than 0, in whole seconds")
    return int(seconds)


def _duration(value: str) -> timedelta:
    parsed = _DURATION.match(value)
    if parsed is None or int(parsed[1]) == 0:
        raise ValidationError(
            f"--expires-in {value!r} must be a whole number of minutes, hours or days, "
            "such as 90m, 24h or 7d"
        )
    return timedelta(**{_UNITS[parsed[2]]: int(parsed[1])})


PROFILE = click.Group("profile", help="Check a compatibility profile on this machine.")
PROFILE.add_command(
    click.Command(
        "check",
        callback=profile_check,
        help="Run a profile's model-free check in its local container: prime-rl's dry run, "
        "the loss mask on public fixtures, and the LoRA module paths. Rents nothing.",
        params=[
            click.Argument(["profile_name"], metavar="PROFILE"),
            click.Option(["--dry-run"], is_flag=True, help="Run the model-free step. Required."),
            JSON,
        ],
    )
)

GRANT = click.Group("grant", help="Execution grants for this machine, operator-attested.")
GRANT.add_command(
    click.Command(
        "issue",
        callback=grant_issue,
        help="Issue a grant for one operation on one resolved plan, after you type the plan's "
        "first 12 characters. Spends nothing itself.",
        params=[
            click.Option(["--plan"], metavar="DIGEST", help="The resolved plan it binds."),
            click.Option(
                ["--operation"],
                type=click.Choice(get_args(GrantedOperation.__value__)),
                help="The one operation it admits.",
            ),
            click.Option(["--max-usd"], metavar="DOLLARS", help="The most it may spend."),
            click.Option(["--max-hours"], metavar="HOURS", help="The longest it may run."),
            click.Option(["--max-attempts"], type=click.IntRange(min=1), help="The most attempts."),
            click.Option(["--expires-in"], metavar="90m|24h|7d", help="How long it lasts."),
            JSON,
        ],
    )
)

MODEL_CLIMB = click.Group(
    "model-climb",
    help="Fine-tune an open model privately and measure whether it got better (M0: checks "
    "and grants only; nothing is rented).",
)
MODEL_CLIMB.add_command(
    click.Command(
        "capabilities",
        callback=capabilities,
        help="Show the contract, the profiles this CLI knows, Docker, and the built operations.",
        params=[JSON],
    )
)
MODEL_CLIMB.add_command(PROFILE)
MODEL_CLIMB.add_command(GRANT)
