"""The Verifiers Taskset for twelve HF Tasksmith tasks, from HF FineEnvs/HF_ML_Tasksmith.

Each task is a pull request taken back out of a Hugging Face repository. The agent works in
``/workspace`` of the task's own agent image; when it is done, the files the task lists are
copied into a fresh box from the task's grader image, which runs the task's tests there. The
agent never sees the tests, and nothing it did to its own box reaches the grader but those files.

The package carries the tasks and nothing of their images: which agent and grader image each task
runs in comes from the Campaign, through this taskset's ``images`` configuration, and only the
tasks named there are loaded. ``provenance.json`` records how each task folder differs from the
published one.

This module runs inside the managed engine, never in the ordinary Techtree environment.
"""

from __future__ import annotations

from collections.abc import Iterator
from importlib.resources import files
from pathlib import Path
from typing import Final

import verifiers.v1 as vf
from pydantic import BaseModel, ConfigDict, Field
from verifiers.v1.runtimes import Runtime, provision_runtime
from verifiers.v1.state import state_cls
from verifiers.v1.tasksets.harbor import HarborTask, HarborTaskset
from verifiers.v1.tasksets.harbor.taskset import HarborConfig, parse_task, verifier_box_data
from verifiers.v1.trace import Trace, TraceTask
from verifiers.v1.utils.artifacts import collect, restore
from verifiers.v1.utils.compile import resolve_runtime_config

__all__ = [
    "WORKDIR",
    "TaskImages",
    "TasksmithConfig",
    "TasksmithTask",
    "TasksmithTaskset",
]

#: Every Tasksmith task's instructions and tests name this folder; the engine would start in /app.
WORKDIR: Final = "/workspace"
TASKS: Final = Path(str(files("hf_tasksmith_v1") / "tasks"))


class TaskImages(BaseModel):
    """One task's two images, each a digest-pinned reference."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    agent: str
    grader: str


class TasksmithConfig(HarborConfig):
    """``images`` maps each task to load, by its folder name, to its two images.

    ``artifact_max_bytes`` is 128 MiB: tasksmith-5dd11b34cce1 hands the grader all of
    ``src/transformers``, about 48 MB before the agent changes anything.
    """

    images: dict[str, TaskImages]
    artifact_max_bytes: int = Field(128 * 1024 * 1024, gt=0)


class TasksmithTask(HarborTask):
    async def validate(self, runtime: Runtime) -> bool:
        """The gold check: untouched, the task scores 0; with its reference answer, 1.

        Both gradings happen the way an episode's does, in a fresh grader box that receives only
        the files the task lists.
        """
        untouched = await self._grade(runtime)
        reference = TASKS / self.data.name.removeprefix("repo2rlenv/") / "solution" / "reference"
        for path in sorted(p for p in reference.rglob("*") if p.is_file()):
            await runtime.write(f"{WORKDIR}/{path.relative_to(reference)}", path.read_bytes())
        answered = await self._grade(runtime)
        return untouched == 0.0 and answered == 1.0

    async def _grade(self, runtime: Runtime) -> float:
        artifacts = await collect(
            runtime, self.data.artifacts, max_bytes=self.data.artifact_max_bytes
        )
        grader = type(self)(verifier_box_data(self.data), self.config)
        trace = Trace(
            task=TraceTask(
                type=type(grader).__name__, data=grader.data, key=grader.key, hash=grader.hash
            ),
            state=state_cls(type(grader))(),
            agent=vf.AgentInfo(config=vf.AgentConfig(), name="validate", trainable=False),
        )
        config = resolve_runtime_config(runtime.config, grader)
        async with provision_runtime(config, env=grader.runtime_env()) as box:
            await box.prepare_setup()
            await grader.setup(box)
            await restore(box, artifacts)
            await grader.stage_tests(box, wipe=True)
            await box.prepare_execution([])
            return await grader.run_verifier(box, trace)


class TasksmithTaskset(HarborTaskset, vf.Taskset[TasksmithTask, TasksmithConfig]):
    def load(self) -> Iterator[TasksmithTask]:
        """The configured tasks, by folder name, each on its pinned images.

        A task's folder name stands in for its path, so its hash is the same on every machine.
        """
        parsing = self.config.model_copy(update={"ignore_dockerfile": True})
        for idx, task_id in enumerate(sorted(self.config.images)):
            pins = self.config.images[task_id]
            data = parse_task(TASKS / task_id, idx, parsing)
            yield TasksmithTask(
                data.model_copy(
                    update={
                        "image": pins.agent,
                        "verifier_image": pins.grader,
                        "upload_environment": False,
                        "workdir": WORKDIR,
                        "task_dir": task_id,
                    }
                ),
                self.config.task,
            )
