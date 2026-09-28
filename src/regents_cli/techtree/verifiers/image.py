"""Asking the local daemon what the pinned subject image is.

The evaluation records the reference it was asked for and nothing about what was there, so
Techtree asks once per variant, immediately before the child is launched. Nothing here pulls:
provisioning an image is an explicit setup step.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from collections.abc import Iterable
from typing import Final

from regents_cli.techtree.errors import ValidationError
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.models.campaign import RuntimeSpec
from regents_cli.techtree.verifiers.models import SubjectImageResolution, VariantName

SUBJECT_IMAGE_UNRESOLVED: Final = "subject_image_unresolved"
IMAGE_INSPECT_TIMEOUT_SECONDS: Final = 30.0

_INSPECT_FORMAT: Final = "{{json .RepoDigests}}\t{{.Os}}/{{.Architecture}}"


def resolve_subject_image(runtime: RuntimeSpec, variant: VariantName) -> SubjectImageResolution:
    """What this machine's daemon holds for the Campaign's subject image."""
    if shutil.which("docker") is None:
        raise ValidationError(
            "docker is not on PATH, so what the subject container would run cannot be established",
            code=SUBJECT_IMAGE_UNRESOLVED,
            details={"variant": variant.value, "image": runtime.image},
        )

    completed = subprocess.run(
        ["docker", "image", "inspect", runtime.image, "--format", _INSPECT_FORMAT],
        capture_output=True,
        text=True,
        check=False,
        timeout=IMAGE_INSPECT_TIMEOUT_SECONDS,
        stdin=subprocess.DEVNULL,
    )
    if completed.returncode != 0 or not completed.stdout.strip():
        raise ValidationError(
            f"the Docker daemon does not hold {runtime.image}; pull it as an explicit setup "
            "step before running an evaluation",
            code=SUBJECT_IMAGE_UNRESOLVED,
            details={
                "variant": variant.value,
                "image": runtime.image,
                "exit_code": completed.returncode,
            },
        )

    digests, _, platform = completed.stdout.strip().partition("\t")
    repository_digests = json.loads(digests)
    if runtime.image not in repository_digests:
        raise ValidationError(
            "the image the daemon resolved does not list the content the Campaign pinned "
            "among its own repository digests",
            code=SUBJECT_IMAGE_UNRESOLVED,
            details={
                "variant": variant.value,
                "image": runtime.image,
                "repository_digests": _text_detail(repository_digests),
            },
        )
    if platform not in runtime.image_platform_digests:
        raise ValidationError(
            f"the daemon serves {runtime.image} as {platform}, which the Campaign pins no "
            "manifest digest for",
            code=SUBJECT_IMAGE_UNRESOLVED,
            details={
                "variant": variant.value,
                "platform": platform,
                "pinned_platforms": _text_detail(runtime.image_platform_digests),
            },
        )

    return SubjectImageResolution(
        variant=variant,
        image=runtime.image,
        index_digest=runtime.image_index_digest,
        platform=platform,
    )


def _text_detail(values: Iterable[object]) -> list[JsonValue]:
    return [text for text in sorted(str(value) for value in values)]
