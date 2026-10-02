"""What one variant actually resolved and ran, fingerprinted from three sources.

The traces say what the runtime did, the resolved configuration says what the engine
understood it was asked for, and the daemon's answer says which image content was really on
this machine, for every task's agent image and grader image. They are required to agree; a
disagreement is exactly the drift a controlled comparison exists to detect, so it is a refusal
rather than a weaker result. Mounted skill digests are read back from the mount directory names,
which Techtree names after the skill's root digest.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any, Final

from regents_cli.techtree.canonical import digest_object, validate_digest
from regents_cli.techtree.errors import ValidationError, VerificationError
from regents_cli.techtree.models.base import Digest, JsonValue, NonEmptyString, ProtocolModel
from regents_cli.techtree.models.campaign import (
    CampaignImageRuntime,
    CampaignTaskset,
    PinnedImage,
    RuntimeSpec,
    pinned_task_images,
)
from regents_cli.techtree.verifiers.models import (
    ImageResolution,
    NormalizedEpisode,
    NormalizedTrace,
)

OBSERVED_CONFIGURATION_MISMATCH: Final = "observed_configuration_mismatch"

#: The directory-name spelling of a digest, which is how a mounted skill's content address
#: survives into a filesystem path.
_DIGEST_DIRECTORY_PREFIX: Final = "sha256-"


class ObservedImage(ProtocolModel):
    """One image that ran: the reference asked for, the content held, the platform's bytes."""

    image: NonEmptyString
    index_digest: Digest
    platform_digest: Digest


class ObservedTaskImages(ProtocolModel):
    """The images one task ran on; no grader when it was graded in the agent's own box."""

    task_hash: Digest
    agent: ObservedImage
    grader: ObservedImage | None


class ObservedSubjectConfiguration(ProtocolModel):
    """One normalized fingerprint of what a variant actually executed."""

    model_id: NonEmptyString
    sampling_digest: Digest
    harness_id: NonEmptyString
    harness_version: NonEmptyString
    use_bundled_skill: bool
    skill_root_digests: list[Digest]
    runtime_kind: NonEmptyString
    runtime_platform: NonEmptyString
    images: list[ObservedTaskImages]
    tool_inventory_digest: Digest
    reward_contract_digest: Digest
    verifiers_version: NonEmptyString
    verifiers_revision: NonEmptyString


def read_resolved_config(path: Path) -> dict[str, Any]:
    """The configuration the engine resolved and wrote back out, nulls included."""
    try:
        document: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValidationError(
            "the configuration this variant's engine resolved could not be read, so what it "
            "actually ran cannot be established",
            code=OBSERVED_CONFIGURATION_MISMATCH,
            details={"path": str(path)},
        ) from error
    return document


def observed_from_episodes(
    episodes: Sequence[NormalizedEpisode],
    *,
    resolved_config: Mapping[str, Any],
    image_resolution: ImageResolution,
    runtime: RuntimeSpec,
    taskset: CampaignTaskset,
    seat: str,
) -> ObservedSubjectConfiguration:
    """Fingerprint one variant, requiring every episode to agree.

    `seat` is the engine's name for the subject's seat in the Campaign's environment.
    """
    traces = [trace for episode in episodes for trace in episode.traces]
    if not traces:
        raise VerificationError(
            "this variant recorded no subject trace, so there is no observed configuration "
            "to establish",
            code=OBSERVED_CONFIGURATION_MISMATCH,
            details={"episodes": len(episodes)},
        )
    reference = traces[0]
    _require_no_drift(traces)
    mounted = _mounted_skill_digests(resolved_config, seat)
    declared = [validate_digest(value) for value in reference.skill_root_digests]
    if mounted != declared:
        raise VerificationError(
            "the skills the engine mounted are not the skills this variant's traces record, "
            "so what the subject was given is not what the experiment declared",
            code=OBSERVED_CONFIGURATION_MISMATCH,
            details={"mounted": mounted, "recorded": declared},
        )
    _require_config_agrees_with_traces(reference, resolved_config, runtime, seat)
    images = _observed_images(episodes, image_resolution, runtime, taskset)
    return ObservedSubjectConfiguration(
        model_id=reference.model_id,
        sampling_digest=digest_object(reference.sampling),
        harness_id=reference.harness_id,
        harness_version=reference.harness_version,
        use_bundled_skill=reference.use_bundled_skill,
        skill_root_digests=mounted,
        runtime_kind=reference.runtime.kind,
        runtime_platform=image_resolution.platform,
        images=images,
        tool_inventory_digest=digest_object(
            [
                {
                    "name": tool.name,
                    "description_digest": tool.description_digest,
                    "parameters_digest": tool.parameters_digest,
                }
                for tool in sorted(reference.tools, key=lambda tool: tool.name)
            ]
        ),
        reward_contract_digest=digest_object(
            [
                {"name": reward.name, "weight": reward.weight}
                for reward in sorted(reference.rewards, key=lambda item: item.name)
            ]
        ),
        verifiers_version=reference.verifiers_version,
        verifiers_revision=reference.verifiers_revision,
    )


def _require_no_drift(traces: Sequence[NormalizedTrace]) -> None:
    """Two rollouts that disagree about what they ran were not one experiment."""
    for label, observed in (
        ("model", {trace.model_id for trace in traces}),
        ("harness", {trace.harness_id for trace in traces}),
        ("harness version", {trace.harness_version for trace in traces}),
        ("bundled-skill setting", {trace.use_bundled_skill for trace in traces}),
        ("sampling", {digest_object(trace.sampling) for trace in traces}),
        ("runtime kind", {trace.runtime.kind for trace in traces}),
        ("skill list", {tuple(trace.skill_root_digests) for trace in traces}),
        (
            "tool inventory",
            {tuple(sorted(tool.name for tool in trace.tools)) for trace in traces},
        ),
        (
            "reward contract",
            {
                tuple(sorted((reward.name, reward.weight) for reward in trace.rewards))
                for trace in traces
            },
        ),
        (
            "Verifiers build",
            {(trace.verifiers_version, trace.verifiers_revision) for trace in traces},
        ),
    ):
        if len(observed) > 1:
            raise VerificationError(
                f"this variant's rollouts do not agree on the {label} they ran, so they are "
                "not one configuration measured many times",
                code=OBSERVED_CONFIGURATION_MISMATCH,
                details={"field": label, "observed": _text_detail(observed)},
            )


def _require_config_agrees_with_traces(
    trace: NormalizedTrace, resolved_config: Mapping[str, Any], runtime: RuntimeSpec, seat: str
) -> None:
    subject = _subject_of(resolved_config, seat)
    harness = _table(subject, "harness")
    resolved_runtime = _table(subject, "runtime")
    pairs = [
        ("model", resolved_config.get("model"), trace.model_id),
        ("harness", harness.get("id"), trace.harness_id),
        ("harness version", harness.get("version"), trace.harness_version),
        ("runtime kind", resolved_runtime.get("type"), trace.runtime.kind),
        ("bundled-skill setting", harness.get("use_bundled_skill"), trace.use_bundled_skill),
    ]
    # A task-image run gives the seat no image; each task's own image is checked against its pin.
    if isinstance(runtime, CampaignImageRuntime):
        pairs.append(("runtime image", resolved_runtime.get("image"), trace.runtime.image))
    for label, resolved, recorded in pairs:
        if resolved == recorded:
            continue
        raise VerificationError(
            f"the engine resolved a different {label} than this variant's traces record",
            code=OBSERVED_CONFIGURATION_MISMATCH,
            details={"field": label, "resolved": str(resolved), "recorded": str(recorded)},
        )
    if _sampling_of(resolved_config) != _set_knobs(dict(trace.sampling)):
        raise VerificationError(
            "the sampling settings the engine resolved are not the ones this variant's "
            "rollouts record being sampled under",
            code=OBSERVED_CONFIGURATION_MISMATCH,
            details={
                "resolved": _text_detail(_sampling_of(resolved_config)),
                "recorded": _text_detail(trace.sampling),
            },
        )


def _observed_images(
    episodes: Sequence[NormalizedEpisode],
    image_resolution: ImageResolution,
    runtime: RuntimeSpec,
    taskset: CampaignTaskset,
) -> list[ObservedTaskImages]:
    """Each task's images as they ran: the evaluation, the daemon and the Campaign must agree."""
    pins = {pin.task_hash: pin for pin in pinned_task_images(runtime, taskset)}
    observed: list[ObservedTaskImages] = []
    for episode in episodes:
        pin = pins.get(validate_digest(episode.task_hash))
        if pin is None:
            raise VerificationError(
                "this variant scored a task the Campaign pins no images for",
                code=OBSERVED_CONFIGURATION_MISMATCH,
                details={"task_hash": episode.task_hash},
            )
        for trace in episode.traces:
            agent = _observed_image(
                "agent",
                trace.runtime.image,
                trace.runtime.image_index_digest,
                pin.agent,
                image_resolution,
            )
            grader = None
            if pin.grader is not None or trace.grader_image is not None:
                if pin.grader is None or trace.grader_image is None:
                    raise VerificationError(
                        "this task was graded somewhere other than the Campaign says",
                        code=OBSERVED_CONFIGURATION_MISMATCH,
                        details={
                            "task_hash": episode.task_hash,
                            "recorded": str(trace.grader_image),
                            "pinned": None if pin.grader is None else pin.grader.image,
                        },
                    )
                grader = _observed_image(
                    "grader",
                    trace.grader_image,
                    pin.grader.index_digest,
                    pin.grader,
                    image_resolution,
                )
            observed.append(
                ObservedTaskImages(task_hash=episode.task_hash, agent=agent, grader=grader)
            )
    return observed


def _observed_image(
    role: str,
    recorded: str,
    recorded_index_digest: str,
    pinned: PinnedImage,
    image_resolution: ImageResolution,
) -> ObservedImage:
    if recorded != pinned.image:
        raise VerificationError(
            f"a rollout ran a different {role} image than its task pins",
            code=OBSERVED_CONFIGURATION_MISMATCH,
            details={"recorded": recorded, "pinned": pinned.image},
        )
    held = image_resolution.index_digest(pinned.image)
    if held is None or held != recorded_index_digest or held != pinned.index_digest:
        raise VerificationError(
            f"the content the daemon holds for the {role} image is not the content the "
            "rollout names and the Campaign pins",
            code=OBSERVED_CONFIGURATION_MISMATCH,
            details={
                "image": pinned.image,
                "resolved": str(held),
                "recorded": recorded_index_digest,
                "pinned": pinned.index_digest,
            },
        )
    platform_digest = pinned.platform_digests.get(image_resolution.platform)
    if platform_digest is None:
        raise VerificationError(
            f"the daemon served the {role} image on a platform the Campaign pins no manifest "
            "for, so which bytes ran cannot be established",
            code=OBSERVED_CONFIGURATION_MISMATCH,
            details={
                "platform": image_resolution.platform,
                "pinned_platforms": _text_detail(pinned.platform_digests),
            },
        )
    return ObservedImage(
        image=pinned.image,
        index_digest=pinned.index_digest,
        platform_digest=validate_digest(platform_digest),
    )


def _subject_of(resolved_config: Mapping[str, Any], seat: str) -> Mapping[str, Any]:
    environment = _table(resolved_config, "env")
    subject = environment.get(seat)
    if not isinstance(subject, Mapping):
        raise VerificationError(
            f"the configuration the engine resolved declares no {seat!r} seat for the subject, "
            "so it does not describe an evaluation of a subject",
            code=OBSERVED_CONFIGURATION_MISMATCH,
            details={"seat": seat, "tables": _text_detail(environment)},
        )
    return subject


def _table(document: Mapping[str, Any], name: str) -> Mapping[str, Any]:
    value = document.get(name)
    if not isinstance(value, Mapping):
        raise VerificationError(
            f"the configuration the engine resolved has no {name!r} table, so what it ran "
            "cannot be established",
            code=OBSERVED_CONFIGURATION_MISMATCH,
            details={"table": name},
        )
    return value


def _set_knobs(sampling: Mapping[str, Any]) -> dict[str, JsonValue]:
    return {str(k): v for k, v in sorted(sampling.items()) if v is not None}


def _sampling_of(resolved_config: Mapping[str, Any]) -> dict[str, JsonValue]:
    """The sampling knobs the engine set; a knob resolved to null was not set."""
    sampling = _table(resolved_config, "sampling")
    values: dict[str, JsonValue] = {}
    for key, value in sorted(sampling.items()):
        if value is None:
            continue
        if not isinstance(value, str | int | float | bool):
            raise VerificationError(
                "the resolved sampling parameters hold a value that is not a scalar, so they "
                "cannot be fingerprinted",
                code=OBSERVED_CONFIGURATION_MISMATCH,
                details={"key": str(key)},
            )
        values[str(key)] = value
    if not values:
        raise VerificationError(
            "the configuration the engine resolved records no sampling parameters, so how "
            "the subject was sampled is unknown",
            code=OBSERVED_CONFIGURATION_MISMATCH,
            details={},
        )
    return values


def _mounted_skill_digests(resolved_config: Mapping[str, Any], seat: str) -> list[Digest]:
    harness = _table(_subject_of(resolved_config, seat), "harness")
    mounted = harness.get("skills", [])
    if not isinstance(mounted, list):
        raise VerificationError(
            "the resolved harness does not list the skills it mounted",
            code=OBSERVED_CONFIGURATION_MISMATCH,
            details={},
        )
    digests: list[Digest] = []
    for entry in mounted:
        name = Path(str(entry)).name
        if not name.startswith(_DIGEST_DIRECTORY_PREFIX):
            raise VerificationError(
                "the engine mounted a skill from a directory that is not named after the "
                "skill's content, so what the subject read cannot be identified",
                code=OBSERVED_CONFIGURATION_MISMATCH,
                details={"directory": name},
            )
        digests.append(validate_digest(name.replace("-", ":", 1)))
    return digests


def _text_detail(values: Iterable[object]) -> list[str]:
    return sorted(str(value) for value in values)
