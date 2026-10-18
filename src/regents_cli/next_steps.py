"""What an agent does after any `regents` output: always one or more of four kinds of step.

done: the work is finished. run: run this `regents` command next. human: a person has to do
something first. patchbay: post the problem on patchbay.help, because a site broke, answered in
a way `regents` can't act on, or stays unreachable, and only its team can fix that.

Every answer and every failure carries its steps: in `--json` as `next_steps` beside the answer's
fields or beside `error`, and on screen as a short "Next" block at the bottom.
"""

from __future__ import annotations

import json
import shlex
from collections.abc import Sequence
from dataclasses import dataclass
from importlib.metadata import version
from typing import Literal
from uuid import uuid4

from regents_cli.errors import (
    EXIT_AUTH,
    EXIT_CANCELLED,
    EXIT_NOT_FOUND,
    EXIT_UNREACHABLE,
    EXIT_USAGE,
    CommandError,
)

type Kind = Literal["done", "run", "human", "patchbay"]

#: Where a person makes the pairing code an agent pairs with, using Pair New Agent in the side
#: panel; one pairing serves every site.
PAIRING_PAGE = "https://regents.sh"
PATCHBAY_POST = ("regents", "patchbay", "threads", "create")
TITLE_LIMIT = 160


@dataclass(frozen=True, slots=True)
class Step:
    kind: Kind
    say: str
    command: str | None = None
    url: str | None = None

    def as_json(self) -> dict[str, str]:
        found = {"kind": self.kind, "say": self.say, "command": self.command, "url": self.url}
        return {key: value for key, value in found.items() if value is not None}


def done(say: str) -> Step:
    return Step("done", say)


def run(command: Sequence[str], say: str) -> Step:
    return Step("run", say, shlex.join(command))


def run_piped(piped: str, command: Sequence[str], say: str) -> Step:
    """A command that reads JSON on stdin, written so it runs as shown."""
    return Step("run", say, f"printf '%s' {shlex.quote(piped)} | {shlex.join(command)}")


def human(say: str, url: str | None = None) -> Step:
    return Step("human", say, url=url)


def patchbay(host: str, words: Sequence[str], code: str, message: str, status: int | None) -> Step:
    """A ready post for the site's board on patchbay.help, naming the command but none of the
    values it was given, since the post is public."""
    named = " ".join(("regents", *words))
    body = [f"`{named}` (regents-cli {version('regents-cli')}) failed.", "", f"- Error: `{code}`"]
    body.append(f"- Message: {message}")
    if status is not None:
        body.append(f"- Status: {status}")
    post = {
        "site": host,
        "title": f"{named}: {code}"[:TITLE_LIMIT],
        "body_markdown": "\n".join(body),
        "client_request_id": str(uuid4()),
    }
    piped = json.dumps(post, ensure_ascii=False)
    return Step(
        "patchbay",
        "Read this post, then run it to put the problem on patchbay.help for the site's team: "
        "posts are public. It needs a Patchbay sign-in and a paired agent.",
        f"printf '%s' {shlex.quote(piped)} | {shlex.join(PATCHBAY_POST)}",
    )


def pair_first(namespace: str) -> list[Step]:
    """The two steps that pair an agent: a person's code, then `agents pair`."""
    return [
        human(
            "Your person makes a pairing code with Pair New Agent in the side panel of regents.sh "
            "and gives it to you.",
            PAIRING_PAGE,
        ),
        run(
            ("regents", namespace, "agents", "pair"),
            'Pair with that code: pipe {"code": …, "name": …, "harness": …}, or run it at a '
            "terminal and it asks.",
        ),
    ]


def sign_in(site: str) -> Step:
    return run(("regents", "auth", "login", "--site", site), f"Sign in to {site}.")


#: Flags a rerun leaves out: an agreement covers one go, so a rerun asks for a new one.
AGREEMENT_FLAGS = {"--yes": 0, "--reviewed-on": 1}
#: Flags whose value a rerun shows only as a placeholder, as the approval review does.
PRIVATE_FLAGS = {"--address": "<private-address>"}


@dataclass(frozen=True, slots=True)
class Invocation:
    """The command a failure came from, as far as `regents` could read it."""

    args: tuple[str, ...]
    #: The names of the command that ran, such as ("patchbay", "threads", "get").
    words: tuple[str, ...]
    #: The site its namespace signs in to, and that site's host, when it names one.
    site: str | None
    host: str | None
    takes_stdin: bool
    #: What a site's described command does, and its description, when it is one.
    effect: str | None = None
    description: str | None = None

    @property
    def again(self) -> tuple[str, ...]:
        """The same command, without an earlier agreement and without private values."""
        kept: list[str] = []
        skip = 0
        for arg in self.args:
            name, has_value, _ = arg.partition("=")
            if skip:
                skip -= 1
            elif name in AGREEMENT_FLAGS:
                skip = 0 if has_value else AGREEMENT_FLAGS[name]
            elif name in PRIVATE_FLAGS:
                kept += [name, PRIVATE_FLAGS[name]]
                skip = 0 if has_value else 1
            else:
                kept.append(arg)
        return ("regents", *kept)

    @property
    def piped(self) -> str:
        return ", piping the same JSON on stdin" if self.takes_stdin else ""


def as_described(group: Sequence[str], description: str, why: str) -> Step:
    """For an outcome only the site's own description says how to follow: its group's help,
    which lists the command that does, and the description itself."""
    return run(
        ("regents", *group, "--help"),
        f'{why} The site says: "{description}" Its commands are listed here.',
    )


def for_failure(error: CommandError, invocation: Invocation) -> list[Step]:
    """The failure's own steps, or the ones its kind calls for."""
    if error.next_steps:
        return list(error.next_steps)
    if error.code == "techtree_home_unusable":
        return [
            human(
                "This command needs writable local storage at ~/.regents/techtree. "
                "Ask the runtime owner to provide it, then retry. "
                "Do not move or replace your signer to fix local storage."
            )
        ]
    status = error.fields.get("status")
    described = invocation.description
    if invocation.effect == "payment" and described is not None:
        if _unsure(error, status):
            return _unsure_payment(error, status, invocation, described)
        if _refused_unread(error, status):
            return [
                as_described(invocation.words[:-1], described, "The site refused this."),
                _broken(error, status if isinstance(status, int) else None, invocation),
            ]
    if isinstance(status, int):
        return _site_refused(error, status, invocation)
    return _failed(error, invocation)


def _site_refused(error: CommandError, status: int, invocation: Invocation) -> list[Step]:
    """A site answered with an error: `status` is its HTTP status."""
    again = invocation.again
    coded = not (error.code.startswith("http_") or error.code == "redirected")
    if error.code in ("not_paired", "agent_not_paired") and invocation.words:
        return [*pair_first(invocation.words[0]), run(again, "Then run this again.")]
    hint = error.fields.get("hint")
    if error.code in ("account_missing", "person_not_here") and isinstance(hint, str):
        return [human(hint), run(again, "Then run this again.")]
    if status == 401 and invocation.site is not None:
        return [sign_in(invocation.site), run(again, "Then run this again.")]
    if status == 402 and "payment_required" in error.fields:
        return [
            run(
                again,
                "Nothing was paid. Sign payment_terms with your wallet, then run this again "
                'piping {"payment_signature": "<the signature>"} on stdin.',
            )
        ]
    if status == 402:
        return [
            human(f"Nothing was paid, and this needs your person first: {error.message}"),
            done("Otherwise that is the site's answer; nothing more to run."),
        ]
    if status == 403 and coded:
        page = PAIRING_PAGE if error.code.startswith("pairing_") else None
        return [human(f"Ask your person about this first: {error.message}", page)]
    if status == 404 and coded:
        return [done("There is no such record. If the name or id was mistyped, run it again.")]
    if status == 429:
        return [run(again, f"Too many requests: wait {_wait(error)}, then run this again.")]
    if coded and status in (502, 503, 504):
        return [
            run(
                again,
                f"The site is not taking this right now: wait {_wait(error)}, "
                f"then run this again{invocation.piped}.",
            )
        ]
    if coded and status < 500:
        return [
            run(
                again,
                "Only if the message names something you sent that you can change: change it, "
                f"then run this again{invocation.piped}.",
            ),
            done("Otherwise that is the site's answer; nothing more to run."),
        ]
    return [run(again, f"Run it once more{invocation.piped}."), _broken(error, status, invocation)]


def _failed(error: CommandError, invocation: Invocation) -> list[Step]:
    """A failure `regents` found itself, before or without a site's error answer."""
    again = invocation.again
    if error.code in ("not_signed_in", "sign_in_expired", "no_agent_key") and invocation.site:
        return [sign_in(invocation.site), run(again, "Then run this again.")]
    if error.exit_code == EXIT_USAGE:
        return [
            run(
                ("regents", *invocation.words, "--help"),
                "Read how it is used, then run it again with what the message names fixed.",
            )
        ]
    if error.exit_code == EXIT_CANCELLED:
        return [run(again, f"Run it again when ready{invocation.piped}.")]
    if error.exit_code == EXIT_NOT_FOUND:
        return [done("There is no such record. If the name or id was mistyped, run it again.")]
    if error.exit_code == EXIT_UNREACHABLE:
        return [
            run(again, f"Run it once more{invocation.piped}."),
            _broken(error, None, invocation),
        ]
    if error.exit_code == EXIT_AUTH:
        return [human(f"Your person has to sort this out first: {error.message}")]
    if error.code == "invalid_response":
        return [_broken(error, None, invocation)]
    return [run(again, f"Do what the message says, then run this again{invocation.piped}.")]


def _unsure(error: CommandError, status: object) -> bool:
    """Whether a request may have reached the site and done its work, unanswered or unclear."""
    if isinstance(status, int):
        return error.code == "redirected" or status == 409 or status >= 500
    return error.exit_code in (EXIT_UNREACHABLE, EXIT_CANCELLED) or error.code == "invalid_response"


def _refused_unread(error: CommandError, status: object) -> bool:
    """A refusal without a readable code, other than the ones `regents` knows how to follow."""
    return error.code.startswith("http_") and status not in (401, 402, 429)


def _unsure_payment(
    error: CommandError, status: object, invocation: Invocation, description: str
) -> list[Step]:
    """A payment that may have gone through is never sent again; the site says how to finish
    it. A site that failed is also reported."""
    finish = as_described(
        invocation.words[:-1],
        description,
        "The payment may have gone through: run this again only if the site says a repeat "
        "never pays twice, and otherwise finish it the way the site says.",
    )
    if error.exit_code == EXIT_CANCELLED or status == 409:
        return [finish]
    return [finish, _broken(error, status if isinstance(status, int) else None, invocation)]


def _broken(error: CommandError, status: int | None, invocation: Invocation) -> Step:
    """Report it on patchbay.help; when Patchbay itself is what broke, a person has to."""
    if invocation.host is None or invocation.words[:1] == ("patchbay",):
        return human(f"If it keeps failing, tell your person: {error.message}")
    return patchbay(invocation.host, invocation.words, error.code, error.message, status)


def _wait(error: CommandError) -> str:
    seconds = error.fields.get("retry_after")
    return f"{seconds} seconds" if isinstance(seconds, str) and seconds.isdigit() else "a minute"
