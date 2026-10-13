"""`regents techtree model-climb …` (contract model-climb-v1): what this machine can run, the
model-free compatibility check, local execution grants (M0), and sending a signed proof to the
person's private Techtree records (M3). None rents a machine or calls a paid model."""

from __future__ import annotations

import re
import sys
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Final, cast, get_args

import click

from regents_cli import output, siwa
from regents_cli.http import Request, send
from regents_cli.techtree import fs, paths
from regents_cli.techtree.canonical import digest_object, sha256_digest_bytes, validate_digest
from regents_cli.techtree.commands.answers import BASE_URL, JSON, emit
from regents_cli.techtree.errors import NotFoundError, PolicyError, ValidationError
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.identity.store import IdentityStore
from regents_cli.techtree.model_climb import grants, ledger, profiles, proof
from regents_cli.techtree.model_climb.contracts import (
    CONTRACT,
    OPERATION_SCHEMA_VERSION,
    ExecutionGrant,
    GrantedOperation,
)
from regents_cli.techtree.model_climb.store import ModelClimbStore
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.site import site_base

CAPABILITIES: Final = "model_climb_capabilities"
PROFILE_CHECK: Final = "model_climb_profile_check"
GRANT_ISSUE: Final = "model_climb_grant_issue"
GRANT_REVOKE: Final = "model_climb_grant_revoke"
REPORT_SUBMIT: Final = "model_climb_report_submit"
#: The operations from the contract's table this build runs natively.
BUILT_OPERATIONS: Final = (
    CAPABILITIES,
    PROFILE_CHECK,
    GRANT_ISSUE,
    GRANT_REVOKE,
    REPORT_SUBMIT,
)
REPORTS_PATH: Final = "/api/model-climb/v1/reports"
SUBMIT_TIMEOUT_MS: Final = 60_000
#: What the operator answers for before a grant on a plan that counts on the account's own
#: spending limit (contract 6.1), under the name each answer has on the grant's `issued` ledger
#: line. Both must hold.
ATTESTATIONS: Final = {
    "auto_top_up_off": "Is automatic top-up off on the compute account?",
    "balance_within_monthly_limit": (
        "Is the account's balance no more than its monthly spending limit?"
    ),
}
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
        "operation_id": CAPABILITIES,
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
        known = sorted(profiles.PROFILES)
        raise ValidationError(
            f"there is no profile {profile_name}; the profiles are {', '.join(known)}",
            details={"profiles": known},
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
        "operation_id": PROFILE_CHECK,
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


def _setting(resolved: JsonValue, *path: str) -> JsonValue:
    """One setting of prime-rl's resolved configuration, or None where it has none."""
    for key in path:
        resolved = resolved.get(key) if isinstance(resolved, dict) else None
    return resolved


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
    resolved = answer.dry_run.resolved
    if resolved is not None:
        check(
            "Layer merging off",
            _setting(resolved, "model", "fusions", "enabled") == [],
            "LoRA attaches to the separate projections the coverage check counts",
        )
        quiet = (
            _setting(resolved, "dashboard") is False
            and _setting(resolved, "heartbeat") is None
            and _setting(resolved, "monitors", "prime") is None
            and _setting(resolved, "monitors", "wandb") is None
        )
        check(
            "Nothing sent anywhere",
            quiet,
            "no dashboard, heartbeat, Prime or W&B monitor; metrics stay in a local file"
            if quiet
            else "the configuration starts a dashboard, a heartbeat or an online monitor",
        )
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
    dollars = _dollars(grant.max_cents)
    if as_json or not (sys.stdin.isatty() and sys.stdout.isatty()):
        raise PolicyError(
            "a grant is issued only by a person at this machine's terminal, who answers for "
            f"the account's spending limit and types the grant's maximum, {dollars}, to "
            "confirm. Show the person the review; they run this command themselves.",
            code=grants.APPROVAL_REQUIRED,
            details={"review": list(review)},
        )
    output.show(output.review(review))
    attested: dict[str, bool] = {}
    if grants.stored_plan(store, plan_digest).spec.budget.credit_ceiling_attested:
        attested = {
            name: click.confirm(question, default=False) for name, question in ATTESTATIONS.items()
        }
        if not all(attested.values()):
            raise ValidationError(
                "the plan counts on the account's spending limit, and that was not attested, "
                "so no grant was issued"
            )
    typed = click.prompt(
        f"Type the most this grant may spend, {dollars}, to issue it",
        default="",
        show_default=False,
    )
    if typed.strip() != dollars:
        raise ValidationError(
            "the typed confirmation did not match the grant's maximum, so no grant was issued"
        )
    envelope = service.sign_object(grant)
    path = store.put_grant(envelope)
    ledger.record(
        store.ledger_path,
        service,
        envelope,
        "issued",
        at=grant.issued_at,
        auto_top_up_off=attested.get("auto_top_up_off"),
        balance_within_monthly_limit=attested.get("balance_within_monthly_limit"),
    )
    answer: dict[str, JsonValue] = {
        "schema_version": OPERATION_SCHEMA_VERSION,
        "operation_id": GRANT_ISSUE,
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


def grant_revoke(grant_id: str, as_json: bool) -> None:
    store = _store()
    service = IdentityService(IdentityStore(paths.home()))
    service.ensure()
    try:
        envelope = store.get_grant(grant_id)
    except NotFoundError as error:
        raise ValidationError(error.message, details={"grant_id": grant_id}) from error
    grants.revoke(store, service, envelope, now=datetime.now(UTC))
    answer: dict[str, JsonValue] = {
        "schema_version": OPERATION_SCHEMA_VERSION,
        "operation_id": GRANT_REVOKE,
        "grant_id": grant_id,
        "revoked": True,
        "next_actions": [],
    }
    emit(
        answer,
        as_json=as_json,
        shown=[output.report(f"Grant {grant_id} is revoked. Nothing runs under it again.")],
    )


def _dollars(cents: int) -> str:
    """An amount as a person types it: 10 for ten dollars, 35.50 for thirty-five fifty."""
    whole, rest = divmod(cents, 100)
    return str(whole) if rest == 0 else f"{whole}.{rest:02d}"


def _grant_review(grant: ExecutionGrant) -> list[str]:
    hours = Decimal(grant.max_wall_time_seconds) / 3600
    return [
        f"Admits one operation: {grant.operation}",
        f"On plan {grant.plan}",
        f"  dataset {grant.dataset_release}",
        f"  benchmark {grant.benchmark_release}",
        f"  recipe {grant.recipe}",
        f"Compute: {grant.gpu_count} x {grant.gpu_model} at {grant.provider}",
        f"  mission {grant.mission}",
        f"Spends at most ${_dollars(grant.max_cents)} and runs at most {hours.normalize()} hours",
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


# submit


def submit(folder: str, base_url: str | None, as_json: bool) -> None:
    data = proof.document(Path(folder))
    key = sha256_digest_bytes(data)
    base = site_base(base_url)
    request = Request("POST", REPORTS_PATH, headers={"idempotency-key": key}, raw_content=data)
    receipt = siwa.current("techtree", SUBMIT_TIMEOUT_MS)
    request = replace(request, headers={**request.headers, **siwa.sign(request, receipt)})
    answer = send(base, request, SUBMIT_TIMEOUT_MS)
    report = answer["report"]
    results = report["results"]
    emit(
        answer,
        as_json=as_json,
        shown=[
            output.report(
                "\n".join(
                    [
                        f"Techtree kept report {report['report_digest']} privately for the "
                        "person this agent is paired with.",
                        "",
                        f"- Outcome: {results['outcome']}",
                        f"- Comparison: {results['comparison']}",
                        f"- Release gate: {results['release_gate']}",
                        f"- Signed by: {report['signer_key_id']}",
                        "",
                        f"Read it again: regents techtree model-climb report "
                        f"{report['report_digest']}",
                    ]
                )
            )
        ],
    )


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
        help="Issue a grant for one operation on one resolved plan, after you answer for the "
        "account's spending limit and type the grant's maximum. Spends nothing itself.",
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

GRANT.add_command(
    click.Command(
        "revoke",
        callback=grant_revoke,
        help="End a grant on this machine: nothing is admitted under it again. A job already "
        "running is not stopped by this.",
        params=[click.Argument(["grant_id"], metavar="GRANT_ID"), JSON],
    )
)

MODEL_CLIMB = click.Group(
    "model-climb",
    help="Fine-tune an open model privately and measure whether it got better (checks, "
    "grants and private proofs so far; nothing is rented).",
)
MODEL_CLIMB.add_command(
    click.Command(
        "capabilities",
        callback=capabilities,
        help="Show the contract, the profiles this CLI knows, Docker, and the built operations.",
        params=[JSON],
    )
)
MODEL_CLIMB.add_command(
    click.Command(
        "submit",
        callback=submit,
        help="Send a signed proof folder (manifest.json and objects/) to Techtree, which checks "
        "it and keeps it privately for the person this agent is paired with. Sending the same "
        "proof again changes nothing.",
        params=[
            click.Argument(["folder"], metavar="PROOF_FOLDER", type=click.Path(file_okay=False)),
            BASE_URL,
            JSON,
        ],
    )
)
MODEL_CLIMB.add_command(PROFILE)
MODEL_CLIMB.add_command(GRANT)
