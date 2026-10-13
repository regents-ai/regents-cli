"""What comes after a failure. A site's own fault ends in a ready patchbay.help post that names
the command but none of the values it was given, because the post is public; when Patchbay
itself is what broke, a person is told instead. A payment or a paid start is never repeated
blind (the 1.10.1 review)."""

from __future__ import annotations

import json
import shlex

import httpx
import pytest

from regents_cli import app
from regents_cli.errors import EXIT_CANCELLED, EXIT_UNREACHABLE, CommandError
from regents_cli.http import answer
from regents_cli.next_steps import Invocation, for_failure
from regents_cli.platforms import pinned_platforms
from regents_cli.runner import after
from regents_cli.techtree.commands.run import after_logs, after_status
from regents_cli.techtree.forge.records import inspect_first
from regents_cli.techtree.models.base import JsonValue

SECRET = "my-private-note"


def invocation(namespace: str, host: str) -> Invocation:
    args = (namespace, "threads", "get", SECRET)
    return Invocation(args, (namespace, "threads", "get"), namespace, host, takes_stdin=False)


def test_a_broken_site_gets_a_public_post_without_the_values() -> None:
    error = CommandError("http_500", "The site failed.", status=500)
    failed = invocation("keyfleet", "keyfleet.ai")
    again, post = for_failure(error, failed)
    assert again.kind == "run" and again.command == shlex.join(failed.again)
    assert post.kind == "patchbay" and post.command is not None
    piped = shlex.split(post.command)[2]
    assert json.loads(piped)["site"] == "keyfleet.ai"
    assert SECRET not in post.command


def test_a_broken_patchbay_goes_to_a_person() -> None:
    error = CommandError("http_500", "The site failed.", status=500)
    steps = for_failure(error, invocation("patchbay", "patchbay.help"))
    assert [step.kind for step in steps] == ["run", "human"]


def test_a_coded_refusal_is_for_the_agent_to_fix() -> None:
    error = CommandError("site_busy", "Try again soon.", status=503, retry_after="30")
    (step,) = for_failure(error, invocation("keyfleet", "keyfleet.ai"))
    assert step.kind == "run" and "30 seconds" in step.say


PAY = ["patchbay", "payments", "execute", "00000000-0000-0000-0000-000000000001", "--json"]


def paying() -> Invocation:
    return app.invocation(app.root(), PAY)


@pytest.mark.parametrize(
    "error",
    [
        CommandError("timeout", "No answer.", exit_code=EXIT_UNREACHABLE),
        CommandError("cancelled", "Interrupted.", exit_code=EXIT_CANCELLED),
        CommandError("invalid_response", "Not JSON."),
        CommandError("http_500", "The site failed.", status=500),
        CommandError("facilitator_unavailable", "Try later.", status=502),
        CommandError("settlement_pending", "Pending.", status=409),
    ],
)
def test_an_unsure_payment_is_never_sent_again(error: CommandError) -> None:
    """Review P1: a payment that may have gone through is finished as the site describes
    (Patchbay: payments complete), never repeated with the same signature."""
    steps = for_failure(error, paying())
    assert all(step.command != shlex.join(paying().again) for step in steps)
    assert steps[0].command == "regents patchbay payments --help"
    assert "payments complete" in steps[0].say and "never pays twice" in steps[0].say


def test_a_rerun_asks_for_agreement_again_and_hides_private_values() -> None:
    """Review P1 and P2: a rerun never carries an earlier --yes into a new paid start, and
    never shows a contributor address."""
    args = (
        "techtree",
        "publish",
        "run_1",
        "--address",
        "0xabc",
        "--yes",
        "--reviewed-on",
        "host-agent",
        "--address=0xdef",
        "--reviewed-on=cli",
        "--json",
    )
    again = Invocation(args, ("techtree", "publish"), None, None, takes_stdin=False).again
    assert again == (
        "regents",
        "techtree",
        "publish",
        "run_1",
        "--address",
        "<private-address>",
        "--address",
        "<private-address>",
        "--json",
    )


def test_only_a_402_with_x402_terms_asks_for_a_signature() -> None:
    """Review P2: a 402 with no payment terms (Credits, free quota) is not signing advice."""
    terms = httpx.Response(402, json={"accepts": []}, headers={"payment-required": "e30="})
    no_terms = httpx.Response(402, json={"credits": 0})
    coded = httpx.Response(402, json={"error": {"code": "free_fixes_used", "message": "Used."}})
    failed = invocation("patchbay", "patchbay.help")
    signs = [_raised(r) for r in (terms, no_terms, coded)]
    assert ["Sign" in for_failure(e, failed)[0].say for e in signs] == [True, False, False]
    assert signs[1].code == "http_402"
    assert [s.kind for s in for_failure(signs[2], failed)] == ["human", "done"]


def test_a_202_is_followed_as_the_site_describes() -> None:
    """Review P2: "settled, effect incomplete" is not done; the site's description says how to
    finish it."""
    patchbay = next(p for p in pinned_platforms() if p.name == "patchbay")
    execute = next(c for c in patchbay.commands if c.words[:2] == ("payments", "execute"))
    line = ["regents", "patchbay", "payments", "execute", "x"]
    (unfinished,) = after(patchbay, execute, {"status": "settled"}, line, [], finished=False)
    assert unfinished.command == "regents patchbay payments --help"
    assert "payments complete" in unfinished.say
    assert after(patchbay, execute, {}, line, [], finished=True)[0].kind == "done"


def test_a_stopped_forge_start_is_read_back_before_another() -> None:
    step = inspect_first("forgerun_1")
    assert step.command == "regents techtree forge status forgerun_1"


def test_a_run_that_ended_without_a_result_ends_at_its_logs() -> None:
    """Review P2: status points at the logs, and the logs end it, so the two never loop."""
    standing: dict[str, JsonValue] = {
        "run_id": "run_1",
        "terminal": True,
        "result_available": False,
    }
    assert after_status(standing).command == "regents techtree run logs run_1"
    assert after_logs(standing).kind == "done"
    assert after_logs({**standing, "result_available": True}).command == (
        "regents techtree run result run_1"
    )


def _raised(response: httpx.Response) -> CommandError:
    with pytest.raises(CommandError) as raised:
        answer(response)
    return raised.value
