"""Protocol constants: schema strings, pins and limits. Values only, no imports."""

from __future__ import annotations

from typing import Final

#: Prefix that turns a bare SHA-256 hexadecimal string into a Techtree digest.
DIGEST_PREFIX: Final = "sha256:"

SKILL_SCHEMA_VERSION: Final = "techtree.skill.v1alpha1"
SUBMISSION_DRAFT_SCHEMA_VERSION: Final = "techtree.submission-draft.v1alpha1"
EXPERIMENT_V4_SCHEMA_VERSION: Final = "techtree.experiment.v4"
RUN_REQUEST_V2_SCHEMA_VERSION: Final = "techtree.run-request.v2"
TASKSET_LOCK_SCHEMA_VERSION: Final = "techtree.taskset-lock.v1alpha1"
EPISODE_RECEIPT_V3_SCHEMA_VERSION: Final = "techtree.episode-receipt.v3"
UPLIFT_V3_SCHEMA_VERSION: Final = "techtree.uplift-report.v3"
PUBLICATION_SUBMISSION_SCHEMA_VERSION: Final = "techtree.publication-submission.v1alpha1"
PUBLICATION_WITHDRAWAL_SCHEMA_VERSION: Final = "techtree.publication-withdrawal.v1alpha1"
PUBLICATION_JOURNAL_SCHEMA_VERSION: Final = "techtree.publication-journal.v1alpha1"

#: The starter Skill's name, the label the guided first run files it under, and the release
#: disclosure printed beside it. None of the three is ever derived from a path.

DEFAULT_WORKER_HEARTBEAT_SECONDS: Final = 2
DEFAULT_STALE_HEARTBEAT_SECONDS: Final = 15

MAX_SKILL_FILE_BYTES: Final = 256 * 1024
MAX_SKILL_TOTAL_BYTES: Final = 2 * 1024 * 1024
MAX_SKILL_FILES: Final = 64
