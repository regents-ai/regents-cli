"""Execution grants (contract section 6): one operation, on one resolved plan, within limits.

A local grant is drawn from the stored plan and its study, so every field it binds is the plan's
own, and it is signed with this machine's Techtree identity key. It is operator-attested: the
key belongs to the person who runs this machine, and that is all the signature proves.
`admit` is the only check a command makes before it spends or deploys under a grant; a grant id
alone authorizes nothing. `use` then spends one of the grant's uses on an attempt, before that
attempt's job is submitted, and `revoke` ends a grant for good. All three read the grant ledger.
"""

from __future__ import annotations

import getpass
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from regents_cli.techtree.errors import (
    ConflictError,
    PolicyError,
    TechtreeError,
    ValidationError,
)
from regents_cli.techtree.identity.models import ExecutorIdentity
from regents_cli.techtree.identity.service import IdentityService, verify_signed_object
from regents_cli.techtree.ids import new_id
from regents_cli.techtree.model_climb import ledger
from regents_cli.techtree.model_climb.contracts import (
    DIGEST_MISMATCH,
    SCHEMA_VERSION,
    ExecutionGrant,
    GrantAttestation,
    GrantedOperation,
    ModelStudySpec,
    ResolvedModelPlan,
)
from regents_cli.techtree.model_climb.store import ModelClimbStore
from regents_cli.techtree.models.base import Digest, ObjectEnvelope

PLAN_CHANGED = "plan_changed"
APPROVAL_REQUIRED = "approval_required"
#: The most a plan for the GPU compatibility test may reserve (contract 6.1).
PROFILE_TEST_MAX_CENTS = 2000


@dataclass(frozen=True)
class Limits:
    max_cents: int
    max_wall_time_seconds: int
    max_attempts: int
    expires_in: timedelta


def stored_plan(store: ModelClimbStore, digest: Digest) -> ResolvedModelPlan:
    """The plan stored under `digest`; a plan whose science changed is `plan_changed`."""
    try:
        plan = store.get(digest)
    except TechtreeError as error:
        if error.code == DIGEST_MISMATCH:
            raise ConflictError(
                f"the stored plan {digest} no longer matches its digest, so nothing may be "
                "granted against it",
                code=PLAN_CHANGED,
                details={"plan": digest},
            ) from error
        raise
    if not isinstance(plan, ResolvedModelPlan):
        raise ValidationError(
            f"{digest} is a {plan.kind}, not a ResolvedModelPlan", details={"plan": digest}
        )
    return plan


def draft_grant(
    store: ModelClimbStore,
    *,
    identity: ExecutorIdentity,
    plan_digest: Digest,
    operation: GrantedOperation,
    limits: Limits,
    now: datetime,
) -> ExecutionGrant:
    """The grant a person is asked to confirm, every bound field filled from the plan."""
    plan = stored_plan(store, plan_digest)
    study = store.get(plan.spec.study)
    if not isinstance(study, ModelStudySpec):
        raise ValidationError(
            f"the plan's study {plan.spec.study} is a {study.kind}, not a ModelStudySpec",
            details={"plan": plan_digest},
        )
    budget = plan.spec.budget
    expiry = plan.spec.expires_at.isoformat()
    refusals = _failed(
        (
            budget.enforcement == "estimate_only",
            "the plan's spending cap is an estimate only, and a grant needs an enforced cap",
        ),
        (plan.spec.expires_at <= now, f"the plan expired at {expiry}"),
        (
            now + limits.expires_in > plan.spec.expires_at,
            f"the grant would outlive the plan, which expires at {expiry}",
        ),
        (
            limits.max_cents > budget.amount_cents,
            f"the limit of {limits.max_cents} cents is more than the plan reserves",
        ),
        (
            limits.max_wall_time_seconds > study.spec.budgets.maximum_wall_time_seconds,
            "the wall-time limit is longer than the study allows",
        ),
        (
            operation == "model_climb_profile_test"
            and budget.amount_cents > PROFILE_TEST_MAX_CENTS,
            f"the plan reserves {budget.amount_cents} cents, and a compatibility test may "
            f"reserve at most {PROFILE_TEST_MAX_CENTS}",
        ),
    )
    if refusals:
        raise ValidationError(
            f"no grant can be issued: {refusals[0]}",
            details={"plan": plan_digest, "refusals": refusals},
        )
    return ExecutionGrant(
        schema_version=SCHEMA_VERSION,
        kind="ExecutionGrant",
        grant_id=new_id("grant"),
        mode="local",
        issuer_key_id=identity.key_id,
        approving_human=getpass.getuser(),
        workspace=study.spec.workspace,
        actor_key_id=identity.key_id,
        operation=operation,
        plan=plan_digest,
        dataset_release=plan.spec.dataset_release,
        benchmark_release=plan.spec.benchmark_release,
        recipe=plan.spec.recipe,
        provider=plan.spec.compute.provider,
        mission=plan.spec.compute.mission,
        gpu_model=plan.spec.compute.gpu_model,
        gpu_count=plan.spec.compute.gpu_count,
        max_cents=limits.max_cents,
        max_wall_time_seconds=limits.max_wall_time_seconds,
        max_attempts=limits.max_attempts,
        max_parallel_jobs=study.spec.budgets.maximum_parallel_jobs,
        egress=plan.spec.egress,
        issued_at=now,
        expires_at=now + limits.expires_in,
        nonce=uuid.uuid4().hex,
        uses_allowed=limits.max_attempts,
        attestation=GrantAttestation(level="participant", operator_attested=True),
    )


def admit(
    store: ModelClimbStore,
    envelope: ObjectEnvelope[ExecutionGrant],
    *,
    identity: ExecutorIdentity,
    operation: GrantedOperation,
    plan_digest: Digest,
    now: datetime,
) -> ExecutionGrant:
    """The grant, when it admits `operation` on `plan_digest` now; otherwise `approval_required`.

    The signature covers every bound field, so a grant edited after signing never verifies.
    The ledger must show the grant issued, never revoked, and with a use left.
    """
    verdict = verify_signed_object(identity=identity, envelope=envelope, subject="grant")
    grant = envelope.payload
    events = [line.event for line in ledger.lines(store.ledger_path, identity, envelope)]
    refusals = [failure.detail for failure in verdict.failures] + _failed(
        (grant.operation != operation, f"it admits {grant.operation}, not {operation}"),
        (grant.plan != plan_digest, f"it binds plan {grant.plan}, not {plan_digest}"),
        (
            grant.actor_key_id != identity.key_id,
            f"it is for actor {grant.actor_key_id}, not {identity.key_id}",
        ),
        (grant.expires_at <= now, f"it expired at {grant.expires_at.isoformat()}"),
        ("issued" not in events, "the grant ledger has no record that it was issued"),
        ("revoked" in events, "it was revoked"),
        (
            events.count("used") >= _uses(grant),
            f"all {_uses(grant)} of its uses are spent",
        ),
    )
    if refusals:
        raise _refused(grant, refusals)
    stored_plan(store, plan_digest)
    return grant


def use(
    store: ModelClimbStore,
    service: IdentityService,
    envelope: ObjectEnvelope[ExecutionGrant],
    *,
    intent_id: str,
    now: datetime,
) -> None:
    """Spend one of an admitted grant's uses on the attempt `intent_id`, before its job is
    submitted. An attempt that already holds its use spends no second one."""
    held = ledger.lines(store.ledger_path, service.ensure(), envelope)
    used = [line.intent_id for line in held if line.event == "used"]
    if intent_id in used:
        return
    if len(used) >= _uses(envelope.payload):
        raise _refused(envelope.payload, [f"all {_uses(envelope.payload)} of its uses are spent"])
    ledger.record(store.ledger_path, service, envelope, "used", at=now, intent_id=intent_id)


def revoke(
    store: ModelClimbStore,
    service: IdentityService,
    envelope: ObjectEnvelope[ExecutionGrant],
    *,
    now: datetime,
) -> None:
    """End a grant: nothing is admitted under it again. Revoking twice changes nothing."""
    held = ledger.lines(store.ledger_path, service.ensure(), envelope)
    if not any(line.event == "revoked" for line in held):
        ledger.record(store.ledger_path, service, envelope, "revoked", at=now)


def _uses(grant: ExecutionGrant) -> int:
    return min(grant.uses_allowed, grant.max_attempts)


def _refused(grant: ExecutionGrant, refusals: list[str]) -> PolicyError:
    return PolicyError(
        f"grant {grant.grant_id} does not admit this: {refusals[0]}",
        code=APPROVAL_REQUIRED,
        details={"grant_id": grant.grant_id, "refusals": refusals},
    )


def _failed(*conditions: tuple[bool, str]) -> list[str]:
    return [reason for failed, reason in conditions if failed]
