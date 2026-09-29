"""Regenerate the golden documents in tests/techtree/fixtures/golden.

The goldens are one consistent fixture graph: every digest one document names is the digest of
another golden, computed here. Values produced outside this graph (engine bundles, skill
archives, images, tasks) stand in as digests of fixed labels, and one instant stands in for
every clock reading, so a regeneration reproduces every byte. The engine plane names the
Verifiers build the packaged engine pins.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Final

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pydantic import BaseModel

from regents_cli.techtree.canonical import (
    digest_object,
    sha256_digest_bytes,
    to_json_value,
)
from regents_cli.techtree.constants import (
    EPISODE_RECEIPT_V2_SCHEMA_VERSION,
    EXPERIMENT_V2_SCHEMA_VERSION,
    RUN_REQUEST_V2_SCHEMA_VERSION,
    TASKSET_LOCK_SCHEMA_VERSION,
    UPLIFT_V2_SCHEMA_VERSION,
)
from regents_cli.techtree.crypto import (
    load_private_key,
    public_key_bytes,
    public_key_to_base64,
    sign_digest,
)
from regents_cli.techtree.engines.bundle import embedded_engine_root, read_engine_descriptor
from regents_cli.techtree.execution_facts import (
    bound_execution_plan_digest,
    climb_summary_execution_facts,
    compatibility_result_execution_facts,
    episode_receipt_execution_facts,
    run_request_execution_facts,
    uplift_report_execution_facts,
)
from regents_cli.techtree.identity.models import ExecutorIdentity
from regents_cli.techtree.models.base import ArtifactRef, Digest, JsonValue, ObjectEnvelope
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
    PublicContext,
    RuntimeSpec,
    SamplingSpec,
    ScoringSpec,
    TaskMembershipCommitment,
    TaskSelection,
    TasksetRef,
    VariantSchedule,
)
from regents_cli.techtree.models.catalog import (
    ClimbSummaryV2,
    CompatibilityIssue,
    CompatibilityResultV2,
    DataPolicySummary,
    EngineCompatibilityStatus,
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
from regents_cli.techtree.models.episode_receipt import (
    EpisodeReceiptV2,
    EvidenceStatus,
    NamedTraceReceipt,
    ScoreStatus,
    SubjectRuntimeReceipt,
)
from regents_cli.techtree.models.execution_plan import (
    EvaluationEngineRef,
    EvidenceBackendSpec,
    ExecutionBackendSpec,
    ResolvedExecutionPlan,
    SubjectBackendSpec,
)
from regents_cli.techtree.models.experiment import (
    ExperimentConfigurationV2,
    ExperimentManifestV2,
    ExperimentVariant,
    JsonDifference,
    ManifestComparison,
)
from regents_cli.techtree.models.run import PolicyAcknowledgement, RunRequestV2
from regents_cli.techtree.models.uplift_report import (
    ComparisonStatus,
    ExecutionStatus,
    PublicationStatus,
    TaskDelta,
    UpliftDecision,
    UpliftReportV2,
    UpliftStatuses,
)
from regents_cli.techtree.models.validation import (
    TasksetLock,
    TasksetValidationReceipt,
    UpstreamValidationSummary,
    ValidationCheck,
    ValidationMethod,
)
from regents_cli.techtree.receipts.execution import (
    COMPARISON_EXECUTION_SCHEMA_VERSION,
    NO_COST_SOURCE,
    ComparisonExecutionRecord,
    PairOutcome,
    UsageProvenance,
    VariantExecutionSummary,
    VariantUsage,
    unavailable_cost,
)
from regents_cli.techtree.receipts.uplift import aggregate_primary_result, publication_eligible_for
from regents_cli.techtree.tasksets.membership import membership_digest

GOLDEN: Final = Path(__file__).resolve().parents[2] / "tests/techtree/fixtures/golden"

FIXED_TIME: Final = datetime(2026, 1, 1, tzinfo=UTC)
CLIMB_SLUG: Final = "hello-world-climb"
TASKSET_ID: Final = "procedure-transfer-v1"
TASK_COUNT: Final = 20
SUBJECT_IMAGE: Final = (
    "python@sha256:90744cff8f32887f075c47d747a173ff333e9e98801667af93c357fa9f5e28ff"
)
SUBJECT_IMAGE_PLATFORM_DIGESTS: Final = {
    "linux/amd64": "sha256:78b39ef14d8e2b4d71f8dc304f1328c37df95fe0ef99477c2ae6bd3d03784553",
    "linux/arm64": "sha256:20eadabc42589e6543b24a64ab305b9895e9fcf6dbb2cadb14812f394ecdbadf",
}

#: The version-1 Climb names a Techtree 0.3.0 version-1 Campaign, a document this build has
#: no model for, so its digest is carried as that release computed it.
V1_CAMPAIGN_DIGEST: Final = (
    "sha256:2ffd504ad7478aa0243881a3658044b07ea6c51d4778a2a011acc96bf9f93af1"
)

#: The Fabric-hosted subject plane of the parity pair's second plan. This build's model admits
#: only a direct subject, so the plan is digested as the document 0.3.0 wrote.
PARITY_SUBJECT: Final[dict[str, JsonValue]] = {
    "kind": "fabric",
    "harness_id": "fabric-hermes-agent",
    "harness_version": "0.19.0+fabric.1",
    "adapter_id": "fabric-hermes-adapter",
    "adapter_version": "0.1.0",
    "adapter_contract_version": "1",
}


def fixture_digest(label: str) -> Digest:
    """A fixed digest standing in for a value produced outside the fixture graph."""
    return sha256_digest_bytes(f"techtree-golden/{label}".encode())


def fixture_id(prefix: str, label: str) -> str:
    """A fixed prefixed identifier for a fixture object."""
    return f"{prefix}_{fixture_digest(label).removeprefix('sha256:')[:32]}"


def ordered_task_hashes() -> list[Digest]:
    """The fixture taskset's committed membership."""
    return [fixture_digest(f"task/{position}") for position in range(TASK_COUNT)]


def data_policy() -> DataPolicy:
    """The development rights policy."""
    return DataPolicy(
        schema_version="techtree.data-policy.v1alpha1",
        id=fixture_id("policy", "data-policy"),
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
            future_use_revocable=True, immutable_published_proofs_remain=True
        ),
    )


def taskset_ref() -> TasksetRef:
    """The embedded development taskset."""
    return TasksetRef(
        kind="verifiers",
        id=TASKSET_ID,
        package=PackageRef(
            kind="embedded",
            name=TASKSET_ID,
            revision="1",
            digest=fixture_digest("reference-package"),
        ),
        config={"num_tasks": TASK_COUNT},
    )


def taskset_lock() -> TasksetLock:
    """The publisher lock the fixture Campaign commits to."""
    hashes = ordered_task_hashes()
    return TasksetLock(
        schema_version=TASKSET_LOCK_SCHEMA_VERSION,
        taskset_ref=taskset_ref(),
        engine_digest=fixture_digest("engine-bundle"),
        resolved_package_digest=fixture_digest("reference-package"),
        ordered_task_hashes=hashes,
        membership_digest=membership_digest(hashes),
        task_count=TASK_COUNT,
    )


def validation_receipt(lock_digest: Digest, revision: str) -> TasksetValidationReceipt:
    """The publisher receipt for the fixture taskset."""
    checks = [
        ("upstream_gold", f"{TASK_COUNT} of {TASK_COUNT} gold answers validated"),
        ("upstream_setup", f"{TASK_COUNT} of {TASK_COUNT} task setups validated"),
        ("membership_repeatability", "two inspections produced the same ordered task hashes"),
        ("task_hash_uniqueness", "no task hash appears twice"),
        (
            "committed_membership_match",
            "the recomputed membership digest matches the commitment",
        ),
        ("expected_task_count", f"the taskset yielded the expected {TASK_COUNT} tasks"),
    ]
    return TasksetValidationReceipt(
        schema_version="techtree.taskset-validation.v1alpha1",
        taskset_lock_digest=lock_digest,
        engine_digest=fixture_digest("engine-bundle"),
        method=ValidationMethod(
            kind="verifiers_validate", mode="all", runtime="subprocess", validator_revision=revision
        ),
        status="valid",
        upstream_summary=UpstreamValidationSummary(
            mode="all",
            total=TASK_COUNT,
            recorded=TASK_COUNT,
            valid=TASK_COUNT,
            invalid=0,
            error=0,
            timeout=0,
            missing=0,
            valid_rate=1.0,
        ),
        checks=[ValidationCheck(id=name, status="passed", detail=text) for name, text in checks],
        normalized_evidence=ArtifactRef(
            digest=fixture_digest("validation-evidence"),
            media_type="application/json",
            size=8192,
            relative_path="validation-evidence.json",
        ),
    )


def execution_plan(package_version: str, revision: str) -> ResolvedExecutionPlan:
    """The plan this build resolves: local execution, a direct subject, native evidence."""
    return ResolvedExecutionPlan(
        schema_version="techtree.execution-plan.v1",
        kind="ResolvedExecutionPlan",
        evaluation=EvaluationEngineRef(
            kind="verifiers",
            api_generation="v1",
            package_version=package_version,
            source_commit=revision,
            engine_digest=fixture_digest("engine-bundle"),
        ),
        execution=ExecutionBackendSpec(
            kind="local", provider=None, provider_environment_coordinate=None
        ),
        subject=SubjectBackendSpec(
            kind="direct",
            harness_id="hermes-agent",
            harness_version="0.19.0",
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


def subject_agent(skills: list[ArtifactRef]) -> AgentSpecV2:
    """The frozen development subject."""
    return AgentSpecV2(
        model=ModelSpec(
            provider="development",
            model_id="development-placeholder",
            revision=None,
            credential_env="TECHTREE_MODEL_API_KEY",
        ),
        sampling=SamplingSpec(temperature=0.0, max_tokens=512),
        harness=HarnessSpecV2(use_bundled_skill=False, skills=skills),
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


def campaign(
    data_policy_digest: Digest, receipt_digest: Digest, plan_digest: Digest
) -> CampaignSpecV2:
    """The development Campaign, bound to one plan."""
    hashes = ordered_task_hashes()
    return CampaignSpecV2(
        schema_version="techtree.campaign.v2",
        kind="Campaign",
        metadata=CampaignMetadata(
            id=fixture_id("campaign", "campaign"), version=1, purpose="component_uplift"
        ),
        context=CampaignContext(program_ref=None, outcome_contract_digest=None),
        taskset=CampaignTaskset(
            ref=taskset_ref(),
            selection=TaskSelection(num_tasks=TASK_COUNT, num_rollouts=1, shuffle=False),
            membership=TaskMembershipCommitment(
                mode="committed",
                ordered_task_hashes=hashes,
                membership_digest=membership_digest(hashes),
            ),
            validation_receipt_digest=receipt_digest,
        ),
        environment=EnvironmentSpec(id="single-agent"),
        agents={SUBJECT_AGENT: subject_agent([])},
        mutation_contract=MutationContract(
            kind=MutationKind.SKILL_INSERTION,
            target_agent="subject",
            allowed_differences=[SKILL_MUTATION_POINTER],
            minimum_skills=1,
            maximum_skills=1,
        ),
        execution=ExecutionSpec(
            order=VariantSchedule.PARALLEL, max_concurrent=1, timeout_seconds=1800, retry_limit=0
        ),
        scoring=ScoringSpec(
            primary_reward="reward",
            aggregation="mean",
            require_candidate_above_baseline=True,
            minimum_absolute_delta=0.05,
        ),
        evidence=EvidenceRequirementsV2(runtime_evidence="not_required"),
        budgets=BudgetSpec(
            maximum_input_tokens=None,
            maximum_output_tokens=None,
            maximum_model_calls=None,
            maximum_usd=None,
        ),
        data_policy_digest=data_policy_digest,
        execution_plan_digest=plan_digest,
    )


def parity_candidate_campaign(
    source: CampaignSpecV2, plan: ResolvedExecutionPlan
) -> CampaignSpecV2:
    """The same experiment bound to the Fabric-hosted plan of the parity pair."""
    parity_plan = to_json_value(plan)
    assert isinstance(parity_plan, dict)
    parity_plan["subject"] = PARITY_SUBJECT
    document = to_json_value(source)
    assert isinstance(document, dict)
    document["metadata"] = {
        "id": fixture_id("campaign", "parity-candidate-campaign"),
        "version": source.metadata.version + 1,
        "purpose": source.metadata.purpose,
    }
    document["execution_plan_digest"] = digest_object(parity_plan)
    return CampaignSpecV2.model_validate(document)


def climb(campaign_digest: Digest, *, version: int, label: str) -> ClimbManifest:
    """One edition of the development Climb."""
    return ClimbManifest(
        schema_version="techtree.climb.v1alpha1",
        kind="Climb",
        metadata=ClimbMetadata(
            id=fixture_id("climb", label),
            slug=CLIMB_SLUG,
            version=version,
            title="Techtree Hello World",
            summary=(
                "A toy Skill-uplift Climb, used here to exercise the Techtree protocol end to "
                "end. It produces no publishable evidence."
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


def experiment(
    variant: ExperimentVariant,
    spec: CampaignSpecV2,
    plan: ResolvedExecutionPlan,
    climb_digest: Digest,
    skills: list[ArtifactRef],
) -> ExperimentManifestV2:
    """One fully resolved experiment manifest, differing between variants only in Skills."""
    configuration = ExperimentConfigurationV2(
        taskset=spec.taskset,
        environment=spec.environment,
        agents={SUBJECT_AGENT: subject_agent(skills)},
        mutation_contract=spec.mutation_contract,
        execution_plan_digest=bound_execution_plan_digest(spec, plan),
        execution=spec.execution,
        scoring=spec.scoring,
        evidence=spec.evidence,
        budgets=spec.budgets,
        data_policy_digest=spec.data_policy_digest,
        outcome_contract_digest=spec.context.outcome_contract_digest,
    )
    return ExperimentManifestV2(
        schema_version=EXPERIMENT_V2_SCHEMA_VERSION,
        id=fixture_id("receipt", f"experiment/v2/{variant.value}"),
        campaign_spec_digest=digest_object(spec),
        program_ref=None,
        public_context=PublicContext(kind="climb", climb_digest=climb_digest),
        variant=variant,
        configuration=configuration,
        configuration_digest=digest_object(configuration),
        created_at=FIXED_TIME,
    )


def fixture_private_key() -> Ed25519PrivateKey:
    """The fixed development key the signed goldens are signed with; no real identity is it."""
    return load_private_key(bytes.fromhex(fixture_digest("executor-identity").split(":")[1]))


def executor_identity() -> ExecutorIdentity:
    """The public half of the fixture signing key."""
    private_key = fixture_private_key()
    return ExecutorIdentity(
        kind="local_ed25519",
        key_id=sha256_digest_bytes(public_key_bytes(private_key)),
        algorithm="ed25519",
        public_key=public_key_to_base64(private_key.public_key()),
        created_at=FIXED_TIME,
    )


def sign_fixture[T: BaseModel](value: T) -> ObjectEnvelope[T]:
    """Wrap one fixture object in its signed envelope; Ed25519 signing is deterministic."""
    digest = digest_object(value)
    return ObjectEnvelope[T](
        payload=value,
        payload_digest=digest,
        signature=sign_digest(fixture_private_key(), digest, key_id=executor_identity().key_id),
    )


def run_request(
    spec: CampaignSpecV2,
    plan: ResolvedExecutionPlan,
    climb_digest: Digest,
    lock_digest: Digest,
    baseline: ExperimentManifestV2,
    candidate: ExperimentManifestV2,
) -> RunRequestV2:
    """What the fixture run was created to do."""
    return RunRequestV2(
        schema_version=RUN_REQUEST_V2_SCHEMA_VERSION,
        run_id=fixture_id("run", "v2-run"),
        draft_id=fixture_id("draft", "v2-draft"),
        draft_digest=fixture_digest("v2-draft"),
        campaign_spec_digest=digest_object(spec),
        program_ref=None,
        public_context=PublicContext(kind="climb", climb_digest=climb_digest),
        data_policy_digest=spec.data_policy_digest,
        outcome_contract_digest=None,
        execution_plan_digest=run_request_execution_facts(spec, plan).execution_plan_digest,
        taskset_lock_digest=lock_digest,
        baseline_manifest_digest=digest_object(baseline),
        candidate_manifest_digest=digest_object(candidate),
        policy_acknowledgement=PolicyAcknowledgement(
            data_policy_digest=spec.data_policy_digest,
            method="explicit_cli_review",
            acknowledged_at=FIXED_TIME,
        ),
        executor_kind="verifiers",
        created_at=FIXED_TIME,
    )


def episode_receipt(
    spec: CampaignSpecV2,
    plan: ResolvedExecutionPlan,
    climb_digest: Digest,
    candidate: ExperimentManifestV2,
) -> EpisodeReceiptV2:
    """One receipt of the shape a real Verifiers episode produces."""
    facts = episode_receipt_execution_facts(spec, plan)
    task_hash = ordered_task_hashes()[0]
    return EpisodeReceiptV2(
        schema_version=EPISODE_RECEIPT_V2_SCHEMA_VERSION,
        id=fixture_id("receipt", "v2-episode-receipt"),
        run_id=fixture_id("run", "v2-run"),
        campaign_spec_digest=digest_object(spec),
        program_ref=None,
        public_context=PublicContext(kind="climb", climb_digest=climb_digest),
        data_policy_digest=spec.data_policy_digest,
        outcome_contract_digest=None,
        execution_plan_digest=facts.execution_plan_digest,
        execution_location=facts.execution_location,
        subject_runtime=SubjectRuntimeReceipt(
            kind="docker",
            resolved_image_digest=fixture_digest("subject-image"),
            platform="linux/arm64",
        ),
        variant=ExperimentVariant.CANDIDATE,
        experiment_manifest_digest=digest_object(candidate),
        episode_id=fixture_id("episode", "v2-episode"),
        episode_digest=fixture_digest("v2-raw-episode"),
        task_hash=task_hash,
        named_traces={
            SUBJECT_AGENT: [
                NamedTraceReceipt(
                    role=SUBJECT_AGENT,
                    trace_id=fixture_id("trace", "v2-trace"),
                    trace_digest=fixture_digest("v2-raw-trace"),
                    task_hash=task_hash,
                    rewards={"exact_match": 1.0},
                    metrics={},
                    ok=True,
                )
            ]
        },
        score_status=ScoreStatus.VALID,
        evidence_status=EvidenceStatus.COMPLETE,
        executor_kind="verifiers",
        artifacts=[
            ArtifactRef(
                digest=fixture_digest("v2-normalized-episodes"),
                media_type="application/x-ndjson",
                size=65536,
                relative_path=None,
            )
        ],
    )


def task_deltas() -> list[TaskDelta]:
    """Paired task rewards with wins, losses and ties."""
    rows: list[TaskDelta] = []
    for position, task_hash in enumerate(ordered_task_hashes()):
        baseline = 1.0 if position < 6 else 0.0
        candidate = 1.0 if 6 <= position < 14 else (0.0 if position < 2 else baseline)
        rows.append(
            TaskDelta(
                task_hash=task_hash,
                baseline_reward=baseline,
                candidate_reward=candidate,
                delta=candidate - baseline,
            )
        )
    return rows


def uplift_report(
    spec: CampaignSpecV2,
    plan: ResolvedExecutionPlan,
    climb_digest: Digest,
    receipt_digest: Digest,
    baseline: ExperimentManifestV2,
    candidate: ExperimentManifestV2,
) -> UpliftReportV2:
    """The shape a report of a real comparison takes."""
    facts = uplift_report_execution_facts(spec, plan)
    deltas = task_deltas()
    return UpliftReportV2(
        schema_version=UPLIFT_V2_SCHEMA_VERSION,
        id=fixture_id("uplift", "v2-uplift-report"),
        run_id=fixture_id("run", "v2-run"),
        campaign_spec_digest=digest_object(spec),
        program_ref=None,
        public_context=PublicContext(kind="climb", climb_digest=climb_digest),
        data_policy_digest=spec.data_policy_digest,
        outcome_contract_digest=None,
        execution_plan_digest=facts.execution_plan_digest,
        execution_location=facts.execution_location,
        taskset_validation_receipt_digest=receipt_digest,
        baseline_manifest_digest=digest_object(baseline),
        candidate_manifest_digest=digest_object(candidate),
        statuses=UpliftStatuses(
            execution=ExecutionStatus.COMPLETED,
            score=ScoreStatus.VALID,
            evidence=EvidenceStatus.COMPLETE,
            comparison=ComparisonStatus.CONTROLLED_WITH_WARNINGS,
            publication=PublicationStatus.NOT_REQUESTED,
        ),
        manifest_comparison=ManifestComparison(
            baseline_configuration_digest=baseline.configuration_digest,
            candidate_configuration_digest=candidate.configuration_digest,
            differences=[
                JsonDifference(
                    pointer=f"{SKILL_MUTATION_POINTER}/0",
                    baseline=None,
                    candidate=fixture_digest("skill-archive"),
                )
            ],
            allowed_differences=[SKILL_MUTATION_POINTER],
            controlled=True,
            violations=[],
        ),
        primary_result=aggregate_primary_result(deltas, "exact_match"),
        task_deltas=deltas,
        decision=UpliftDecision.ACCEPTED,
        proof_grade="P1",
        publication_eligible=publication_eligible_for(
            grade="P1", publication=PublicationStatus.NOT_REQUESTED
        ),
        created_at=FIXED_TIME,
    )


def variant_execution(
    manifest: ExperimentManifestV2,
    finished_at: datetime,
    input_tokens: int,
    output_tokens: int,
    model_calls: int,
) -> VariantExecutionSummary:
    """One side of the comparison's operational record."""
    variant = manifest.variant
    return VariantExecutionSummary(
        variant=variant,
        started_at=FIXED_TIME,
        finished_at=finished_at,
        elapsed_seconds=(finished_at - FIXED_TIME).total_seconds(),
        exit_code=0,
        cancelled=False,
        episode_count=TASK_COUNT,
        max_concurrent=2,
        usage=VariantUsage(
            provenance=UsageProvenance.NORMALIZED_TRACES,
            model_calls=model_calls,
            input_tokens=input_tokens,
            cached_input_tokens=0,
            output_tokens=output_tokens,
            total_tokens=input_tokens + output_tokens,
            traces_total=TASK_COUNT,
            traces_with_usage=TASK_COUNT,
        ),
        cost=unavailable_cost(NO_COST_SOURCE),
        experiment_manifest_digest=digest_object(manifest),
        argv_digest=fixture_digest(f"{variant.value}-argv"),
        normalized_episodes_digest=fixture_digest(f"{variant.value}-normalized"),
        raw_traces_digest=fixture_digest(f"{variant.value}-raw-traces"),
        resolved_config_digest=fixture_digest(f"{variant.value}-resolved-config"),
    )


def comparison_execution(
    report: UpliftReportV2, baseline: ExperimentManifestV2, candidate: ExperimentManifestV2
) -> ComparisonExecutionRecord:
    """One comparison's operational record: summed trace tokens and no cost."""
    baseline_finished = FIXED_TIME + timedelta(seconds=612)
    return ComparisonExecutionRecord(
        schema_version=COMPARISON_EXECUTION_SCHEMA_VERSION,
        run_id=report.run_id,
        campaign_spec_digest=report.campaign_spec_digest,
        engine_digest=fixture_digest("engine-bundle"),
        execution_backend="verifiers",
        schedule=VariantSchedule.PARALLEL,
        started_at=FIXED_TIME,
        finished_at=baseline_finished,
        elapsed_seconds=612.0,
        launch_skew_seconds=0.031,
        first_launched=ExperimentVariant.BASELINE,
        overlap_seconds=598.0,
        campaign_max_concurrent=4,
        outcome=PairOutcome.COMPLETED,
        baseline=variant_execution(baseline, baseline_finished, 1_186_432, 24_918, 163),
        candidate=variant_execution(
            candidate, FIXED_TIME + timedelta(seconds=598), 1_204_771, 26_004, 171
        ),
    )


def climb_summary(
    spec: CampaignSpecV2,
    plan: ResolvedExecutionPlan,
    climb_manifest: ClimbManifest,
    policy: DataPolicy,
) -> ClimbSummaryV2:
    """What `climb show` displays for the development Climb."""
    facts = climb_summary_execution_facts(spec, plan)
    compatibility = compatibility_result_execution_facts(spec, plan)
    return ClimbSummaryV2(
        reference=f"{climb_manifest.metadata.slug}@{climb_manifest.metadata.version}",
        climb_digest=digest_object(climb_manifest),
        campaign_spec_digest=digest_object(spec),
        title=climb_manifest.metadata.title,
        summary=climb_manifest.metadata.summary,
        status=climb_manifest.metadata.status,
        purpose=spec.metadata.purpose,
        taskset_id=spec.taskset.ref.id,
        task_count=spec.taskset.selection.num_tasks,
        subject_harness=facts.subject_harness,
        subject_harness_version=facts.subject_harness_version,
        mutation_kind=climb_manifest.candidate_policy.required_mutation,
        candidate_skill_visibility=climb_manifest.candidate_policy.skill_visibility,
        execution_backend_kind=facts.execution_backend_kind,
        proof_grade=climb_manifest.publication.proof_grade,
        data_policy=DataPolicySummary(
            raw_episode_server_upload=policy.raw_episodes.server_upload,
            raw_episode_training_use=policy.raw_episodes.training_use,
            candidate_skill_public_release=policy.candidate_skill.public_release,
            uplift_report_visibility=policy.derived_artifacts.uplift_report,
        ),
        compatibility=CompatibilityResultV2(
            compatible=False,
            host_platform="darwin/arm64",
            host_supported=True,
            required_engine_digest=fixture_digest("engine-bundle"),
            engine_status=EngineCompatibilityStatus.NOT_INSTALLED,
            execution_plan_digest=compatibility.execution_plan_digest,
            evaluation_engine_source_commit=compatibility.evaluation_engine_source_commit,
            evaluation_engine_digest=compatibility.evaluation_engine_digest,
            execution_backend_kind=compatibility.execution_backend_kind,
            execution_backend_supported=compatibility.execution_backend_supported,
            subject_backend_kind=compatibility.subject_backend_kind,
            subject_backend_supported=compatibility.subject_backend_supported,
            issues=[
                CompatibilityIssue(
                    code="engine_not_installed",
                    severity="error",
                    message=(
                        "The managed evaluation engine this Climb requires is not installed yet."
                    ),
                    blocking=True,
                )
            ],
        ),
    )


def golden_objects() -> dict[str, BaseModel]:
    """Every golden, by file stem."""
    descriptor = read_engine_descriptor(embedded_engine_root("default"))
    policy = data_policy()
    lock = taskset_lock()
    receipt = validation_receipt(digest_object(lock), descriptor.verifiers_revision)
    receipt_digest = digest_object(receipt)
    plan = execution_plan(descriptor.verifiers_version, descriptor.verifiers_revision)
    spec = campaign(digest_object(policy), receipt_digest, digest_object(plan))
    climb_v2 = climb(digest_object(spec), version=2, label="climb/v2")
    climb_v2_digest = digest_object(climb_v2)
    candidate_skill = ArtifactRef(
        digest=fixture_digest("skill-archive"),
        media_type="application/zip",
        size=4096,
        relative_path="candidate-skill.zip",
    )
    baseline = experiment(ExperimentVariant.BASELINE, spec, plan, climb_v2_digest, [])
    candidate = experiment(
        ExperimentVariant.CANDIDATE, spec, plan, climb_v2_digest, [candidate_skill]
    )
    report = uplift_report(spec, plan, climb_v2_digest, receipt_digest, baseline, candidate)
    return {
        "campaign-parity-candidate": parity_candidate_campaign(spec, plan),
        "campaign-v2": spec,
        "climb": climb(V1_CAMPAIGN_DIGEST, version=1, label="climb"),
        "climb-summary-v2": climb_summary(spec, plan, climb_v2, policy),
        "climb-v2": climb_v2,
        "comparison-execution": comparison_execution(report, baseline, candidate),
        "data-policy": policy,
        "episode-receipt-v2": sign_fixture(episode_receipt(spec, plan, climb_v2_digest, candidate)),
        "execution-plan": plan,
        "executor-identity": executor_identity(),
        "experiment-baseline-v2": baseline,
        "experiment-candidate-v2": candidate,
        "run-request-v2": run_request(
            spec, plan, climb_v2_digest, digest_object(lock), baseline, candidate
        ),
        "taskset-lock": lock,
        "taskset-validation-receipt": receipt,
        "uplift-report-v2": sign_fixture(report),
    }


def main() -> None:
    """Write every golden as sorted, two-space-indented JSON and print each digest."""
    for name, document in sorted(golden_objects().items()):
        rendered = json.dumps(to_json_value(document), indent=2, sort_keys=True, ensure_ascii=False)
        (GOLDEN / f"{name}.json").write_text(f"{rendered}\n", encoding="utf-8")
        print(f"{name}.json {digest_object(document)}")


if __name__ == "__main__":
    main()
