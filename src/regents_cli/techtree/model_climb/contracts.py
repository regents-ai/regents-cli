"""Model Climb's objects (contract model-climb-v1, section 3), one model per `kind`.

Every scientific object is `schema_version`, `kind`, `spec`, `operational` and `digest`. The
digest covers `{schema_version, kind, spec}` only, and validating an object recomputes it, so a
stored object whose science changed after it was sealed never loads. `operational` is a closed
set of fields per kind: what a field means decides where it lives, never the producer.

Amounts of money are whole US cents, so no amount is ever a float.
"""

from __future__ import annotations

from typing import Annotated, Final, Literal, Self

from pydantic import Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from regents_cli.techtree.canonical import digest_object
from regents_cli.techtree.models.base import (
    Digest,
    NonEmptyString,
    ProtocolModel,
    UtcDateTime,
)

SCHEMA_VERSION: Final = "techtree.model-climb.v1alpha1"
OPERATION_SCHEMA_VERSION: Final = "techtree.model-climb.operation.v1alpha1"
CONTRACT: Final = "model-climb-v1"
#: What a read reports when an object's science changed after it was sealed.
DIGEST_MISMATCH: Final = "digest_mismatch"

type SchemaVersion = Literal["techtree.model-climb.v1alpha1"]
#: A full git commit, as every pinned upstream revision is named.
type Revision = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{40}$")]
type Cents = Annotated[int, Field(ge=0)]
type Count = Annotated[int, Field(ge=0)]
type Positive = Annotated[int, Field(gt=0)]


# Result fields (contract 3.3): six independent answers, never merged into one status.


class ResultFields(ProtocolModel):
    execution: Literal["succeeded", "failed", "cancelled", "indeterminate"]
    integrity: Literal["verified", "invalid", "incomplete"]
    comparison: Literal["valid", "invalid", "exploratory"]
    outcome: Literal["uplift", "tie", "regression", "inconclusive"]
    release_gate: Literal["pass", "fail", "insufficient_evidence", "not_evaluated"]
    attestation: Literal["participant", "identified_executor", "independently_reproduced"]


# The parts objects share.


class ModelRef(ProtocolModel):
    model_id: NonEmptyString
    revision: Revision


class Created(ProtocolModel):
    """The `operational` of a kind whose only operational fact is when it was made."""

    created_at: UtcDateTime


class _ScientificObject(ProtocolModel):
    """Each kind narrows `kind`, `spec` and `operational` to its own."""

    schema_version: SchemaVersion
    kind: str
    spec: ProtocolModel
    operational: ProtocolModel
    digest: Digest

    @model_validator(mode="after")
    def _check_the_digest_covers_this_science(self) -> Self:
        computed = science_digest(self)
        if computed != self.digest:
            raise PydanticCustomError(
                DIGEST_MISMATCH,
                "this object's science no longer matches its digest: stored {stored}, "
                "computed {computed}",
                {"stored": self.digest, "computed": computed},
            )
        return self


def science_digest(value: _ScientificObject) -> Digest:
    """The digest of `{schema_version, kind, spec}`: never `operational`, never `digest`."""
    return digest_object(
        {
            "schema_version": value.schema_version,
            "kind": value.kind,
            "spec": value.spec,
        }
    )


def seal[T: _ScientificObject](cls: type[T], spec: ProtocolModel, operational: ProtocolModel) -> T:
    """A new object of `cls` with its digest computed: the only way one is made. Each class
    is named after its `kind`."""
    kind = cls.__name__
    digest = digest_object({"schema_version": SCHEMA_VERSION, "kind": kind, "spec": spec})
    return cls(
        schema_version=SCHEMA_VERSION,
        kind=kind,
        spec=spec,
        operational=operational,
        digest=digest,
    )


# ModelStudySpec


class HarnessProfile(ProtocolModel):
    prompt_digest: Digest
    output_schema_digest: Digest
    #: None where the harness has no decision policy (contract 3.2).
    decision_policy_digest: Digest | None


class SelectionRule(ProtocolModel):
    split: Literal["validation"]
    rule: NonEmptyString
    candidate_limit: Positive


class MetricConstraint(ProtocolModel):
    metric: NonEmptyString
    bound: Literal["at_most", "at_least"]
    value: float


class Metrics(ProtocolModel):
    primary: NonEmptyString
    constraints: list[MetricConstraint]
    minimum_positives: Positive
    minimum_negatives: Positive


class Budgets(ProtocolModel):
    training_max_cents: Cents
    evaluation_max_cents: Cents
    inference_trial_max_cents: Cents
    maximum_wall_time_seconds: Positive
    maximum_parallel_jobs: Positive


class DataPolicy(ProtocolModel):
    export_beyond_approved_boundary: Literal["denied"]
    external_teacher: Literal["denied", "approved"]
    external_judge: Literal["denied", "approved"]
    monitoring_upload: Literal["denied", "approved"]
    public_publication: Literal["denied", "approved"]
    chatgpt_projection: Literal["denied", "approved_summary_only"]


class ModelStudySpecSpec(ProtocolModel):
    workspace: NonEmptyString
    task_kind: Literal["structured_prediction"]
    hypothesis: NonEmptyString
    mutation: Literal["model_weights"]
    baseline: ModelRef
    baseline_weights_digest: Digest
    baseline_tokenizer_digest: Digest
    harness: HarnessProfile
    dataset_release: Digest
    benchmark_release: Digest
    selection: SelectionRule
    metrics: Metrics
    budgets: Budgets
    data_policy: DataPolicy


class StudyOperational(ProtocolModel):
    label: NonEmptyString
    created_at: UtcDateTime


class ModelStudySpec(_ScientificObject):
    kind: Literal["ModelStudySpec"]
    spec: ModelStudySpecSpec
    operational: StudyOperational


# DatasetRelease


class LineageStep(ProtocolModel):
    source_digest: Digest
    transformation: NonEmptyString


class SplitCommitment(ProtocolModel):
    """sha256 over the sorted HMAC-SHA256(salt, row id) of one split (contract 3.4)."""

    commitment: Digest
    rows: Count


class SplitCommitments(ProtocolModel):
    train: SplitCommitment
    validation: SplitCommitment
    proving: SplitCommitment
    debug: SplitCommitment | None


class DatasetReleaseSpec(ProtocolModel):
    snapshot_digest: Digest
    source_lineage: list[LineageStep]
    rights_class: NonEmptyString
    row_schema_digest: Digest
    #: None where the rows were not transformed (contract 3.2).
    transformation_digest: Digest | None
    feature_cutoff_rule: NonEmptyString
    label_policy: NonEmptyString
    duplicate_cluster_rule: NonEmptyString
    splits: SplitCommitments
    exclusions: dict[str, Count]


class SnapshotOperational(ProtocolModel):
    snapshot_handle: NonEmptyString
    created_at: UtcDateTime


class DatasetRelease(_ScientificObject):
    kind: Literal["DatasetRelease"]
    spec: DatasetReleaseSpec
    operational: SnapshotOperational


# BenchmarkRelease


class VerifierRef(ProtocolModel):
    package: NonEmptyString
    version: NonEmptyString
    environment: NonEmptyString


class SamplingProtocol(ProtocolModel):
    temperature: Annotated[float, Field(ge=0)]
    max_output_tokens: Positive
    samples_per_case: Positive
    seed: int


class BenchmarkReleaseSpec(ProtocolModel):
    dataset_release: Digest
    verifier: VerifierRef
    proving_commitment: Digest
    output_schema_digest: Digest
    sampling: SamplingProtocol
    #: None where no scorer test or qualification report exists (contract 3.2).
    scorer_test_digest: Digest | None
    qualification_report_digest: Digest | None


class BenchmarkRelease(_ScientificObject):
    kind: Literal["BenchmarkRelease"]
    spec: BenchmarkReleaseSpec
    operational: Created


# TrainingRecipe


class TrainerRef(ProtocolModel):
    name: Literal["prime-rl"]
    revision: Revision
    lock_digest: Digest


class LoraConfig(ProtocolModel):
    rank: Positive
    alpha: Positive
    dropout: Annotated[float, Field(ge=0, lt=1)]
    #: Every target, written out; the trainer's matched modules must equal `expected_modules`.
    targets: Annotated[list[NonEmptyString], Field(min_length=1)]
    expected_modules: Positive


class Optimizer(ProtocolModel):
    name: NonEmptyString
    learning_rate: Annotated[float, Field(gt=0)]
    weight_decay: Annotated[float, Field(ge=0)]
    optimization_dtype: Literal["bfloat16"]
    reduce_dtype: Literal["bfloat16"]


class TrainingLimits(ProtocolModel):
    micro_batch_size: Positive
    batch_size: Positive
    max_context_tokens: Positive
    max_steps: Positive


class TrainingRecipeSpec(ProtocolModel):
    trainer: TrainerRef
    image_digest: Digest
    model: ModelRef
    renderer: NonEmptyString
    loss_mask: Literal["assistant_only"]
    lora: LoraConfig
    optimizer: Optimizer
    seed: int
    limits: TrainingLimits
    checkpoint_selection: NonEmptyString


class TrainingRecipe(_ScientificObject):
    kind: Literal["TrainingRecipe"]
    spec: TrainingRecipeSpec
    operational: Created


# ResolvedModelPlan

type Enforcement = Literal["provider_hard_limit", "bounded_operational_limit", "estimate_only"]


#: M0's compute: San Francisco Compute's Autoresearch batch jobs (contract 6.1).
type ComputeProvider = Literal["sfcompute_autoresearch"]


class ComputeTarget(ProtocolModel):
    provider: ComputeProvider
    #: The Autoresearch mission every job is filed under.
    mission: NonEmptyString
    gpu_model: NonEmptyString
    gpu_count: Positive


class PriceQuote(ProtocolModel):
    item: NonEmptyString
    cents_per_hour: Cents


class BudgetReservation(ProtocolModel):
    """How much the plan may spend, and how that cap is enforced (contract 6.1)."""

    amount_cents: Cents
    enforcement: Enforcement
    shutdown_allowance_cents: Cents
    credit_ceiling_attested: bool
    prices: list[PriceQuote]


class ResolvedModelPlanSpec(ProtocolModel):
    study: Digest
    dataset_release: Digest
    benchmark_release: Digest
    recipe: Digest
    compute: ComputeTarget
    egress: list[NonEmptyString]
    compatibility_profile: Digest
    budget: BudgetReservation
    expires_at: UtcDateTime


class ResolvedModelPlan(_ScientificObject):
    kind: Literal["ResolvedModelPlan"]
    spec: ResolvedModelPlanSpec
    operational: Created


# ModelArtifact


class ModelArtifactSpec(ProtocolModel):
    base_weights_root: Digest
    adapter_root: Digest
    adapter_config_digest: Digest
    tokenizer_digest: Digest
    config_digest: Digest
    merged_weights_root: Digest | None
    plan: Digest
    attempt: Digest
    licence: NonEmptyString
    privacy_class: Literal["private", "public"]


class StoredOperational(ProtocolModel):
    storage_handle: NonEmptyString
    created_at: UtcDateTime


class ModelArtifact(_ScientificObject):
    kind: Literal["ModelArtifact"]
    spec: ModelArtifactSpec
    operational: StoredOperational


# TrainingAttempt

type AttemptEnd = Literal["succeeded", "failed", "cancelled", "budget_exhausted", "indeterminate"]


class TrainingAttemptSpec(ProtocolModel):
    plan: Digest
    run_id: NonEmptyString
    attempt_id: NonEmptyString
    observed_config_digest: Digest
    steps: Count
    tokens: Count
    checkpoints: list[Digest]
    exit_reason: AttemptEnd
    measured_cost_cents: Cents
    predecessor: Digest | None
    optimizer_state_restored: bool
    rng_state_restored: bool


class AttemptOperational(ProtocolModel):
    #: The attempt's intent, sent as the provider's idempotency key and label (contract 5).
    intent_id: NonEmptyString
    upstream_job_id: NonEmptyString | None
    event_cursor: NonEmptyString | None
    started_at: UtcDateTime
    ended_at: UtcDateTime | None


class TrainingAttempt(_ScientificObject):
    kind: Literal["TrainingAttempt"]
    spec: TrainingAttemptSpec
    operational: AttemptOperational


# ModelUpliftReport


class PairedOutcomes(ProtocolModel):
    """Base and candidate on the same cases: each case counted once, in one cell."""

    cases: Count
    both_correct: Count
    base_only_correct: Count
    candidate_only_correct: Count
    neither_correct: Count
    positives: Count
    negatives: Count

    @model_validator(mode="after")
    def _check_the_cells_add_up(self) -> Self:
        cells = (
            self.both_correct
            + self.base_only_correct
            + self.candidate_only_correct
            + self.neither_correct
        )
        if cells != self.cases:
            raise ValueError(f"the four cells count {cells} cases, not {self.cases}")
        if self.positives + self.negatives != self.cases:
            raise ValueError("positives and negatives must count every case once")
        return self


class Uncertainty(ProtocolModel):
    method: NonEmptyString
    confidence: Annotated[float, Field(gt=0, lt=1)]
    interval_low: float
    interval_high: float


class ModelUpliftReportSpec(ProtocolModel):
    artifact: Digest
    benchmark_release: Digest
    evaluator_outputs: Annotated[list[Digest], Field(min_length=1)]
    paired_outcomes: PairedOutcomes
    uncertainty: Uncertainty
    results: ResultFields
    limitations: list[NonEmptyString]


class ModelUpliftReport(_ScientificObject):
    kind: Literal["ModelUpliftReport"]
    spec: ModelUpliftReportSpec
    operational: Created


# ServiceComparisonReport


class BusinessMetric(ProtocolModel):
    metric: NonEmptyString
    deployment: Digest
    value: float


class ServiceComparisonReportSpec(ProtocolModel):
    deployments: Annotated[list[Digest], Field(min_length=2)]
    load_protocol: NonEmptyString
    latency_protocol: NonEmptyString
    business_metrics: list[BusinessMetric]
    infrastructure_differences: list[NonEmptyString]
    cost_model: NonEmptyString


class ServiceComparisonReport(_ScientificObject):
    kind: Literal["ServiceComparisonReport"]
    spec: ServiceComparisonReportSpec
    operational: Created


# DeploymentRelease


class Quota(ProtocolModel):
    requests_per_minute: Positive
    monthly_max_cents: Cents


class DeploymentReleaseSpec(ProtocolModel):
    artifact: Digest
    prompt_digest: Digest
    output_schema_digest: Digest
    calibrator_digest: Digest | None
    policy_version: NonEmptyString
    runtime_image_digest: Digest
    quantization: NonEmptyString
    hardware_profile: NonEmptyString
    quota: Quota
    fallback: Literal["incumbent", "human_queue", "safe_failure"]
    predecessor: Digest | None


class DeploymentOperational(ProtocolModel):
    endpoint_handle: NonEmptyString
    created_at: UtcDateTime


class DeploymentRelease(_ScientificObject):
    kind: Literal["DeploymentRelease"]
    spec: DeploymentReleaseSpec
    operational: DeploymentOperational


type ScientificObject = Annotated[
    ModelStudySpec
    | DatasetRelease
    | BenchmarkRelease
    | TrainingRecipe
    | ResolvedModelPlan
    | ModelArtifact
    | TrainingAttempt
    | ModelUpliftReport
    | ServiceComparisonReport
    | DeploymentRelease,
    Field(discriminator="kind"),
]


# Execution grants (contract section 6)

#: The operations a grant may admit: those that spend, deploy or publish.
type GrantedOperation = Literal[
    "model_climb_profile_test",
    "model_climb_start",
    "model_climb_prove",
    "model_climb_deployment_apply",
    "model_climb_deployment_promote",
    "model_climb_deployment_rollback",
]


class GrantAttestation(ProtocolModel):
    level: Literal["participant"]
    operator_attested: Literal[True]


class ExecutionGrant(ProtocolModel):
    """One operation on one resolved plan, within these limits; signed by its issuer's key.

    Every field is bound: the signature covers them all, so changing any one breaks it.
    """

    schema_version: SchemaVersion
    kind: Literal["ExecutionGrant"]
    grant_id: NonEmptyString
    mode: Literal["local"]
    issuer_key_id: NonEmptyString
    approving_human: NonEmptyString
    workspace: NonEmptyString
    actor_key_id: NonEmptyString
    operation: GrantedOperation
    plan: Digest
    dataset_release: Digest
    benchmark_release: Digest
    recipe: Digest
    provider: ComputeProvider
    mission: NonEmptyString
    gpu_model: NonEmptyString
    gpu_count: Positive
    max_cents: Cents
    max_wall_time_seconds: Positive
    max_attempts: Positive
    max_parallel_jobs: Positive
    egress: list[NonEmptyString]
    issued_at: UtcDateTime
    expires_at: UtcDateTime
    nonce: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{32}$")]
    uses_allowed: Positive
    attestation: GrantAttestation

    @model_validator(mode="after")
    def _check_it_expires_after_it_is_issued(self) -> Self:
        if self.expires_at <= self.issued_at:
            raise ValueError("a grant must expire after it is issued")
        return self
