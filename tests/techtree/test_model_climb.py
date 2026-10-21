"""Model Climb's engine invariants (contract model-climb-v1, the agreed test set).

The costly failures: a digest that drifts or covers operational fields, so the same science gets
two names or a changed plan keeps its name; a grant that still admits work after a bound field
changed; a LoRA run that silently trains fewer modules than the recipe names; and a second paid
job submitted after a first submission's outcome was unknown.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from regents_cli.app import main
from regents_cli.techtree import paths
from regents_cli.techtree.canonical import digest_object, sha256_digest_bytes
from regents_cli.techtree.crypto import (
    generate_private_key,
    public_key_bytes,
    public_key_to_base64,
    sign_digest,
)
from regents_cli.techtree.errors import PolicyError, TechtreeError
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.identity.store import IdentityStore
from regents_cli.techtree.model_climb import attempts, grants, profiles, proof
from regents_cli.techtree.model_climb.contracts import (
    BenchmarkRelease,
    BenchmarkReleaseSpec,
    BudgetReservation,
    Budgets,
    ComputeTarget,
    Created,
    DataPolicy,
    DatasetRelease,
    DatasetReleaseSpec,
    ExecutionGrant,
    GrantedOperation,
    HarnessProfile,
    Metrics,
    ModelRef,
    ModelStudySpec,
    ModelStudySpecSpec,
    ModelUpliftReport,
    ModelUpliftReportSpec,
    PairedOutcomes,
    ResolvedModelPlan,
    ResolvedModelPlanSpec,
    ResultFields,
    SamplingProtocol,
    SelectionRule,
    SnapshotOperational,
    SplitCommitment,
    SplitCommitments,
    StudyOperational,
    Uncertainty,
    VerifierRef,
    seal,
)
from regents_cli.techtree.model_climb.store import ModelClimbStore
from regents_cli.techtree.models.base import ObjectEnvelope
from tests.techtree.run_log import at_a_terminal

NOW = datetime(2026, 10, 12, 18, 0, tzinfo=UTC)


def digest(fill: str) -> str:
    return "sha256:" + fill * 64


def study() -> ModelStudySpec:
    return seal(
        ModelStudySpec,
        ModelStudySpecSpec(
            workspace="workspace-test",
            task_kind="structured_prediction",
            hypothesis="A LoRA adapter extracts invoice fields more accurately.",
            mutation="model_weights",
            baseline=ModelRef(
                model_id="Qwen/Qwen3.5-9B", revision="c202236235762e1c871ad0ccb60c8ee5ba337b9a"
            ),
            baseline_weights_digest=digest("1"),
            baseline_tokenizer_digest=digest("2"),
            harness=HarnessProfile(
                prompt_digest=digest("3"),
                output_schema_digest=digest("4"),
                decision_policy_digest=digest("5"),
            ),
            dataset_release=digest("6"),
            benchmark_release=digest("7"),
            selection=SelectionRule(split="validation", rule="best_primary", candidate_limit=3),
            metrics=Metrics(
                primary="exact_match",
                constraints=[],
                minimum_positives=50,
                minimum_negatives=50,
            ),
            budgets=Budgets(
                training_max_cents=5000,
                evaluation_max_cents=1000,
                inference_trial_max_cents=500,
                maximum_wall_time_seconds=6 * 3600,
                maximum_parallel_jobs=1,
            ),
            data_policy=DataPolicy(
                export_beyond_approved_boundary="denied",
                external_teacher="denied",
                external_judge="denied",
                monitoring_upload="denied",
                public_publication="denied",
                chatgpt_projection="denied",
            ),
        ),
        StudyOperational(label="invoice fields", created_at=NOW),
    )


def plan(
    study_digest: str,
    *,
    cents: int = 4000,
    dataset_release: str = digest("6"),
    benchmark_release: str = digest("7"),
) -> ResolvedModelPlan:
    return seal(
        ResolvedModelPlan,
        ResolvedModelPlanSpec(
            study=study_digest,
            dataset_release=dataset_release,
            benchmark_release=benchmark_release,
            recipe=digest("8"),
            compute=ComputeTarget(
                provider="sfcompute_autoresearch",
                mission="sample-mission",
                gpu_model="H100_80GB",
                gpu_count=2,
            ),
            egress=["huggingface.co"],
            compatibility_profile=digest("9"),
            budget=BudgetReservation(
                amount_cents=cents,
                enforcement="bounded_operational_limit",
                shutdown_allowance_cents=200,
                credit_ceiling_attested=True,
                prices=[],
            ),
            # Grant issue refuses an expired plan by the real clock, so the plan expires
            # a week from now rather than a week from the fixed NOW.
            expires_at=datetime.now(UTC) + timedelta(days=7),
        ),
        Created(created_at=NOW),
    )


def dataset_spec() -> DatasetReleaseSpec:
    split = SplitCommitment(commitment=digest("a"), rows=100)
    return DatasetReleaseSpec(
        snapshot_digest=digest("c"),
        source_lineage=[],
        rights_class="customer_private",
        row_schema_digest=digest("e"),
        transformation_digest=digest("f"),
        feature_cutoff_rule="none",
        label_policy="reviewed labels",
        duplicate_cluster_rule="exact text",
        splits=SplitCommitments(train=split, validation=split, proving=split, debug=None),
        exclusions={},
    )


def benchmark_spec() -> BenchmarkReleaseSpec:
    return BenchmarkReleaseSpec(
        dataset_release=digest("6"),
        verifier=VerifierRef(package="verifier", version="1", environment="invoice"),
        proving_commitment=digest("a"),
        output_schema_digest=digest("4"),
        sampling=SamplingProtocol(
            temperature=0.0, max_output_tokens=256, samples_per_case=1, seed=7
        ),
        scorer_test_digest=digest("b"),
        qualification_report_digest=digest("d"),
    )


# Digest stability


def test_a_digest_is_pinned_and_survives_a_round_trip(tmp_path: Path) -> None:
    sealed = study()
    store = ModelClimbStore(tmp_path)
    store.put(sealed)
    assert store.get(sealed.digest) == sealed
    assert sealed.digest == study().digest
    assert sealed.digest == (
        "sha256:7276ebb1e6113189f3f4eaa9ce88c4f5fa1eda531b6f410578406145347cf36b"
    )


# Spec and operational kept apart


def test_operational_fields_never_change_the_digest() -> None:
    first = study()
    relabelled = seal(
        ModelStudySpec,
        first.spec,
        StudyOperational(label="renamed", created_at=NOW + timedelta(hours=1)),
    )
    assert relabelled.digest == first.digest


def test_a_stored_object_whose_spec_changed_never_loads(tmp_path: Path) -> None:
    sealed = study()
    store = ModelClimbStore(tmp_path)
    path = store.put(sealed)
    stored = json.loads(path.read_text())
    stored["spec"]["hypothesis"] = "Something else."
    path.write_text(json.dumps(stored))
    with pytest.raises(TechtreeError) as refused:
        store.get(sealed.digest)
    assert refused.value.code == "digest_mismatch"


# Grant binding


def stored_plan(monkeypatch: pytest.MonkeyPatch, home: Path) -> tuple[ModelClimbStore, str]:
    monkeypatch.setenv("HOME", str(home))
    store = ModelClimbStore(paths.home().model_climb_dir)
    sealed_study = study()
    store.put(sealed_study)
    dataset = seal(
        DatasetRelease,
        dataset_spec(),
        SnapshotOperational(snapshot_handle="local", created_at=NOW),
    )
    store.put(dataset)
    benchmark = seal(BenchmarkRelease, benchmark_spec(), Created(created_at=NOW))
    store.put(benchmark)
    sealed_plan = plan(
        sealed_study.digest, dataset_release=dataset.digest, benchmark_release=benchmark.digest
    )
    store.put(sealed_plan)
    return store, sealed_plan.digest


def issue(plan_digest: str, *extra: str) -> list[str]:
    return [
        "techtree",
        "model-climb",
        "grant",
        "issue",
        "--plan",
        plan_digest,
        "--operation",
        "model_climb_start",
        "--max-usd",
        "35.50",
        "--max-hours",
        "4",
        "--max-attempts",
        "2",
        "--expires-in",
        "24h",
        *extra,
    ]


def test_a_grant_admits_its_operation_and_nothing_once_a_bound_field_changes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    store, plan_digest = stored_plan(monkeypatch, tmp_path)
    at_a_terminal(monkeypatch, "y\ny\n35.50\n")
    assert main(issue(plan_digest)) == 0
    [grant_file] = store.grants_dir.glob("*.json")
    envelope = store.get_grant(grant_file.stem)
    identity = IdentityService(IdentityStore(paths.home())).ensure()
    now = datetime.now(UTC)

    def admit(candidate: ObjectEnvelope[ExecutionGrant], operation: GrantedOperation) -> None:
        grants.admit(
            store,
            candidate,
            identity=identity,
            operation=operation,
            plan_digest=plan_digest,
            now=now,
        )

    admit(envelope, "model_climb_start")
    assert envelope.payload.max_cents == 3550
    assert envelope.payload.max_wall_time_seconds == 4 * 3600
    with pytest.raises(PolicyError) as refused:
        admit(envelope, "model_climb_prove")
    assert refused.value.code == "approval_required"
    raised = envelope.model_copy(
        update={"payload": envelope.payload.model_copy(update={"max_cents": 400000})}
    )
    with pytest.raises(PolicyError) as refused:
        admit(raised, "model_climb_start")
    assert refused.value.code == "approval_required"


def test_a_wrong_confirmation_issues_no_grant(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    store, plan_digest = stored_plan(monkeypatch, tmp_path)
    at_a_terminal(monkeypatch, "y\ny\n35\n")
    assert main(issue(plan_digest)) == 1
    assert not store.grants_dir.exists() or not any(store.grants_dir.iterdir())


def test_without_a_person_at_a_terminal_no_grant_is_issued(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    store, plan_digest = stored_plan(monkeypatch, tmp_path)
    assert main(issue(plan_digest, "--json")) == 1
    error = json.loads(capsys.readouterr().out)["error"]
    assert error["code"] == "approval_required"
    assert any(plan_digest in line for line in error["details"]["review"])
    assert not store.grants_dir.exists() or not any(store.grants_dir.iterdir())


# The coverage check (248 modules), on the module paths the M0 dry run reported

PREFIX = "model.language_model.layers"
LAYER_TYPES = (["linear_attention"] * 3 + ["full_attention"]) * 8
FULL_ATTENTION = ("q_proj", "k_proj", "v_proj", "o_proj")
GATED_DELTANET = ("in_proj_qkv", "in_proj_z", "in_proj_b", "in_proj_a", "out_proj")
MLP = ("gate_proj", "up_proj", "down_proj")


def every_target() -> list[str]:
    names = []
    for index, kind in enumerate(LAYER_TYPES):
        if kind == "full_attention":
            names += [f"{PREFIX}.{index}.self_attn.{leaf}" for leaf in FULL_ATTENTION]
        else:
            names += [f"{PREFIX}.{index}.linear_attn.{leaf}" for leaf in GATED_DELTANET]
        names += [f"{PREFIX}.{index}.mlp.{leaf}" for leaf in MLP]
    return names


def test_the_anchored_targets_match_exactly_the_248_text_modules() -> None:
    full = every_target()
    assert len(full) == 248

    def targeted(name: str) -> bool:
        return any(re.search(pattern, name) for pattern in profiles.M0.targets)

    assert all(targeted(name) for name in full)
    assert not targeted("model.visual.blocks.0.mlp.linear_fc1")
    assert not targeted("mtp.layers.0.mlp.up_proj")
    assert not targeted(f"{PREFIX}.0.self_attn.q_proj.lora_A")
    assert profiles.coverage(profiles.M0, full, layer_types=LAYER_TYPES).holds
    short = profiles.coverage(profiles.M0, full[1:], layer_types=LAYER_TYPES)
    assert short.missing == [f"{PREFIX}.0.linear_attn.in_proj_qkv"]
    extra = profiles.coverage(
        profiles.M0, [*full, "model.visual.blocks.0.mlp.up_proj"], layer_types=LAYER_TYPES
    )
    assert extra.unexpected == ["model.visual.blocks.0.mlp.up_proj"]


# Admission: the resolved training configuration sends nothing anywhere and takes no requests


def quiet_configuration() -> dict[str, Any]:
    return {
        "dashboard": False,
        "heartbeat": None,
        "control": None,
        "monitors": {"prime": None, "wandb": None},
        "model": {"fusions": {"enabled": []}},
    }


def sent_nothing(resolved: dict[str, Any]) -> str:
    [check] = [c for c in profiles.config_checks(resolved) if c.label == "Nothing sent anywhere"]
    return check.status


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("dashboard",), True),
        (("heartbeat",), {"url": "https://example.invalid"}),
        (("control",), {"host": "0.0.0.0", "port": 8040}),
        (("monitors", "prime"), {}),
        (("monitors", "wandb"), {}),
    ],
)
def test_admission_fails_when_the_trainer_would_talk_to_anyone(
    path: tuple[str, ...], value: Any
) -> None:
    assert sent_nothing(quiet_configuration()) == "pass"
    resolved = quiet_configuration()
    *parents, leaf = path
    target = resolved
    for key in parents:
        target = target[key]
    target[leaf] = value
    assert sent_nothing(resolved) == "fail"


# The indeterminate rule: look up, never resubmit


class SimulatedProvider:
    """A simulated provider: it creates jobs in memory and never talks to anyone."""

    def __init__(self, *, lose_the_answer: bool) -> None:
        self.lose_the_answer = lose_the_answer
        self.jobs: dict[str, str] = {}
        self.submissions = 0

    def submit(self, intent_id: str) -> str:
        self.submissions += 1
        self.jobs[intent_id] = f"simulated-job-{self.submissions}"
        if self.lose_the_answer:
            raise attempts.SubmissionOutcomeUnknownError
        return self.jobs[intent_id]

    def find(self, intent_id: str) -> str | None:
        return self.jobs.get(intent_id)


def test_an_unknown_outcome_is_looked_up_and_never_submitted_again(tmp_path: Path) -> None:
    journal = attempts.Journal(tmp_path / "attempt.jsonl")
    provider = SimulatedProvider(lose_the_answer=True)
    assert attempts.submit_once(journal, provider, "intent-1") == "simulated-job-1"
    assert attempts.submit_once(journal, provider, "intent-1") == "simulated-job-1"
    assert provider.submissions == 1
    assert [fact.state for fact in journal.facts()] == ["intent", "indeterminate", "submitted"]


def test_a_lookup_that_finds_nothing_submits_nothing(tmp_path: Path) -> None:
    journal = attempts.Journal(tmp_path / "attempt.jsonl")
    journal.append(attempts.JournalFact(state="intent", intent_id="intent-1"))
    provider = SimulatedProvider(lose_the_answer=False)
    with pytest.raises(TechtreeError) as refused:
        attempts.submit_once(journal, provider, "intent-1")
    assert refused.value.code == "job_indeterminate"
    assert provider.submissions == 0


# The proof sent to Techtree (contract 3.5)


def report_for(artifact: str, benchmark: str) -> ModelUpliftReportSpec:
    return ModelUpliftReportSpec(
        artifact=artifact,
        benchmark_release=benchmark,
        evaluator_outputs=[digest("c")],
        paired_outcomes=PairedOutcomes(
            cases=4,
            both_correct=1,
            base_only_correct=1,
            candidate_only_correct=1,
            neither_correct=1,
            positives=2,
            negatives=2,
        ),
        uncertainty=Uncertainty(
            method="paired bootstrap", confidence=0.95, interval_low=-0.1, interval_high=0.1
        ),
        results=ResultFields(
            execution="succeeded",
            integrity="verified",
            comparison="valid",
            outcome="tie",
            release_gate="not_evaluated",
            attestation="participant",
        ),
        limitations=[],
    )


def test_a_proof_missing_an_object_it_reaches_is_never_written(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    store, _ = stored_plan(monkeypatch, tmp_path / "home")
    benchmark = seal(BenchmarkRelease, benchmark_spec(), Created(created_at=NOW))
    store.put(benchmark)
    report = seal(
        ModelUpliftReport,
        report_for(digest("e"), benchmark.digest),
        Created(created_at=NOW),
    )
    store.put(report)
    service = IdentityService(IdentityStore(paths.home()))
    folder = tmp_path / "proof"
    with pytest.raises(TechtreeError) as refused:
        proof.write(store, service, report.digest, folder)
    assert refused.value.code == "not_found"
    assert not folder.exists()


def test_a_proof_larger_than_techtree_keeps_is_refused_before_sending(tmp_path: Path) -> None:
    (tmp_path / "objects").mkdir(parents=True)
    (tmp_path / "manifest.json").write_text(json.dumps({"padding": "x" * proof.MAX_DOCUMENT_BYTES}))
    with pytest.raises(TechtreeError) as refused:
        proof.document(tmp_path)
    assert refused.value.details["check"] == "document"


def test_a_proof_the_site_accepts_is_refused_when_an_object_it_refers_to_is_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Techtree's eight checks read only the report's own two references; `graph` reads every
    object's, so a proof leaving out the artifact's plan holds there and is refused here."""
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    created = {"created_at": "2026-10-13T00:00:00Z"}

    def carried(kind: str, spec: dict[str, Any]) -> dict[str, Any]:
        body = {"schema_version": proof.OBJECT_SCHEMA_VERSION, "kind": kind, "spec": spec}
        return {**body, "operational": created, "digest": digest_object(body)}

    benchmark = carried("BenchmarkRelease", benchmark_spec().model_dump(mode="json"))
    artifact = carried("ModelArtifact", {"plan": digest("9")})
    report_spec = report_for(str(artifact["digest"]), str(benchmark["digest"]))
    report = carried("ModelUpliftReport", report_spec.model_dump(mode="json"))
    key = generate_private_key()
    public = public_key_bytes(key)
    payload = {
        "schema_version": proof.PROOF_SCHEMA_VERSION,
        "report": report["digest"],
        "objects": sorted(str(value["digest"]) for value in (benchmark, artifact, report)),
        "signer": {
            "kind": "local_ed25519",
            "algorithm": "ed25519",
            "key_id": sha256_digest_bytes(public),
            "public_key": public_key_to_base64(key.public_key()),
        },
    }
    payload_digest = digest_object(payload)
    signature = sign_digest(key, payload_digest, key_id=sha256_digest_bytes(public))
    folder = tmp_path / "proof"
    (folder / "objects").mkdir(parents=True)
    manifest = {
        "payload": payload,
        "payload_digest": payload_digest,
        "signature": signature.model_dump(mode="json"),
    }
    (folder / "manifest.json").write_text(json.dumps(manifest))
    for value in (benchmark, artifact, report):
        name = str(value["digest"]).removeprefix("sha256:")
        (folder / "objects" / f"{name}.json").write_text(json.dumps(value))

    assert main(["techtree", "proof", "verify", str(folder), "--json"]) == 1
    error = json.loads(capsys.readouterr().out)["error"]
    assert error["code"] == "validation_error"
    assert error["details"]["check"] == "graph"
    assert error["details"]["missing"] == digest("9")
