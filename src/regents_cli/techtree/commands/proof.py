"""`regents techtree proof verify TARGET`: does this proof still hold together?

It reads, hashes and checks signatures; it writes nothing, contacts nothing and needs no
Techtree state, so a proof handed over on a memory stick checks on a machine that has never
run a Climb. A broken proof is a typed failure with the failed checks, not a printed warning.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Final, Literal

import click
from rich.console import RenderableType

from regents_cli import output
from regents_cli.techtree import paths
from regents_cli.techtree.commands.answers import JSON, emit, warnings
from regents_cli.techtree.commands.publish import publication_service
from regents_cli.techtree.errors import NotFoundError, ValidationError, VerificationError
from regents_cli.techtree.identity.models import (
    VerificationMessage,
    VerificationResult,
    VerificationStatus,
)
from regents_cli.techtree.ids import validate_id
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.publication.downloaded import (
    is_downloaded_bundle,
    verify_downloaded_bundle,
)
from regents_cli.techtree.publication.offer import publication_offer
from regents_cli.techtree.receipts.bundle import (
    BUNDLE_MANIFEST_FILENAME,
    PROOF_BUNDLE_INVALID,
    proof_bundle_dir,
)
from regents_cli.techtree.receipts.verify import LocalProofVerifier

#: Nothing at that name to verify; distinct from a proof that exists and does not hold.
PROOF_TARGET_NOT_FOUND: Final = "proof_target_not_found"
_MARK: Final[dict[VerificationStatus, output.CheckStatus]] = {
    "passed": "pass",
    "warning": "warn",
    "failed": "fail",
}

type ProofTargetKind = Literal["bundle", "report", "published"]


def verify(target: str, as_json: bool) -> None:
    runs_dir = paths.home().runs_dir
    path, kind = resolve_proof_target(target, runs_dir=runs_dir)
    verifier = LocalProofVerifier()
    if kind == "published":
        result = verify_downloaded_bundle(path)
    elif kind == "report":
        result = verifier.verify_report(path)
    else:
        result = verifier.verify_bundle(path)
    if not result.verified:
        raise VerificationError(
            f"this local proof does not verify: {result.failures[0].detail}",
            code=PROOF_BUNDLE_INVALID,
            details={
                "target": target,
                "failed_checks": [message.id for message in result.failures],
                "codes": sorted({message.code for message in result.failures}),
            },
        )
    summary = verifier.explain(result)
    answer: dict[str, JsonValue] = {
        "target": target,
        "kind": kind,
        "verified": True,
        "summary": [message.model_dump(mode="json") for message in summary],
        "checks": [message.model_dump(mode="json") for message in result.messages],
    }
    if result.warnings:
        answer["warnings"] = warnings(result.warnings)
    # Offered only for a bundle of a run on this machine whose report says it may be published:
    # offering a command that would refuse is worse than offering nothing.
    run_id = _run_of(path, runs_dir) if kind == "bundle" else None
    if run_id is not None and publication_service().publication_eligible(run_id):
        answer["publication_offer"] = dict(publication_offer(run_id))
    answer["report"] = _report(answer, summary, result)
    emit(answer, as_json=as_json, shown=_shown(answer, summary, result))


def resolve_proof_target(target: str, *, runs_dir: Path) -> tuple[Path, ProofTargetKind]:
    """A directory is a bundle; a file is a downloaded Result bundle or a signed report;
    anything else is a run identifier looked up on this machine."""
    candidate = Path(target).expanduser()
    if candidate.is_dir():
        return candidate, "bundle"
    if candidate.is_file():
        if candidate.name == BUNDLE_MANIFEST_FILENAME:
            return candidate.parent, "bundle"
        if is_downloaded_bundle(candidate):
            return candidate, "published"
        return candidate, "report"
    missing = NotFoundError(
        f"there is no proof to verify for {target}: no such run, directory or file",
        code=PROOF_TARGET_NOT_FOUND,
        details={"target": target},
    )
    try:
        run_id = validate_id(target, "run")
    except ValidationError as error:
        raise missing from error
    directory = proof_bundle_dir(runs_dir / run_id)
    if directory.is_dir():
        return directory, "bundle"
    raise missing


def _run_of(bundle: Path, runs_dir: Path) -> str | None:
    """The run a proof directory belongs to, read off the directory rather than the argument."""
    run_dir = bundle.parent
    if run_dir.parent.resolve() != runs_dir.resolve():
        return None
    try:
        return validate_id(run_dir.name, "run")
    except ValidationError:
        return None


# The headings a person reads a verification under. The envelope checks are the only ones
# whose sentence does not say what it was about, so the subject is read off the identifier.
_SIGNATURE_ASPECTS: Final = (
    ".payload_digest",
    ".signature",
    ".signature_key",
    ".signature_present",
)
_HEADINGS: Final[tuple[tuple[str, Callable[[str], bool]], ...]] = (
    (
        "Files and key present",
        lambda i: i.endswith(".present") or i.startswith("document.") or i == "bundle.public_key",
    ),
    (
        "Stored file digests",
        lambda i: i.startswith("artifact.") or i == "bundle.root_report_digest",
    ),
    (
        "Linkage and control",
        lambda i: i.startswith(("linkage.", "receipt_set.", "execution_record.")),
    ),
    ("Signatures", lambda i: i.endswith(_SIGNATURE_ASPECTS)),
    ("Aggregate recomputation", lambda i: i.startswith("aggregate.")),
    ("Publication", lambda i: i.startswith("publication.")),
    ("Proof grade conditions", lambda i: i.startswith("p1.")),
    ("Other checks", lambda _: True),
)


def _report(
    answer: dict[str, JsonValue], summary: Sequence[VerificationMessage], result: VerificationResult
) -> str:
    checks = result.messages
    lines = [
        *_opening(answer, checks),
        "",
        *(f"- **{message.status.upper()}** {message.detail}" for message in summary),
        "",
        _what_was_checked(checks),
        *(f"- {heading}: {_tally(group)}" for heading, group in _grouped(checks)),
        *_closing(answer, result),
    ]
    return "\n".join(lines)


def _shown(
    answer: dict[str, JsonValue], summary: Sequence[VerificationMessage], result: VerificationResult
) -> list[RenderableType]:
    """The same report for a person at a terminal, its checks as check lists."""
    checks = result.messages
    closing = _closing(answer, result)
    return [
        output.report("\n".join(_opening(answer, checks))),
        output.checks(
            output.Check(message.id.replace("_", " "), _MARK[message.status], message.detail)
            for message in summary
        ),
        output.report(_what_was_checked(checks)),
        output.checks(
            output.Check(heading, _MARK[_worst(group)], _tally(group))
            for heading, group in _grouped(checks)
        ),
        *([output.report("\n".join(closing))] if closing else []),
    ]


def _opening(answer: dict[str, JsonValue], checks: Sequence[VerificationMessage]) -> list[str]:
    return [
        f"This proof verifies: {len(checks)} checks, all from the stored bytes, with nothing "
        "fetched.",
        "",
        f"Proof: {answer['target']}",
    ]


def _what_was_checked(checks: Sequence[VerificationMessage]) -> str:
    return f"What was checked, {len(checks)} checks in all"


def _closing(answer: dict[str, JsonValue], result: VerificationResult) -> list[str]:
    lines: list[str] = []
    if result.warnings:
        lines += ["", "Warnings", *(f"- {message.detail}" for message in result.warnings)]
    offer = answer.get("publication_offer")
    if isinstance(offer, dict):
        lines += ["", f"To publish it: `{offer['command']}`", str(offer["reason"])]
    return lines


def _worst(checks: Sequence[VerificationMessage]) -> VerificationStatus:
    """How one heading came out as one word: a failure, else a warning, else passed."""
    statuses = {message.status for message in checks}
    if "failed" in statuses:
        return "failed"
    if "warning" in statuses:
        return "warning"
    return "passed"


def _grouped(
    checks: Sequence[VerificationMessage],
) -> list[tuple[str, list[VerificationMessage]]]:
    collected: dict[str, list[VerificationMessage]] = {heading: [] for heading, _ in _HEADINGS}
    for message in checks:
        for heading, belongs_here in _HEADINGS:
            if belongs_here(message.id):
                collected[heading].append(message)
                break
    return [(heading, group) for heading, group in collected.items() if group]


def _tally(checks: Sequence[VerificationMessage]) -> str:
    """How one heading came out: its one status, or passed over total with a warning count."""
    if len(checks) == 1:
        return checks[0].status
    passed = sum(1 for message in checks if message.status == "passed")
    warned = len(checks) - passed
    note = "" if not warned else (" (1 warning)" if warned == 1 else f" ({warned} warnings)")
    return f"{passed}/{len(checks)}{note}"


PROOF = click.Group("proof", help="Check proofs, offline, from the bytes they stored.")
PROOF.add_command(
    click.Command(
        "verify",
        callback=verify,
        params=[click.Argument(["target"], metavar="TARGET"), JSON],
        help="Check a proof: a run identifier, a proof bundle directory, a Result bundle "
        "downloaded from the run log, or a signed uplift-report file.",
    )
)
