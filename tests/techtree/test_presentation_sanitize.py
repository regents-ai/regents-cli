"""Nothing hidden reaches a rendering: no escape sequence, no path into somebody's home.

The costly failures: a terminal or a gateway obeys an escape sequence a task or a model put in a
label, or a local path travels into a result that is later published. The walk checks every
string the payload holds rather than the fields somebody remembered to check.
"""

from __future__ import annotations

import pytest

from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.presentation.models import (
    PRESENTATION_SCHEMA_VERSION,
    PresentationCaveat,
    SkillSummary,
    TaskResultRow,
    UpliftPresentationPayload,
)
from regents_cli.techtree.presentation.sanitize import (
    PRESENTATION_REDACTION_FAILED,
    ensure_no_hidden_task_material,
)


def payload(**overrides: object) -> UpliftPresentationPayload:
    """A minimal valid payload with the given fields replaced."""
    base: dict[str, object] = {
        "schema_version": PRESENTATION_SCHEMA_VERSION,
        "run_id": "run_" + "0" * 32,
        "campaign_title": "A Climb",
        "comparison_label": "Hello World Uplift Receipt",
        "change_label": "No tested Skill → Skill v1",
        "baseline_skill": SkillSummary(
            label="No tested Skill", root_digest=None, file_count=0, total_bytes=0
        ),
        "candidate_skill": SkillSummary(
            label="branch-code-v1",
            root_digest=f"sha256:{'a' * 64}",
            file_count=1,
            total_bytes=1024,
        ),
        "baseline_score": 0.0,
        "candidate_score": 1.0,
        "absolute_delta": 1.0,
        "relative_delta": None,
        "wins": 1,
        "losses": 0,
        "ties": 0,
        "task_rows": [
            TaskResultRow(
                position=0,
                task_label="task 01 · abcdef01",
                baseline_score=0.0,
                candidate_score=1.0,
                delta=1.0,
                outcome="win",
            )
        ],
        "baseline_tasks_scored_full": 0,
        "candidate_tasks_scored_full": 1,
        "baseline_tokens": None,
        "candidate_tokens": None,
        "baseline_seconds": None,
        "candidate_seconds": None,
        "baseline_model_turns": None,
        "candidate_model_turns": None,
        "baseline_rate_limited_calls": None,
        "candidate_rate_limited_calls": None,
        "every_rollout_completed": None,
        "economics_source": "unavailable",
        "derived_cost": None,
        "cost_unavailable_reason": "This run wrote no signed execution record.",
        "decision": "accepted",
        "proof_grade": "P1",
        "verification_status": "verified_offline",
        "caveats": [PresentationCaveat(code="no_server_upload", severity="info", text="Nothing")],
    }
    base.update(overrides)
    return UpliftPresentationPayload.model_validate(base)


def test_a_payload_carrying_an_escape_sequence_is_refused() -> None:
    with pytest.raises(ValidationError) as raised:
        ensure_no_hidden_task_material(payload(campaign_title="\x1b[31mA Climb"))

    assert raised.value.code == PRESENTATION_REDACTION_FAILED
    assert raised.value.details["field"] == "campaign_title"


def test_a_payload_naming_a_private_path_is_refused() -> None:
    with pytest.raises(ValidationError) as raised:
        ensure_no_hidden_task_material(
            payload(
                caveats=[
                    PresentationCaveat(
                        code="path",
                        severity="info",
                        text="see /Users/someone/.regents/techtree/runs for the evidence",
                    )
                ]
            )
        )

    assert raised.value.code == PRESENTATION_REDACTION_FAILED
    assert raised.value.details["field"] == "caveats[0].text"
