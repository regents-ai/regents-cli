"""A task's score is the rubric's weighted total, and a reward off the rubric is refused.

The costly failure: a Result decided on one reward, or on rewards the pinned scorer never
weighed, published as though it were the environment's own score.
"""

from __future__ import annotations

import pytest

from regents_cli.techtree.errors import VerificationError
from regents_cli.techtree.models.campaign import Rubric, RubricReward
from regents_cli.techtree.receipts.episode import REWARD_MISSING, REWARD_RUBRIC_MISMATCH
from regents_cli.techtree.receipts.uplift import task_score

TASK = "sha256:" + "a" * 64
RUBRIC = Rubric(
    rewards=[
        RubricReward(name="bas_correct", weight=0.6),
        RubricReward(name="fault_audit", weight=0.4),
    ],
    scorer_digest="sha256:" + "b" * 64,
)


def test_the_score_is_the_weighted_total_worked_exactly() -> None:
    # Summed as doubles, 0.1 * 0.6 + 0.7 * 0.4 comes to 0.33999999999999997.
    scores = {"bas_correct": 0.1, "fault_audit": 0.7}
    assert task_score(scores, RUBRIC, label="candidate", task_hash=TASK) == 0.34


@pytest.mark.parametrize(
    ("scores", "code"),
    [
        ({"bas_correct": 1.0}, REWARD_MISSING),
        ({"bas_correct": 1.0, "fault_audit": 0.3, "format": 1.0}, REWARD_RUBRIC_MISMATCH),
    ],
)
def test_a_missing_reward_or_one_off_the_rubric_is_refused(
    scores: dict[str, float], code: str
) -> None:
    with pytest.raises(VerificationError) as refused:
        task_score(scores, RUBRIC, label="candidate", task_hash=TASK)
    assert refused.value.code == code
