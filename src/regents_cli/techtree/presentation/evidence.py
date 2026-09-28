"""Counts read back out of a finished run's own recorded evidence.

How many model turns each side took and how often the provider refused a call are recorded
by every run and carried by none of its signed documents. The signed execution record commits
each side's normalized episodes and raw traces by digest, so this reads those files back at
render time and checks them against those digests. A file that is missing, unreadable, or no
longer the file the record committed yields nothing at all rather than a number. Only counts
leave this module: the files carry prompts, replies and grader material, and no string taken
from either is returned.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from regents_cli.techtree.canonical import sha256_digest_bytes
from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.experiment import ExperimentVariant
from regents_cli.techtree.receipts.execution import ComparisonExecutionRecord
from regents_cli.techtree.verifiers.models import VariantName
from regents_cli.techtree.verifiers.outputs import TRACES_FILENAME, read_normalized_episodes
from regents_cli.techtree.verifiers.paths import RunPaths

#: Read from the recorded call's status rather than matched against the provider's prose.
RATE_LIMIT_STATUS: Final = 429


@dataclass(frozen=True)
class VariantEvidence:
    """What one side's own recorded files say it did."""

    model_turns: int
    rollouts: int
    rollouts_completed: int
    rate_limited_calls: int


@dataclass(frozen=True)
class RecordedEvidence:
    """Both sides, read from files the signed record commits by digest."""

    baseline: VariantEvidence
    candidate: VariantEvidence

    @property
    def every_rollout_completed(self) -> bool:
        return all(
            side.rollouts_completed == side.rollouts and side.rollouts > 0
            for side in (self.baseline, self.candidate)
        )


def read_recorded_evidence(
    run_root: Path, record: ComparisonExecutionRecord
) -> RecordedEvidence | None:
    """Both sides' counts, or None for every reason a reading can fail; never a partial answer."""
    paths = RunPaths(root=run_root)
    sides: dict[VariantName, VariantEvidence] = {}
    for variant in (VariantName.BASELINE, VariantName.CANDIDATE):
        summary = record.side(ExperimentVariant(variant.value))
        side = _variant_evidence(
            paths=paths,
            variant=variant,
            normalized_episodes_digest=summary.normalized_episodes_digest,
            raw_traces_digest=summary.raw_traces_digest,
        )
        if side is None:
            return None
        sides[variant] = side
    return RecordedEvidence(
        baseline=sides[VariantName.BASELINE], candidate=sides[VariantName.CANDIDATE]
    )


def _variant_evidence(
    *,
    paths: RunPaths,
    variant: VariantName,
    normalized_episodes_digest: str,
    raw_traces_digest: str,
) -> VariantEvidence | None:
    episodes_path = paths.variant_normalized_episodes(variant)
    if _checked(episodes_path, normalized_episodes_digest) is None:
        return None
    try:
        episodes = read_normalized_episodes(episodes_path)
    except ValidationError:
        return None
    raw = _checked(paths.variant_output_dir(variant) / TRACES_FILENAME, raw_traces_digest)
    if raw is None:
        return None
    rate_limited = _rate_limited_calls(raw)
    if rate_limited is None:
        return None
    rollouts = [trace for episode in episodes for trace in episode.traces]
    return VariantEvidence(
        model_turns=sum(trace.num_turns for trace in rollouts),
        rollouts=len(rollouts),
        rollouts_completed=sum(1 for trace in rollouts if trace.ok),
        rate_limited_calls=rate_limited,
    )


def _checked(path: Path, digest: str) -> bytes | None:
    """A file's bytes when they are still the bytes that were signed."""
    try:
        data = path.read_bytes()
    except OSError:
        return None
    return data if sha256_digest_bytes(data) == digest else None


def _rate_limited_calls(raw: bytes) -> int | None:
    """Count the calls the provider refused with a rate limit; the message beside each is unread."""
    total = 0
    try:
        for line in raw.decode("utf-8").splitlines():
            if not line.strip():
                continue
            for trace in json.loads(line).get("traces") or []:
                for call in trace.get("calls") or []:
                    error = call.get("error")
                    if isinstance(error, dict) and error.get("status_code") == RATE_LIMIT_STATUS:
                        total += 1
    except (UnicodeDecodeError, ValueError, AttributeError):
        return None
    return total
