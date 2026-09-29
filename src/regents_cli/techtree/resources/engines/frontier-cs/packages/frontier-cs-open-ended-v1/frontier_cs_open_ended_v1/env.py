"""The environment that seats the evaluated role under its real name, `subject`.

The same shape as Hello World's environment, for the same reason: every trace records
``agent.name == "subject"``, so receipts group by the role the Campaign declares rather than by a
name renamed afterwards. Model, harness, runtime and skills all arrive through the compiled
configuration; nothing here is a knob.
"""

from __future__ import annotations

import verifiers.v1 as vf

__all__ = ["FrontierCsEnv", "FrontierCsEnvConfig"]


class FrontierCsEnvConfig(vf.EnvConfig):
    """The one seat, named for the role it plays."""

    subject: vf.AgentConfig = vf.AgentConfig()


class FrontierCsEnv(vf.Env[FrontierCsEnvConfig]):
    """One episode is the subject attempting one problem."""

    async def run(self, task: vf.Task, agents: vf.Agents) -> None:
        """Play one task through the subject seat.

        Args:
            task: The task this episode is seeded from.
            agents: The episode's agents, addressed by seat name.
        """
        await agents.subject.run(task)
