"""`regents techtree setup`: prepare this machine to run a Climb."""

from __future__ import annotations

from typing import Final

import click

from regents_cli.techtree import paths
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.commands.engine import engine_lines
from regents_cli.techtree.doctor.service import DoctorService
from regents_cli.techtree.engines.installer import EngineInstaller, find_uv
from regents_cli.techtree.engines.registry import EngineRegistry
from regents_cli.techtree.errors import PrerequisiteError
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.identity.store import IdentityStore
from regents_cli.techtree.models.base import JsonValue

ENVIRONMENT_NOT_READY: Final = "environment_not_ready"

#: A published proof carries the public half inside the envelopes it signs, which is what makes
#: the signature checkable by somebody who does not trust us; the private half never travels.
LOCAL_SIGNING_KEY_NOTICE: Final = (
    "Techtree keeps a local signing key, used only to detect changes to your local receipts. "
    "The private half never leaves the key directory. The public half travels inside the "
    "proofs it signs, which is what lets anybody check one."
)


def setup(as_json: bool) -> None:
    home = paths.home()
    doctor = DoctorService(home)
    blocking = doctor.blocking_failures(doctor.run())
    if blocking:
        identifiers = [check.id for check in blocking]
        raise PrerequisiteError(
            "this host is not ready to run a Climb: " + ", ".join(identifiers),
            code=ENVIRONMENT_NOT_READY,
            details={
                "failed_checks": list(identifiers),
                "blocking_failures": [check.model_dump(mode="json") for check in blocking],
            },
        )
    installer = EngineInstaller(home, EngineRegistry(home), find_uv())
    status = installer.verify(installer.install().digest)
    identity = IdentityService(IdentityStore(home)).ensure()
    answer: dict[str, JsonValue] = {
        "engine": status.model_dump(mode="json"),
        "key_id": identity.key_id,
    }
    answer["report"] = "\n".join(
        [
            f"This machine is ready. Evaluation engine {status.digest} is installed and verified.",
            "",
            *engine_lines(status),
            "",
            LOCAL_SIGNING_KEY_NOTICE,
            f"- Key: {identity.key_id}",
        ]
    )
    emit(answer, as_json=as_json)


SETUP = click.Command(
    "setup",
    callback=setup,
    help="Prepare this machine to run a Climb: check prerequisites, install and verify the "
    "evaluation engine, and settle the local signing key.",
    params=[JSON],
)
