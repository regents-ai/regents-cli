"""Execution grants (contract section 6): one operation, on one resolved plan, within limits.

A local grant is drawn from the stored plan and its study, so every field it binds is the plan's
own, and it is signed with this machine's Techtree identity key. It is operator-attested: the
key belongs to the person who runs this machine, and that is all the signature proves.
`admit` is the only check a command makes before it spends or deploys under a grant; a grant id
alone authorizes nothing.
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
from regents_cli.techtree.identity.service import verify_signed_object
from regents_cli.techtree.ids import new_id
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
    """
    verdict = verify_signed_object(identity=identity, envelope=envelope, subject="grant")
    grant = envelope.payload
    refusals = [failure.detail for failure in verdict.failures] + _failed(
        (grant.operation != operation, f"it admits {grant.operation}, not {operation}"),
        (grant.plan != plan_digest, f"it binds plan {grant.plan}, not {plan_digest}"),
        (
            grant.actor_key_id != identity.key_id,
            f"it is for actor {grant.actor_key_id}, not {identity.key_id}",
        ),
        (grant.expires_at <= now, f"it expired at {grant.expires_at.isoformat()}"),
    )
    if refusals:
        raise PolicyError(
            f"grant {grant.grant_id} does not admit this: {refusals[0]}",
            code=APPROVAL_REQUIRED,
            details={"grant_id": grant.grant_id, "refusals": refusals},
        )
    stored_plan(store, plan_digest)
    return grant


def _failed(*conditions: tuple[bool, str]) -> list[str]:
    return [reason for failed, reason in conditions if failed]
