"""Every path one run's Verifiers execution is allowed to touch.

The layout is per variant so a parallel schedule cannot have two children writing the same
file, and a cancelled variant's partial evidence stays legible next to its sibling's.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Final, Self

from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.verifiers.models import VariantName

VERIFIERS_DIRECTORY: Final = "verifiers"
INPUT_CONFIG_FILENAME: Final = "input.json"
NORMALIZED_EPISODES_FILENAME: Final = "normalized-episodes.jsonl"
STDOUT_LOG_FILENAME: Final = "stdout.log"
STDERR_LOG_FILENAME: Final = "stderr.log"
COMMAND_LOG_FILENAME: Final = "command.log"
SUPERVISION_RECORD_FILENAME: Final = "supervision.json"

#: The engine's `--output-dir` groups runs; `--run.name` pins the one directory under it that
#: the evidence lands in. Unpinned, the engine would append a random suffix nobody can find twice.
EVAL_RUN_NAME: Final = "run"

_DRY_RUN_DIRECTORY: Final = "dry-run"
_INPUTS_DIRECTORY: Final = "inputs"
_MANIFESTS_DIRECTORY: Final = "manifests"
_SKILL_FILES_PATH: Final = ("skill", "files")


@dataclass(frozen=True)
class RunPaths:
    """One run's directory and everything the execution writes under it."""

    root: Path

    @classmethod
    def for_run(cls, paths: TechtreePaths, run_id: str) -> Self:
        return cls(root=paths.run_dir(run_id))

    @property
    def inputs_dir(self) -> Path:
        return self.root / _INPUTS_DIRECTORY

    @property
    def skill_files_dir(self) -> Path:
        return self.inputs_dir.joinpath(*_SKILL_FILES_PATH)

    def manifest_path(self, variant: VariantName) -> Path:
        return self.inputs_dir / _MANIFESTS_DIRECTORY / f"{variant.value}.json"

    @property
    def verifiers_dir(self) -> Path:
        return self.root / VERIFIERS_DIRECTORY

    def variant_dir(self, variant: VariantName) -> Path:
        return self.verifiers_dir / variant.value

    def variant_input_config(self, variant: VariantName) -> Path:
        return self.variant_dir(variant) / INPUT_CONFIG_FILENAME

    def variant_dry_run_dir(self, variant: VariantName) -> Path:
        """Kept apart from the real output: a dry run writes only the resolved config, and a
        resolved config beside real evidence would look like a truncated run."""
        return self.variant_dir(variant) / _DRY_RUN_DIRECTORY

    def variant_dry_run_command_log(self, variant: VariantName) -> Path:
        return self.variant_dry_run_dir(variant) / COMMAND_LOG_FILENAME

    def variant_supervision_record(self, variant: VariantName) -> Path:
        return self.variant_dir(variant) / SUPERVISION_RECORD_FILENAME

    def variant_output_group_dir(self, variant: VariantName) -> Path:
        """What the compiled config's `output_dir` names: the engine groups runs under it."""
        return self.variant_dir(variant)

    def variant_output_dir(self, variant: VariantName) -> Path:
        """Where the real evaluation lands: the group directory plus the pinned run name."""
        return self.variant_output_group_dir(variant) / EVAL_RUN_NAME

    def variant_stdout_log(self, variant: VariantName) -> Path:
        return self.variant_output_dir(variant) / STDOUT_LOG_FILENAME

    def variant_stderr_log(self, variant: VariantName) -> Path:
        return self.variant_output_dir(variant) / STDERR_LOG_FILENAME

    def variant_normalized_episodes(self, variant: VariantName) -> Path:
        return self.variant_output_dir(variant) / NORMALIZED_EPISODES_FILENAME

    def relative(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    def owns(self, path: Path) -> bool:
        """Whether `path` lies inside the run's own input tree."""
        return path.is_absolute() and path.is_relative_to(self.inputs_dir)
