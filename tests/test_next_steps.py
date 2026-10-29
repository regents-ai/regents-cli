"""What comes after a failure. A site's own fault ends in a public search of patchbay.help, then
a ready post there that names the command but none of the values it was given, because the post
is public; when Patchbay itself is what broke, or the command ran against another address than
the site's own, a person is told instead. A payment or a paid start is never repeated blind (the
1.10.1 review)."""

from __future__ import annotations

import json
import shlex
import socket
from dataclasses import replace
from pathlib import Path

import click
import httpx
import pytest
from rich.console import Console

from regents_cli import app, doctor, output
from regents_cli.errors import EXIT_CANCELLED, EXIT_UNREACHABLE, CommandError
from regents_cli.http import answer
from regents_cli.next_steps import Invocation, elsewhere, for_failure, human
from regents_cli.platforms import FollowUp, Platform, pinned_platforms
from regents_cli.runner import after, hinted
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
    """The pairing is shared by every Regent site, but the person makes the code signed in on
    the site the agent called (each site's agent_not_paired hint says "on this site"): the
    refusal keeps the site's own hint and links that site's Pair New Agent, never regents.sh's
    for every site."""
    hint = "Ask your person to sign in on this site and pair you with Pair New Agent."
    refused = httpx.Response(
        403, json={"error": {"code": "agent_not_paired", "message": "Not paired.", "hint": hint}}
    )
    called = app.invocation(app.root(), [platform.name, "agents", "whoami", "--json"])
    person, redeem, again = for_failure(_raised(refused), called)
    assert (person.kind, person.say) == ("human", hint)
    assert person.url == f"https://{platform.host}/account#shell-pairing"
    assert redeem.command == f"regents {platform.name} agents pair"
    assert again.command == shlex.join(called.again)


@pytest.mark.parametrize("platform", SITES, ids=lambda platform: platform.name)
def test_whoami_with_no_pairing_points_at_that_sites_pair_new_agent(platform: Platform) -> None:
    whoami = next(c for c in platform.commands if c.words == ("agents", "whoami"))
    person, redeem, *_ = after(platform, whoami, {"data": {"pairing": None}}, {}, [], finished=True)
    assert person.kind == "human" and platform.host in person.say
    assert person.url == f"https://{platform.host}/account#shell-pairing"
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
        assert f"regents {platform.name} agents pair" in shown.help


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


def test_a_rerun_keeps_an_address_and_hides_one_carrying_a_password() -> None:
    """A site command's local --base-url stays runnable; an address with a user or password,
    given in either form, before a later plain one, or where Click read it as another value,
    never comes back."""
    args = (
        "techtree",
        "model",
        "check-server",
        "--base-url",
        "http://operator:hunter2@127.0.0.1:8000/v1",
        "--base-url=http://operator:hunter2@127.0.0.1:8001/v1",
        "--base-url",
        "http://127.0.0.1:8000/v1",
        "--base-url=operator:hunter2@127.0.0.1:8000",
        "--base-url",
        "http:\\\\operator:hunter2@127.0.0.1:8000",
        "--base-url",
        "--base-url",
        "https://operator:hunter2@a.example",
        "--query=https://operator:hunter2@a.example",
        "--json",
    )
    again = Invocation(args, ("techtree", "model"), None, None, takes_stdin=False).again
    assert again == (
        "regents",
        "techtree",
        "model",
        "check-server",
        "--base-url",
        "<private-address>",
        "--base-url=<private-address>",
        "--base-url",
        "http://127.0.0.1:8000/v1",
        "--base-url=<private-address>",
        "--base-url",
        "<private-address>",
        "--base-url",
        "--base-url",
        "<private-address>",
        "--query=<private-address>",
        "--json",
    )


def test_a_failure_after_a_repeated_base_url_names_the_address_used_and_no_password(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Click uses the last --base-url given, so the steps name that one, and an earlier one
    carrying a password never comes back."""
    monkeypatch.delenv("ASH_TEMPLATE_BASE_URL", raising=False)
    with socket.socket() as unused:
        unused.bind(("127.0.0.1", 0))
        port = unused.getsockname()[1]
    used = f"http://127.0.0.1:{port}"
    exit_code = app.main(
        [
            "ash-template",
            "health",
            "--base-url",
            f"http://operator:hunter2@127.0.0.1:{port}",
            f"--base-url={used}",
            "--json",
        ]
    )

    shown = capsys.readouterr().out
    assert exit_code == EXIT_UNREACHABLE
    assert "hunter2" not in shown
    said = " ".join(step["say"] for step in json.loads(shown)["next_steps"])
    assert f"This ran against {used}," in said


@pytest.mark.parametrize(
    ("command", "after"),
    [
        (
            ["threads", "search"],
            ["--query", "--base-url=http://operator:hunter2@127.0.0.1:9", "--json"],
        ),
        (
            ["tools", "catalog"],
            ["--json", "--", "example.com", "--base-url=http://operator:hunter2@127.0.0.1:9"],
        ),
    ],
    ids=["another option's value", "after --"],
)
def test_the_address_named_is_the_one_click_read(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    command: list[str],
    after: list[str],
) -> None:
    """Words that only look like --base-url are not the address the command used."""
    monkeypatch.delenv("PATCHBAY_BASE_URL", raising=False)
    with socket.socket() as unused:
        unused.bind(("127.0.0.1", 0))
        port = unused.getsockname()[1]
    used = f"http://127.0.0.1:{port}"
    exit_code = app.main(["patchbay", *command, "--base-url", used, *after])

    shown = capsys.readouterr().out
    assert exit_code == EXIT_UNREACHABLE
    assert "hunter2" not in shown
    said = " ".join(step["say"] for step in json.loads(shown)["next_steps"])
    assert f"This ran against {used}," in said


def test_a_failure_beside_version_prints_only_the_failure(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Reading the options back to describe a failure runs nothing, --version included."""
    exit_code = app.main(["--version", "--bogus", "--json"])

    assert exit_code == 2
    assert json.loads(capsys.readouterr().out)["next_steps"]


@pytest.mark.parametrize("root", [[], ["--open-browser"]])
def test_an_option_before_the_command_keeps_what_the_command_was_given(
    monkeypatch: pytest.MonkeyPatch, root: list[str]
) -> None:
    monkeypatch.delenv("KEYFLEET_BASE_URL", raising=False)
    cli = app.root()
    login = app.invocation(cli, [*root, "auth", "login", "--site", "keyfleet", "--phase", "send"])
    assert login.site == "keyfleet"
    assert login.takes_stdin
    fleets = ["keyfleet", "fleets", "list", "--base-url", "https://a.example"]
    assert app.invocation(cli, [*root, *fleets]).elsewhere == "https://a.example"


@pytest.mark.parametrize(
    "args",
    [
        ["--", "keyfleet", "fleets", "list"],
        ["keyfleet", "--", "fleets", "list"],
        ["keyfleet", "fleets", "--", "list"],
        ["--open-browser", "--", "keyfleet", "fleets", "list"],
    ],
)
def test_a_double_dash_before_the_command_names_the_command_click_ran(args: list[str]) -> None:
    """The steps named only `regents keyfleet` and offered a public post about another address."""
    called = app.invocation(app.root(), [*args, "--base-url", "https://a.example"])
    assert called.words == ("keyfleet", "fleets", "list")
    assert called.elsewhere == "https://a.example"
    login = app.invocation(
        app.root(), ["auth", "--", "login", "--site", "keyfleet", "--phase", "send"]
    )
    assert login.site == "keyfleet"
    assert login.takes_stdin


@pytest.mark.parametrize("extra", [[], ["--bogus"]])
def test_an_unreadable_address_is_refused_without_a_traceback(
    capsys: pytest.CaptureFixture[str], extra: list[str]
) -> None:
    exit_code = app.main(
        ["keyfleet", "fleets", "list", "--base-url", "http://[::1", *extra, "--json"]
    )

    assert exit_code == 2
    assert json.loads(capsys.readouterr().out)["next_steps"]


def test_a_json_read_as_another_options_value_leaves_the_failure_in_words(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Click read every argument and took `--json` as the address, so no --json was given."""
    monkeypatch.delenv("KEYFLEET_BASE_URL", raising=False)
    exit_code = app.main(["keyfleet", "fleets", "list", "--base-url", "--json"])

    assert exit_code == 2
    assert capsys.readouterr().out == ""


@pytest.mark.parametrize("args", [[], ["keyfleet"], ["keyfleet", "fleets"], ["auth"]])
def test_a_bare_group_prints_its_help_and_succeeds(
    capsys: pytest.CaptureFixture[str], args: list[str]
) -> None:
    assert app.main(args) == 0
    assert capsys.readouterr().out.startswith("Usage: regents")


def test_another_address_carrying_a_password_is_named_without_it() -> None:
    """A site's variable is read as given, so a failure there may name a user and password."""
    step = elsewhere("https://operator:hunter2@staging.example", "It could not be reached.")
    assert "hunter2" not in step.say
    assert "<private-address>" in step.say


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


def test_transactions_to_send_are_never_called_done() -> None:
    """Keyfleet's votes, claims and presence answer transactions the agent's own wallet sends,
    and 1.10.20 ended them with "nothing more to run", so an agent took an unsent vote as cast. A
    transaction the chain's state makes certain to fail stops them all, with its reason."""
    keyfleet = next(p for p in pinned_platforms() if p.name == "keyfleet")
    vote = next(c for c in keyfleet.commands if c.words[:2] == ("proposals", "vote"))
    given = {spec.name: "x" if spec.required else None for spec in vote.inputs}
    sent = {"name": "yes", "title": "Vote yes", "to": "0x" + "1" * 40, "data": "0x", "value": "0"}
    answered = {"chain_id": 8453, "transactions": [{**sent, "blocked": None}] * 2}
    (step,) = after(keyfleet, vote, answered, given, [], finished=True)
    assert step.kind == "wallet" and "2 transactions" in step.say and "8453" in step.say
    blocked = {**answered, "transactions": [{**sent, "blocked": "Voting has closed"}]}
    (step,) = after(keyfleet, vote, blocked, given, [], finished=True)
    assert step.kind == "done" and "Voting has closed" in step.say


def test_a_follow_up_takes_the_callers_own_arguments() -> None:
    """Keyfleet answers seldom repeat the fleet, so a follow-up that needed <fleet> from the
    answer was always dropped (18 Oct ask 2) and Keyfleet could describe none."""
    keyfleet = next(p for p in pinned_platforms() if p.name == "keyfleet")
    started = next(c for c in keyfleet.commands if c.words[:2] == ("notebooks", "run"))
    result = next(c for c in keyfleet.commands if c.words[:2] == ("notebooks", "result"))
    follow = FollowUp("run", "Read the result.", " ".join(result.words), {"run": "run.id"}, None)
    command = replace(started, next_steps=(follow,))
    given = {spec.name: spec.name.upper() if spec.required else None for spec in command.inputs}
    (step,) = after(keyfleet, command, {"run": {"id": "r1"}}, given, [], finished=True)
    assert step.command == "regents keyfleet notebooks result FLEET PROJECT NOTEBOOK r1"


def test_a_refusals_hint_naming_a_route_offers_its_command() -> None:
    """keyfleet fleets get with a mistyped id: the site's hint names GET /api/v1/fleets, and the
    only step said the record does not exist."""
    keyfleet = next(p for p in pinned_platforms() if p.name == "keyfleet")
    (listed,) = hinted(keyfleet, "GET /api/v1/fleets lists every fleet.", ["--json"])
    assert listed.command == "regents keyfleet fleets list --json"
    (projects,) = hinted(
        keyfleet, "List them with GET /api/v1/agent/fleets/FLEET_ID/projects).", ["--json"]
    )
    assert projects.command == "regents keyfleet projects list --help"
    assert hinted(keyfleet, "Ask your person.", ["--json"]) == []


def test_a_hinted_command_runs_where_the_refused_one_ran(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The hinted command offered to run went to the usual site, without --json, after a refusal
    from another address."""
    monkeypatch.delenv("KEYFLEET_BASE_URL", raising=False)
    refusal = CommandError(
        "fleet_not_found",
        "No such fleet.",
        status=404,
        hint="GET /api/v1/fleets lists every fleet.",
    )
    args = ["keyfleet", "fleets", "get", "nope", "--base-url", "https://127.0.0.1:1", "--json"]
    app._failed(refusal, app.root(), args)

    runs = [step.get("command") for step in json.loads(capsys.readouterr().out)["next_steps"]]
    assert "regents keyfleet fleets list --base-url https://127.0.0.1:1 --json" in runs


def test_a_hint_never_offers_a_change_ready_to_run(capsys: pytest.CaptureFixture[str]) -> None:
    refusal = CommandError(
        "nothing_new", "Nothing to mark.", status=409, hint="POST /api/v1/activity/read marks all."
    )
    app._failed(refusal, app.root(), ["ash-template", "activity", "list", "--json"])

    runs = [step.get("command") for step in json.loads(capsys.readouterr().out)["next_steps"]]
    assert "regents ash-template activity mark-read --help" in runs


def test_flat_records_are_a_table_only_when_they_fit() -> None:
    """workspace pulse's seven short columns printed as thirty blocks of seven lines; a table
    that does not fit must still never fold a cell across lines."""
    row = {"at": "2026-10-29T03:20:00Z", "seq": 1405, "text": "Agent Contessa worked on it"}
    rows = [row, {**row, "seq": 1402}]
    for width, table in ((120, True), (40, False)):
        console = Console(width=width, record=True)
        console.print(output._renderable(rows))
        lines = console.export_text().splitlines()
        assert (len(lines) == 3) is table, lines


def test_a_table_leaves_links_to_json_only_beside_a_records_own_id() -> None:
    """Patchbay thread rows carry only `thread_id`, so hiding it left a person nothing to pick a
    thread by; beside an `id`, the hidden links are named in one line however narrow the table."""
    threads = [{"thread_id": "t1", "title": "Hello", "inserted_at": "2026-10-29T03:20:00Z"}]
    messages = [{"conversation_id": "c1", "id": "m1", "body": "hi"}]
    for width in (120, 30):
        console = Console(width=width, record=True)
        console.print(output._renderable(threads))
        lines = console.export_text().splitlines()
        assert lines[0].split()[:2] == ["Thread", "ID"] and lines[1].startswith("t1"), lines
        assert "--json" not in console.export_text()
        console = Console(width=width, record=True)
        console.print(output._renderable(messages))
        lines = console.export_text().splitlines()
        assert lines[0].split() == ["ID", "Body"] and "c1" not in lines[1], lines
        assert lines[2:] == ["Add --json for the ID columns."], lines


def test_doctor_asks_for_an_update_only_when_the_site_names_a_newer_regents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Contessa's item 6: nothing told an agent its regents was older than the site's. Releases
    compare by number, so 1.10.9 is older than 1.10.20, not newer."""
    monkeypatch.setattr(doctor, "version", lambda _name: "1.10.9")
    code, _ = doctor.release_current("keyfleet.ai", "1.10.20")
    behind = {"check": doctor.RELEASE, "ok": True, "code": code, "detail": "x"}
    assert code == doctor.BEHIND
    assert [s.kind for s in doctor.held("keyfleet", [behind])] == ["human", "done"]
    assert doctor.release_current("keyfleet.ai", "1.9.30")[0] == "current"
    monkeypatch.setattr(doctor, "version", lambda _name: "1.10.21.dev3+g80ee066")
    assert doctor.release_current("keyfleet.ai", "1.10.20")[0] == "current"


def test_doctor_asks_for_an_update_when_other_checks_fail(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The update step came only when every check held, and named keyfleet.ai for any address."""

    def unreachable(*_: object) -> None:
        raise CommandError("unreachable", "No answer.", exit_code=EXIT_UNREACHABLE)

    monkeypatch.setattr(doctor, "version", lambda _name: "1.10.9")
    monkeypatch.setattr(doctor, "release_named", lambda *_: "1.10.20")
    monkeypatch.setattr(doctor, "site_answers", unreachable)
    monkeypatch.setattr(doctor, "read_answers", unreachable)
    monkeypatch.setattr(doctor, "sign_in_good", lambda *_: (doctor.NOT_SIGNED_IN, "Not yet."))
    exit_code = app.main(["keyfleet", "doctor", "--base-url", "https://127.0.0.1:9", "--json"])

    said = [step["say"] for step in json.loads(capsys.readouterr().out)["next_steps"]]
    assert exit_code != 0
    assert any(
        "uv tool upgrade regents-cli" in line
        and line.endswith("127.0.0.1:9 names regents-cli 1.10.20; this is 1.10.9.")
        for line in said
    ), said
