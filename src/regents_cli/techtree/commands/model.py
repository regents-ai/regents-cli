"""`regents techtree model login | status | logout`: sign this machine in to the person's ChatGPT
plan, so Climbs can run on it as well as on their own Prime key. Every call goes to OpenAI;
nothing goes to the Techtree site, and no answer ever carries a token.

`regents techtree model import-obliteratus`: describe an OBLITERATUS checkpoint and the model it
was made from as the two model blocks of a model substitution pair. It reads local files only.
"""

from __future__ import annotations

from pathlib import Path

import click

from regents_cli.next_steps import done, human
from regents_cli.techtree import paths
from regents_cli.techtree.canonical import to_json_value
from regents_cli.techtree.chatgpt import signin
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.models.open_weights import ServingSpec
from regents_cli.techtree.obliteratus import import_checkpoint

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
    emit(
        answer,
        as_json=as_json,
        next_steps=[
            human(
                "Your person may set how much of their plan Regents may use.",
                signin.USAGE_SETTINGS_URL,
            ),
            done("Signed in; Climbs can now run on the ChatGPT plan."),
        ],
    )


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
    emit(answer, as_json=as_json, next_steps=[done("Signed in; nothing more to run.")])


def logout(as_json: bool) -> None:
    logged_out = signin.logout(paths.home().root)
    answer: dict[str, JsonValue] = {
        "removed": logged_out.removed,
        "email": logged_out.email,
        "revocation_confirmed": logged_out.revocation_confirmed,
    }
    answer["report"] = _logout_report(logged_out)
    unconfirmed = logged_out.removed and not logged_out.revocation_confirmed
    emit(
        answer,
        as_json=as_json,
        next_steps=[
            human("Your person disconnects Regents there to finish.", signin.USAGE_SETTINGS_URL)
            if unconfirmed
            else done("Signed out; nothing more to run.")
        ],
    )


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


def import_obliteratus(
    checkpoint: Path,
    source: Path,
    vllm_version: str,
    dtype: str,
    quantization: str | None,
    max_model_len: int,
    as_json: bool,
) -> None:
    serving = ServingSpec(
        engine="vllm",
        version=vllm_version,
        dtype=dtype,
        quantization=quantization,
        max_model_len=max_model_len,
    )
    pair = import_checkpoint(checkpoint, source, serving)
    derivation = pair.candidate.derivation
    assert derivation is not None
    answer: dict[str, JsonValue] = {
        "baseline": to_json_value(pair.baseline),
        "candidate": to_json_value(pair.candidate),
    }
    answer["report"] = "\n".join(
        [
            f"**Baseline** {derivation.source.repo} at {derivation.source.revision}",
            "",
            f"Weights {pair.baseline.weights.weights_root}",
            "",
            f"**Candidate** OBLITERATUS {derivation.method} at {derivation.tool_commit}",
            "",
            f"Weights {pair.candidate.weights.weights_root}",
            "",
            "Same tokenizer, chat template and serving on both sides; only the weights differ. "
            "The --json answer holds both model blocks.",
        ]
    )
    emit(answer, as_json=as_json, next_steps=[done("Both model blocks are ready.")])


MODEL = click.Group(
    "model",
    help="Sign this machine in to your ChatGPT plan, so Climbs can run on it, or describe an "
    "open-weights model pair.",
)
MODEL.add_command(
    click.Command(
        "login",
        callback=login,
        help="Sign in to your ChatGPT plan in the browser. Needs ChatGPT Plus or Pro. It prints "
        "the sign-in address; regents --open-browser techtree model login opens it too.",
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
MODEL.add_command(
    click.Command(
        "import-obliteratus",
        callback=import_obliteratus,
        help="Describe an OBLITERATUS checkpoint and the Hugging Face snapshot it was made from "
        "as a model substitution pair. Reads local files only; every digest is computed here.",
        params=[
            click.Argument(
                ["checkpoint"],
                type=click.Path(exists=True, file_okay=False, resolve_path=True, path_type=Path),
            ),
            click.Option(
                ["--source"],
                required=True,
                type=click.Path(exists=True, file_okay=False, resolve_path=True, path_type=Path),
                help="The source model's Hugging Face cache snapshot folder "
                "(.../models--<org>--<name>/snapshots/<commit>).",
            ),
            click.Option(
                ["--vllm-version"], required=True, help="The vLLM version both sides are served by."
            ),
            click.Option(["--dtype"], required=True, help="The served dtype, such as bfloat16."),
            click.Option(["--quantization"], default=None, help="The served quantization, if any."),
            click.Option(
                ["--max-model-len"],
                required=True,
                type=click.IntRange(min=1),
                help="The served context length in tokens.",
            ),
            JSON,
        ],
    )
)
