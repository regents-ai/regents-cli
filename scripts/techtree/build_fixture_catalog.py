"""Regenerate the packaged catalog: every Climb this build ships and every object under each.

For each Climb, the pipeline installs that Climb's packaged engine into a throwaway home, locks
its taskset, validates it for real, and builds the DataPolicy, execution plan, Campaign and Climb
around the digests that produced. Identifiers derive from fixed labels, so every byte is a
function of the definitions below and the engine bundles.
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal

from pydantic import BaseModel
from tasksets import TasksetValidation, lock_taskset, validate_taskset

from regents_cli.techtree.canonical import canonical_json_bytes, digest_object
from regents_cli.techtree.engines.bundle import (
    embedded_engine_root,
    engine_bundle_digest,
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
from regents_cli.techtree.models.validation import TasksetLock, TasksetValidationReceipt
from regents_cli.techtree.paths import TechtreePaths
from regents_cli.techtree.release.document import document_digest

ROOT: Final = Path(__file__).resolve().parents[2]
CATALOG_ROOT: Final = ROOT / "src/regents_cli/techtree/resources/catalog"

#: The pinned Hermes release the subject runs, named by its tag; v2026.9.24 is Hermes 0.21.5.
#: Both subject images already hold it, so no episode downloads it
#: (scripts/techtree/subject-image).
HARNESS_ID: Final = "hermes-agent"
HARNESS_VERSION: Final = "v2026.9.24"

SUBJECT_MODEL_PROVIDER: Final = "prime"
SUBJECT_MODEL_ID: Final = "openai/gpt-6-luna"
SUBJECT_CREDENTIAL_ENV: Final = "PRIME_API_KEY"
#: GPT-6 Luna takes a reasoning effort and has no temperature setting, so none is sent.
SUBJECT_TEMPERATURE: Final = None
SUBJECT_REASONING_EFFORT: Final = "high"

CAMPAIGN_MAX_CONCURRENT: Final = 4
CAMPAIGN_RETRY_LIMIT: Final = 0

INDEX_FILENAME: Final = "catalog.json"


@dataclass(frozen=True)
class ClimbDefinition:
    """Everything that differs between two Climbs this build ships."""

    slug: str
    version: int
    title: str
    summary: str
    #: Fixed labels the Campaign and DataPolicy identifiers derive from; nothing shows them.
    campaign_label: str
    data_policy_label: str
    #: The packaged engine, and the taskset package in it; the package name is also its
    #: Verifiers taskset id.
    engine: str
    package: str
    task_count: int
    primary_reward: str
    subject_image: str
    subject_image_platform_digests: dict[str, str]
    subject_max_output_tokens: int
    #: A ceiling, never a price: `verifiers/budget.py` bounds what the token limits can cost.
    budget_usd: float
    maximum_input_tokens: int
    maximum_output_tokens: int
    maximum_model_calls: int
    timeout_seconds: int
    #: Tasks that need a container are validated in the subject image rather than in the engine.
    validate_in_subject_image: bool

    @property
    def reference(self) -> str:
        return f"{self.slug}@{self.version}"

    def path(self, directory: str) -> str:
        """Where this Climb's object of one kind lives in the catalog."""
        return f"{directory}/{self.slug}.json"


HELLO_WORLD: Final = ClimbDefinition(
    slug="hello-world-climb",
    version=1,
    title="Techtree Hello World",
    summary=(
        "A toy Skill-uplift Climb. It runs the synthetic BranchCode v1 task family "
        "twice — once without a Skill, once with one — so you can see what writing a "
        "procedure down changes. This is an introductory demonstration of the "
        "mechanism, not a measure of broad capability."
    ),
    campaign_label="hello-world-campaign@1",
    data_policy_label="hello-world-policy@1",
    engine="default",
    package="procedure-transfer-v1",
    task_count=36,
    primary_reward="exact_match",
    subject_image=(
        "ghcr.io/regents-ai/techtree-subject"
        "@sha256:76ebb4a9390b80bfd5a6584d4229512fea1c858d4a0b73153a25cf1495cca155"
    ),
    subject_image_platform_digests={
        "linux/amd64": "sha256:0ee8a49c691251f31533972d6bb15079208c74089b231c4d9d7a215f2efb1fc5",
        "linux/arm64": "sha256:a41b2e5c0675a0d0706cc8ae41bc3e2c974d8d693d450c604a73cbfbf69c3320",
    },
    subject_max_output_tokens=16000,
    # The enforced token limits below can amount to $6.28.
    budget_usd=6.50,
    maximum_input_tokens=500000,
    maximum_output_tokens=32000,
    maximum_model_calls=44,
    timeout_seconds=1200,
    validate_in_subject_image=False,
)

FRONTIER_CS: Final = ClimbDefinition(
    slug="frontier-cs-open-ended-climb",
    version=1,
    title="Frontier-CS Open-Ended",
    summary=(
        "Ten open-ended optimisation problems from Frontier-CS, created with FrontierSmith, "
        "where no perfect answer is known. The subject writes one C++ program per problem, "
        "and the problem's own checker scores it from 0 to 1 on hidden tests. Every problem "
        "runs twice — once without a Skill, once with one — to show what a written approach "
        "changes. Not a measure of broad capability."
    ),
    campaign_label="frontier-cs-open-ended-campaign@1",
    data_policy_label="frontier-cs-open-ended-policy@1",
    engine="frontier-cs",
    package="frontier-cs-open-ended-v1",
    task_count=10,
    primary_reward="case_score_mean",
    # Hello World's image with g++ added (scripts/techtree/subject-image-cpp).
    subject_image=(
        "ghcr.io/regents-ai/techtree-subject"
        "@sha256:27d04c85a88cb52eae8f6f9ed379769ed9ed3b8d7b12d9e1b33b12f5ac95dab8"
    ),
    subject_image_platform_digests={
        "linux/amd64": "sha256:38a69ff50f77768339b929ad9c47238bef72dacd5985e7d64ee094a7b6c6fe10",
        "linux/arm64": "sha256:fa56b14ceeebe858a6a39e591fb810766f41004019bfa6b0a5ff6548805e21ae",
    },
    subject_max_output_tokens=32000,
    # The enforced token limits below can amount to $2.35.
    budget_usd=2.50,
    maximum_input_tokens=400000,
    maximum_output_tokens=96000,
    maximum_model_calls=60,
    timeout_seconds=3600,
    validate_in_subject_image=True,
)

#: In catalog order; the first is the introductory Climb.
CLIMBS: Final = (HELLO_WORLD, FRONTIER_CS)

type ObjectKind = Literal[
    "campaign", "data_policy", "execution_plan", "taskset_validation", "validation_evidence"
]


def derived_id(prefix: str, label: str) -> str:
    """The identifier one fixed label always produces."""
    return f"{prefix}_{hashlib.sha256(label.encode('utf-8')).hexdigest()[:32]}"


def taskset_ref(definition: ClimbDefinition) -> TasksetRef:
    """The Climb's taskset, read from its packaged engine's own descriptor."""
    package = next(
        entry
        for entry in read_engine_descriptor(embedded_engine_root(definition.engine)).packages
        if entry.name == definition.package
    )
    return TasksetRef(
        kind="verifiers",
        id=definition.package,
        package=PackageRef(
            kind="embedded",
            name=definition.package,
            revision=package.version,
            digest=package.source_digest,
        ),
        config={},
    )


def task_selection(definition: ClimbDefinition) -> TaskSelection:
    """The selection the Campaign commits to, never shuffled."""
    return TaskSelection(num_tasks=definition.task_count, num_rollouts=1, shuffle=False)


def engine_digest(definition: ClimbDefinition) -> Digest:
    """The digest of the engine bundle the Climb runs."""
    return engine_bundle_digest(embedded_engine_root(definition.engine))


def publish_validation(build_root: Path, definition: ClimbDefinition) -> TasksetValidation:
    """Install the Climb's engine in a throwaway home, lock its taskset and validate it."""
    paths = TechtreePaths(root=build_root / "home")
    registry = EngineRegistry(paths)
    engine = EngineInstaller(paths, registry, find_uv()).install(engine_digest(definition))
    lock = lock_taskset(
        registry, engine.digest, taskset_ref(definition), task_selection(definition)
    )
    return validate_taskset(
        registry,
        engine.digest,
        lock,
        build_root / definition.slug,
        docker_image=definition.subject_image if definition.validate_in_subject_image else None,
    )


def data_policy(definition: ClimbDefinition) -> DataPolicy:
    """The development rights policy."""
    return DataPolicy(
        schema_version="techtree.data-policy.v1alpha1",
        id=derived_id("policy", definition.data_policy_label),
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


def execution_plan(definition: ClimbDefinition) -> ResolvedExecutionPlan:
    """The plan the Campaign binds, naming the Climb's packaged engine by content."""
    descriptor = read_engine_descriptor(embedded_engine_root(definition.engine))
    return ResolvedExecutionPlan(
        schema_version="techtree.execution-plan.v1",
        kind="ResolvedExecutionPlan",
        evaluation=EvaluationEngineRef(
            kind="verifiers",
            api_generation="v1",
            package_version=descriptor.verifiers_version,
            source_commit=descriptor.verifiers_revision,
            engine_digest=engine_digest(definition),
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
    definition: ClimbDefinition,
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
            id=derived_id("campaign", definition.campaign_label),
            version=1,
            purpose="component_uplift",
        ),
        context=CampaignContext(program_ref=None, outcome_contract_digest=None),
        taskset=CampaignTaskset(
            ref=lock.taskset_ref,
            selection=task_selection(definition),
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
                sampling=SamplingSpec(
                    temperature=SUBJECT_TEMPERATURE,
                    max_tokens=definition.subject_max_output_tokens,
                    reasoning_effort=SUBJECT_REASONING_EFFORT,
                ),
                harness=HarnessSpecV2(use_bundled_skill=False, skills=[]),
                runtime=RuntimeSpec(
                    type="docker",
                    image=definition.subject_image,
                    supported_platforms=sorted(definition.subject_image_platform_digests),
                    image_platform_digests=dict(definition.subject_image_platform_digests),
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
            timeout_seconds=definition.timeout_seconds,
            retry_limit=CAMPAIGN_RETRY_LIMIT,
        ),
        scoring=ScoringSpec(
            primary_reward=definition.primary_reward,
            aggregation="mean",
            require_candidate_above_baseline=True,
            minimum_absolute_delta=0.0,
        ),
        evidence=EvidenceRequirementsV2(runtime_evidence="not_required"),
        budgets=BudgetSpec(
            maximum_input_tokens=definition.maximum_input_tokens,
            maximum_output_tokens=definition.maximum_output_tokens,
            maximum_model_calls=definition.maximum_model_calls,
            maximum_usd=definition.budget_usd,
        ),
        data_policy_digest=data_policy_digest,
        execution_plan_digest=execution_plan_digest,
    )


def climb(definition: ClimbDefinition, campaign_digest: Digest) -> ClimbManifest:
    """The public wrapper, with no schedule: the Climb is open while the build exists."""
    return ClimbManifest(
        schema_version="techtree.climb.v1alpha1",
        kind="Climb",
        metadata=ClimbMetadata(
            id=derived_id("climb", definition.reference),
            slug=definition.slug,
            version=definition.version,
            title=definition.title,
            summary=definition.summary,
            status="open",
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
            proof_grade="P1",
        ),
        leaderboard=LeaderboardPolicy(enabled=False, evidence_required="not_required"),
    )


#: The catalog directory each kind of object is written under.
OBJECT_DIRECTORIES: Final[dict[ObjectKind, str]] = {
    "campaign": "campaigns",
    "data_policy": "data-policies",
    "execution_plan": "execution-plans",
    "taskset_validation": "taskset-validations",
    "validation_evidence": "validation-evidence",
}


@dataclass(frozen=True)
class BuiltClimb:
    """One Climb's manifest and the objects under it."""

    definition: ClimbDefinition
    manifest: ClimbManifest
    objects: dict[ObjectKind, BaseModel]


def build_climb(build_root: Path, definition: ClimbDefinition) -> BuiltClimb:
    """Validate one Climb's taskset and build every object around what that produced."""
    validation = publish_validation(build_root, definition)
    policy = data_policy(definition)
    plan = execution_plan(definition)
    campaign_spec = campaign(
        definition,
        validation.lock,
        digest_object(validation.receipt),
        digest_object(policy),
        digest_object(plan),
    )
    return BuiltClimb(
        definition=definition,
        manifest=climb(definition, digest_object(campaign_spec)),
        objects={
            "campaign": campaign_spec,
            "data_policy": policy,
            "execution_plan": plan,
            "taskset_validation": validation.receipt,
            "validation_evidence": validation.evidence,
        },
    )


def write_catalog(destination: Path, climbs: list[BuiltClimb]) -> None:
    """Write each object as the canonical bytes its digest covers, then the readable index."""
    for built in climbs:
        written = {built.definition.path("climbs"): built.manifest} | {
            built.definition.path(OBJECT_DIRECTORIES[kind]): model
            for kind, model in built.objects.items()
        }
        for relative, model in written.items():
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(canonical_json_bytes(model))
    index = CatalogIndexV2(
        schema_version="techtree.catalog.v2",
        climbs=[
            CatalogClimbEntry(
                reference=built.definition.reference,
                digest=digest_object(built.manifest),
                path=built.definition.path("climbs"),
            )
            for built in climbs
        ],
        objects={
            digest_object(model): CatalogObjectLocationV2(
                kind=kind,
                path=built.definition.path(OBJECT_DIRECTORIES[kind]),
                media_type="application/json",
            )
            for built in climbs
            for kind, model in built.objects.items()
        },
    )
    document = json.loads(canonical_json_bytes(index))
    rendered = json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False)
    (destination / INDEX_FILENAME).write_text(f"{rendered}\n", encoding="utf-8")


def main() -> None:
    """Regenerate the catalog and print what each Campaign's receipt says."""
    with tempfile.TemporaryDirectory(prefix="techtree-fixture-catalog-") as directory:
        climbs = [build_climb(Path(directory), definition) for definition in CLIMBS]
    write_catalog(CATALOG_ROOT, climbs)
    for built in climbs:
        receipt = built.objects["taskset_validation"]
        assert isinstance(receipt, TasksetValidationReceipt)
        sys.stdout.write(
            f"{built.definition.reference}: {built.definition.task_count} tasks, validation "
            f"{receipt.status}, receipt {digest_object(receipt)}\n"
        )
    catalog = document_digest((CATALOG_ROOT / INDEX_FILENAME).read_bytes())
    sys.stdout.write(f"catalog {catalog}\n")


if __name__ == "__main__":
    main()
