"""Deterministic packaging for the single Prime Verifiers taskset format."""

from __future__ import annotations

import re
import secrets
from dataclasses import dataclass

from verify_runtime.model import EnvironmentFamily, MatchedSelection, TaskInstance, canonical_json_bytes, sha256_bytes

PRIME_SDK_DISTRIBUTION = "verifiers"
PRIME_SDK_VERSION = "0.2.1"
PRIME_TASKSET_FORMAT = "regent-forge-prime-v1"


@dataclass(frozen=True)
class PrimeTasksetPackage:
    """The agent-visible taskset and the separately sealed verifier packet."""

    agent_taskset: dict
    sealed_verifier_packet: bytes


_VERIFIER_HANDLE_BYTES = 32
_VERIFIER_HANDLE_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}")


def package_taskset(
    *,
    family: EnvironmentFamily,
    selection: MatchedSelection,
    task: TaskInstance,
    side: str,
    skill_bytes: bytes,
    task_input: bytes,
    grader_source: bytes,
    max_spend_usd_cents: int,
) -> PrimeTasksetPackage:
    """Package one matched task without exposing verifier material to the agent."""

    if side not in {"baseline", "candidate"}:
        raise ValueError("Prime taskset side must be baseline or candidate")
    if selection.task_id != task.task_id or selection.partition != task.partition:
        raise ValueError("Prime taskset selection does not match its task")
    if task.family_id != family.family_id:
        raise ValueError("Prime taskset family does not match its task")
    if sha256_bytes(task_input) != task.input_digest:
        raise ValueError("Prime task input does not match its canonical digest")
    if sha256_bytes(grader_source) != task.grader_digest:
        raise ValueError("Prime grader does not match its canonical digest")
    if type(max_spend_usd_cents) is not int or max_spend_usd_cents < 0:
        raise ValueError("Prime taskset spend ceiling must be a non-negative integer")

    agent_taskset = {
        "schema_version": 1,
        "format": PRIME_TASKSET_FORMAT,
        "sdk": {"distribution": PRIME_SDK_DISTRIBUTION, "version": PRIME_SDK_VERSION},
        "family_id": family.family_id,
        "matched_selection": selection.to_dict() | {"side": side},
        "task": {
            "identity": {
                "schema_version": task.schema_version,
                "task_id": task.task_id,
                "family_id": task.family_id,
                "slice_id": task.slice_id,
                "partition": task.partition,
                "role_id": task.role_id,
                "input_digest": task.input_digest,
            },
            "input": {"content": task_input.decode("utf-8"), "digest": task.input_digest},
        },
        "intervention": {
            "artifact": "SKILL.md",
            "content": skill_bytes.decode("utf-8"),
            "digest": sha256_bytes(skill_bytes),
        },
        "budget": {"max_spend_usd_cents": max_spend_usd_cents},
    }
    sealed_packet = canonical_json_bytes({
        "schema_version": 1,
        "format": PRIME_TASKSET_FORMAT,
        "family": family.to_dict(),
        "task": task.to_dict(),
        "grader": {"content": grader_source.decode("utf-8"), "digest": task.grader_digest},
    })
    return PrimeTasksetPackage(
        agent_taskset=agent_taskset,
        sealed_verifier_packet=sealed_packet,
    )


def new_verifier_handle() -> str:
    """Return a random, content-independent handle for adapter-memory lookup."""

    verifier_handle = secrets.token_urlsafe(_VERIFIER_HANDLE_BYTES)
    if _VERIFIER_HANDLE_PATTERN.fullmatch(verifier_handle) is None:
        raise RuntimeError("Prime generated an invalid verifier handle")
    return verifier_handle


def taskset_bytes(package: PrimeTasksetPackage) -> bytes:
    """Return the byte-stable agent-visible representation used at rollout."""

    return canonical_json_bytes(package.agent_taskset)
