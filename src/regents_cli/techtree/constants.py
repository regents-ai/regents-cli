"""Protocol constants: schema strings, pins and limits. Values only, no imports."""

from __future__ import annotations

from typing import Final

#: Prefix that turns a bare SHA-256 hexadecimal string into a Techtree digest.
DIGEST_PREFIX: Final = "sha256:"

CATALOG_V2_SCHEMA_VERSION: Final = "techtree.catalog.v2"
CAMPAIGN_V2_SCHEMA_VERSION: Final = "techtree.campaign.v2"
EXECUTION_PLAN_SCHEMA_VERSION: Final = "techtree.execution-plan.v1"
CLIMB_SCHEMA_VERSION: Final = "techtree.climb.v1alpha1"
DATA_POLICY_SCHEMA_VERSION: Final = "techtree.data-policy.v1alpha1"
SKILL_SCHEMA_VERSION: Final = "techtree.skill.v1alpha1"
SUBMISSION_DRAFT_SCHEMA_VERSION: Final = "techtree.submission-draft.v1alpha1"
EXPERIMENT_V2_SCHEMA_VERSION: Final = "techtree.experiment.v2"
RUN_REQUEST_V2_SCHEMA_VERSION: Final = "techtree.run-request.v2"
TASKSET_LOCK_SCHEMA_VERSION: Final = "techtree.taskset-lock.v1alpha1"
TASKSET_VALIDATION_SCHEMA_VERSION: Final = "techtree.taskset-validation.v1alpha1"
VALIDATION_EVIDENCE_SCHEMA_VERSION: Final = "techtree.validation-evidence.v1alpha1"
VALIDATION_EXECUTION_SCHEMA_VERSION: Final = "techtree.validation-execution.v1alpha1"
EPISODE_RECEIPT_V2_SCHEMA_VERSION: Final = "techtree.episode-receipt.v2"
UPLIFT_V2_SCHEMA_VERSION: Final = "techtree.uplift-report.v2"
ENGINE_SCHEMA_VERSION: Final = "techtree.engine.v1alpha1"
PUBLICATION_SUBMISSION_SCHEMA_VERSION: Final = "techtree.publication-submission.v1alpha1"
PUBLICATION_RECEIPT_SCHEMA_VERSION: Final = "techtree.publication-receipt.v1alpha1"
PUBLICATION_WITHDRAWAL_SCHEMA_VERSION: Final = "techtree.publication-withdrawal.v1alpha1"
PUBLICATION_WITHDRAWAL_RECEIPT_SCHEMA_VERSION: Final = (
    "techtree.publication-withdrawal-receipt.v1alpha1"
)
PUBLICATION_JOURNAL_SCHEMA_VERSION: Final = "techtree.publication-journal.v1alpha1"

#: Go/OCI-style `<os>/<arch>` strings are the only host-platform spelling in the protocol.
SUPPORTED_HOST_PLATFORMS: Final[tuple[str, ...]] = (
    "darwin/amd64",
    "darwin/arm64",
    "linux/amd64",
    "linux/arm64",
)

#: The subject container every generated Campaign pins, and the per-platform manifests the
#: index resolves to. A tag moves, so a Campaign naming one could not claim its two variants
#: ran the same subject; read from the registry on 2026-08-13, never written from memory.
SUBJECT_IMAGE_REPOSITORY: Final = "python"
SUBJECT_IMAGE_TAG: Final = "3.11-slim"
SUBJECT_IMAGE_INDEX_DIGEST: Final = (
    "sha256:90744cff8f32887f075c47d747a173ff333e9e98801667af93c357fa9f5e28ff"
)
SUBJECT_IMAGE: Final = f"{SUBJECT_IMAGE_REPOSITORY}@{SUBJECT_IMAGE_INDEX_DIGEST}"
SUBJECT_IMAGE_PLATFORM_DIGESTS: Final[dict[str, str]] = {
    "linux/amd64": "sha256:78b39ef14d8e2b4d71f8dc304f1328c37df95fe0ef99477c2ae6bd3d03784553",
    "linux/arm64": "sha256:20eadabc42589e6543b24a64ab305b9895e9fcf6dbb2cadb14812f394ecdbadf",
}

#: The starter Skill's name, the label the guided first run files it under, and the release
#: disclosure printed beside it. None of the three is ever derived from a path.
STARTER_SKILL_NAME: Final = "hello-world-starter-v1"
STARTER_SKILL_CANDIDATE_LABEL: Final = "hello-world-v1"
STARTER_SKILL_PURPOSE: Final = "intentionally incomplete introductory Skill"

DEFAULT_WORKER_HEARTBEAT_SECONDS: Final = 2
DEFAULT_STALE_HEARTBEAT_SECONDS: Final = 15

MAX_SKILL_FILE_BYTES: Final = 256 * 1024
MAX_SKILL_TOTAL_BYTES: Final = 2 * 1024 * 1024
MAX_SKILL_FILES: Final = 64

#: Never a branch, a tag, or an unpinned PyPI range; changing it reruns the engine preflight.
PINNED_VERIFIERS_REVISION: Final = "b2e4e8157783b2c0dffc7821044c87f29f1c3ccf"
