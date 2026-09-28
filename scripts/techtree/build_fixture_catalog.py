"""Regenerate the packaged catalog: the one Climb this build ships and every object under it.

The pipeline installs the packaged engine into a throwaway home, locks the reference taskset,
validates it for real, and builds the DataPolicy, execution plan, Campaign and Climb around the
digests that produced. Identifiers derive from fixed labels, so every byte is a function of the
constants below and the engine bundle.
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from pathlib import Path
from typing import Final, Literal

from pydantic import BaseModel
from tasksets import TasksetValidation, lock_taskset, validate_taskset

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object
from regents_cli.techtree.engines.bundle import (
    default_engine_digest,
    embedded_engine_root,
    read_engine_descriptor,
)
from regents_cli.techtree.engines.installer import EngineInstaller, find_uv
from regents_cli.techtree.engines.registry import EngineRegistry
from regents_cli.techtree.models.base import Digest
from regents_cli.techtree.models.campaign import (
    SKILL_MUTATION_POINTER,
    SUBJECT_AGENT,
    AgentSpecV2,
    BudgetSpec,
    CampaignContext,
    CampaignMetadata,
    CampaignSpecV2,
    CampaignTaskset,
    EnvironmentSpec,
    EvidenceRequirementsV2,
    ExecutionSpec,
    HarnessSpecV2,
    ModelSpec,
    MutationContract,
    MutationKind,
    PackageRef,
    RuntimeSpec,
    SamplingSpec,
    ScoringSpec,
    TaskMembershipCommitment,
    TaskSelection,
    TasksetRef,
    VariantSchedule,
)
from regents_cli.techtree.models.catalog import (
    CatalogClimbEntry,
    CatalogIndexV2,
    CatalogObjectLocationV2,
)
from regents_cli.techtree.models.climb import (
    CandidateConstraints,
    CandidatePolicy,
    ClimbManifest,
    ClimbMetadata,
    LeaderboardPolicy,
    PublicationPolicy,
)
from regents_cli.techtree.models.data_policy import (
    CandidateSkillPolicy,
    DataOwner,
    DataPolicy,
    DerivedArtifactPolicy,
    RawEpisodePolicy,
    RevocationPolicy,
)
from regents_cli.techtree.models.execution_plan import (
    EvaluationEngineRef,
    EvidenceBackendSpec,
    ExecutionBackendSpec,
    ResolvedExecutionPlan,
    SubjectBackendSpec,
)
from regents_cli.techtree.models.validation import TasksetLock
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.release.document import document_digest

ROOT: Final = Path(__file__).resolve().parents[2]
CATALOG_ROOT: Final = ROOT / "src/regents_cli/techtree/resources/catalog"

CLIMB_SLUG: Final = "hello-world-climb"
CLIMB_VERSION: Final = 1
#: Fixed labels the Campaign and DataPolicy identifiers derive from; nothing shows them.
CAMPAIGN_LABEL: Final = "hello-world-campaign@1"
DATA_POLICY_LABEL: Final = "hello-world-policy@1"

#: The reference taskset; its distribution name is also its Verifiers taskset id.
REFERENCE_PACKAGE: Final = "procedure-transfer-v1"
TASK_COUNT: Final = 36
PRIMARY_REWARD: Final = "exact_match"

#: The pinned Hermes release the subject runs, named by its tag; v2026.7.20 is Hermes 0.19.0,
#: the harness 0.3.0 was certified with. The subject image already holds it, so no episode
#: downloads it (scripts/techtree/subject-image).
HARNESS_ID: Final = "hermes-agent"
HARNESS_VERSION: Final = "v2026.7.20"

SUBJECT_MODEL_PROVIDER: Final = "prime"
SUBJECT_MODEL_ID: Final = "qwen/qwen3.7-flash"
SUBJECT_CREDENTIAL_ENV: Final = "PRIME_API_KEY"
SUBJECT_MAX_OUTPUT_TOKENS: Final = 4096
SUBJECT_IMAGE: Final = (
    "ghcr.io/regents-ai/techtree-subject"
    "@sha256:0acde5ee96ca0798253a12e4102de2ed5b8cb9e18ff111e462312137e299b0e4"
)
SUBJECT_IMAGE_PLATFORM_DIGESTS: Final = {
    "linux/amd64": "sha256:258f2db32d8b97fa63aac2c67e7e7e19e0849aa9460d6dcd6c8ca2216daf2609",
    "linux/arm64": "sha256:320054f0c3bd6e3ca44f15afb461f09ffa2928f1adf032860a6a1d6776d5dbc6",
}

#: A ceiling, never a price: the enforced token limits below can amount to $2.42.
CAMPAIGN_BUDGET_USD: Final = 2.50
CAMPAIGN_MAXIMUM_OUTPUT_TOKENS: Final = 16000
CAMPAIGN_MAXIMUM_INPUT_TOKENS: Final = 900000
CAMPAIGN_MAXIMUM_MODEL_CALLS: Final = 44
CAMPAIGN_MAX_CONCURRENT: Final = 4
CAMPAIGN_TIMEOUT_SECONDS: Final = 600
CAMPAIGN_RETRY_LIMIT: Final = 0

CLIMB_PATH: Final = f"climbs/{CLIMB_SLUG}.json"
INDEX_FILENAME: Final = "catalog.json"

type ObjectKind = Literal[
    "campaign", "data_policy", "execution_plan", "taskset_validation", "validation_evidence"
]


def derived_id(prefix: str, label: str) -> str:
    """The identifier one fixed label always produces."""
    return f"{prefix}_{hashlib.sha256(label.encode('utf-8')).hexdigest()[:32]}"


def reference_taskset_ref() -> TasksetRef:
    """The reference taskset, read from the packaged engine's own descriptor."""
    package = next(
        entry
        for entry in read_engine_descriptor(embedded_engine_root()).packages
        if entry.name == REFERENCE_PACKAGE
    )
    return TasksetRef(
        kind="verifiers",
        id=REFERENCE_PACKAGE,
        package=PackageRef(
            kind="embedded",
            name=REFERENCE_PACKAGE,
            revision=package.version,
            digest=package.source_digest,
        ),
        config={},
    )


def task_selection() -> TaskSelection:
    """The selection the Campaign commits to, never shuffled."""
    return TaskSelection(num_tasks=TASK_COUNT, num_rollouts=1, shuffle=False)


def publish_validation(build_root: Path) -> TasksetValidation:
    """Install the packaged engine in a throwaway home, lock the taskset and validate it."""
    paths = TechtreePaths(root=build_root / "home")
    registry = EngineRegistry(paths)
    engine = EngineInstaller(paths, registry, find_uv()).install()
    lock = lock_taskset(registry, engine.digest, reference_taskset_ref(), task_selection())
    return validate_taskset(registry, engine.digest, lock, build_root)


def data_policy() -> DataPolicy:
    """The development rights policy."""
    return DataPolicy(
        schema_version="techtree.data-policy.v1alpha1",
        id=derived_id("policy", DATA_POLICY_LABEL),
        version=1,
        owner=DataOwner(kind="participant", account_ref=None),
        raw_episodes=RawEpisodePolicy(
            local_retention="allowed",
            server_upload="prohibited",
            public_release="prohibited",
            reproduction_access="consent_required",
            training_use="prohibited",
        ),
        derived_artifacts=DerivedArtifactPolicy(
            aggregate_scores="public",
            uplift_report="public",
            redacted_trace_projection="public",
            anonymized_product_analytics="allowed",
        ),
        candidate_skill=CandidateSkillPolicy(
            ownership="participant",
            public_release="required_for_climb",
            training_use="prohibited",
        ),
        revocation=RevocationPolicy(
            future_use_revocable=True,
            immutable_published_proofs_remain=True,
        ),
    )


def execution_plan() -> ResolvedExecutionPlan:
    """The plan the Campaign binds, naming the packaged engine by content."""
    descriptor = read_engine_descriptor(embedded_engine_root())
    return ResolvedExecutionPlan(
        schema_version="techtree.execution-plan.v1",
        kind="ResolvedExecutionPlan",
        evaluation=EvaluationEngineRef(
            kind="verifiers",
            api_generation="v1",
            package_version=descriptor.verifiers_version,
            source_commit=descriptor.verifiers_revision,
            engine_digest=default_engine_digest(),
        ),
        execution=ExecutionBackendSpec(
            kind="local", provider=None, provider_environment_coordinate=None
        ),
        subject=SubjectBackendSpec(
            kind="direct",
            harness_id=HARNESS_ID,
            harness_version=HARNESS_VERSION,
            adapter_id=None,
            adapter_version=None,
            adapter_contract_version=None,
        ),
        evidence=EvidenceBackendSpec(
            native_evidence="required",
            trace_coverage="not_requested",
            coverage_profile_digest=None,
        ),
    )


def campaign(
    lock: TasksetLock,
    receipt_digest: Digest,
    data_policy_digest: Digest,
    execution_plan_digest: Digest,
) -> CampaignSpecV2:
    """The scientific contract the Climb invites participants to run."""
    return CampaignSpecV2(
        schema_version="techtree.campaign.v2",
        kind="Campaign",
        metadata=CampaignMetadata(
            id=derived_id("campaign", CAMPAIGN_LABEL), version=1, purpose="component_uplift"
        ),
        context=CampaignContext(program_ref=None, outcome_contract_digest=None),
        taskset=CampaignTaskset(
            ref=lock.taskset_ref,
            selection=task_selection(),
            membership=TaskMembershipCommitment(
                mode="committed",
                ordered_task_hashes=list(lock.ordered_task_hashes),
                membership_digest=lock.membership_digest,
            ),
            validation_receipt_digest=receipt_digest,
        ),
        environment=EnvironmentSpec(id="single-agent"),
        agents={
            SUBJECT_AGENT: AgentSpecV2(
                model=ModelSpec(
                    provider=SUBJECT_MODEL_PROVIDER,
                    model_id=SUBJECT_MODEL_ID,
                    revision=None,
                    credential_env=SUBJECT_CREDENTIAL_ENV,
                ),
                sampling=SamplingSpec(temperature=0.0, max_tokens=SUBJECT_MAX_OUTPUT_TOKENS),
                harness=HarnessSpecV2(use_bundled_skill=False, skills=[]),
                runtime=RuntimeSpec(
                    type="docker",
                    image=SUBJECT_IMAGE,
                    supported_platforms=sorted(SUBJECT_IMAGE_PLATFORM_DIGESTS),
                    image_platform_digests=dict(SUBJECT_IMAGE_PLATFORM_DIGESTS),
                    cpu=2.0,
                    memory_gb=4.0,
                    network_policy="restricted",
                ),
                trainable=False,
            )
        },
        mutation_contract=MutationContract(
            kind=MutationKind.SKILL_INSERTION,
            target_agent="subject",
            allowed_differences=[SKILL_MUTATION_POINTER],
            minimum_skills=1,
            maximum_skills=1,
        ),
        execution=ExecutionSpec(
            order=VariantSchedule.PARALLEL,
            max_concurrent=CAMPAIGN_MAX_CONCURRENT,
            timeout_seconds=CAMPAIGN_TIMEOUT_SECONDS,
            retry_limit=CAMPAIGN_RETRY_LIMIT,
        ),
        scoring=ScoringSpec(
            primary_reward=PRIMARY_REWARD,
            aggregation="mean",
            require_candidate_above_baseline=True,
            minimum_absolute_delta=0.0,
        ),
        evidence=EvidenceRequirementsV2(runtime_evidence="not_required"),
        budgets=BudgetSpec(
            maximum_input_tokens=CAMPAIGN_MAXIMUM_INPUT_TOKENS,
            maximum_output_tokens=CAMPAIGN_MAXIMUM_OUTPUT_TOKENS,
            maximum_model_calls=CAMPAIGN_MAXIMUM_MODEL_CALLS,
            maximum_usd=CAMPAIGN_BUDGET_USD,
        ),
        data_policy_digest=data_policy_digest,
        execution_plan_digest=execution_plan_digest,
    )


def climb(campaign_digest: Digest) -> ClimbManifest:
    """The public wrapper, with no schedule: a development Climb is open while the build exists."""
    return ClimbManifest(
        schema_version="techtree.climb.v1alpha1",
        kind="Climb",
        metadata=ClimbMetadata(
            id=derived_id("climb", f"{CLIMB_SLUG}@{CLIMB_VERSION}"),
            slug=CLIMB_SLUG,
            version=CLIMB_VERSION,
            title="Techtree Hello World",
            summary=(
                "A toy Skill-uplift Climb. It runs the synthetic BranchCode v1 task family "
                "twice — once without a Skill, once with one — so you can see what writing a "
                "procedure down changes. This is an introductory demonstration of the "
                "mechanism, not a measure of broad capability."
            ),
            status="development",
            opens_at=None,
            closes_at=None,
        ),
        campaign_spec_digest=campaign_digest,
        candidate_policy=CandidatePolicy(
            required_mutation="skill_insertion",
            skill_visibility="public",
            constraints=CandidateConstraints(
                min_skills=1, max_skills=1, format="techtree-instruction-skill-v1"
            ),
        ),
        publication=PublicationPolicy(
            report_visibility="public",
            raw_episode_visibility="prohibited",
            public_trace_projection="redacted",
            proof_grade="development_only",
        ),
        leaderboard=LeaderboardPolicy(enabled=False, evidence_required="not_required"),
    )


def write_catalog(
    destination: Path, climb_manifest: ClimbManifest, objects: dict[ObjectKind, BaseModel]
) -> None:
    """Write each object as the canonical bytes its digest covers, then the readable index."""
    paths: dict[ObjectKind, str] = {
        "campaign": "campaigns",
        "data_policy": "data-policies",
        "execution_plan": "execution-plans",
        "taskset_validation": "taskset-validations",
        "validation_evidence": "validation-evidence",
    }
    written = {CLIMB_PATH: climb_manifest} | {
        f"{paths[kind]}/{CLIMB_SLUG}.json": model for kind, model in objects.items()
    }
    for relative, model in written.items():
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(canonical_json_bytes(model))
    index = CatalogIndexV2(
        schema_version="techtree.catalog.v2",
        climbs=[
            CatalogClimbEntry(
                reference=f"{CLIMB_SLUG}@{CLIMB_VERSION}",
                digest=digest_object(climb_manifest),
                path=CLIMB_PATH,
            )
        ],
        objects={
            digest_object(model): CatalogObjectLocationV2(
                kind=kind,
                path=f"{paths[kind]}/{CLIMB_SLUG}.json",
                media_type="application/json",
            )
            for kind, model in objects.items()
        },
    )
    document = json.loads(canonical_json_bytes(index))
    rendered = json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False)
    (destination / INDEX_FILENAME).write_text(f"{rendered}\n", encoding="utf-8")


def main() -> None:
    """Regenerate the catalog and print what the Campaign's receipt says."""
    with tempfile.TemporaryDirectory(prefix="techtree-fixture-catalog-") as directory:
        validation = publish_validation(Path(directory))
    policy = data_policy()
    plan = execution_plan()
    campaign_spec = campaign(
        validation.lock,
        digest_object(validation.receipt),
        digest_object(policy),
        digest_object(plan),
    )
    write_catalog(
        CATALOG_ROOT,
        climb(digest_object(campaign_spec)),
        {
            "campaign": campaign_spec,
            "data_policy": policy,
            "execution_plan": plan,
            "taskset_validation": validation.receipt,
            "validation_evidence": validation.evidence,
        },
    )
    sys.stdout.write(
        f"{CLIMB_SLUG}@{CLIMB_VERSION}: {TASK_COUNT} tasks, validation "
        f"{validation.receipt.status}, receipt {digest_object(validation.receipt)}, "
        f"catalog {document_digest((CATALOG_ROOT / INDEX_FILENAME).read_bytes())}\n"
    )


if __name__ == "__main__":
    main()
