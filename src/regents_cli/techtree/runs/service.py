"""Run control, and the transaction that makes starting safe.

Starting a run spends a draft, and with it a person's approval of exactly what that draft
would do, across four pieces of state with a crash possible between any two. The draft
decides which run it becomes: `DraftStore.claim_start` allocates the identifier exactly once,
and everything after that is repair. A failed launch does not produce a second run, and
reading a run's status never changes it.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Final, Literal

from regents_cli.techtree.canonical import digest_object, to_json_value
from regents_cli.techtree.constants import (
    DEFAULT_STALE_HEARTBEAT_SECONDS,
    DEFAULT_WORKER_HEARTBEAT_SECONDS,
    RUN_REQUEST_V2_SCHEMA_VERSION,
)
from regents_cli.techtree.drafts.store import (
    DraftSnapshot,
    DraftStartRecord,
    DraftStartStatus,
    DraftStore,
)
from regents_cli.techtree.errors import (
    ConflictError,
    NotFoundError,
    PolicyError,
    RunError,
    TechtreeError,
    UsageError,
    ValidationError,
    VerificationError,
)
from regents_cli.techtree.execution_facts import (
    require_executable_execution_plan,
    run_request_execution_facts,
)
from regents_cli.techtree.ids import new_id
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.run import (
    PolicyAcknowledgement,
    RunPhase,
    RunRequestV2,
    RunState,
    RunStatus,
)
from regents_cli.techtree.models.uplift_report import UpliftReportV2
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.runs.artifacts import RunArtifactStore
from regents_cli.techtree.runs.events import (
    DETAIL_ACTOR,
    DETAIL_APPROVED_AT,
    DETAIL_DRAFT_DIGEST,
    DETAIL_ERROR,
    RUN_APPROVED,
    RUN_FAILED,
)
from regents_cli.techtree.runs.launcher import WorkerLauncher
from regents_cli.techtree.runs.machine import is_terminal, run_failure
from regents_cli.techtree.runs.store import RunStore
from regents_cli.techtree.verifiers.models import VariantName
from regents_cli.techtree.verifiers.outputs import EVAL_LOG_PATH
from regents_cli.techtree.verifiers.paths import RunPaths

DRAFT_ALREADY_STARTED: Final = "draft_already_started"
POLICY_ACCEPTANCE_DIGEST_MISMATCH: Final = "policy_acceptance_digest_mismatch"
POLICY_ACCEPTANCE_METHOD_INVALID: Final = "policy_acceptance_method_invalid"
RUN_RESULT_NOT_READY: Final = "run_result_not_ready"
RUN_RESULT_DIGEST_MISMATCH: Final = "run_result_digest_mismatch"
RUN_LOGS_UNAVAILABLE: Final = "run_logs_unavailable"
RUN_WAIT_TIMEOUT_OUT_OF_RANGE: Final = "run_wait_timeout_out_of_range"

type ApprovalActor = Literal["human_via_cli", "operator_via_flag", "human_via_hermes"]

#: Which actors belong to which acceptance surface. A run recording a command-line acceptance
#: and a host-agent actor would describe two approvals, and only one of them happened.
ACTORS_BY_METHOD: Final[dict[str, frozenset[str]]] = {
    "explicit_cli_review": frozenset({"human_via_cli", "operator_via_flag"}),
    "host_agent_confirmation": frozenset({"human_via_hermes"}),
}

DEFAULT_LOG_TAIL: Final = 200
MINIMUM_LOG_TAIL: Final = 1
MAXIMUM_LOG_TAIL: Final = 5000

#: The Hermes bridge runs the CLI under a 120-second timeout; stopping at 90 keeps an expired
#: wait Techtree's own answer rather than the host's guess.
DEFAULT_WAIT_TIMEOUT_SECONDS: Final = 30
MINIMUM_WAIT_TIMEOUT_SECONDS: Final = 1
MAXIMUM_WAIT_TIMEOUT_SECONDS: Final = 90

type CancellationOutcome = Literal["requested", "already_requested", "already_terminal"]


def utc_now() -> datetime:
    """Return the current instant in UTC."""
    return datetime.now(UTC)


@dataclass(frozen=True)
class ProcessHealth:
    """What the host can say about a run's worker that its log cannot."""

    worker_pid: int | None
    worker_alive: bool
    heartbeat_at: datetime | None
    heartbeat_age_seconds: float | None
    heartbeat_stale: bool


@dataclass(frozen=True)
class RunCancellation:
    """The result of asking a run to stop, and which of the three it was."""

    status: RunStatus
    outcome: CancellationOutcome


@dataclass(frozen=True)
class RunLogs:
    """A bounded window onto one log, line for line as written."""

    run_id: str
    lines: list[str]
    truncated: bool


class RunService:
    """Transactional, idempotent run control for the commands."""

    def __init__(
        self,
        *,
        paths: TechtreePaths,
        draft_store: DraftStore,
        run_store: RunStore,
        artifact_store: RunArtifactStore,
        launcher: WorkerLauncher,
        clock: Callable[[], datetime] = utc_now,
        stale_heartbeat_seconds: float = DEFAULT_STALE_HEARTBEAT_SECONDS,
    ) -> None:
        self._paths = paths
        self._drafts = draft_store
        self._runs = run_store
        self._artifacts = artifact_store
        self._launcher = launcher
        self._clock = clock
        self._stale_after = stale_heartbeat_seconds

    def start(
        self,
        *,
        draft_id: str,
        policy_acknowledgement: PolicyAcknowledgement,
        approved_by: ApprovalActor,
    ) -> RunStatus:
        """Claim the draft, create the run, stage inputs, and launch."""
        snapshot = self._drafts.load_snapshot(draft_id)
        self._require_startable(snapshot, policy_acknowledgement, approved_by)
        record = self._drafts.claim_start(draft_id=draft_id, run_id=new_id("run"))
        request = self._request_for(record, snapshot, policy_acknowledgement)
        self._ensure_run_exists(record, request, approved_by)
        self._artifacts.stage_inputs(run_id=record.run_id, request=request, snapshot=snapshot)
        return self._ensure_launched(record)

    def _require_startable(
        self,
        snapshot: DraftSnapshot,
        acknowledgement: PolicyAcknowledgement,
        approved_by: ApprovalActor,
    ) -> None:
        """Check everything that must hold before any state is mutated."""
        draft = snapshot.draft
        if draft.policy_acceptance.required and (
            acknowledgement.data_policy_digest != draft.data_policy_digest
        ):
            raise PolicyError(
                "the accepted DataPolicy is not the one this draft runs under",
                code=POLICY_ACCEPTANCE_DIGEST_MISMATCH,
                details={
                    "draft_id": draft.id,
                    "expected_digest": draft.data_policy_digest,
                    "accepted_digest": acknowledgement.data_policy_digest,
                },
            )
        if approved_by not in ACTORS_BY_METHOD[acknowledgement.method]:
            raise PolicyError(
                f"{approved_by} did not give a {acknowledgement.method} acceptance, so the run "
                "would record an approval nobody made",
                code=POLICY_ACCEPTANCE_METHOD_INVALID,
                details={
                    "draft_id": draft.id,
                    "method": acknowledgement.method,
                    "actor": approved_by,
                },
            )
        if not snapshot.comparison.controlled:
            raise VerificationError(
                "this draft's candidate differs from its baseline somewhere the Campaign does "
                "not permit, so it cannot be run",
                code="manifest_comparison_invalid",
                details={"draft_id": draft.id},
            )
        require_executable_execution_plan(snapshot.source.campaign, snapshot.source.execution_plan)

    def _request_for(
        self,
        record: DraftStartRecord,
        snapshot: DraftSnapshot,
        policy_acknowledgement: PolicyAcknowledgement,
    ) -> RunRequestV2:
        """The run's immutable request: a retried start keeps the one the run was created with."""
        draft = snapshot.draft
        try:
            existing = self._runs.get_request(record.run_id)
        except NotFoundError:
            existing = None
        if existing is not None:
            if existing.draft_id != draft.id:
                raise ConflictError(
                    f"draft {draft.id} is claimed by run {record.run_id}, which was created "
                    "from a different draft",
                    code=DRAFT_ALREADY_STARTED,
                    details={"draft_id": draft.id, "run_id": record.run_id},
                )
            return existing
        facts = run_request_execution_facts(
            snapshot.source.campaign, snapshot.source.execution_plan
        )
        return RunRequestV2(
            schema_version=RUN_REQUEST_V2_SCHEMA_VERSION,
            run_id=record.run_id,
            draft_id=draft.id,
            draft_digest=digest_object(draft),
            campaign_spec_digest=draft.campaign_spec_digest,
            program_ref=draft.program_ref,
            public_context=draft.public_context,
            data_policy_digest=draft.data_policy_digest,
            outcome_contract_digest=draft.outcome_contract_digest,
            execution_plan_digest=facts.execution_plan_digest,
            taskset_lock_digest=snapshot.source.publisher_validation.taskset_lock_digest,
            baseline_manifest_digest=draft.baseline_manifest_digest,
            candidate_manifest_digest=draft.candidate_manifest_digest,
            policy_acknowledgement=policy_acknowledgement,
            executor_kind="verifiers",
            created_at=self._clock(),
        )

    def _ensure_run_exists(
        self, record: DraftStartRecord, request: RunRequestV2, approved_by: ApprovalActor
    ) -> None:
        """Create the run unless a previous attempt did; one run, one recorded approval."""
        try:
            self._runs.get_request(record.run_id)
        except NotFoundError:
            self._runs.create(request)
            self._runs.append(
                record.run_id,
                phase=RunPhase.CREATED,
                kind=RUN_APPROVED,
                details={
                    DETAIL_DRAFT_DIGEST: request.draft_digest,
                    DETAIL_ACTOR: approved_by,
                    DETAIL_APPROVED_AT: to_json_value(
                        request.policy_acknowledgement.acknowledged_at
                    ),
                },
            )

    def _ensure_launched(self, record: DraftStartRecord) -> RunStatus:
        """Launch the worker if, and only if, none has ever been launched."""
        run_id = record.run_id
        state = self._runs.state(run_id)
        if record.status is DraftStartStatus.LAUNCH_FAILED:
            raise RunError(
                f"run {run_id} could not be started, and a draft is spent on exactly one run",
                code="worker_launch_failed",
                details={
                    "run_id": run_id,
                    "draft_id": record.draft_id,
                    "launch_error_code": record.launch_error_code,
                },
            )
        # A worker announces its own pid as its first act, so evidence of a worker is evidence
        # the launch happened even if the launching process died before recording anything.
        if state.worker_pid is not None or is_terminal(state.phase):
            return self.status(run_id)
        try:
            pid = self._launcher.launch(run_id)
        except TechtreeError as error:
            self._record_launch_failure(record, error)
            raise
        if self._runs.state(run_id).worker_pid is None:
            with suppress(ConflictError, RunError, ValidationError):
                self._runs.write_pid(run_id, pid)
        self._drafts.mark_launched(
            draft_id=record.draft_id, run_id=run_id, launched_at=self._clock()
        )
        return self.status(run_id)

    def _record_launch_failure(self, record: DraftStartRecord, error: TechtreeError) -> None:
        state = self._runs.state(record.run_id)
        if not is_terminal(state.phase):
            failure = run_failure(error)
            self._runs.append(
                record.run_id,
                phase=RunPhase.FAILED,
                kind=RUN_FAILED,
                details={DETAIL_ERROR: to_json_value(failure)},
            )
        self._drafts.mark_launch_failed(
            draft_id=record.draft_id, run_id=record.run_id, error_code=error.code
        )

    def status(self, run_id: str) -> RunStatus:
        """Return the projected state plus process and heartbeat health."""
        state = self._runs.state(run_id)
        health = self._health(run_id, state)
        return RunStatus(
            state=state,
            worker_alive=health.worker_alive,
            heartbeat_stale=health.heartbeat_stale,
            result_available=self._runs.result_path(run_id).exists(),
        )

    def request(self, run_id: str) -> RunRequestV2:
        """Return the immutable request this run executes."""
        return self._runs.get_request(run_id)

    def state_digest(self, run_id: str) -> Digest:
        """Return the digest of the durable state an answer was read from."""
        return self._runs.state_digest(run_id)

    def wait(
        self,
        run_id: str,
        *,
        timeout_seconds: int = DEFAULT_WAIT_TIMEOUT_SECONDS,
        since_state_digest: Digest | None = None,
    ) -> None:
        """Block until this run moves past ``since_state_digest``, ends, or time is up.

        Nothing is returned and nothing is left running; the caller reads the run afterwards
        exactly as it would have without waiting, and an expired bound is an ordinary return.
        """
        if (
            timeout_seconds < MINIMUM_WAIT_TIMEOUT_SECONDS
            or timeout_seconds > MAXIMUM_WAIT_TIMEOUT_SECONDS
        ):
            raise UsageError(
                f"a wait is between {MINIMUM_WAIT_TIMEOUT_SECONDS} and "
                f"{MAXIMUM_WAIT_TIMEOUT_SECONDS} seconds; {timeout_seconds} is outside that",
                code=RUN_WAIT_TIMEOUT_OUT_OF_RANGE,
                details={
                    "run_id": run_id,
                    "timeout_seconds": timeout_seconds,
                    "minimum": MINIMUM_WAIT_TIMEOUT_SECONDS,
                    "maximum": MAXIMUM_WAIT_TIMEOUT_SECONDS,
                },
            )
        baseline = (
            self._runs.state_digest(run_id) if since_state_digest is None else since_state_digest
        )
        deadline = time.monotonic() + timeout_seconds
        while True:
            if self._runs.state_digest(run_id) != baseline:
                return
            if is_terminal(self._runs.state(run_id).phase):
                return
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            time.sleep(min(DEFAULT_WORKER_HEARTBEAT_SECONDS, remaining))

    def process_health(self, run_id: str) -> ProcessHealth:
        """Return what the host knows about this run's worker process."""
        return self._health(run_id, self._runs.state(run_id))

    def _health(self, run_id: str, state: RunState) -> ProcessHealth:
        alive = self._launcher.is_alive(run_id)
        heartbeat = state.heartbeat_at
        age = None if heartbeat is None else (self._clock() - heartbeat).total_seconds()
        if is_terminal(state.phase) or state.worker_pid is None:
            stale = False
        else:
            stale = age is None or age > self._stale_after
        return ProcessHealth(
            worker_pid=state.worker_pid,
            worker_alive=alive,
            heartbeat_at=heartbeat,
            heartbeat_age_seconds=age,
            heartbeat_stale=stale,
        )

    def result(self, run_id: str) -> UpliftReportV2:
        """Return the report, once the run has finished and the journal names it."""
        state = self._runs.state(run_id)
        if state.phase is not RunPhase.COMPLETED:
            raise RunError(
                f"run {run_id} is {state.phase.value} and has no result yet",
                code=RUN_RESULT_NOT_READY,
                details={"run_id": run_id, "phase": state.phase.value},
            )
        report = self._runs.get_result(run_id)
        recomputed = digest_object(report)
        if state.result_digest is None or recomputed != state.result_digest:
            raise VerificationError(
                f"the report stored for run {run_id} is not the report its journal recorded",
                code=RUN_RESULT_DIGEST_MISMATCH,
                details={"run_id": run_id, "expected": state.result_digest, "computed": recomputed},
            )
        return report

    def logs(self, run_id: str, *, tail: int = DEFAULT_LOG_TAIL) -> RunLogs:
        """Return the last ``tail`` lines of the worker log, as they were written."""
        return self._read_log(
            run_id,
            path=self._runs.worker_log_path(run_id),
            tail=tail,
            missing=f"run {run_id} has written no log yet",
        )

    def variant_logs(
        self, run_id: str, variant: VariantName, *, tail: int = DEFAULT_LOG_TAIL
    ) -> RunLogs:
        """Return one variant's engine log; never the child's stdout, which holds transcripts."""
        return self._read_log(
            run_id,
            path=RunPaths.for_run(self._paths, run_id).variant_output_dir(variant) / EVAL_LOG_PATH,
            tail=tail,
            missing=f"the {variant.value} variant of run {run_id} has not started evaluating yet",
        )

    def _read_log(self, run_id: str, *, path: Path, tail: int, missing: str) -> RunLogs:
        if tail < MINIMUM_LOG_TAIL or tail > MAXIMUM_LOG_TAIL:
            raise UsageError(
                f"--tail is between {MINIMUM_LOG_TAIL} and {MAXIMUM_LOG_TAIL} lines; {tail} is "
                "outside that",
                details={
                    "run_id": run_id,
                    "tail": tail,
                    "minimum": MINIMUM_LOG_TAIL,
                    "maximum": MAXIMUM_LOG_TAIL,
                },
            )
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
        except FileNotFoundError as error:
            raise NotFoundError(
                missing, code=RUN_LOGS_UNAVAILABLE, details={"run_id": run_id}
            ) from error
        lines = raw.splitlines()
        return RunLogs(run_id=run_id, lines=lines[-tail:], truncated=len(lines) > tail)

    def worker_log_path(self, run_id: str) -> Path:
        """The log file a follower reads; for the command's own use, never put in an answer."""
        return self._runs.worker_log_path(run_id)

    def cancel(self, run_id: str, *, requested_by: str = "cli") -> RunCancellation:
        """Ask a run to stop, idempotently, and signal its worker."""
        state = self._runs.state(run_id)
        if is_terminal(state.phase):
            return RunCancellation(status=self.status(run_id), outcome="already_terminal")
        already = state.phase is RunPhase.CANCEL_REQUESTED
        self._runs.request_cancel(run_id, requested_by=requested_by)
        self._launcher.request_termination(run_id)
        return RunCancellation(
            status=self.status(run_id),
            outcome="already_requested" if already else "requested",
        )
