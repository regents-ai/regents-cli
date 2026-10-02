"""Regenerate the packaged catalog: every Climb this build ships and every object under each.

For each Climb, the pipeline installs that Climb's packaged engine into a throwaway home, locks
its taskset, validates it for real, and builds the DataPolicy, execution plan, Campaign and Climb
around the digests that produced. Identifiers derive from fixed labels, so every byte is a
function of the definitions below and the engine bundles.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal

from package_tasksmith import HELD_OUT_TASKS, TRAINING_TASKS
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
    CampaignImageRuntime,
    CampaignMetadata,
    CampaignSpecV3,
    CampaignTaskset,
    EnvironmentSpec,
    EvidenceRequirementsV2,
    ExecutionSpec,
    HarnessSpecV2,
    ModelSpec,
    MutationContract,
    MutationKind,
    PackageRef,
    PinnedImage,
    RuntimeSpec,
    SamplingSpec,
    ScoringSpec,
    TaskImageRuntime,
    TaskImages,
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
from regents_cli.techtree.verifiers.config import TaskImagesToml

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
#: Written by build_tasksmith_images.py from the published images.
TASKSMITH_PINS: Final = ROOT / "scripts/techtree/tasksmith-image/pins.json"


@dataclass(frozen=True)
class CampaignImage:
    """The one image every task of a Campaign runs in, and its manifest digest per platform."""

    image: str
    platform_digests: dict[str, str]


@dataclass(frozen=True)
class TaskImageSet:
    """Tasks that each run in their own agent image and are graded in their own grader image.

    The pins come from the pins file `build_tasksmith_images.py` writes; the engine loads the
    tasks named there in sorted order, which is the order the Campaign commits to.
    """

    task_ids: tuple[str, ...]


@dataclass(frozen=True)
class CampaignDefinition:
    """Everything that differs between two Campaigns this build ships."""

    #: Where the Campaign's own objects live in the catalog, and the fixed label its identifier
    #: derives from; nothing shows either.
    slug: str
    label: str
    version: int
    #: The packaged engine, and the taskset package in it; the package name is also its
    #: Verifiers taskset id.
    engine: str
    package: str
    task_count: int
    primary_reward: str
    images: CampaignImage | TaskImageSet
    cpu: float
    memory_gb: float
    subject_max_output_tokens: int
    #: A ceiling on what the provider reports, never a price.
    budget_usd: float
    maximum_input_tokens: int
    maximum_output_tokens: int
    maximum_model_calls: int
    timeout_seconds: int
    #: Tasks that need a container but share one image are validated in that subject image
    #: rather than in the engine; tasks with their own images are always validated in them.
    validate_in_subject_image: bool

    def path(self, directory: str) -> str:
        """Where this Campaign's object of one kind lives in the catalog."""
        return f"{directory}/{self.slug}.json"


@dataclass(frozen=True)
class ClimbDefinition:
    """Everything that differs between two Climbs this build ships."""

    slug: str
    version: int
    title: str
    summary: str
    data_policy_label: str
    campaign: CampaignDefinition
    #: Run once, on the winning Skill against no Skill; it never decides the winner.
    held_out: CampaignDefinition | None

    @property
    def reference(self) -> str:
        return f"{self.slug}@{self.version}"

    def path(self, directory: str) -> str:
        """Where this Climb's object of one kind lives in the catalog."""
        return f"{directory}/{self.slug}.json"


HELLO_WORLD: Final = ClimbDefinition(
    slug="hello-world-climb",
    version=2,
    title="Techtree Hello World",
    summary=(
        "A toy Skill-uplift Climb. It runs the synthetic BranchCode v1 task family "
        "twice — once without a Skill, once with one — so you can see what writing a "
        "procedure down changes. This is an introductory demonstration of the "
        "mechanism, not a measure of broad capability."
    ),
    data_policy_label="hello-world-policy@1",
    campaign=CampaignDefinition(
        slug="hello-world-climb",
        label="hello-world-campaign@2",
        version=2,
        engine="default",
        package="procedure-transfer-v1",
        task_count=36,
        primary_reward="exact_match",
        images=CampaignImage(
            image=(
                "ghcr.io/regents-ai/techtree-subject"
                "@sha256:76ebb4a9390b80bfd5a6584d4229512fea1c858d4a0b73153a25cf1495cca155"
            ),
            platform_digests={
                "linux/amd64": (
                    "sha256:0ee8a49c691251f31533972d6bb15079208c74089b231c4d9d7a215f2efb1fc5"
                ),
                "linux/arm64": (
                    "sha256:a41b2e5c0675a0d0706cc8ae41bc3e2c974d8d693d450c604a73cbfbf69c3320"
                ),
            },
        ),
        cpu=2.0,
        memory_gb=4.0,
        subject_max_output_tokens=16000,
        # The enforced token limits below can amount to $6.28.
        budget_usd=6.50,
        maximum_input_tokens=500000,
        maximum_output_tokens=32000,
        maximum_model_calls=44,
        timeout_seconds=1200,
        validate_in_subject_image=False,
    ),
    held_out=None,
)

FRONTIER_CS: Final = ClimbDefinition(
    slug="frontier-cs-open-ended-climb",
    version=2,
    title="Frontier-CS Open-Ended",
    summary=(
        "Ten open-ended optimisation problems from Frontier-CS, created with FrontierSmith, "
        "where no perfect answer is known. The subject writes one C++ program per problem, "
        "and the problem's own checker scores it from 0 to 1 on hidden tests. Every problem "
        "runs twice — once without a Skill, once with one — to show what a written approach "
        "changes. Not a measure of broad capability."
    ),
    data_policy_label="frontier-cs-open-ended-policy@1",
    campaign=CampaignDefinition(
        slug="frontier-cs-open-ended-climb",
        label="frontier-cs-open-ended-campaign@2",
        version=2,
        engine="frontier-cs",
        package="frontier-cs-open-ended-v1",
        task_count=10,
        primary_reward="case_score_mean",
        # Hello World's image with g++ added (scripts/techtree/subject-image-cpp).
        images=CampaignImage(
            image=(
                "ghcr.io/regents-ai/techtree-subject"
                "@sha256:27d04c85a88cb52eae8f6f9ed379769ed9ed3b8d7b12d9e1b33b12f5ac95dab8"
            ),
            platform_digests={
                "linux/amd64": (
                    "sha256:38a69ff50f77768339b929ad9c47238bef72dacd5985e7d64ee094a7b6c6fe10"
                ),
                "linux/arm64": (
                    "sha256:fa56b14ceeebe858a6a39e591fb810766f41004019bfa6b0a5ff6548805e21ae"
                ),
            },
        ),
        cpu=2.0,
        memory_gb=4.0,
        subject_max_output_tokens=32000,
        # The enforced token limits below can amount to $2.35.
        budget_usd=2.50,
        maximum_input_tokens=400000,
        maximum_output_tokens=96000,
        maximum_model_calls=60,
        timeout_seconds=3600,
        validate_in_subject_image=True,
    ),
    held_out=None,
)


def tasksmith_campaign(slug: str, label: str, task_ids: tuple[str, ...]) -> CampaignDefinition:
    """One of the Tasksmith Climb's two Campaigns: the same terms over different tasks.

    Each task's agent box gets the cores and memory its own task.toml gives the agent.
    """
    return CampaignDefinition(
        slug=slug,
        label=label,
        version=1,
        engine="tasksmith",
        package="hf-tasksmith-v1",
        task_count=len(task_ids),
        primary_reward="solved",
        images=TaskImageSet(task_ids=task_ids),
        cpu=1.0,
        memory_gb=2.0,
        subject_max_output_tokens=32000,
        budget_usd=20.00,
        maximum_input_tokens=2000000,
        maximum_output_tokens=96000,
        maximum_model_calls=80,
        timeout_seconds=1800,
        validate_in_subject_image=False,
    )


TASKSMITH: Final = ClimbDefinition(
    slug="tasksmith-climb",
    version=1,
    title="HF Tasksmith",
    summary=(
        "Six real changes from Hugging Face's trl, transformers, diffusers, peft and "
        "accelerate repositories, taken back out of the code. The subject makes each change "
        "again in the repository, and the change's own tests, run in a separate box, score it "
        "0 or 1. Every task runs twice — once without a Skill, once with one. Six more tasks "
        "are kept apart: they are run once, on the winning Skill, and never decide the winner. "
        "Not a measure of broad capability."
    ),
    data_policy_label="tasksmith-policy@1",
    campaign=tasksmith_campaign("tasksmith-climb", "tasksmith-campaign@1", TRAINING_TASKS),
    held_out=tasksmith_campaign(
        "tasksmith-held-out", "tasksmith-held-out-campaign@1", HELD_OUT_TASKS
    ),
)

#: In catalog order; the first is the introductory Climb.
CLIMBS: Final = (HELLO_WORLD, FRONTIER_CS, TASKSMITH)

type ObjectKind = Literal[
    "campaign", "data_policy", "execution_plan", "taskset_validation", "validation_evidence"
]


def derived_id(prefix: str, label: str) -> str:
    """The identifier one fixed label always produces."""
    return f"{prefix}_{hashlib.sha256(label.encode('utf-8')).hexdigest()[:32]}"


type TaskPins = dict[str, dict[str, PinnedImage]]


def read_task_pins(path: Path) -> TaskPins:
    """The pins file: task id to its `agent` and `grader` images."""
    document = json.loads(path.read_text(encoding="utf-8"))
    return {
        task_id: {seat: PinnedImage.model_validate(image) for seat, image in images.items()}
        for task_id, images in document.items()
    }


def taskset_ref(definition: CampaignDefinition) -> TasksetRef:
    """The Campaign's taskset, read from its packaged engine's own descriptor."""
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


def task_selection(definition: CampaignDefinition) -> TaskSelection:
    """The selection the Campaign commits to, never shuffled."""
    return TaskSelection(num_tasks=definition.task_count, num_rollouts=1, shuffle=False)


def engine_digest(definition: CampaignDefinition) -> Digest:
    """The digest of the engine bundle the Campaign runs."""
    return engine_bundle_digest(embedded_engine_root(definition.engine))


def engine_images(
    definition: CampaignDefinition, pins: TaskPins
) -> dict[str, TaskImagesToml] | None:
    """The images the engine loads each task with, when the tasks pin their own."""
    if isinstance(definition.images, CampaignImage):
        return None
    return {
        task_id: TaskImagesToml(
            agent=pins[task_id]["agent"].image, grader=pins[task_id]["grader"].image
        )
        for task_id in definition.images.task_ids
    }


def publish_validation(
    build_root: Path, definition: CampaignDefinition, pins: TaskPins
) -> TasksetValidation:
    """Install the Campaign's engine in a throwaway home, lock its taskset and validate it."""
    paths = TechtreePaths(root=build_root / "home")
    registry = EngineRegistry(paths)
    engine = EngineInstaller(paths, registry, find_uv()).install(engine_digest(definition))
    images = engine_images(definition, pins)
    lock = lock_taskset(
        registry, engine.digest, taskset_ref(definition), task_selection(definition), images=images
    )
    subject_image = (
        definition.images.image
        if isinstance(definition.images, CampaignImage) and definition.validate_in_subject_image
        else None
    )
    return validate_taskset(
        registry,
        engine.digest,
        lock,
        build_root / definition.slug,
        runtime="subprocess"
        if isinstance(definition.images, CampaignImage) and subject_image is None
        else "docker",
        docker_image=subject_image,
        images=images,
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


def execution_plan(definition: CampaignDefinition) -> ResolvedExecutionPlan:
    """The plan the Campaign binds, naming its packaged engine by content."""
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


def runtime(definition: CampaignDefinition, pins: TaskPins) -> RuntimeSpec:
    """Where the subject runs: one image for every task, or each task's own two."""
    if isinstance(definition.images, CampaignImage):
        return CampaignImageRuntime(
            type="docker",
            image_source="campaign",
            image=definition.images.image,
            supported_platforms=sorted(definition.images.platform_digests),
            image_platform_digests=dict(definition.images.platform_digests),
            cpu=definition.cpu,
            memory_gb=definition.memory_gb,
            network_policy="restricted",
        )
    platforms = {
        frozenset(pins[task_id][seat].platform_digests)
        for task_id in definition.images.task_ids
        for seat in ("agent", "grader")
    }
    if len(platforms) != 1:
        raise SystemExit(f"{definition.slug}'s images are not all built for the same platforms")
    return TaskImageRuntime(
        type="docker",
        image_source="task",
        supported_platforms=sorted(next(iter(platforms))),
        cpu=definition.cpu,
        memory_gb=definition.memory_gb,
        network_policy="restricted",
    )


def task_images(
    definition: CampaignDefinition, lock: TasksetLock, pins: TaskPins
) -> list[TaskImages] | None:
    """Each task's pins, in membership order: the engine loads the tasks sorted by id."""
    if isinstance(definition.images, CampaignImage):
        return None
    task_ids = sorted(definition.images.task_ids)
    if len(task_ids) != len(lock.ordered_task_hashes):
        raise SystemExit(f"{definition.slug} locked a different number of tasks than it names")
    return [
        TaskImages(
            task_hash=task_hash,
            task_id=task_id,
            agent=pins[task_id]["agent"],
            grader=pins[task_id]["grader"],
        )
        for task_id, task_hash in zip(task_ids, lock.ordered_task_hashes, strict=True)
    ]


def campaign(
    definition: CampaignDefinition,
    pins: TaskPins,
    lock: TasksetLock,
    receipt_digest: Digest,
    data_policy_digest: Digest,
    execution_plan_digest: Digest,
) -> CampaignSpecV3:
    """The scientific contract the Climb invites participants to run."""
    return CampaignSpecV3(
        schema_version="techtree.campaign.v3",
        kind="Campaign",
        metadata=CampaignMetadata(
            id=derived_id("campaign", definition.label),
            version=definition.version,
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
            task_images=task_images(definition, lock, pins),
        ),
        environment=EnvironmentSpec(
            id="single-agent"
            if isinstance(definition.images, CampaignImage)
            else "harbor-separate-grader"
        ),
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
                runtime=runtime(definition, pins),
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


def climb(
    definition: ClimbDefinition, campaign_digest: Digest, held_out_digest: Digest | None
) -> ClimbManifest:
    """The public wrapper, with no schedule: the Climb is open while the build exists."""
    return ClimbManifest(
        schema_version="techtree.climb.v1alpha2",
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
        held_out_campaign_spec_digest=held_out_digest,
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


#: Objects every Campaign of a Climb shares, written once at the Climb's path.
CLIMB_OBJECTS: Final[frozenset[ObjectKind]] = frozenset({"data_policy", "execution_plan"})


@dataclass(frozen=True)
class BuiltCampaign:
    """One Campaign and the objects under it."""

    definition: CampaignDefinition
    objects: dict[ObjectKind, BaseModel]


@dataclass(frozen=True)
class BuiltClimb:
    """One Climb's manifest and its Campaigns."""

    definition: ClimbDefinition
    manifest: ClimbManifest
    campaigns: list[BuiltCampaign]

    def locations(self) -> list[tuple[ObjectKind, str, BaseModel]]:
        """Every object under the Climb with the catalog path it is written to."""
        return [
            (
                kind,
                (self.definition if kind in CLIMB_OBJECTS else built.definition).path(
                    OBJECT_DIRECTORIES[kind]
                ),
                model,
            )
            for built in self.campaigns
            for kind, model in built.objects.items()
        ]


def build_campaign(
    build_root: Path, definition: CampaignDefinition, pins: TaskPins, policy: DataPolicy
) -> BuiltCampaign:
    """Validate one Campaign's taskset and build every object around what that produced."""
    validation = publish_validation(build_root, definition, pins)
    plan = execution_plan(definition)
    campaign_spec = campaign(
        definition,
        pins,
        validation.lock,
        digest_object(validation.receipt),
        digest_object(policy),
        digest_object(plan),
    )
    return BuiltCampaign(
        definition=definition,
        objects={
            "campaign": campaign_spec,
            "data_policy": policy,
            "execution_plan": plan,
            "taskset_validation": validation.receipt,
            "validation_evidence": validation.evidence,
        },
    )


def build_climb(build_root: Path, definition: ClimbDefinition, pins: TaskPins) -> BuiltClimb:
    """Build the Climb's Campaigns, then the Climb around their digests."""
    policy = data_policy(definition)
    main = build_campaign(build_root, definition.campaign, pins, policy)
    held_out = (
        None
        if definition.held_out is None
        else build_campaign(build_root, definition.held_out, pins, policy)
    )
    return BuiltClimb(
        definition=definition,
        manifest=climb(
            definition,
            digest_object(main.objects["campaign"]),
            None if held_out is None else digest_object(held_out.objects["campaign"]),
        ),
        campaigns=[main] if held_out is None else [main, held_out],
    )


def write_catalog(destination: Path, climbs: list[BuiltClimb]) -> None:
    """Write each object as the canonical bytes its digest covers, then the readable index."""
    for built in climbs:
        written = {built.definition.path("climbs"): built.manifest} | {
            path: model for _, path, model in built.locations()
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
                kind=kind, path=path, media_type="application/json"
            )
            for built in climbs
            for kind, path, model in built.locations()
        },
    )
    document = json.loads(canonical_json_bytes(index))
    rendered = json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False)
    (destination / INDEX_FILENAME).write_text(f"{rendered}\n", encoding="utf-8")


def main() -> None:
    """Regenerate the catalog and print what each Campaign's receipt says."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tasksmith-pins", type=Path, default=TASKSMITH_PINS)
    pins = read_task_pins(parser.parse_args().tasksmith_pins)
    with tempfile.TemporaryDirectory(prefix="techtree-fixture-catalog-") as directory:
        climbs = [build_climb(Path(directory), definition, pins) for definition in CLIMBS]
    write_catalog(CATALOG_ROOT, climbs)
    for built in climbs:
        for campaign_built in built.campaigns:
            receipt = campaign_built.objects["taskset_validation"]
            assert isinstance(receipt, TasksetValidationReceipt)
            sys.stdout.write(
                f"{built.definition.reference} {campaign_built.definition.slug}: "
                f"{campaign_built.definition.task_count} tasks, validation {receipt.status}, "
                f"receipt {digest_object(receipt)}\n"
            )
    catalog = document_digest((CATALOG_ROOT / INDEX_FILENAME).read_bytes())
    sys.stdout.write(f"catalog {catalog}\n")


if __name__ == "__main__":
    main()
