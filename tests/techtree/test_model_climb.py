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

import pytest

from regents_cli.app import main
from regents_cli.techtree import paths
from regents_cli.techtree.errors import PolicyError, TechtreeError
from regents_cli.techtree.identity.service import IdentityService
from regents_cli.techtree.identity.store import IdentityStore
from regents_cli.techtree.model_climb import attempts, grants, profiles
from regents_cli.techtree.model_climb.contracts import (
    BudgetReservation,
    Budgets,
    ComputeTarget,
    Created,
    DataPolicy,
    ExecutionGrant,
    GrantedOperation,
    HarnessProfile,
    Metrics,
    ModelRef,
    ModelStudySpec,
    ModelStudySpecSpec,
    ResolvedModelPlan,
    ResolvedModelPlanSpec,
    SelectionRule,
    StudyOperational,
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


def plan(study_digest: str, *, cents: int = 4000) -> ResolvedModelPlan:
    return seal(
        ResolvedModelPlan,
        ResolvedModelPlanSpec(
            study=study_digest,
            dataset_release=digest("6"),
            benchmark_release=digest("7"),
            recipe=digest("8"),
            compute=ComputeTarget(
                provider="sfcompute_autoresearch",
                mission="regents-123",
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
            expires_at=NOW + timedelta(days=7),
        ),
        Created(created_at=NOW),
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
    sealed_plan = plan(sealed_study.digest)
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
    at_a_terminal(monkeypatch, plan_digest.removeprefix("sha256:")[:12] + "\n")
    assert main(issue(plan_digest)) == 0
    [grant_file] = store.grants_dir.iterdir()
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
    at_a_terminal(monkeypatch, "000000000000\n")
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
