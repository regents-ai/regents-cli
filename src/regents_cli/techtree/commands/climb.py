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
from regents_cli.techtree.commands.answers import JSON, emit
from regents_cli.techtree.commands.run import run_service
from regents_cli.techtree.drafts.source import CampaignSource
from regents_cli.techtree.drafts.store import DraftStore
from regents_cli.techtree.ids import validate_id
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.models.campaign import CampaignSpecV2
from regents_cli.techtree.models.catalog import ClimbSummaryV2, CompatibilityResultV2
from regents_cli.techtree.models.run import AcknowledgementMethod, PolicyAcknowledgement
from regents_cli.techtree.models.skill import SubmissionDraft
from regents_cli.techtree.runs.machine import public_state
from regents_cli.techtree.runs.service import ApprovalActor, utc_now
from regents_cli.techtree.skills.service import PreparedDraft, SkillPreparationService

ONLY_CHANGE_LINE: Final = "The Skill is the only scientific change."

#: Said next to the model-calls line, which is what keeps it from reading as "nothing leaves
#: this machine": starting a run sends none of the participant's material, and publishing later
#: carries the proof and never the episodes.
PUBLICATION_STEP_LINE: Final = (
    "Publishing is a separate step, taken after a run finishes and only if you choose to: what "
    "travels then is the run's proof — the signed report and its receipts — and never the "
    "episodes."
)

#: A DataPolicy describes a published result, and read alone it looks like a plan to publish
#: somebody's Skill; this says what publishing takes and that model calls still leave.
PUBLICATION_TERMS_LINE: Final = (
    "These are the terms this Climb sets for a published result. Nothing is published unless "
    "you publish a finished run yourself, and what travels then is the run's proof — the signed "
    "report and its receipts — and never the episodes. Your Skill and your episodes stay on "
    "this machine, and model calls still go to the model provider you configured."
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
        "subject_runtime": to_json_value(campaign.subject.runtime),
        "primary_reward": campaign.scoring.primary_reward,
        "candidate_skill_ownership": resolved.data_policy.candidate_skill.ownership,
    }
    warnings = _development_warnings([summary]) + _compatibility_warnings(summary.compatibility)
    if warnings:
        answer["warnings"] = warnings
    answer["report"] = _show_report(
        summary,
        campaign,
        resolved.data_policy_digest,
        resolved.data_policy.candidate_skill.ownership,
    )
    emit(answer, as_json=as_json)


def prepare(reference: str, skill: Path, label: str | None, as_json: bool) -> None:
    prepared = SkillPreparationService(paths.home()).prepare(
        climb_reference=reference, skill_path=skill, candidate_label=label
    )
    draft = prepared.draft
    source = prepared.source
    campaign = source.campaign
    policy = source.data_policy
    start_command = shlex.join(["regents", "techtree", "climb", "start", draft.id])
    answer: dict[str, JsonValue] = {
        "draft_id": draft.id,
        "draft_digest": prepared.draft_digest,
        "climb_reference": climb_reference(source.climb),
        "climb_digest": source.climb_digest,
        "campaign_spec_digest": draft.campaign_spec_digest,
        "data_policy_digest": draft.data_policy_digest,
        "candidate_label": draft.skill_artifact.name,
        "skill_root_digest": draft.skill_artifact.root_digest,
        "included_files": list(draft.included_files),
        "baseline_skill_count": len(campaign.subject.harness.skills),
        "candidate_skill_count": 1,
        "estimated_episodes": draft.estimated_episodes,
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
    reviewed_on = approve(
        yes=yes,
        reviewed_on=reviewed_on,
        as_json=as_json,
        review=[
            *review_lines(draft=draft, campaign=campaign),
            draft.policy_acceptance.summary,
            PUBLICATION_TERMS_LINE,
        ],
        command=["climb", "start", draft_id],
        question="Start this run?",
        why="A run spends model tokens under the Campaign's declared maximum and accepts the "
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
    warnings = _start_warnings(source)
    answer: dict[str, JsonValue] = {
        "run_id": state.run_id,
        "draft_id": draft_id,
        "draft_digest": request.draft_digest,
        "phase": state.phase.value,
        "worker_pid": state.worker_pid,
        "campaign_spec_digest": draft.campaign_spec_digest,
        "data_policy_digest": draft.data_policy_digest,
        "policy_acknowledgement_method": method,
        "approved_by": actor,
        "state_digest": service.state_digest(state.run_id),
        "warnings": to_json_value(warnings),
        "report": "\n".join(
            [
                f"Run {state.run_id} started from draft {draft_id}: {public_state(state.phase)}.",
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


def review_lines(*, draft: SubmissionDraft, campaign: CampaignSpecV2) -> list[str]:
    """The five things a person weighs before a run starts, read off this draft and Campaign."""
    return [
        f"This runs {draft.estimated_episodes} episodes: the same tasks once for each side of "
        "the comparison.",
        _cost_line(campaign),
        ONLY_CHANGE_LINE,
        f"Model calls go to {campaign.subject.model.provider}, under that provider's policies.",
        PUBLICATION_STEP_LINE,
    ]


def _cost_line(campaign: CampaignSpecV2) -> str:
    """What holds the spend while the run is under way, and what does not."""
    ceiling = campaign.budgets.maximum_usd
    if ceiling is None:
        return (
            "This run spends model tokens on inference. This Campaign declares no maximum, so "
            "Techtree does not stop the run for what it spends. Each episode still has enforced "
            "turn, token, and time limits. A provider that charges for tokens bills the episodes "
            "above to your own account, and a model you run yourself sends no bill."
        )
    return (
        "This run spends model tokens on inference. While it runs, Techtree adds up the cost "
        "the provider reports for each finished task, and once the total reaches the "
        f"${ceiling:.2f} maximum this Campaign declares, it stops both sides; a stopped run has "
        "no score. Tasks still under way when it stops can add a little to the total. Each "
        "episode also has enforced turn, token, and time limits. A provider that charges for "
        "tokens bills the episodes above to your own account, and a model you run yourself "
        "sends no bill."
    )


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


def _start_warnings(source: CampaignSource) -> list[dict[str, str]]:
    """Two facts read off the run: it spends real tokens, and whether its report is publishable."""
    warnings = [
        {
            "id": "paid_evaluation_run",
            "text": "This run evaluates the agent for real and spends model tokens on inference "
            f"with {source.campaign.subject.model.provider}. If that provider charges for "
            "tokens, what you pay is whatever it charges; a model you run yourself sends no "
            "bill.",
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
    summary: ClimbSummaryV2, campaign: CampaignSpecV2, policy_digest: str, ownership: str
) -> str:
    compatibility = summary.compatibility
    lines = [
        f"{summary.reference} — {summary.title}",
        "",
        summary.summary,
        "",
        f"- Status: {summary.status}; purpose: {summary.purpose}",
        f"- Tasks: {summary.task_count} from {summary.taskset_id}",
        f"- Subject: {campaign.subject.model.provider} {campaign.subject.model.model_id} in "
        f"{summary.subject_harness} {summary.subject_harness_version}",
        f"- Scored on: {campaign.scoring.primary_reward}",
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
    lines.append(
        f"Next: regents techtree climb prepare {summary.reference} --skill <path to SKILL.md>"
    )
    return "\n".join(lines)


def _prepare_report(prepared: PreparedDraft, start_command: str) -> str:
    draft = prepared.draft
    campaign = prepared.source.campaign
    ceiling = campaign.budgets.maximum_usd
    lines = [
        f"Draft {draft.id} is prepared against {climb_reference(prepared.source.climb)}.",
        "",
        f"- Candidate: {draft.skill_artifact.name} ({draft.skill_artifact.root_digest})",
        f"- Files: {', '.join(draft.included_files)}",
        f"- Episodes: {draft.estimated_episodes}",
        f"- Declared maximum: {'none' if ceiling is None else f'${ceiling:.2f}'}",
        f"- Comparison controlled: {'yes' if prepared.manifest_comparison.controlled else 'no'}",
        f"- Proof grade: {prepared.source.climb.publication.proof_grade}",
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
        help="Snapshot a Skill against a Climb into a draft that `climb start` can run.",
        params=[
            REFERENCE,
            click.Option(
                ["--skill"],
                required=True,
                type=click.Path(exists=True, dir_okay=True, path_type=Path),
                help="The Skill's SKILL.md or its directory.",
            ),
            click.Option(
                ["--label"], help="What to call the candidate; its directory name otherwise."
            ),
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
