"""The files one variant's evaluation must have left behind, and their normalized projection.

Techtree keeps the raw upstream evidence and the projection the engine's own normalizer makes
of it, because a projection nobody can check against its source is a claim rather than
evidence. The resolved config and the log live in the engine's subdirectories; `logs/latest`
is a symlink another launch could repoint and is never read or hashed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Final

from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.canonical import sha256_digest_bytes
from regents_cli.techtree.engines.registry import EngineRegistry
from regents_cli.techtree.engines.runner import EngineRunner
from regents_cli.techtree.errors import EngineError, ValidationError
from regents_cli.techtree.models.base import ArtifactRef, Digest
from regents_cli.techtree.verifiers.models import (
    ChildProcessOutcome,
    NormalizedEpisode,
    SubjectImageResolution,
    VariantExecutionPlan,
    VariantExecutionResult,
)
from regents_cli.techtree.verifiers.paths import NORMALIZED_EPISODES_FILENAME

VARIANT_OUTPUT_INCOMPLETE: Final = "variant_output_incomplete"

RESOLVED_CONFIG_PATH: Final = "configs/resolved/eval.json"
TRACES_FILENAME: Final = "traces.jsonl"
#: One attempt directory is minted per launch and Techtree launches once.
EVAL_LOG_PATH: Final = "logs/attempt_1/eval.log"

#: The engine helper that turns raw episodes into the protocol projection, inside the bundle.
NORMALIZE_EVAL_OUTPUT_TOOL: Final = "normalize_eval_output.py"

RESOLVED_CONFIG_MEDIA_TYPE: Final = "application/json"
TRACES_MEDIA_TYPE: Final = "application/x-ndjson"
EVAL_LOG_MEDIA_TYPE: Final = "text/plain"
NORMALIZED_EPISODES_MEDIA_TYPE: Final = "application/x-ndjson"

DEFAULT_NORMALIZE_TIMEOUT_SECONDS: Final = 300.0


def required_output_paths(output_dir: Path) -> dict[str, Path]:
    """The three files a completed evaluation writes under its pinned run directory."""
    return {
        "config": output_dir / RESOLVED_CONFIG_PATH,
        "traces": output_dir / TRACES_FILENAME,
        "eval_log": output_dir / EVAL_LOG_PATH,
    }


def require_output_files(output_dir: Path) -> dict[str, Path]:
    """The three files, or a refusal; an empty traces file means no episode ever completed."""
    paths = required_output_paths(output_dir)
    missing = sorted(name for name, path in paths.items() if not path.is_file())
    if missing:
        raise ValidationError(
            f"the evaluation output is incomplete; missing {', '.join(missing)} under "
            f"{output_dir.name}",
            code=VARIANT_OUTPUT_INCOMPLETE,
            details={"output_dir": str(output_dir), "missing": list(missing)},
        )
    if paths["traces"].stat().st_size == 0:
        raise ValidationError(
            "the evaluation recorded no episodes; traces.jsonl is empty",
            code=VARIANT_OUTPUT_INCOMPLETE,
            details={"output_dir": str(output_dir), "missing": ["episodes"]},
        )
    return paths


def artifact_for(path: Path, media_type: str) -> ArtifactRef:
    """Hash a file's exact bytes and describe it."""
    try:
        data = path.read_bytes()
    except OSError as error:
        raise ValidationError(
            f"the evaluation artifact {path.name} could not be read",
            code=VARIANT_OUTPUT_INCOMPLETE,
            details={"path": str(path)},
        ) from error
    if not data:
        raise ValidationError(
            f"the evaluation artifact {path.name} is empty",
            code=VARIANT_OUTPUT_INCOMPLETE,
            details={"path": str(path)},
        )
    return ArtifactRef(
        digest=sha256_digest_bytes(data),
        media_type=media_type,
        size=len(data),
        relative_path=None,
    )


def read_normalized_episodes(path: Path) -> list[NormalizedEpisode]:
    """Every record of a normalized JSONL file; a missing final newline is a truncated file."""
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise ValidationError(
            "the normalized episode file could not be read",
            code=VARIANT_OUTPUT_INCOMPLETE,
            details={"path": str(path)},
        ) from error
    if not raw:
        raise ValidationError(
            "the normalized episode file is empty",
            code=VARIANT_OUTPUT_INCOMPLETE,
            details={"path": str(path)},
        )
    if not raw.endswith(b"\n"):
        raise ValidationError(
            "the normalized episode file does not end with a newline, so its last record is "
            "incomplete",
            code=VARIANT_OUTPUT_INCOMPLETE,
            details={"path": str(path)},
        )
    episodes: list[NormalizedEpisode] = []
    for number, line in enumerate(raw.decode("utf-8").splitlines(), start=1):
        if not line.strip():
            raise ValidationError(
                f"the normalized episode file has a blank record at line {number}",
                code=VARIANT_OUTPUT_INCOMPLETE,
                details={"path": str(path), "line": number},
            )
        episodes.append(_parse_episode(line, path=path, number=number))
    return episodes


def _parse_episode(line: str, *, path: Path, number: int) -> NormalizedEpisode:
    try:
        return NormalizedEpisode.model_validate_json(line)
    except PydanticValidationError as error:
        detail = error.errors()[0]["msg"]
        raise ValidationError(
            f"the normalized episode at line {number} is malformed: {detail}",
            code=VARIANT_OUTPUT_INCOMPLETE,
            details={"path": str(path), "line": number},
        ) from error
    except json.JSONDecodeError as error:
        raise ValidationError(
            f"the normalized episode at line {number} is not JSON",
            code=VARIANT_OUTPUT_INCOMPLETE,
            details={"path": str(path), "line": number},
        ) from error


def normalize_eval_output(
    *,
    engine_registry: EngineRegistry,
    engine_digest: Digest,
    engine_runner: EngineRunner,
    output_dir: Path,
    taskset_lock_path: Path,
    experiment_manifest_path: Path,
    destination: Path,
    timeout: float = DEFAULT_NORMALIZE_TIMEOUT_SECONDS,
) -> Path:
    """Run the engine's normalizer, under the engine's interpreter, over one variant's output."""
    script = engine_registry.tool_path(engine_digest, NORMALIZE_EVAL_OUTPUT_TOOL)
    result = engine_runner.run_python_script(
        script,
        [
            "--output-dir",
            str(output_dir),
            "--membership",
            str(taskset_lock_path),
            "--experiment-manifest",
            str(experiment_manifest_path),
            "--output",
            str(destination),
        ],
        timeout=timeout,
    )
    if result.exit_code != 0:
        raise EngineError(
            "the engine could not normalize the evaluation output: "
            f"{_last_line(result.stderr) or _last_line(result.stdout)}",
            code="eval_normalization_failed",
            details={
                "engine_digest": engine_digest,
                "output_dir": str(output_dir),
                "exit_code": result.exit_code,
            },
        )
    return destination


def build_variant_result(
    *,
    plan: VariantExecutionPlan,
    outcome: ChildProcessOutcome,
    image_resolution: SubjectImageResolution,
    engine_registry: EngineRegistry,
    engine_digest: Digest,
    engine_runner: EngineRunner,
    taskset_lock_path: Path,
    timeout: float = DEFAULT_NORMALIZE_TIMEOUT_SECONDS,
) -> VariantExecutionResult:
    """One variant's complete result: raw evidence and its projection, both hashed."""
    if outcome.variant is not plan.variant:
        raise ValidationError(
            f"a {plan.variant.value} plan cannot be completed by a {outcome.variant.value} "
            "child process",
            code=VARIANT_OUTPUT_INCOMPLETE,
            details={"plan": plan.variant.value, "outcome": outcome.variant.value},
        )

    output_dir = Path(plan.verifiers_output_dir)
    paths = require_output_files(output_dir)
    destination = output_dir / NORMALIZED_EPISODES_FILENAME
    normalize_eval_output(
        engine_registry=engine_registry,
        engine_digest=engine_digest,
        engine_runner=engine_runner,
        output_dir=output_dir,
        taskset_lock_path=taskset_lock_path,
        experiment_manifest_path=Path(plan.experiment_manifest_path),
        destination=destination,
        timeout=timeout,
    )
    episodes = read_normalized_episodes(destination)
    if len(episodes) != plan.task_count:
        raise ValidationError(
            f"the {plan.variant.value} variant normalized {len(episodes)} episodes for "
            f"{plan.task_count} committed tasks",
            code=VARIANT_OUTPUT_INCOMPLETE,
            details={
                "variant": plan.variant.value,
                "normalized": len(episodes),
                "expected": plan.task_count,
            },
        )

    return VariantExecutionResult(
        variant=plan.variant,
        experiment_manifest_digest=plan.experiment_manifest_digest,
        resolved_verifiers_config=artifact_for(paths["config"], RESOLVED_CONFIG_MEDIA_TYPE),
        raw_traces=artifact_for(paths["traces"], TRACES_MEDIA_TYPE),
        eval_log=artifact_for(paths["eval_log"], EVAL_LOG_MEDIA_TYPE),
        normalized_episodes=artifact_for(destination, NORMALIZED_EPISODES_MEDIA_TYPE),
        child_outcome=outcome,
        image_resolution=image_resolution,
        episodes=episodes,
    )


def _last_line(stream: str) -> str:
    for line in reversed(stream.splitlines()):
        if line.strip():
            return line.strip()
    return ""
