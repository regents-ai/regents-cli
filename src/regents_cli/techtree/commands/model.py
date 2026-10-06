"""`regents techtree model login | status | logout`: sign this machine in to the person's ChatGPT
plan, so Climbs can run on it as well as on their own Prime key. Every call goes to OpenAI;
nothing goes to the Techtree site, and no answer ever carries a token."""

from __future__ import annotations

import click

from regents_cli.techtree import paths
from regents_cli.techtree.chatgpt import signin
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.models.base import JsonValue

_PLAN_LINE = "Using your ChatGPT plan"


def login(as_json: bool) -> None:
    signed_in = signin.login(paths.home().root)
    answer: dict[str, JsonValue] = {
        "email": signed_in.email,
        "access": "chatgpt_plan",
        "usage_settings": signin.USAGE_SETTINGS_URL,
    }
    answer["report"] = "\n".join(
        [
            f"Signed in to ChatGPT as {signed_in.email}.",
            "",
            _PLAN_LINE,
            "",
            "Set how much of your plan Regents may use, or disconnect it, at "
            f"{signin.USAGE_SETTINGS_URL}",
        ]
    )
    emit(answer, as_json=as_json)


def status(as_json: bool) -> None:
    plan = signin.status(paths.home().root)
    answer: dict[str, JsonValue] = {
        "email": plan.email,
        "models": [
            {"slug": model.slug, "display_name": model.display_name} for model in plan.models
        ],
        "usage_settings": signin.USAGE_SETTINGS_URL,
    }
    offered = (
        [f"- {model.display_name} ({model.slug})" for model in plan.models]
        if plan.models
        else ["- none listed for this account"]
    )
    answer["report"] = "\n".join(
        [
            f"Signed in to ChatGPT as {plan.email}.",
            "",
            "Models your plan offers:",
            *offered,
            "",
            f"Manage what Regents may use at {signin.USAGE_SETTINGS_URL}",
        ]
    )
    emit(answer, as_json=as_json)


def logout(as_json: bool) -> None:
    logged_out = signin.logout(paths.home().root)
    answer: dict[str, JsonValue] = {
        "removed": logged_out.removed,
        "email": logged_out.email,
        "revocation_confirmed": logged_out.revocation_confirmed,
    }
    answer["report"] = _logout_report(logged_out)
    emit(answer, as_json=as_json)


def _logout_report(logged_out: signin.LoggedOut) -> str:
    if not logged_out.removed:
        return "This machine wasn't signed in to a ChatGPT plan, so there was nothing to remove."
    who = f" ({logged_out.email})" if logged_out.email else ""
    if logged_out.revocation_confirmed:
        return f"Signed out of ChatGPT{who}. OpenAI confirmed the sign-in is revoked."
    return (
        f"The ChatGPT sign-in{who} was removed from this machine, but OpenAI didn't confirm it "
        f"is revoked. Disconnect Regents at {signin.USAGE_SETTINGS_URL} to finish."
    )


MODEL = click.Group(
    "model", help="Sign this machine in to your ChatGPT plan, so Climbs can run on it."
)
MODEL.add_command(
    click.Command(
        "login",
        callback=login,
        help="Sign in to your ChatGPT plan in the browser. Needs ChatGPT Plus or Pro.",
        params=[JSON],
    )
)
MODEL.add_command(
    click.Command(
        "status",
        callback=status,
        help="Show the signed-in ChatGPT account and the models its plan offers.",
        params=[JSON],
    )
)
MODEL.add_command(
    click.Command(
        "logout",
        callback=logout,
        help="Revoke the ChatGPT sign-in at OpenAI and remove it from this machine.",
        params=[JSON],
    )
)
