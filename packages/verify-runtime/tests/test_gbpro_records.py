from __future__ import annotations

from dataclasses import replace

import pytest

from verify_runtime.capsule import declared_capsule, resolve_capsule
from verify_runtime.families import (
    BASELINE_SKILL,
    CANDIDATE_SKILL,
    GB_PRO_FAMILY,
    GB_PRO_GRADER_SOURCE,
    GB_PRO_HELD_OUT_SOURCE,
    GB_PRO_REFERENCE_DATA,
    GB_PRO_REFERENCE_SOURCE,
    GB_PRO_TASKS,
    GB_PRO_TASKSET_PACKAGE,
    validate_gb_pro_family,
)
from verify_runtime.model import (
    AuthoredQuestion,
    BenchmarkFamily,
    ModelValidationError,
    TaskInstance,
    SeasonManifest,
    TasksetPackageReference,
    VerifiersPin,
    canonical_json_bytes,
    load_digest_pinned_source,
    sealed_answer_key_commitment,
    sha256_bytes,
    strict_json_loads,
)
from verify_runtime.protocol import lock_benchmark_protocol
from verify_runtime.runner import FixtureExecutor


DATASET_COMMIT = "c" * 40


def _capsules():
    identity = FixtureExecutor().resolve_identity()
    return (
        resolve_capsule(
            declared_capsule("builtin://baseline/SKILL.md", executor="fixture"),
            BASELINE_SKILL,
            identity=identity,
        ),
        resolve_capsule(
            declared_capsule("builtin://candidate/SKILL.md", executor="fixture"),
            CANDIDATE_SKILL,
            identity=identity,
        ),
    )


def _authored(*, acceptance: str = "accepted", answer_key: object | None = None) -> AuthoredQuestion:
    return AuthoredQuestion.create(
        task_input_digest=sha256_bytes(b"forge-question-input-v1\n"),
        author_identity="agent://regent/forge-author-01",
        pinned_data_revision=f"huggingface://datasets/regent-gb-pro@{DATASET_COMMIT}",
        deterministic_answer_key=answer_key if answer_key is not None else {"answer": [1, True]},
        acceptance_decision=acceptance,
    )


def test_gb_pro_family_is_pinned_without_embedded_task_shapes() -> None:
    family = validate_gb_pro_family()
    record = family.to_dict()

    assert len(family.reference_questions) == 10
    assert len({question.question_id for question in family.reference_questions}) == 10
    assert record["taskset_package"] == GB_PRO_TASKSET_PACKAGE.to_dict()
    assert set(record["taskset_package"]) == {"schema_version", "package", "version", "content_hash"}
    assert "tasks" not in record
    assert family.family_id == family.expected_family_id()
    assert type(GB_PRO_REFERENCE_SOURCE.revision) is str
    assert type(GB_PRO_HELD_OUT_SOURCE.revision) is str

    assert type(family).from_dict(record).to_dict() == record
    tampered = {**record, "reference_questions": [dict(item) for item in record["reference_questions"]]}
    tampered["reference_questions"][0]["answer_key_commitment"] = "0" * 64
    with pytest.raises(ModelValidationError, match="family_id does not match"):
        type(family).from_dict(tampered)


def test_external_sources_and_taskset_package_refuse_digest_mismatches() -> None:
    assert load_digest_pinned_source(GB_PRO_REFERENCE_SOURCE, GB_PRO_REFERENCE_DATA) == GB_PRO_REFERENCE_DATA
    with pytest.raises(ModelValidationError, match="external source content digest mismatch"):
        load_digest_pinned_source(GB_PRO_REFERENCE_SOURCE, b"different-source\n")

    package_content = b"verifiers-v1-taskset-package-fixture\n"
    package = TasksetPackageReference(1, "verifiers.v1.taskset.fixture", "1", sha256_bytes(package_content))
    assert package.verify_content(package_content) == package_content
    with pytest.raises(ModelValidationError, match="taskset package content hash mismatch"):
        package.verify_content(b"different-package\n")


def test_authored_question_has_only_the_four_business_fields_and_canonical_identity() -> None:
    question = _authored(answer_key={"answer": [1, True], "sentinel": "SEALED-ANSWER"})
    record = question.to_dict()
    assert set(record) == {
        "schema_version",
        "question_id",
        "task_input_digest",
        "author_identity",
        "pinned_data_revision",
        "deterministic_answer_key",
        "acceptance_decision",
    }
    assert type(question).from_dict(record).to_dict() == record
    assert "SEALED-ANSWER" not in canonical_json_bytes(question.public_dict(answer_key_commitment="0" * 64)).decode()

    for field, value in (
        ("author_identity", "agent://regent/forge-author-02"),
        ("pinned_data_revision", f"huggingface://datasets/regent-gb-pro@{'d' * 40}"),
        ("deterministic_answer_key", {"answer": [2, False]}),
        ("acceptance_decision", "rejected"),
        ("task_input_digest", sha256_bytes(b"different-question-input\n")),
    ):
        assert replace(question, **{field: value}).expected_question_id() != question.question_id

    tampered = record | {"author_identity": "agent://regent/forge-author-02"}
    with pytest.raises(ModelValidationError, match="canonical question content"):
        AuthoredQuestion.from_dict(tampered)
    with pytest.raises(ModelValidationError, match="immutable HuggingFace dataset locator"):
        _authored().create(
            task_input_digest=question.task_input_digest,
            author_identity=question.author_identity,
            pinned_data_revision="huggingface://datasets/regent-gb-pro@main",
            deterministic_answer_key=question.deterministic_answer_key,
            acceptance_decision="accepted",
        )


def test_sealed_answer_key_is_not_agent_visible_and_is_not_a_raw_key_digest() -> None:
    sentinel = "SEALED-ANSWER-KEY-SENTINEL"
    task = GB_PRO_TASKS[-1]
    commitment = sealed_answer_key_commitment(
        family=GB_PRO_FAMILY.to_dict(),
        task=task.to_dict(),
        grader_source=GB_PRO_GRADER_SOURCE,
        answer_key=sentinel,
    )
    assert commitment != sha256_bytes(sentinel.encode())

    from verify_runtime.adapters.prime import package_taskset
    from verify_runtime.model import MatchedSelection

    package = package_taskset(
        family=GB_PRO_FAMILY,  # type: ignore[arg-type]
        selection=MatchedSelection(task.task_id, task.partition, 0, task.provenance, commitment),
        task=task,
        side="candidate",
        skill_bytes=CANDIDATE_SKILL,
        task_input=b"gb-pro-authored-held-out-input-01\n",
        grader_source=GB_PRO_GRADER_SOURCE,
        max_spend_usd_cents=1_000,
        answer_key=sentinel,
    )
    assert sentinel.encode() not in canonical_json_bytes(package.agent_taskset)
    assert sentinel.encode() in package.sealed_verifier_packet


def test_benchmark_lock_derives_calibration_and_scored_sets_from_provenance() -> None:
    baseline, candidate = _capsules()
    protocol = lock_benchmark_protocol(baseline, candidate, family=GB_PRO_FAMILY, tasks=GB_PRO_TASKS)

    assert len(protocol.calibration_task_ids) == 10
    assert len(protocol.scored_task_ids) == 1
    assert all(selection.provenance == "public_reference" for selection in protocol.selections[:10])
    assert protocol.selections[-1].provenance == "held_out"
    assert protocol.challenge_revision_id == GB_PRO_FAMILY.challenge_contract.challenge_revision_id
    assert protocol.decision_rule == GB_PRO_FAMILY.challenge_contract.decision_rule
    assert protocol.taskset_version == GB_PRO_TASKSET_PACKAGE
    assert all("SEALED-ANSWER" not in canonical_json_bytes(value).decode() for value in (protocol.to_dict(),))

    fabricated = protocol.to_dict()
    fabricated["partitions"] = {**fabricated["partitions"], "validation": list(fabricated["partitions"]["untouched"])}
    with pytest.raises(ModelValidationError, match="protocol (partitions must contain unique|matched selections must equal)"):
        type(protocol).from_dict(fabricated)

    relabeled = replace(GB_PRO_TASKS[0], provenance="held_out")
    with pytest.raises(ModelValidationError, match="relabeled as held_out"):
        lock_benchmark_protocol(baseline, candidate, family=GB_PRO_FAMILY, tasks=(relabeled, *GB_PRO_TASKS[1:]))

    wrong_commitment = replace(GB_PRO_TASKS[0], answer_key_commitment="0" * 64)
    with pytest.raises(ModelValidationError, match="does not match the family"):
        lock_benchmark_protocol(baseline, candidate, family=GB_PRO_FAMILY, tasks=(wrong_commitment, *GB_PRO_TASKS[1:]))

    pending = _authored(acceptance="pending")
    with pytest.raises(ModelValidationError, match="only accepted authored questions"):
        lock_benchmark_protocol(baseline, candidate, family=GB_PRO_FAMILY, tasks=GB_PRO_TASKS, authored_questions=(pending,))


def test_reusable_family_shape_allows_zero_reference_calibration() -> None:
    baseline, candidate = _capsules()
    family = BenchmarkFamily.create(
        challenge_contract=GB_PRO_FAMILY.challenge_contract,
        taskset_package=GB_PRO_TASKSET_PACKAGE,
        held_out_source=GB_PRO_HELD_OUT_SOURCE,
    )
    task = TaskInstance(
        1,
        "zero-reference-held-out-01",
        family.family_id,
        "zero-reference.held-out",
        "validation",
        "gb-pro-agent",
        sha256_bytes(b"zero-reference-input\n"),
        sha256_bytes(GB_PRO_GRADER_SOURCE),
        "held_out",
        sealed_answer_key_commitment(
            family=family.to_dict(),
            task={
                "schema_version": 1,
                "task_id": "zero-reference-held-out-01",
                "family_id": family.family_id,
                "slice_id": "zero-reference.held-out",
                "partition": "validation",
                "role_id": "gb-pro-agent",
                "input_digest": sha256_bytes(b"zero-reference-input\n"),
                "grader_digest": sha256_bytes(GB_PRO_GRADER_SOURCE),
                "provenance": "held_out",
            },
            grader_source=GB_PRO_GRADER_SOURCE,
            answer_key={"answer": "zero-reference"},
        ),
    )
    protocol = lock_benchmark_protocol(baseline, candidate, family=family, tasks=(task,))
    assert protocol.calibration_task_ids == ()
    assert protocol.scored_task_ids == (task.task_id,)


def test_season_manifest_pins_verifiers_benchmark_identity_and_three_splits() -> None:
    manifest = SeasonManifest.create(
        challenge_revision_id=GB_PRO_FAMILY.challenge_contract.challenge_revision_id,
        verifiers=VerifiersPin("v1", "0.2.1", "e" * 40, "trace-v1"),
        benchmark_identity=GB_PRO_FAMILY.family_id,
        benchmark_public_name="Gene Bench Pro",
        taskset_package=GB_PRO_TASKSET_PACKAGE,
    )
    record = manifest.to_dict()
    assert strict_json_loads(canonical_json_bytes(record)) == record
    assert record["verifiers"] == {
        "api": "v1",
        "package_version": "0.2.1",
        "git_commit": "e" * 40,
        "trace_version": "trace-v1",
    }
    assert record["splits"] == {
        "development": {"visibility": "public", "reward_bearing": False, "purpose": "development"},
        "certification": {"visibility": "hidden", "reward_bearing": True, "purpose": "certification"},
        "successor": {"visibility": "hidden", "reward_bearing": False, "purpose": "anti-overfit"},
    }
    assert SeasonManifest.from_dict(record) == manifest

    tampered = {**record, "splits": {**record["splits"], "successor": {**record["splits"]["successor"], "reward_bearing": True}}}
    with pytest.raises(ModelValidationError, match="fixed three-split policy"):
        SeasonManifest.from_dict(tampered)
