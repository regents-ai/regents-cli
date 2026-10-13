"""model-climb-fixture: the one Verifiers task of Model Climb's M0 compatibility test.

The invoice-fields row of the four public synthetic fixtures, asked once. The reward is 1 when
the reply, read as JSON, equals the fixture's answer, and 0 otherwise. The training run sees
the same row, so this measures that the stack runs end to end and nothing about quality.
"""

import json
from pathlib import Path

import verifiers.v1 as vf

FIXTURES = Path(__file__).with_name("fixtures.jsonl")
FIXTURE_ID = "invoice-fields"
END_OF_THINKING = "</think>"


def fixture_row(fixture_id: str = FIXTURE_ID) -> dict:
    rows = [json.loads(line) for line in FIXTURES.read_text().splitlines() if line.strip()]
    [row] = [row for row in rows if row["id"] == fixture_id]
    return row


def answer_of(reply: str | None):
    """The reply read as JSON, after any thinking the model wrote first; None when it is not
    JSON."""
    text = (reply or "").rpartition(END_OF_THINKING)[2].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


class FixtureData(vf.TaskData):
    answer: str
    """The fixture's own answer, as JSON text."""


class FixtureTask(vf.Task[FixtureData]):
    @vf.stop
    async def single_turn(self, trace: vf.Trace) -> bool:
        return trace.num_turns >= 1

    @vf.reward(weight=1.0)
    async def fixture_reward(self, trace: vf.Trace) -> float:
        return float(answer_of(trace.last_reply) == json.loads(self.data.answer))


class FixtureConfig(vf.TasksetConfig):
    pass


class FixtureTaskset(vf.Taskset[FixtureTask, FixtureConfig]):
    def load(self) -> list[FixtureTask]:
        system, user, assistant = fixture_row()["messages"]
        return [
            FixtureTask(
                FixtureData(
                    id=FIXTURE_ID,
                    prompt=user["content"],
                    system_prompt=system["content"],
                    answer=assistant["content"],
                ),
                self.config.task,
            )
        ]


__all__ = ["FixtureTaskset"]
