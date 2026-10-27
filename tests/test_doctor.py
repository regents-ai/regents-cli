"""`regents <site> doctor`: what follows a failed check. A site that fails its own checks is
searched for on patchbay.help, then reported there; checks run against another address are
never reported as the site's problem (the first-run walk, 27 Oct)."""

from __future__ import annotations

from regents_cli.doctor import repairs
from regents_cli.platforms import pinned_platforms

KEYFLEET = next(p for p in pinned_platforms() if p.name == "keyfleet")
FAILED = [{"check": "site answers", "ok": False, "detail": "unreachable: No answer."}]
AGAIN = ["regents", "keyfleet", "doctor"]


def test_a_failing_site_is_searched_for_before_it_is_reported() -> None:
    again, search, post = repairs(KEYFLEET, KEYFLEET.base_url, FAILED, "1 of 3", AGAIN)
    assert again.command == "regents keyfleet doctor"
    assert search.command == "regents patchbay threads search --origin keyfleet.ai"
    assert post.kind == "patchbay"


def test_checks_against_another_address_are_not_posted_against_the_site() -> None:
    again, person = repairs(KEYFLEET, "http://127.0.0.1:9", FAILED, "1 of 3", AGAIN)
    assert again.kind == "run" and person.kind == "human"
    assert "http://127.0.0.1:9" in person.say
