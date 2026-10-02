"""Asking the local daemon what the pinned images are.

The evaluation records the references it was asked for and nothing about what was there, so
Techtree asks once per variant, immediately before the child is launched, about every image the
variant may start: the one Campaign image, or each task's agent and grader images. Nothing here
pulls: provisioning an image is an explicit setup step.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from collections.abc import Iterable
from typing import Final

from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.models.campaign import (
    CampaignTaskset,
    PinnedImage,
    RuntimeSpec,
    pinned_task_images,
)
from regents_cli.techtree.verifiers.models import ImageResolution, ResolvedImage, VariantName

SUBJECT_IMAGE_UNRESOLVED: Final = "subject_image_unresolved"
IMAGE_INSPECT_TIMEOUT_SECONDS: Final = 30.0

_INSPECT_FORMAT: Final = "{{json .RepoDigests}}\t{{.Os}}/{{.Architecture}}"


def pinned_images(runtime: RuntimeSpec, taskset: CampaignTaskset) -> list[PinnedImage]:
    """Every distinct image a run of this Campaign may start, sorted by reference."""
    pins: dict[str, PinnedImage] = {}
    for task in pinned_task_images(runtime, taskset):
        for pinned in (task.agent, task.grader):
            if pinned is not None:
                pins[pinned.image] = pinned
    return [pins[image] for image in sorted(pins)]


def resolve_images(
    runtime: RuntimeSpec, taskset: CampaignTaskset, variant: VariantName
) -> ImageResolution:
    """What this machine's daemon holds for every image the Campaign pins."""
    pins = pinned_images(runtime, taskset)
    if shutil.which("docker") is None:
        raise ValidationError(
            "docker is not on PATH, so what the subject container would run cannot be established",
            code=SUBJECT_IMAGE_UNRESOLVED,
            details={"variant": variant.value, "image": pins[0].image},
        )
    resolved: list[ResolvedImage] = []
    platforms: set[str] = set()
    for pinned in pins:
        platform = _resolve(pinned, variant)
        platforms.add(platform)
        resolved.append(ResolvedImage(image=pinned.image, index_digest=pinned.index_digest))
    if len(platforms) != 1:
        raise ValidationError(
            "the Docker daemon serves the Campaign's images on different platforms, so which "
            "bytes would run cannot be stated once",
            code=SUBJECT_IMAGE_UNRESOLVED,
            details={"variant": variant.value, "platforms": _text_detail(platforms)},
        )
    return ImageResolution(variant=variant, platform=platforms.pop(), images=resolved)


def _resolve(pinned: PinnedImage, variant: VariantName) -> str:
    """The platform the daemon serves one pinned image on, once it is shown to hold it."""
    completed = subprocess.run(
        ["docker", "image", "inspect", pinned.image, "--format", _INSPECT_FORMAT],
        capture_output=True,
        text=True,
        check=False,
        timeout=IMAGE_INSPECT_TIMEOUT_SECONDS,
        stdin=subprocess.DEVNULL,
    )
    if completed.returncode != 0 or not completed.stdout.strip():
        raise ValidationError(
            f"the Docker daemon does not hold {pinned.image}; pull it as an explicit setup "
            "step before running an evaluation",
            code=SUBJECT_IMAGE_UNRESOLVED,
            details={
                "variant": variant.value,
                "image": pinned.image,
                "exit_code": completed.returncode,
            },
        )

    digests, _, platform = completed.stdout.strip().partition("\t")
    repository_digests = json.loads(digests)
    if pinned.image not in repository_digests:
        raise ValidationError(
            "the image the daemon resolved does not list the content the Campaign pinned "
            "among its own repository digests",
            code=SUBJECT_IMAGE_UNRESOLVED,
            details={
                "variant": variant.value,
                "image": pinned.image,
                "repository_digests": _text_detail(repository_digests),
            },
        )
    if platform not in pinned.platform_digests:
        raise ValidationError(
            f"the daemon serves {pinned.image} as {platform}, which the Campaign pins no "
            "manifest digest for",
            code=SUBJECT_IMAGE_UNRESOLVED,
            details={
                "variant": variant.value,
                "platform": platform,
                "pinned_platforms": _text_detail(pinned.platform_digests),
            },
        )
    return platform


def _text_detail(values: Iterable[object]) -> list[JsonValue]:
    return [text for text in sorted(str(value) for value in values)]
