"""`regents techtree climb list | show | prepare | start`: from the catalog to a run."""

from __future__ import annotations

import shlex
from pathlib import Path
from typing import Final

import click

from regents_cli.techtree import paths
from regents_cli.techtree.approval import REVIEWED_ON, YES, ReviewedOn, approve
from regents_cli.techtree.canonical import to_json_value
from regents_cli.techtree.catalog.repository import climb_reference
from regents_cli.techtree.catalog.service import CLIMB_LIST_STATUSES, CatalogService
from regents_cli.techtree.chatgpt.signin import USAGE_SETTINGS_URL
from regents_cli.techtree.commands.answers import BASE_URL, JSON, emit
from regents_cli.techtree.commands.run import run_service
from regents_cli.techtree.drafts.source import CampaignSource
from regents_cli.techtree.drafts.store import DraftStore
from regents_cli.techtree.errors import UsageError
from regents_cli.techtree.ids import validate_id
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.models.campaign import CampaignSpecV4, ModelAccess, Rubric
from regents_cli.techtree.models.catalog import ClimbSummaryV2, CompatibilityResultV2
from regents_cli.techtree.models.run import AcknowledgementMethod, PolicyAcknowledgement
from regents_cli.techtree.models.skill import SubmissionDraft
from regents_cli.techtree.runs.machine import public_state
from regents_cli.techtree.runs.service import ApprovalActor, utc_now
from regents_cli.techtree.site import site_base
from regents_cli.techtree.skills.published import prepare_rerun
from regents_cli.techtree.skills.service import PreparedDraft, SkillPreparationService
from regents_cli.techtree.verifiers.credentials import ROUTE_NAMES

ONLY_CHANGE_LINE: Final = "The Skill is the only scientific change."

#: Said next to the model-calls line, which is what keeps it from reading as "nothing leaves
#: this machine": starting a run sends none of the participant's material, and publishing later
#: carries the proof and never the episodes.
PUBLICATION_STEP_LINE: Final = (
    "Publishing is a separate step, taken after a run finishes and only if you choose to: what "
    "travels then is the run's proof — the signed report, its receipts and your Skill, which "
    "becomes public — and never the episodes."
)

#: A DataPolicy describes a published result, and read alone it looks like a plan to publish
#: somebody's Skill; this says what publishing takes and that model calls still leave.
PUBLICATION_TERMS_LINE: Final = (
    "These are the terms this Climb sets for a published result. Nothing is published unless "
    "you publish a finished run yourself, and what travels then is the run's proof — the signed "
    "report, its receipts and your Skill, which becomes public — and never the episodes. Until "
    "then your Skill stays on this machine, and your episodes always do. Model calls still go "
    "to OpenAI or Prime, on the route the run uses."
)

#: `--access` spells a route with a hyphen; records spell it with an underscore.
_ACCESS_FLAGS: Final[dict[str, ModelAccess]] = {
    "chatgpt-plan": "chatgpt_plan",
    "prime-key": "prime_key",
}

#: What a rerun is, and what it is not, said wherever a rerun is prepared.
RERUN_LINE: Final = (
    "A rerun of {bundle}: the same Campaign and the same Skill, with new runs made and signed "
    "under this machine's own key. A rerun from another key is still a report from someone's "
    "own machine: not another person, and not independent reproduction. No platform witnessed "
    "either run."
)

REFERENCE = click.Argument(["reference"], metavar="REFERENCE")


def list_climbs(status: str, as_json: bool) -> None:
    summaries = CatalogService(paths.home()).list_climbs(status=status)
    answer: dict[str, JsonValue] = {
        "climbs": [to_json_value(summary) for summary in summaries],
        "count": len(summaries),
    }
    development = _development_warnings(summaries)
    if development:
        answer["warnings"] = development
    answer["report"] = _list_report(summaries)
    emit(answer, as_json=as_json)


def show(reference: str, as_json: bool) -> None:
    catalog = CatalogService(paths.home())
    resolved = catalog.get_climb(reference)
    summary = catalog.climb_summary(resolved)
    campaign = resolved.campaign
    answer: dict[str, JsonValue] = {
        "climb": to_json_value(summary),
        "data_policy_digest": resolved.data_policy_digest,
        "subject_model": to_json_value(campaign.subject.model),
        "budgets": to_json_value(campaign.budgets),
        "subject_runtime": to_json_value(campaign.subject.runtime),
        "rubric": to_json_value(campaign.scoring.rubric),
        "candidate_skill_ownership": resolved.data_policy.candidate_skill.ownership,
        "held_out_campaign_spec_digest": resolved.climb.held_out_campaign_spec_digest,
    }
    warnings = _development_warnings([summary]) + _compatibility_warnings(summary.compatibility)
    if warnings:
        answer["warnings"] = warnings
    answer["report"] = _show_report(
        summary,
        campaign,
        resolved.data_policy_digest,
        resolved.data_policy.candidate_skill.ownership,
        held_out=resolved.climb.held_out_campaign_spec_digest is not None,
    )
    emit(answer, as_json=as_json)


def prepare(
    reference: str | None,
    skill: Path | None,
    label: str | None,
    held_out: bool,
    rerun_of: str | None,
    access_flag: str | None,
    base_url: str | None,
    as_json: bool,
) -> None:
    home = paths.home()
    access = None if access_flag is None else _ACCESS_FLAGS[access_flag]
    if rerun_of is not None:
        if reference is not None or skill is not None or label is not None or held_out:
            raise UsageError(
                "--rerun-of takes no Climb, --skill, --label or --held-out: the Result names "
                "its Campaign and carries its Skill"
            )
        prepared = prepare_rerun(home, rerun_of, access=access, base=site_base(base_url))
    else:
        if reference is None or skill is None:
            raise UsageError(
                "name a Climb and --skill, or rerun a published Result with --rerun-of"
            )
        if base_url is not None:
            raise UsageError("--base-url is only for --rerun-of, which reads Techtree's site")
        prepared = SkillPreparationService(home).prepare(
            climb_reference=reference,
            skill_path=skill,
            access=access,
            candidate_label=label,
            held_out=held_out,
        )
    draft = prepared.draft
    source = prepared.source
    campaign = source.campaign
    policy = source.data_policy
    start_command = shlex.join(["regents", "techtree", "climb", "start", draft.id])
    answer: dict[str, JsonValue] = {
        "draft_id": draft.id,
        "draft_digest": prepared.draft_digest,
        "draft_dir": str(DraftStore(home).draft_dir(draft.id)),
        "rerun_of": draft.rerun_of,
        "climb_reference": climb_reference(source.climb),
        "climb_digest": source.climb_digest,
        "campaign_spec_digest": draft.campaign_spec_digest,
        "held_out": source.campaign_digest != source.climb.campaign_spec_digest,
        "data_policy_digest": draft.data_policy_digest,
        "candidate_label": draft.skill_artifact.name,
        "skill_root_digest": draft.skill_artifact.root_digest,
        "included_files": list(draft.included_files),
        "baseline_skill_count": len(campaign.subject.harness.skills),
        "candidate_skill_count": 1,
        "estimated_episodes": draft.estimated_episodes,
        "access": prepared.access,
        "campaign_maximum_usd": campaign.budgets.maximum_usd,
        "candidate_ownership": policy.candidate_skill.ownership,
        "candidate_public_release": policy.candidate_skill.public_release,
        "raw_episode_server_upload": policy.raw_episodes.server_upload,
        "raw_episode_training_use": policy.raw_episodes.training_use,
        "proof_grade": source.climb.publication.proof_grade,
        "policy_acceptance": to_json_value(draft.policy_acceptance),
        "comparison": {
            "controlled": prepared.manifest_comparison.controlled,
            "differences": [
                difference.pointer for difference in prepared.manifest_comparison.differences
            ],
            "allowed_differences": list(prepared.manifest_comparison.allowed_differences),
        },
        "start_command": start_command,
    }
    if draft.warnings:
        answer["warnings"] = [{"id": "draft_warning", "text": text} for text in draft.warnings]
    answer["report"] = _prepare_report(prepared, start_command)
    emit(answer, as_json=as_json)


def start(draft_id: str, yes: bool, reviewed_on: ReviewedOn, as_json: bool) -> None:
    validate_id(draft_id, expected_prefix="draft")
    home = paths.home()
    drafts = DraftStore(home)
    draft = drafts.get(draft_id)
    source = drafts.get_source(draft_id)
    campaign = source.campaign
    access = drafts.access(draft_id)
    reviewed_on = approve(
        yes=yes,
        reviewed_on=reviewed_on,
        as_json=as_json,
        review=[
            *review_lines(draft=draft, campaign=campaign, access=access),
            draft.policy_acceptance.summary,
            PUBLICATION_TERMS_LINE,
        ],
        command=["climb", "start", draft_id],
        question="Start this run?",
        why=f"A run uses your {ROUTE_NAMES[access]} under the Climb's limits and accepts the "
        "Climb's data policy.",
    )
    # Which surface the review happened on is recorded with the run: a person who read it on
    # this terminal, an operator who answered with --yes, or a person who read it in Hermes.
    method: AcknowledgementMethod
    actor: ApprovalActor
    if reviewed_on == "host-agent":
        method, actor = "host_agent_confirmation", "human_via_hermes"
    elif yes:
        method, actor = "explicit_cli_review", "operator_via_flag"
    else:
        method, actor = "explicit_cli_review", "human_via_cli"
    acknowledgement = PolicyAcknowledgement(
        data_policy_digest=draft.data_policy_digest, method=method, acknowledged_at=utc_now()
    )
    service = run_service(home)
    status = service.start(
        draft_id=draft_id, policy_acknowledgement=acknowledgement, approved_by=actor
    )
    state = status.state
    request = service.request(state.run_id)
    warnings = _start_warnings(source, access)
    answer: dict[str, JsonValue] = {
        "run_id": state.run_id,
        "draft_id": draft_id,
        "draft_digest": request.draft_digest,
        "phase": state.phase.value,
        "worker_pid": state.worker_pid,
        "campaign_spec_digest": draft.campaign_spec_digest,
        "data_policy_digest": draft.data_policy_digest,
        "access": access,
        "policy_acknowledgement_method": method,
        "approved_by": actor,
        "state_digest": service.state_digest(state.run_id),
        "warnings": to_json_value(warnings),
        "report": "\n".join(
            [
                f"Run {state.run_id} started from draft {draft_id} on your "
                f"{ROUTE_NAMES[access]}: {public_state(state.phase)}.",
                "",
                f"- Draft digest: {request.draft_digest}",
                f"- Worker process: {state.worker_pid}",
                f"- Approved by: {_phrase(actor)}",
                "",
                *(f"- {warning['text']}" for warning in warnings),
                "",
                f"Next: regents techtree run status {state.run_id}",
            ]
        ),
    }
    emit(answer, as_json=as_json)


def review_lines(
    *, draft: SubmissionDraft, campaign: CampaignSpecV4, access: ModelAccess
) -> list[str]:
    """What a person weighs before a run starts, read off this draft and Campaign, beginning
    with the route the run uses and what it costs."""
    return [
        *route_lines(campaign, access, tries=draft.estimated_episodes),
        f"This runs {draft.estimated_episodes} episodes: the same tasks once for each side of "
        "the comparison.",
        ONLY_CHANGE_LINE,
        _calls_line(campaign, access),
        PUBLICATION_STEP_LINE,
    ]


def route_lines(campaign: CampaignSpecV4, access: ModelAccess, *, tries: int) -> list[str]:
    """The route a run uses and the limits that stop it. The call and dollar limits are exact;
    a try's last reply can carry it past its token limits."""
    budgets = campaign.budgets
    calls = budgets.maximum_model_calls
    if access == "chatgpt_plan":
        tokens = (budgets.maximum_input_tokens + budgets.maximum_output_tokens) * tries
        return [
            "Using your ChatGPT plan",
            f"Manage usage: {USAGE_SETTINGS_URL}",
            "Runs on your ChatGPT plan. Each try stops starting model calls once it passes its "
            f"token limit or reaches {calls} calls, so the run uses about {tokens:,} tokens of "
            "your plan's limits; a try's last reply can go over. Techtree charges nothing.",
        ]
    return [
        f"Runs on your own Prime key. Stops at ${budgets.maximum_usd:.2f}, or sooner when each "
        f"try passes its token limit or reaches {calls} calls. Techtree charges nothing."
    ]


def _calls_line(campaign: CampaignSpecV4, access: ModelAccess) -> str:
    model = campaign.subject.model.model_id
    if access == "chatgpt_plan":
        return f"Model calls go to OpenAI's {model} on your ChatGPT plan, under OpenAI's policies."
    return f"Model calls go to {model} through Prime on your own key, under Prime's policies."


def _development_warnings(summaries: list[ClimbSummaryV2]) -> list[JsonValue]:
    return [
        {
            "id": "development_climb",
            "text": f"{summary.reference} is a development Climb. Its results are for trying "
            "the flow out and are not comparable evidence.",
        }
        for summary in summaries
        if summary.status == "development"
    ]


def _compatibility_warnings(compatibility: CompatibilityResultV2) -> list[JsonValue]:
    """Issues on a host that could still run the Climb; a host that cannot has blockers instead."""
    if not compatibility.compatible:
        return []
    return [{"id": issue.code, "text": issue.message} for issue in compatibility.issues]


def _start_warnings(source: CampaignSource, access: ModelAccess) -> list[dict[str, str]]:
    """Two facts read off the run: what it uses up, and whether its report is publishable."""
    warnings = [
        {
            "id": "paid_evaluation_run",
            "text": "This run evaluates the agent for real and uses your ChatGPT plan's limits."
            if access == "chatgpt_plan"
            else "This run evaluates the agent for real, and Prime charges your own key for "
            "its model calls.",
        }
    ]
    if source.climb.publication.proof_grade == "development_only":
        warnings.append(
            {
                "id": "not_publication_eligible",
                "text": f"{climb_reference(source.climb)} is a development Climb. Its report "
                "is not publication eligible, and its result is not comparable evidence.",
            }
        )
    return warnings


def _list_report(summaries: list[ClimbSummaryV2]) -> str:
    if not summaries:
        return "No Climbs match."
    lines = [f"{len(summaries)} Climb(s):", ""]
    for summary in summaries:
        compatible = "runs here" if summary.compatibility.compatible else "cannot run here"
        lines.append(
            f"- {summary.reference} — {summary.title} ({summary.status}, {summary.task_count} "
            f"tasks, {summary.proof_grade}; {compatible})"
        )
        lines.append(f"  {summary.summary}")
    return "\n".join(lines)


def _show_report(
    summary: ClimbSummaryV2,
    campaign: CampaignSpecV4,
    policy_digest: str,
    ownership: str,
    *,
    held_out: bool,
) -> str:
    compatibility = summary.compatibility
    lines = [
        f"{summary.reference} — {summary.title}",
        "",
        summary.summary,
        "",
        f"- Status: {summary.status}; purpose: {summary.purpose}",
        f"- Tasks: {summary.task_count} from {summary.taskset_id}",
        *(
            [
                "- Held-out tasks: kept apart and run once, on the winning Skill against no "
                "Skill; they never decide the winner (prepare with --held-out)"
            ]
            if held_out
            else []
        ),
        f"- Subject: {campaign.subject.model.model_id} in {summary.subject_harness} "
        f"{summary.subject_harness_version}",
        "- Runs on: " + ", ".join(ROUTE_NAMES[access] for access in campaign.subject.model.access),
        f"- Limits per try: {campaign.budgets.maximum_input_tokens:,} input tokens, "
        f"{campaign.budgets.maximum_output_tokens:,} output tokens, "
        f"{campaign.budgets.maximum_model_calls} model calls",
        *(
            []
            if campaign.budgets.maximum_usd is None
            else [f"- Dollar limit on your own Prime key: ${campaign.budgets.maximum_usd:.2f}"]
        ),
        f"- Scored on: {_rubric_phrase(campaign.scoring.rubric)}",
        f"- Proof grade: {summary.proof_grade}",
        f"- Candidate Skill: {_phrase(summary.candidate_skill_visibility)} to others; ownership "
        f"{ownership}",
        f"- Raw episodes: server upload {_phrase(summary.data_policy.raw_episode_server_upload)}, "
        f"training use {_phrase(summary.data_policy.raw_episode_training_use)}",
        f"- Data policy: {policy_digest}",
        "",
        f"- Runs here: {'yes' if compatibility.compatible else 'no'}",
        f"- Host platform: {compatibility.host_platform}",
        f"- Engine: {_phrase(compatibility.engine_status.value)}",
    ]
    for issue in compatibility.issues:
        lines.append(f"- {issue.severity.upper()} {issue.code}: {issue.message}")
    lines.append("")
    access_flag = (
        " --access prime-key|chatgpt-plan" if len(campaign.subject.model.access) > 1 else ""
    )
    lines.append(
        f"Next: regents techtree climb prepare {summary.reference} --skill <path to SKILL.md>"
        + access_flag
    )
    return "\n".join(lines)


def _prepare_report(prepared: PreparedDraft, start_command: str) -> str:
    draft = prepared.draft
    campaign = prepared.source.campaign
    held_out = prepared.source.campaign_digest != prepared.source.climb.campaign_spec_digest
    lines = [
        f"Draft {draft.id} is prepared against {climb_reference(prepared.source.climb)}"
        + (", on the tasks it keeps apart." if held_out else "."),
        "",
        *([] if draft.rerun_of is None else [RERUN_LINE.format(bundle=draft.rerun_of), ""]),
        f"- Candidate: {draft.skill_artifact.name} ({draft.skill_artifact.root_digest})",
        f"- Files: {', '.join(draft.included_files)}",
        f"- Episodes: {draft.estimated_episodes}",
        f"- Comparison controlled: {'yes' if prepared.manifest_comparison.controlled else 'no'}",
        f"- Proof grade: {prepared.source.climb.publication.proof_grade}",
        "",
        *route_lines(campaign, prepared.access, tries=draft.estimated_episodes),
        "",
        draft.policy_acceptance.summary,
    ]
    if draft.warnings:
        lines.append("")
        lines.extend(f"- {text}" for text in draft.warnings)
    lines.extend(["", f"Next: {start_command}"])
    return "\n".join(lines)


def _phrase(value: str) -> str:
    return value.replace("_", " ")


def _rubric_phrase(rubric: Rubric) -> str:
    """One reward at full weight is its own name; anything else is the weighted total."""
    match rubric.rewards:
        case [reward] if reward.weight == 1.0:
            return reward.name
        case rewards:
            weighted = ", ".join(f"{reward.name} (weight {reward.weight:g})" for reward in rewards)
            return f"the environment's weighted total of {weighted}"


CLIMB = click.Group("climb", help="Browse Climbs, prepare a Skill against one, and start a run.")
CLIMB.add_command(
    click.Command(
        "list",
        callback=list_climbs,
        help="Climbs in the catalog this build ships, with whether each runs on this host.",
        params=[
            click.Option(
                ["--status"],
                type=click.Choice(sorted(CLIMB_LIST_STATUSES)),
                default="available",
                show_default=True,
                help="Which Climbs to list.",
            ),
            JSON,
        ],
    )
)
CLIMB.add_command(
    click.Command(
        "show",
        callback=show,
        help="One Climb: its Campaign, its data policy, and whether this host can run it.",
        params=[REFERENCE, JSON],
    )
)
CLIMB.add_command(
    click.Command(
        "prepare",
        callback=prepare,
        help="Snapshot a Skill against a Climb into a draft that `climb start` can run, or "
        "rerun a published Result with --rerun-of.",
        params=[
            click.Argument(["reference"], metavar="[REFERENCE]", required=False),
            click.Option(
                ["--skill"],
                type=click.Path(exists=True, dir_okay=True, path_type=Path),
                help="The Skill's SKILL.md or its directory.",
            ),
            click.Option(
                ["--label"], help="What to call the candidate; its directory name otherwise."
            ),
            click.Option(
                ["--held-out"],
                is_flag=True,
                help="Against the tasks the Climb keeps apart: run once, on the winning Skill.",
            ),
            click.Option(
                ["--rerun-of"],
                metavar="BUNDLE_DIGEST",
                help="Rerun a published Result: its Campaign and its Skill, with new runs here.",
            ),
            click.Option(
                ["--access", "access_flag"],
                type=click.Choice(sorted(_ACCESS_FLAGS)),
                help="The route this run reaches the model by: your own Prime key or your "
                "ChatGPT plan. Needed when the Climb offers both.",
            ),
            BASE_URL,
            JSON,
        ],
    )
)
CLIMB.add_command(
    click.Command(
        "start",
        callback=start,
        help="Start a comparison run from a draft, after its review is approved.",
        params=[click.Argument(["draft_id"], metavar="DRAFT_ID"), YES, REVIEWED_ON, JSON],
    )
)
