"""`regents techtree run status | logs | cancel | result`: one run, from launch to its report."""

from __future__ import annotations

import contextlib
from typing import Final

import click

from regents_cli import output
from regents_cli.techtree import paths
from regents_cli.techtree.approval import REVIEWED_ON, YES, ReviewedOn, approve
from regents_cli.techtree.canonical import to_json_value, validate_digest
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.drafts.store import DraftStore
from regents_cli.techtree.errors import VerificationError
from regents_cli.techtree.identity.models import VerificationResult
from regents_cli.techtree.ids import validate_id
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.models.experiment import ExperimentVariant
from regents_cli.techtree.models.run import PublicRunState
from regents_cli.techtree.models.uplift_report import UpliftReportV3
from regents_cli.techtree.presentation.build import build_uplift_presentation
from regents_cli.techtree.presentation.compact import render_uplift_markdown
from regents_cli.techtree.presentation.evidence import read_recorded_evidence
from regents_cli.techtree.presentation.models import UpliftPresentationPayload
from regents_cli.techtree.publication.offer import publication_offer
from regents_cli.techtree.receipts.bundle import PROOF_BUNDLE_INVALID, proof_bundle_dir
from regents_cli.techtree.receipts.execution import read_execution_record
from regents_cli.techtree.receipts.verify import LocalProofVerifier
from regents_cli.techtree.runs.artifacts import RunArtifactStore
from regents_cli.techtree.runs.launcher import WorkerLauncher
from regents_cli.techtree.runs.machine import public_state
from regents_cli.techtree.runs.service import (
    DEFAULT_LOG_TAIL,
    DEFAULT_WAIT_TIMEOUT_SECONDS,
    MAXIMUM_LOG_TAIL,
    MAXIMUM_WAIT_TIMEOUT_SECONDS,
    MINIMUM_LOG_TAIL,
    MINIMUM_WAIT_TIMEOUT_SECONDS,
    RunService,
)
from regents_cli.techtree.runs.store import RunStore
from regents_cli.techtree.verifiers.models import VariantName

#: A finished report is where a reader decides what they may do with what they hold, so it
#: says which part was real and whose rights still govern the artifacts.
DEVELOPMENT_ONLY_RESULT_NOTICE: Final = (
    "This is a development-only report.\n"
    "\n"
    "The taskset was validated through Prime Intellect Verifiers.\n"
    "The report is not publication eligible and its result is not comparable evidence.\n"
    "\n"
    "The candidate and generated artifacts remain governed by DataPolicy:\n"
    "{data_policy_digest}"
)

_TERMINAL: Final = frozenset(
    {PublicRunState.COMPLETED, PublicRunState.FAILED, PublicRunState.CANCELLED}
)

RUN_ID = click.Argument(["run_id"], metavar="RUN_ID")


def run_service(home: paths.TechtreePaths) -> RunService:
    """The run service every command in this slice talks to, over one home."""
    store = RunStore(home)
    return RunService(
        paths=home,
        draft_store=DraftStore(home),
        run_store=store,
        artifact_store=RunArtifactStore(home),
        launcher=WorkerLauncher(store),
    )


def status(
    run_id: str, timeout_seconds: int | None, since_state_digest: str | None, as_json: bool
) -> None:
    validate_id(run_id, expected_prefix="run")
    service = run_service(paths.home())
    if timeout_seconds is not None or since_state_digest is not None:
        with contextlib.suppress(KeyboardInterrupt):  # stopping the wait still answers
            service.wait(
                run_id,
                timeout_seconds=(
                    DEFAULT_WAIT_TIMEOUT_SECONDS if timeout_seconds is None else timeout_seconds
                ),
                since_state_digest=(
                    None if since_state_digest is None else validate_digest(since_state_digest)
                ),
            )
    answer = status_answer(service, run_id)
    answer["report"] = _status_report(answer)
    emit(answer, as_json=as_json)


def logs(run_id: str, tail: int, variant: str | None, as_json: bool) -> None:
    validate_id(run_id, expected_prefix="run")
    service = run_service(paths.home())
    if variant is None:
        window = service.logs(run_id, tail=tail)
    else:
        window = service.variant_logs(run_id, VariantName(variant), tail=tail)
    answer: dict[str, JsonValue] = {
        "run_id": window.run_id,
        "lines": list(window.lines),
        "truncated": window.truncated,
        "report": "\n".join(window.lines) if window.lines else "(no log lines yet)",
    }
    emit(answer, as_json=as_json, shown=[output.verbatim(str(answer["report"]))])


def cancel(run_id: str, yes: bool, reviewed_on: ReviewedOn, as_json: bool) -> None:
    validate_id(run_id, expected_prefix="run")
    service = run_service(paths.home())
    before = service.status(run_id)
    # A run that has already ended is answered without a question: there is nothing to stop.
    if public_state(before.state.phase) not in _TERMINAL:
        approve(
            yes=yes,
            reviewed_on=reviewed_on,
            as_json=as_json,
            review=[
                f"Run {run_id} is {public_state(before.state.phase)}. Stopping it ends the "
                "comparison at the next phase boundary; the episodes already run are not "
                "refunded by a provider that charges for tokens, and the run produces no report."
            ],
            command=["run", "cancel", run_id],
            question=f"Stop run {run_id}?",
            why="Stopping a run throws away the work it has done so far.",
        )
    cancellation = service.cancel(run_id)
    state = cancellation.status.state
    warnings: list[JsonValue] = []
    if cancellation.outcome == "already_terminal":
        warnings.append(
            {
                "id": "run_already_terminal",
                "text": f"run {run_id} had already ended as {public_state(state.phase)}; "
                "nothing was changed.",
            }
        )
    elif cancellation.outcome == "already_requested":
        warnings.append(
            {
                "id": "run_stopping",
                "text": f"run {run_id} was already asked to stop; the request stands.",
            }
        )
    answer: dict[str, JsonValue] = {
        "run_id": run_id,
        "outcome": cancellation.outcome,
        "phase": state.phase.value,
        "cancel_requested_at": to_json_value(state.cancel_requested_at),
        "worker_alive": cancellation.status.worker_alive,
        "state_digest": service.state_digest(run_id),
    }
    if warnings:
        answer["warnings"] = warnings
    answer["report"] = "\n".join(
        [
            f"Run {run_id}: {cancellation.outcome.replace('_', ' ')} ({state.phase.value}).",
            *(f"- {warning['text']!s}" for warning in warnings if isinstance(warning, dict)),
            "",
            f"Next: regents techtree run status {run_id}",
        ]
    )
    emit(answer, as_json=as_json)


def result(run_id: str, as_json: bool) -> None:
    validate_id(run_id, expected_prefix="run")
    home = paths.home()
    service = run_service(home)
    report = service.result(run_id)
    verification = _verify_proof(home, run_id, report)
    record = read_execution_record(proof_bundle_dir(home.run_dir(run_id)))
    artifacts = RunArtifactStore(home)
    inputs = artifacts.load_inputs(run_id, RunStore(home).get_request(run_id))
    presentation = build_uplift_presentation(
        report=report,
        campaign=inputs.campaign,
        baseline_receipts=artifacts.episode_receipts(run_id, ExperimentVariant.BASELINE),
        candidate_receipts=artifacts.episode_receipts(run_id, ExperimentVariant.CANDIDATE),
        climb=inputs.source.climb,
        baseline_skill=None,
        candidate_skill=inputs.candidate_skill.artifact,
        verification=verification,
        execution_record=record,
        recorded_evidence=(
            None if record is None else read_recorded_evidence(home.run_dir(run_id), record)
        ),
    )
    answer: dict[str, JsonValue] = {
        "run_id": run_id,
        "uplift_report": to_json_value(report),
        "presentation": to_json_value(presentation),
        "execution_record": to_json_value(record),
        "state_digest": service.state_digest(run_id),
    }
    if verification is not None and report.publication_eligible:
        answer["publication_offer"] = dict(publication_offer(run_id))
    if report.proof_grade == "development_only":
        answer["warnings"] = [
            {
                "id": "development_only_result",
                "text": DEVELOPMENT_ONLY_RESULT_NOTICE.format(
                    data_policy_digest=report.data_policy_digest
                ),
            }
        ]
    answer["report"] = _result_report(presentation, answer)
    emit(answer, as_json=as_json)


def status_answer(service: RunService, run_id: str) -> dict[str, JsonValue]:
    """The facts `run status` states, also what `climb start` shows right after launching."""
    current = service.status(run_id)
    health = service.process_health(run_id)
    state = current.state
    public = public_state(state.phase)
    return {
        "run_id": state.run_id,
        "phase": state.phase.value,
        "public_state": public.value,
        "sequence": state.sequence,
        "updated_at": to_json_value(state.updated_at),
        "progress": to_json_value(state.progress),
        "variant_progress": to_json_value(state.variant_progress),
        "worker_pid": state.worker_pid,
        "worker_alive": current.worker_alive,
        "heartbeat_at": to_json_value(health.heartbeat_at),
        "heartbeat_age_seconds": health.heartbeat_age_seconds,
        "heartbeat_stale": current.heartbeat_stale,
        "cancel_requested_at": to_json_value(state.cancel_requested_at),
        "terminal": public in _TERMINAL,
        "result_available": current.result_available,
        "result_digest": state.result_digest,
        "error": to_json_value(state.error),
        "state_digest": service.state_digest(run_id),
    }


def _verify_proof(
    home: paths.TechtreePaths, run_id: str, report: UpliftReportV3
) -> VerificationResult | None:
    """Check the run's local proof when it claims one; a proof that does not verify is an error.

    A development-only report never claimed a proof, so nothing is verified and nothing is said
    about it. A graded report always has one, and a missing bundle is a failed verification.
    """
    if report.proof_grade == "development_only":
        return None
    verification = LocalProofVerifier().verify_bundle(proof_bundle_dir(home.run_dir(run_id)))
    if not verification.verified:
        raise VerificationError(
            f"run {run_id} produced a report whose local proof does not verify",
            code=PROOF_BUNDLE_INVALID,
            details={
                "run_id": run_id,
                "failed_checks": [message.id for message in verification.failures],
            },
        )
    return verification


def _status_report(answer: dict[str, JsonValue]) -> str:
    lines = [
        f"Run {answer['run_id']}: {answer['public_state']} ({answer['phase']}).",
        "",
    ]
    progress = answer["progress"]
    if isinstance(progress, dict):
        lines.append(
            f"- Progress: {progress['current']} of {progress['total']} — {progress['label']}"
        )
    lines.append(f"- Worker: pid {answer['worker_pid']}, alive {_yes(answer['worker_alive'])}")
    if answer["heartbeat_at"] is not None:
        lines.append(
            f"- Heartbeat: {answer['heartbeat_at']} ({answer['heartbeat_age_seconds']:.0f}s ago"
            f"{', stale' if answer['heartbeat_stale'] else ''})"
        )
    error = answer["error"]
    if isinstance(error, dict):
        lines.append(f"- Failed: {error['code']}: {error['message']}")
    lines.append("")
    if answer["result_available"]:
        lines.append(f"Next: regents techtree run result {answer['run_id']}")
    elif answer["terminal"]:
        lines.append(f"Next: regents techtree run logs {answer['run_id']}")
    else:
        lines.append(f"Next: regents techtree run status {answer['run_id']} --timeout-seconds 30")
    return "\n".join(lines)


def _result_report(presentation: UpliftPresentationPayload, answer: dict[str, JsonValue]) -> str:
    markdown = render_uplift_markdown(presentation)
    warnings = answer.get("warnings")
    if isinstance(warnings, list):
        notices = [str(warning["text"]) for warning in warnings if isinstance(warning, dict)]
        markdown = "\n\n".join([*notices, markdown])
    offer = answer.get("publication_offer")
    if isinstance(offer, dict):
        markdown = f"{markdown}\n\nTo publish this result: {offer['command']}"
    return markdown


def _yes(value: JsonValue) -> str:
    return "yes" if value else "no"


RUN = click.Group("run", help="Watch, read, stop and collect the result of a run.")
RUN.add_command(
    click.Command(
        "status",
        callback=status,
        help="Where a run is now; with --timeout-seconds or --since-state-digest, wait for a "
        "change first.",
        params=[
            RUN_ID,
            click.Option(
                ["--timeout-seconds"],
                type=click.IntRange(MINIMUM_WAIT_TIMEOUT_SECONDS, MAXIMUM_WAIT_TIMEOUT_SECONDS),
                help=f"Wait up to this long for the run to change (default "
                f"{DEFAULT_WAIT_TIMEOUT_SECONDS} when waiting).",
            ),
            click.Option(
                ["--since-state-digest"],
                metavar="DIGEST",
                help="Wait until the run's state differs from this digest, or the timeout.",
            ),
            JSON,
        ],
    )
)
RUN.add_command(
    click.Command(
        "logs",
        callback=logs,
        help="The tail of the run's worker log, or of one variant's evaluation log.",
        params=[
            RUN_ID,
            click.Option(
                ["--tail"],
                type=click.IntRange(MINIMUM_LOG_TAIL, MAXIMUM_LOG_TAIL),
                default=DEFAULT_LOG_TAIL,
                show_default=True,
                help="How many lines from the end.",
            ),
            click.Option(
                ["--variant"],
                type=click.Choice([variant.value for variant in VariantName]),
                help="Read that variant's evaluation log instead of the worker log.",
            ),
            JSON,
        ],
    )
)
RUN.add_command(
    click.Command(
        "cancel",
        callback=cancel,
        help="Ask a run to stop at its next phase boundary.",
        params=[RUN_ID, YES, REVIEWED_ON, JSON],
    )
)
RUN.add_command(
    click.Command(
        "result",
        callback=result,
        help="The finished report, its local proof checked, rendered compactly.",
        params=[RUN_ID, JSON],
    )
)
