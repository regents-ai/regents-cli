"""`regents techtree withdraw BUNDLE_DIGEST`: mark a published entry withdrawn, never deleted.

The entry is named the way the log names it, so it works whether or not the run is still on
this machine. The request is signed with this machine's key, the key that signed the run, and
the log's answer is refused unless the pinned network key countersigned it.
"""

from __future__ import annotations

from typing import Final

import click

from regents_cli.techtree import paths
from regents_cli.techtree.approval import REVIEWED_ON, YES, ReviewedOn, approve
from regents_cli.techtree.canonical import validate_digest
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.identity.store import IdentityStore
from regents_cli.techtree.models.base import Digest, JsonValue
from regents_cli.techtree.publication.coordinates import packaged_publication_coordinates
from regents_cli.techtree.publication.transport import (
    HttpsPublicationTransport,
    publication_endpoint,
)
from regents_cli.techtree.publication.withdraw import WithdrawalService

_WITHDRAW_PROMPT: Final = "Withdraw this entry from the public log?"

#: The honest claim rather than the comfortable one: the entry stays, marked.
_WHAT_WITHDRAWAL_DOES: Final = (
    "Withdrawing marks the entry withdrawn. It is not a deletion: the entry stays at the "
    "address it already has, the log records the withdrawal as another event, and anyone who "
    "already has the proof still has it."
)


def withdrawal_service() -> WithdrawalService:
    coordinates = packaged_publication_coordinates()
    return WithdrawalService(
        coordinates=coordinates,
        endpoint=publication_endpoint(coordinates),
        identity=IdentityService(IdentityStore(paths.home())),
        transport=HttpsPublicationTransport(),
    )


def withdraw(bundle_digest: str, yes: bool, reviewed_on: ReviewedOn, as_json: bool) -> None:
    digest = validate_digest(bundle_digest)
    service = withdrawal_service()
    approve(
        yes=yes,
        reviewed_on=reviewed_on,
        as_json=as_json,
        review=review_lines(digest, service.endpoint),
        command=["withdraw", digest],
        question=_WITHDRAW_PROMPT,
        why="Withdrawing changes a public page, so somebody has to agree to it.",
    )
    outcome = service.withdraw(digest)
    answer: dict[str, JsonValue] = {
        "bundle_digest": outcome.bundle_digest,
        "endpoint": service.endpoint,
        "entry_url": outcome.entry_url,
        "withdrawn_at": outcome.withdrawn_at.isoformat(),
        "key_id": outcome.key_id,
    }
    answer["report"] = "\n".join(
        [
            f"The entry at {outcome.entry_url} is marked withdrawn. It stays where it is: the "
            "log appended the withdrawal rather than removing anything.",
            "",
            f"- Entry: {outcome.entry_url}",
            f"- Proof: {outcome.bundle_digest}",
            f"- Withdrawn: {outcome.withdrawn_at.isoformat()}",
            f"- Signed by: {outcome.key_id}",
        ]
    )
    emit(answer, as_json=as_json)


def review_lines(bundle_digest: Digest, endpoint: str) -> list[str]:
    return [
        f"Withdrawing entry {bundle_digest}",
        "",
        f"A signed request goes to {endpoint}. It is signed with this machine's own key, which "
        "is the key that signed the run.",
        "",
        _WHAT_WITHDRAWAL_DOES,
    ]


WITHDRAW = click.Command(
    "withdraw",
    callback=withdraw,
    params=[click.Argument(["bundle_digest"], metavar="BUNDLE_DIGEST"), YES, REVIEWED_ON, JSON],
    help="Withdraw a published run from the public run log. The entry is marked withdrawn, "
    "not deleted; the request is signed with this machine's key.",
)
