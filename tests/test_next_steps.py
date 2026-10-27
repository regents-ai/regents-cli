"""What comes after a failure. A site's own fault ends in a public search of patchbay.help, then
a ready post there that names the command but none of the values it was given, because the post
is public; when Patchbay itself is what broke, or the command ran against another address than
the site's own, a person is told instead. A payment or a paid start is never repeated blind (the
1.10.1 review)."""

from __future__ import annotations

import json
import shlex
from pathlib import Path

import click
import httpx
import pytest

from regents_cli import app, output
from regents_cli.errors import EXIT_CANCELLED, EXIT_UNREACHABLE, CommandError
from regents_cli.http import answer
from regents_cli.next_steps import Invocation, for_failure, human
from regents_cli.platforms import Platform, pinned_platforms
from regents_cli.runner import after
from regents_cli.techtree.commands.run import after_logs, after_status
from regents_cli.techtree.errors import RunError
from regents_cli.techtree.forge.records import inspect_first, read_back_first
from regents_cli.techtree.models.base import JsonValue

SECRET = "my-private-note"


def invocation(namespace: str, host: str) -> Invocation:
    args = (namespace, "threads", "get", SECRET)
    return Invocation(args, (namespace, "threads", "get"), namespace, host, takes_stdin=False)


def test_a_broken_site_is_searched_for_then_gets_a_public_post_without_the_values() -> None:
    """The first-run walk (27 Oct): a stranger with no sign-in was only ever handed a post it
    could not make, never the search it could."""
    error = CommandError("http_500", "The site failed.", status=500)
    failed = invocation("keyfleet", "keyfleet.ai")
    again, search, post = for_failure(error, failed)
    assert again.kind == "run" and again.command == shlex.join(failed.again)
    assert search.command == (
        "regents patchbay threads search --query http_500 --origin keyfleet.ai"
    )
    assert post.kind == "patchbay" and post.command is not None
    piped = shlex.split(post.command)[2]
    assert json.loads(piped)["site"] == "keyfleet.ai"
    assert SECRET not in post.command


@pytest.mark.parametrize("through", ["flag", "variable"])
def test_a_failure_at_another_address_is_never_posted_against_the_live_site(
    through: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The first-run walk: a refused 127.0.0.1:9 came with a ready public post saying
    keyfleet.ai was unreachable."""
    args = ["keyfleet", "fleets", "list"]
    unreachable = CommandError("unreachable", "No answer.", exit_code=EXIT_UNREACHABLE)
    live = for_failure(unreachable, app.invocation(app.root(), args))
    assert [step.kind for step in live] == ["run", "run", "patchbay"]
    if through == "flag":
        args += ["--base-url", "http://127.0.0.1:9"]
    else:
        monkeypatch.setenv("KEYFLEET_BASE_URL", "http://127.0.0.1:9")
    again, person = for_failure(unreachable, app.invocation(app.root(), args))
    assert again.kind == "run" and person.kind == "human"
    assert "http://127.0.0.1:9" in person.say and "keyfleet.ai" in person.say


def test_a_broken_patchbay_goes_to_a_person() -> None:
    error = CommandError("http_500", "The site failed.", status=500)
    steps = for_failure(error, invocation("patchbay", "patchbay.help"))
    assert [step.kind for step in steps] == ["run", "human"]


def test_a_coded_refusal_is_for_the_agent_to_fix() -> None:
    error = CommandError("site_busy", "Try again soon.", status=503, retry_after="30")
    (step,) = for_failure(error, invocation("keyfleet", "keyfleet.ai"))
    assert step.kind == "run" and "30 seconds" in step.say


SITES = pinned_platforms()


@pytest.mark.parametrize("platform", SITES, ids=lambda platform: platform.name)
def test_an_unpaired_agent_is_sent_to_the_site_it_called(platform: Platform) -> None:
    """Pairing is per site (each site's agent_not_paired hint says "on this site"): the
    refusal keeps the site's own hint and links that site's Account page, never regents.sh's
    for every site."""
    hint = "Ask your person to sign in on this site and pair you with Pair New Agent."
    refused = httpx.Response(
        403, json={"error": {"code": "agent_not_paired", "message": "Not paired.", "hint": hint}}
    )
    called = app.invocation(app.root(), [platform.name, "agents", "whoami", "--json"])
    person, redeem, again = for_failure(_raised(refused), called)
    assert (person.kind, person.say) == ("human", hint)
    assert person.url == f"https://{platform.host}/account"
    assert redeem.command == f"regents {platform.name} agents pair"
    assert again.command == shlex.join(called.again)


@pytest.mark.parametrize("platform", SITES, ids=lambda platform: platform.name)
def test_whoami_with_no_pairing_points_at_that_sites_account_page(platform: Platform) -> None:
    whoami = next(c for c in platform.commands if c.words == ("agents", "whoami"))
    person, redeem, *_ = after(platform, whoami, {"data": {"pairing": None}}, {}, [], finished=True)
    assert person.kind == "human" and platform.host in person.say
    assert person.url == f"https://{platform.host}/account"
    assert redeem.command == f"regents {platform.name} agents pair"


@pytest.mark.parametrize("platform", SITES, ids=lambda platform: platform.name)
def test_a_paired_commands_help_pairs_on_that_site(platform: Platform) -> None:
    """1.10.16's help still told every site's agents to pair with regents.sh."""
    paired = [c for c in platform.commands if c.authority == "paired_agent"]
    for command in paired:
        shown: click.Command = app.root().commands[platform.name]
        for word in (w for w in command.words if not w.startswith("<")):
            assert isinstance(shown, click.Group)
            shown = shown.commands[word]
        assert shown.help is not None
        assert f"on {platform.host} (regents {platform.name} agents pair)" in shown.help


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


def test_a_refused_payment_is_not_called_unsure() -> None:
    """Sentinel F1: a 4xx without a code means the site refused it, not that it may have paid;
    a 401 still asks for sign-in, and --phase prepare sends nothing, so it never pays."""
    (refused, post) = for_failure(CommandError("http_400", "Refused.", status=400), paying())
    assert refused.say.startswith("The site refused this.") and post.kind == "human"
    assert "may have gone through" not in refused.say
    signed_out = for_failure(CommandError("http_401", "Sign in.", status=401), paying())
    assert signed_out[0].command == "regents auth login --site patchbay"
    preparing = app.invocation(app.root(), [*PAY, "--phase", "prepare"])
    timeout = CommandError("timeout", "No answer.", exit_code=EXIT_UNREACHABLE)
    assert all("may have gone through" not in s.say for s in for_failure(timeout, preparing))


def test_a_full_account_asks_the_person_to_unpair_in_the_sites_words() -> None:
    """An agent told to change what it sent and retry would retry a pairing that only its
    person can clear; the step is the site's hint, then the same pair with the same JSON."""
    hint = "Ask your person to unpair an agent on their Regents account page, then pair again."
    refusal = httpx.Response(409, json={"error": {"code": "agent_limit", "hint": hint}})
    with pytest.raises(CommandError) as raised:
        answer(refusal)
    pairing = app.invocation(app.root(), ["protocol", "agents", "pair", "--json"])
    person, again = for_failure(raised.value, pairing)
    assert person.kind == "human" and person.say == hint
    assert again.command == "regents protocol agents pair --json"
    assert again.say == "Then run this again, piping the same JSON on stdin."


def test_a_step_shows_the_sites_words_as_written(capsys: pytest.CaptureFixture[str]) -> None:
    """A step often carries a site's hint or description. Read as styling, "[optional]" was
    dropped, and "[/x]" stopped regents with an error before it showed anything."""
    said = "Pipe a list [optional] here; close [/x] as written."
    output.emit({"read": True}, as_json=False, next_steps=[human(said)])
    assert said in " ".join(capsys.readouterr().out.split())


@pytest.mark.parametrize(
    "error",
    [
        CommandError(
            "agent_not_paired", "Not paired.", status=403, hint="Ask your person for a code."
        ),
        CommandError("http_401", "Sign in.", status=401),
        CommandError("rate_limited", "Slow down.", status=429),
        CommandError("not_signed_in", "Sign in first."),
    ],
)
def test_every_rerun_of_a_piped_command_pipes_the_same_json(error: CommandError) -> None:
    """A rerun without its JSON asks again at a terminal, or sends a write without the
    operation id it must keep, so a second one may be made."""
    posting = app.invocation(app.root(), ["ash-template", "rooms", "post", "general"])
    assert posting.takes_stdin
    *_, again = for_failure(error, posting)
    assert again.kind == "run" and again.say.endswith(", piping the same JSON on stdin.")


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
    given = {spec.name: "x" if spec.required else None for spec in execute.inputs}
    (unfinished,) = after(patchbay, execute, {"status": "settled"}, given, [], finished=False)
    assert unfinished.command == "regents patchbay payments --help"
    assert "payments complete" in unfinished.say
    assert after(patchbay, execute, {}, given, [], finished=True)[0].kind == "done"


def test_a_stopped_forge_start_is_read_back_before_another(tmp_path: Path) -> None:
    """Sentinel F2: a failure after the agreement was recorded (a rerun is refused as already
    sent) points at forge status, keeping its own code and message."""
    step = inspect_first("forgerun_1")
    assert step.command == "regents techtree forge status forgerun_1"
    inner = RunError("hermes could not be started", code="hermes_unusable")
    failed = read_back_first(inner, "plan_1", tmp_path)
    assert (failed.code, failed.message) == ("hermes_unusable", "hermes could not be started")
    assert [s.command for s in for_failure(failed, paying())] == [
        "regents techtree forge status plan_1"
    ]


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
