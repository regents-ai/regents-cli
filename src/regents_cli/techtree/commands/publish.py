"""`regents techtree publish RUN_ID`: the one command that sends anything anywhere.

The proof is verified before anything is asked. Everything that would be sent is shown, file
by file, before the one question. Nobody here to ask means `approval_required` and the exact
command a person's agreement turns into a publication, never an answer invented on their
behalf. The optional address is asked for once, after that agreement, and travels in a header
beside the request, never inside it and never onto disk.
"""

from __future__ import annotations

from typing import Final
from urllib.parse import urlsplit

import click

from regents_cli import output
from regents_cli.techtree import paths
from regents_cli.techtree.approval import REVIEWED_ON, YES, ReviewedOn, approve, asked
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.publication.address import (
    canonical_contributor_address,
    canonical_skill_github_url,
)
from regents_cli.techtree.publication.coordinates import packaged_publication_coordinates
from regents_cli.techtree.publication.offer import RECONCILE_FIRST
from regents_cli.techtree.publication.service import PublicationPlan, PublicationService
from regents_cli.techtree.publication.transport import HttpsPublicationTransport

#: Nothing is promised in return for an address; an intention is not a commitment.
NOTHING_IS_OFFERED: Final = (
    "Nothing is being offered in exchange today. It is kept only so that contributors can be "
    "recognised later, if that becomes possible."
)
ADDRESS_QUESTION: Final = (
    "You can leave an Ethereum address with this run if you want to. It is optional, it is "
    f"never shown on the log, and nobody checks that it is yours. {NOTHING_IS_OFFERED}"
)
_ADDRESS_PROMPT: Final = "Leave an address with this run?"
_PUBLISH_PROMPT: Final = "Publish this run to the public log?"

#: Each episode receipt carries digests, task hashes and scores; the episodes themselves are
#: not in the directory at all.
_WHAT_TRAVELS: Final = (
    "These are the run's proof files: the signed report, the receipts, and the documents they "
    "cite. No prompts and no replies are among them — a receipt records a task's digest and "
    "its score, and the episodes themselves are not in this directory."
)


def publication_service() -> PublicationService:
    """The service every command publishes through: pinned coordinates, the real transport."""
    return PublicationService(
        paths=paths.home(),
        coordinates=packaged_publication_coordinates(),
        transport=HttpsPublicationTransport(),
    )


def publish(
    run_id: str,
    address: str | None,
    github_url: str | None,
    yes: bool,
    reviewed_on: ReviewedOn,
    as_json: bool,
) -> None:
    # Both pieces of typed metadata are checked before anything else, so a mistyped one is
    # refused before a review is shown that could not be acted on.
    skill_github_url = canonical_skill_github_url(github_url) if github_url is not None else None
    contributor = canonical_contributor_address(address) if address is not None else None
    service = publication_service()
    plan = service.plan(run_id)
    approve(
        yes=yes,
        reviewed_on=reviewed_on,
        as_json=as_json,
        review=review_lines(
            plan, contributor_address=contributor, skill_github_url=skill_github_url
        ),
        command=[
            "publish",
            run_id,
            *([] if contributor is None else ["--address", contributor]),
            *([] if skill_github_url is None else ["--github-url", skill_github_url]),
        ],
        question=_PUBLISH_PROMPT,
        why="Publishing sends this run's proof to the public run log, and a published entry is "
        "withdrawn rather than deleted, so somebody has to agree to it.",
    )
    # Only a person at a terminal who has just agreed is asked; with `--yes` nobody is, and
    # no address is sent unless `--address` carried one.
    if not yes and contributor is None:
        contributor = _asked_for_address()
    outcome = service.publish(
        plan, contributor_address=contributor, skill_github_url=skill_github_url
    )
    receipt = outcome.receipt
    answer: dict[str, JsonValue] = {
        "run_id": outcome.run_id,
        "bundle_digest": plan.bundle_digest,
        "endpoint": plan.endpoint,
        "file_count": plan.file_count,
        "byte_count": plan.byte_count,
        "publication": outcome.status.value,
        "log_sequence": receipt.log_sequence,
        "entry_url": receipt.entry_url,
        "accepted_at": receipt.accepted_at.isoformat(),
        "receipt_path": str(outcome.receipt_path),
        "contributor_address_sent": outcome.contributor_address_sent,
        "skill_name": plan.skill_name,
        "skill_github_url": skill_github_url,
        "retry": RECONCILE_FIRST,
    }
    answer["report"] = "\n".join(
        [
            f"Run {outcome.run_id} is entry {receipt.log_sequence} of the public log, at "
            f"{receipt.entry_url}. The log records arrivals in order and ranks nothing.",
            "",
            f"- Run: {outcome.run_id}",
            f"- Entry: {receipt.entry_url}",
            f"- Log sequence: {receipt.log_sequence}",
            f"- Accepted: {receipt.accepted_at.isoformat()}",
            f"- Sent: {plan.file_count} files, {plan.byte_count} bytes",
            f"- Proof: {plan.bundle_digest}",
            f"- Receipt: {outcome.receipt_path}",
            "",
            "The log holds what was sent and the receipt holds what it answered. Neither "
            "changes this run's own files, which are final.",
        ]
    )
    emit(answer, as_json=as_json)


def review_lines(
    plan: PublicationPlan, *, contributor_address: str | None, skill_github_url: str | None
) -> list[str]:
    """What a person reads before they answer: every file, where it goes, what it is not."""
    return [
        f"Publishing run {plan.run_id}",
        "",
        f"These {plan.file_count} files, {plan.byte_count} bytes in all, will be sent to "
        f"{urlsplit(plan.endpoint).hostname}:",
        *(f"  {file.path} ({file.size} bytes)" for file in plan.files),
        f"They go to {plan.endpoint}",
        "",
        f"Proof {plan.bundle_digest}",
        f"Skill {plan.skill_name}",
        f"GitHub {skill_github_url or 'none'}",
        *([] if contributor_address is None else [f"Address {contributor_address}"]),
        "",
        _WHAT_TRAVELS,
        "",
        "The log shows arrivals in the order they arrive and ranks nothing. An entry that is "
        "published stays published: it can be withdrawn, which is recorded, and it is not "
        "deleted.",
    ]


def _asked_for_address() -> str | None:
    """Ask a person once, defaulting to nothing; what they type is checked before it travels."""
    output.stdout.print()
    output.stdout.print(ADDRESS_QUESTION, markup=False)
    if not asked(_ADDRESS_PROMPT):
        return None
    return canonical_contributor_address(click.prompt("Address"))


PUBLISH = click.Command(
    "publish",
    callback=publish,
    params=[
        click.Argument(["run_id"], metavar="RUN_ID"),
        click.Option(
            ["--address"],
            metavar="ADDRESS",
            help="An Ethereum address to send with this run. Optional, never shown on the log, "
            "and nothing is offered in exchange for it.",
        ),
        click.Option(
            ["--github-url"],
            metavar="URL",
            help="The Skill's https://github.com/owner/repo. Public descriptive metadata, not "
            "proof of ownership.",
        ),
        YES,
        REVIEWED_ON,
        JSON,
    ],
    help="Publish a verified run's proof to the public run log. Shows every file that would "
    "be sent and asks before sending anything.",
)
