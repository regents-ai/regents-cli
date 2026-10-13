"""A site's own fault ends in a ready patchbay.help post that names the command but none of the
values it was given, because the post is public; when Patchbay itself is what broke, a person
is told instead, since a post would have to go through the site that failed."""

from __future__ import annotations

import json
import shlex

from regents_cli.errors import CommandError
from regents_cli.next_steps import Invocation, for_failure

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
