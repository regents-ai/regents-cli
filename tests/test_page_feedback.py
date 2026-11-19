"""The feedback a site's page takes through `regents browser`: the agent calls the page's
`feedback` tool, the page asks `window.regentsFeedback`, and regents itself posts one public
Patchbay thread about the site. It posts only the exact call the agent made, once, from the site's
own page opened at the site's own address, with a Patchbay sign-in already on this machine, and
only ever to Patchbay's own address. The page hears back the thread or a refusal, never what was
signed. Patchbay is a stand-in here: nothing leaves this machine.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, NamedTuple

import httpx
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from mcp import Client

from regents_cli import siwa, webmcp_host
from regents_cli.agent_hosts import key_signer
from regents_cli.errors import CommandError
from regents_cli.http import Request, base_address
from regents_cli.platforms import pinned_platforms
from regents_cli.webmcp_host import FEEDBACK, Bridge, FeedbackDoor, PageHost
from tests.signed_agent import ADDRESS, RECEIPT, sign_in, signer_of

pytestmark = pytest.mark.anyio

PATCHBAY = "https://patchbay.help"
SITE = "https://site.test"
OTHER = "https://other.test"
PLATFORMS = {platform.name: platform for platform in pinned_platforms()}
TEMPLATE = PLATFORMS["ash-template"]
KEYFLEET = PLATFORMS["keyfleet"]
#: The template, as if it ran at the stand-in site's address.
STAND_IN = replace(TEMPLATE, base_url=SITE)
MANIFEST = webmcp_host.tool_manifest(TEMPLATE)
THREAD_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
THREAD_PATH = f"/posts/{THREAD_ID}/the-save-button-does-nothing"
THREAD = {
    "thread_id": THREAD_ID,
    "url": THREAD_PATH,
    "thread_kind": "help_needed",
    "updates_cursor": "c-1",
    "paid_offers": [{"campaign_id": "0xabc", "manifest_url": "https://ads.test/m.json"}],
}
POSTED = {"thread_id": THREAD_ID, "url": PATCHBAY + THREAD_PATH}
FEEDBACK_INPUT = {
    "title": "The save button does nothing",
    "body_markdown": "I pressed **Save** on /notes. I expected a saved note; nothing changed.",
    "client_request_id": "fb-2026-11-19-1",
    "public": True,
}


def offering(manifest: dict[str, Any], **entry: str) -> dict[str, Any]:
    """`manifest` with a feedback tool entry, as a site's manifest will name it."""
    named = {"authentication": "patchbay_feedback", "availability": "available", **entry}
    return {**manifest, "tools": [*manifest["tools"], {"name": FEEDBACK, **named}]}


class Patchbay:
    """A stand-in for Patchbay: what it answers, and each request it received."""

    def __init__(self, answer: httpx.Response | Exception | None = None) -> None:
        self.answer = httpx.Response(201, json=THREAD) if answer is None else answer
        self.received: list[Request] = []

    async def post(self, request: Request) -> httpx.Response:
        self.received.append(request)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


@pytest.fixture(autouse=True)
def never_signs_in(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """A feedback post never signs in or renews a sign-in: every way to is recorded here and
    fails the test, even when the code under test catches what it raises."""
    tried: list[str] = []

    def refused(name: str) -> Callable[..., Any]:
        def signs_in(*_: Any, **__: Any) -> Any:
            tried.append(name)
            raise AssertionError(f"siwa.{name} was called")

        return signs_in

    for name in ("current", "sign_in_with_key", "challenge", "verify"):
        monkeypatch.setattr(siwa, name, refused(name))
    yield
    assert tried == []


@pytest.fixture
def signed_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """This machine's agent home, signed in to Patchbay."""
    sign_in(tmp_path, monkeypatch, site="patchbay")
    return tmp_path / "agent"


def door(patchbay: Patchbay, site: str = "site.test") -> FeedbackDoor:
    return FeedbackDoor(offered=True, site=site, post=patchbay.post)


async def test_posts_exactly_the_call_once(signed_in: Path) -> None:
    patchbay = Patchbay()
    feedback = door(patchbay)
    feedback.expect(FEEDBACK, FEEDBACK_INPUT)
    assert await feedback.answer(True, (FEEDBACK_INPUT,)) == POSTED
    again = await feedback.answer(True, (FEEDBACK_INPUT,))
    assert again["error"]["code"] == "no_matching_call"
    [sent] = patchbay.received
    assert (sent.method, sent.target) == ("POST", "/forum/threads")
    assert sent.content is not None
    assert json.loads(sent.content) == {
        "site": "site.test",
        "title": FEEDBACK_INPUT["title"],
        "body_markdown": FEEDBACK_INPUT["body_markdown"],
        "topic_tags": ["feedback"],
        "client_request_id": FEEDBACK_INPUT["client_request_id"],
    }
    assert signer_of("POST", sent.target, sent.content, sent.headers, PATCHBAY) == ADDRESS
    # Signed for Patchbay's own host: read as sent anywhere else, it is no longer the agent's.
    assert signer_of("POST", sent.target, sent.content, sent.headers, SITE) != ADDRESS
    assert sent.headers["x-siwa-receipt"] == RECEIPT
    assert not any(name.startswith("x-payment") or name == "cookie" for name in sent.headers)


@pytest.mark.parametrize(
    "asked",
    [
        ({**FEEDBACK_INPUT, "title": "Another title"},),
        ({**FEEDBACK_INPUT, "body_markdown": ""},),
        ({**FEEDBACK_INPUT, "client_request_id": "fb-other"},),
        ({**FEEDBACK_INPUT, "public": 1},),
        ({**FEEDBACK_INPUT, "page_url": SITE + "/notes"},),
        ({**FEEDBACK_INPUT, "site": "other.test"},),
        ({key: value for key, value in FEEDBACK_INPUT.items() if key != "public"},),
        (FEEDBACK_INPUT, FEEDBACK_INPUT),
        (),
        ([FEEDBACK_INPUT],),
        (json.dumps(FEEDBACK_INPUT),),
    ],
)
async def test_refuses_feedback_the_call_did_not_make(
    signed_in: Path, asked: tuple[Any, ...]
) -> None:
    patchbay = Patchbay()
    feedback = door(patchbay)
    feedback.expect(FEEDBACK, FEEDBACK_INPUT)
    answer = await feedback.answer(True, asked)
    assert answer["error"]["code"] == "no_matching_call"
    assert patchbay.received == []


TEXT = st.text(max_size=40)
INPUTS = st.fixed_dictionaries(
    {
        "title": TEXT.filter(bool),
        "body_markdown": TEXT,
        "client_request_id": TEXT.filter(bool),
        "public": st.just(True),
    }
)


# The agent home the fixture makes is only read, so every example may share it.
@settings(
    max_examples=40, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture]
)
@given(made=INPUTS, other=INPUTS)
async def test_posts_only_the_input_its_call_made(
    signed_in: Path, made: dict[str, Any], other: dict[str, Any]
) -> None:
    patchbay = Patchbay()
    feedback = door(patchbay)
    feedback.expect(FEEDBACK, made)
    if other != made:
        assert (await feedback.answer(True, (other,)))["error"]["code"] == "no_matching_call"
    assert await feedback.answer(True, (made,)) == POSTED
    [sent] = patchbay.received
    assert sent.content is not None
    body = json.loads(sent.content)
    assert {key: body[key] for key in ("title", "body_markdown", "client_request_id")} == {
        key: made[key] for key in ("title", "body_markdown", "client_request_id")
    }


@pytest.mark.parametrize(
    ("feedback", "refusal"),
    [
        (FeedbackDoor(), "feedback_unavailable"),
        (FeedbackDoor.for_site(STAND_IN, SITE, MANIFEST), "feedback_unavailable"),
        (
            FeedbackDoor.for_site(STAND_IN, SITE, offering(MANIFEST, availability="planned")),
            "feedback_unavailable",
        ),
        (
            FeedbackDoor.for_site(STAND_IN, SITE, offering(MANIFEST, authentication="public")),
            "feedback_unavailable",
        ),
        (
            FeedbackDoor.for_site(STAND_IN, "http://localhost:4000", offering(MANIFEST)),
            "not_canonical_site",
        ),
    ],
)
async def test_off_or_elsewhere_sends_nothing(
    signed_in: Path, feedback: FeedbackDoor, refusal: str
) -> None:
    patchbay = Patchbay()
    feedback.post = patchbay.post
    feedback.expect(FEEDBACK, FEEDBACK_INPUT)
    answer = await feedback.answer(True, (FEEDBACK_INPUT,))
    assert answer["error"]["code"] == refusal
    assert patchbay.received == []


async def test_refuses_an_ask_from_anywhere_but_the_sites_open_page(signed_in: Path) -> None:
    patchbay = Patchbay()
    feedback = door(patchbay)
    feedback.expect(FEEDBACK, FEEDBACK_INPUT)
    answer = await feedback.answer(False, (FEEDBACK_INPUT,))
    assert answer["error"]["code"] == "untrusted_page"
    assert patchbay.received == []
    # The refusal did not use the call up.
    assert await feedback.answer(True, (FEEDBACK_INPUT,)) == POSTED


def write_receipt(home: Path, expires: str) -> None:
    path = home / "receipts" / "patchbay.json"
    stored = json.loads(path.read_text("utf-8"))
    path.write_text(json.dumps({**stored, "receipt_expires_at": expires}), "utf-8")


@pytest.mark.parametrize(
    ("change", "refusal"),
    [
        (lambda home: (home / "receipts" / "patchbay.json").unlink(), "not_signed_in"),
        (lambda home: write_receipt(home, "2001-01-01T00:00:00Z"), "sign_in_expired"),
    ],
)
async def test_needs_a_patchbay_sign_in_already_made(
    signed_in: Path, change: Callable[[Path], None], refusal: str
) -> None:
    change(signed_in)
    patchbay = Patchbay()
    feedback = door(patchbay)
    feedback.expect(FEEDBACK, FEEDBACK_INPUT)
    answer = await feedback.answer(True, (FEEDBACK_INPUT,))
    assert answer["error"]["code"] == refusal
    assert "regents auth login --site patchbay" in answer["error"]["hint"]
    assert patchbay.received == []


async def test_a_sign_in_due_to_expire_is_not_renewed(signed_in: Path) -> None:
    soon = datetime.now(UTC) + timedelta(seconds=siwa.RENEW_MARGIN_SECONDS // 2)
    write_receipt(signed_in, soon.isoformat().replace("+00:00", "Z"))
    patchbay = Patchbay()
    feedback = door(patchbay)
    feedback.expect(FEEDBACK, FEEDBACK_INPUT)
    assert (await feedback.answer(True, (FEEDBACK_INPUT,)))["error"]["code"] == "sign_in_expired"
    assert patchbay.received == []


async def test_a_key_that_cannot_sign_sends_nothing(signed_in: Path) -> None:
    (signed_in / "key.json").unlink()
    patchbay = Patchbay()
    feedback = door(patchbay)
    feedback.expect(FEEDBACK, FEEDBACK_INPUT)
    answer = await feedback.answer(True, (FEEDBACK_INPUT,))
    assert answer["error"]["code"] == "outside_key"
    assert "nothing was sent" in answer["error"]["message"]
    assert str(signed_in) not in json.dumps(answer)
    assert patchbay.received == []


async def test_a_call_that_ended_while_signing_sends_nothing(
    signed_in: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    patchbay = Patchbay()
    feedback = door(patchbay)
    invocation = feedback.expect(FEEDBACK, FEEDBACK_INPUT)
    sign = siwa.sign

    def slow(request: Request, receipt: siwa.Receipt, base: str) -> dict[str, str]:
        feedback.forget(invocation)
        return sign(request, receipt, base)

    monkeypatch.setattr(siwa, "sign", slow)
    answer = await feedback.answer(True, (FEEDBACK_INPUT,))
    assert answer["error"]["code"] == "call_ended"
    assert patchbay.received == []


async def test_a_call_that_ended_while_posting_still_hears_the_thread(signed_in: Path) -> None:
    patchbay = Patchbay()
    feedback = door(patchbay)
    invocation = feedback.expect(FEEDBACK, FEEDBACK_INPUT)

    async def post(request: Request) -> httpx.Response:
        feedback.forget(invocation)
        return await patchbay.post(request)

    feedback.post = post
    assert await feedback.answer(True, (FEEDBACK_INPUT,)) == POSTED
    assert len(patchbay.received) == 1


@pytest.mark.parametrize(
    "answer",
    [
        CommandError("timeout", "https://patchbay.help did not answer within 30000 ms."),
        CommandError("unreachable", "https://patchbay.help could not be reached."),
        httpx.Response(500, json={"error": {"code": "internal_error", "message": "Oops."}}),
        httpx.Response(502, text="<html>Bad gateway</html>"),
        httpx.Response(302, headers={"location": "https://patchbay.help/sign-in"}),
        httpx.Response(201, json={"url": THREAD_PATH}),
        httpx.Response(201, json={**THREAD, "url": "https://elsewhere.test/posts/1"}),
        httpx.Response(200, text="posted"),
        httpx.Response(400, text="Bad request"),
    ],
)
async def test_an_answer_that_does_not_say_is_unknown_and_never_resent(
    signed_in: Path, answer: httpx.Response | Exception
) -> None:
    patchbay = Patchbay(answer)
    feedback = door(patchbay)
    feedback.expect(FEEDBACK, FEEDBACK_INPUT)
    heard = await feedback.answer(True, (FEEDBACK_INPUT,))
    assert heard["error"]["code"] == "unknown"
    assert "regents patchbay requests get" in heard["error"]["hint"]
    assert len(patchbay.received) == 1


@pytest.mark.parametrize(
    ("status", "error"),
    [
        (
            403,
            {
                "code": "agent_not_paired",
                "message": "This agent is not paired with an account.",
                "hint": "Ask your person to pair you on their Agents page, then send it again.",
            },
        ),
        (
            422,
            {
                "code": "post_rejected",
                "message": "Patchbay did not post this: it is too short to help anyone.",
                "hint": "Rewrite the post, then send it again.",
                "reason": "too_short",
                "rejects_today": 1,
                "posting_paused_until": None,
            },
        ),
        (
            429,
            {
                "code": "rate_limited",
                "message": "This account has posted too often in the past hour.",
                "hint": "Wait retry_after_seconds, then send it again.",
                "retry_after_seconds": 694,
            },
        ),
    ],
)
async def test_passes_on_patchbays_own_refusal(
    signed_in: Path, status: int, error: dict[str, Any]
) -> None:
    patchbay = Patchbay(httpx.Response(status, json={"error": error}))
    feedback = door(patchbay)
    feedback.expect(FEEDBACK, FEEDBACK_INPUT)
    heard = await feedback.answer(True, (FEEDBACK_INPUT,))
    assert heard == {"error": {key: error[key] for key in ("code", "message", "hint")}}
    assert len(patchbay.received) == 1


@pytest.mark.parametrize(
    ("flag", "variable", "posts"),
    [
        (None, None, True),
        ("https://keyfleet.ai", None, True),
        ("https://staging.keyfleet.ai", None, False),
        ("http://localhost:4000", None, False),
        (None, "http://localhost:4000", False),
    ],
)
async def test_no_address_setting_moves_the_post_or_its_site(
    signed_in: Path,
    monkeypatch: pytest.MonkeyPatch,
    flag: str | None,
    variable: str | None,
    posts: bool,
) -> None:
    """Patchbay's own address and the site's pinned host, whatever --base-url, the site's
    address variable or PATCHBAY_BASE_URL say; a browser opened elsewhere posts nothing."""
    monkeypatch.setenv("PATCHBAY_BASE_URL", "http://localhost:9")
    if variable is None:
        monkeypatch.delenv(KEYFLEET.env_var, raising=False)
    else:
        monkeypatch.setenv(KEYFLEET.env_var, variable)
    received: list[tuple[str, Request, int]] = []

    def respond(base: str, request: Request, timeout_ms: int) -> httpx.Response:
        received.append((base, request, timeout_ms))
        return httpx.Response(201, json=THREAD)

    monkeypatch.setattr(webmcp_host, "respond", respond)
    origin = base_address(flag, KEYFLEET.env_var, KEYFLEET.base_url)
    feedback = FeedbackDoor.for_site(
        KEYFLEET, origin, offering(webmcp_host.tool_manifest(KEYFLEET))
    )
    feedback.expect(FEEDBACK, FEEDBACK_INPUT)
    heard = await feedback.answer(True, (FEEDBACK_INPUT,))
    if not posts:
        assert heard["error"]["code"] == "not_canonical_site"
        assert received == []
        return
    assert heard == POSTED
    [(base, sent, timeout_ms)] = received
    assert (base, sent.method, sent.target) == (PATCHBAY, "POST", "/forum/threads")
    assert timeout_ms == 30_000
    assert sent.content is not None
    assert json.loads(sent.content)["site"] == "keyfleet.ai"
    assert signer_of("POST", sent.target, sent.content, sent.headers, PATCHBAY) == ADDRESS


# The whole path: a page on a stand-in site registers `feedback` in Playwright's Chromium, the
# agent calls it through regents browser's MCP tools, and the page asks window.regentsFeedback.
# `?mode=` makes it misbehave: `twice` asks a second time, `framed` asks from a frame of the site
# itself, and `elsewhere` from a frame on another site.
PAGE = """<!doctype html><title>Notes</title>
<script>
const mode = new URLSearchParams(location.search).get("mode")
if (mode === "framed" || mode === "elsewhere") {
  const frame = document.createElement("iframe")
  frame.id = "inner"
  frame.src = (mode === "framed" ? location.origin : "https://other.test") + "/frame"
  document.documentElement.append(frame)
}
async function feedback(input) {
  if (mode === "framed" || mode === "elsewhere") {
    const frame = document.getElementById("inner").contentWindow
    return new Promise(done => {
      addEventListener("message", event => done(event.data), {once: true})
      frame.postMessage(input, "*")
    })
  }
  const answer = await window.regentsFeedback(input)
  if (mode === "twice") return {first: answer, second: await window.regentsFeedback(input)}
  return answer
}
document.modelContext.registerTool({
  name: "feedback",
  description: "Tell the site's makers (the page's own words).",
  inputSchema: {type: "object"},
  execute: input => feedback(input),
})
</script>"""

FRAME = """<!doctype html><script>
addEventListener("message", async event => {
  event.source.postMessage(await window.regentsFeedback(event.data), "*")
})
</script>"""


class Site(NamedTuple):
    client: Client
    patchbay: Patchbay


@asynccontextmanager
async def opened(feedback: FeedbackDoor) -> AsyncIterator[Site]:
    """regents browser's MCP server for the stand-in site, connected in-process."""
    patchbay = Patchbay()
    feedback.post = patchbay.post
    bridge = Bridge(origin=SITE, manifest=MANIFEST, sign=key_signer("ash-template", SITE))
    host = PageHost(bridge=bridge, show=False, feedback=feedback)

    async def answer(route: Any) -> None:
        url = route.request.url
        if url.startswith(SITE + "/notes"):
            await route.fulfill(content_type="text/html", body=PAGE)
        elif url in (SITE + "/frame", OTHER + "/frame"):
            await route.fulfill(content_type="text/html", body=FRAME)
        else:
            await route.abort()

    page = await host._page()
    await page.context.route("**/*", answer)
    async with Client(webmcp_host.server(TEMPLATE, host)) as client:
        yield Site(client, patchbay)


@pytest.fixture
async def site(signed_in: Path) -> AsyncIterator[Site]:
    async with opened(FeedbackDoor.for_site(STAND_IN, SITE, offering(MANIFEST))) as stand_in:
        yield stand_in


@pytest.fixture
async def site_without_feedback(signed_in: Path) -> AsyncIterator[Site]:
    async with opened(FeedbackDoor.for_site(STAND_IN, SITE, MANIFEST)) as stand_in:
        yield stand_in


async def call(client: Client, name: str, arguments: dict[str, Any]) -> Any:
    result = await client.call_tool(name, arguments)
    assert not result.is_error, result.content
    return result.structured_content


async def test_the_page_hears_only_the_thread(site: Site) -> None:
    client, patchbay = site
    await call(client, "open_page", {"url": "/notes"})
    listed = {tool["name"]: tool for tool in (await call(client, "list_page_tools", {}))["tools"]}
    assert listed["feedback"]["inputSchema"] == webmcp_host.FEEDBACK_ENTRY["input_schema"]
    assert listed["feedback"]["description"] == webmcp_host.FEEDBACK_ENTRY["description"]
    answered = await call(client, "call_page_tool", {"name": "feedback", "input": FEEDBACK_INPUT})
    assert answered == {"result": POSTED}
    [sent] = patchbay.received
    assert sent.content is not None
    assert json.loads(sent.content)["site"] == "site.test"
    assert signer_of("POST", sent.target, sent.content, sent.headers, PATCHBAY) == ADDRESS


async def test_the_page_posts_each_call_once(site: Site) -> None:
    client, patchbay = site
    await call(client, "open_page", {"url": "/notes?mode=twice"})
    answered = await call(client, "call_page_tool", {"name": "feedback", "input": FEEDBACK_INPUT})
    assert answered["result"]["first"] == POSTED
    assert answered["result"]["second"]["error"]["code"] == "no_matching_call"
    assert len(patchbay.received) == 1


@pytest.mark.parametrize("mode", ["framed", "elsewhere"])
async def test_a_frame_cannot_post(site: Site, mode: str) -> None:
    client, patchbay = site
    await call(client, "open_page", {"url": f"/notes?mode={mode}"})
    answered = await call(client, "call_page_tool", {"name": "feedback", "input": FEEDBACK_INPUT})
    assert answered["result"]["error"]["code"] == "untrusted_page"
    assert patchbay.received == []


@pytest.mark.parametrize(
    "wrong",
    [
        {**FEEDBACK_INPUT, "public": False},
        {**FEEDBACK_INPUT, "title": ""},
        {**FEEDBACK_INPUT, "title": "x" * 161},
        {**FEEDBACK_INPUT, "page_url": SITE + "/notes"},
        {key: value for key, value in FEEDBACK_INPUT.items() if key != "public"},
    ],
)
async def test_refuses_input_it_does_not_take_before_the_page_runs(
    site: Site, wrong: dict[str, Any]
) -> None:
    client, patchbay = site
    await call(client, "open_page", {"url": "/notes"})
    result = await client.call_tool("call_page_tool", {"name": "feedback", "input": wrong})
    assert result.is_error
    assert patchbay.received == []


async def test_without_the_sites_word_feedback_is_the_pages_own_tool(
    site_without_feedback: Site,
) -> None:
    client, patchbay = site_without_feedback
    await call(client, "open_page", {"url": "/notes"})
    listed = {tool["name"]: tool for tool in (await call(client, "list_page_tools", {}))["tools"]}
    assert listed["feedback"]["description"] == "Tell the site's makers (the page's own words)."
    wrong = {**FEEDBACK_INPUT, "public": False}
    answered = await call(client, "call_page_tool", {"name": "feedback", "input": wrong})
    assert answered["result"]["error"]["code"] == "feedback_unavailable"
    assert patchbay.received == []
