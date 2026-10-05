"""Proving that two variants differ only where permitted.

Structural invariants are required outright (same Campaign, program, context, policy,
contract, plan; the right variant on each side; the Skill counts the mutation kind needs).
Then the two configurations are canonicalized and diffed to their leaves; every differing
pointer must lie within the mutation contract's one allowed root, and no difference at all is
also a violation. The diff is over canonical JSON so that Python equality never widens the
question. `compare_manifests` reports; `assert_controlled_comparison` refuses.
"""

from __future__ import annotations

import json
from typing import Final

from regents_cli.techtree.canonical import canonical_json_bytes
from regents_cli.techtree.errors import VerificationError
from regents_cli.techtree.models.base import JsonValue
from regents_cli.techtree.models.campaign import MutationContract, MutationKind
from regents_cli.techtree.models.experiment import (
    ExperimentManifestV4,
    ExperimentVariant,
    JsonDifference,
    ManifestComparison,
)
from regents_cli.techtree.pointers import (
    POINTER_SEPARATOR,
    json_pointer_escape,
    pointer_is_within,
)

MANIFEST_COMPARISON_INVALID: Final = "manifest_comparison_invalid"


def diff_values(
    baseline: JsonValue, candidate: JsonValue, *, pointer: str = ""
) -> list[JsonDifference]:
    """The leaves at which two JSON values disagree, as RFC 6901 pointers.

    The walk descends only where both sides are the same kind of container; anything else is
    reported at that pointer and not decomposed further.
    """
    if isinstance(baseline, dict) and isinstance(candidate, dict):
        return _diff_objects(baseline, candidate, pointer)
    if isinstance(baseline, list) and isinstance(candidate, list):
        return _diff_arrays(baseline, candidate, pointer)
    if _same_scalar(baseline, candidate):
        return []
    return [_difference(pointer, baseline, candidate)]


def compare_manifests(
    baseline: ExperimentManifestV4, candidate: ExperimentManifestV4, mutation: MutationContract
) -> ManifestComparison:
    """Compare two variants' configurations and report whether the pair is controlled."""
    allowed = list(mutation.allowed_differences)
    violations = [
        *_variant_violations(baseline, candidate),
        *_shared_field_violations(baseline, candidate),
        *_skill_count_violations(baseline, candidate, mutation),
    ]
    differences = sorted(
        diff_values(_configuration_json(baseline), _configuration_json(candidate)),
        key=lambda difference: difference.pointer,
    )
    if not differences:
        violations.append(
            "the candidate configuration is identical to the baseline, so the pair measures nothing"
        )
    violations.extend(_pointer_violations(differences, allowed))
    return ManifestComparison(
        baseline_configuration_digest=baseline.configuration_digest,
        candidate_configuration_digest=candidate.configuration_digest,
        differences=differences,
        allowed_differences=allowed,
        controlled=not violations,
        violations=violations,
    )


def assert_controlled_comparison(comparison: ManifestComparison) -> None:
    if comparison.controlled:
        return
    raise VerificationError(
        "the candidate differs from the baseline somewhere the Campaign does not permit, so "
        "the comparison would not measure the skill: " + "; ".join(comparison.violations),
        code=MANIFEST_COMPARISON_INVALID,
        details={
            "violations": list(comparison.violations),
            "differences": [difference.pointer for difference in comparison.differences],
            "allowed_differences": list(comparison.allowed_differences),
        },
    )


def _diff_objects(
    baseline: dict[str, JsonValue], candidate: dict[str, JsonValue], pointer: str
) -> list[JsonDifference]:
    differences: list[JsonDifference] = []
    for key in sorted(baseline.keys() | candidate.keys()):
        child = f"{pointer}{POINTER_SEPARATOR}{json_pointer_escape(key)}"
        if key not in baseline:
            differences.append(_difference(child, None, candidate[key]))
        elif key not in candidate:
            differences.append(_difference(child, baseline[key], None))
        else:
            differences.extend(diff_values(baseline[key], candidate[key], pointer=child))
    return differences


def _diff_arrays(
    baseline: list[JsonValue], candidate: list[JsonValue], pointer: str
) -> list[JsonDifference]:
    differences: list[JsonDifference] = []
    for index in range(max(len(baseline), len(candidate))):
        child = f"{pointer}{POINTER_SEPARATOR}{index}"
        if index >= len(baseline):
            differences.append(_difference(child, None, candidate[index]))
        elif index >= len(candidate):
            differences.append(_difference(child, baseline[index], None))
        else:
            differences.extend(diff_values(baseline[index], candidate[index], pointer=child))
    return differences


def _same_scalar(baseline: JsonValue, candidate: JsonValue) -> bool:
    """`True == 1` and `1 == 1.0` in Python but not in JSON, so the type must agree first."""
    if isinstance(baseline, bool) != isinstance(candidate, bool):
        return False
    if isinstance(baseline, int | float) != isinstance(candidate, int | float):
        return False
    return baseline == candidate


def _difference(pointer: str, baseline: JsonValue, candidate: JsonValue) -> JsonDifference:
    # The empty pointer (the whole document) cannot be held by the model; it is reported as `/`.
    return JsonDifference(
        pointer=pointer or POINTER_SEPARATOR, baseline=baseline, candidate=candidate
    )


def _configuration_json(manifest: ExperimentManifestV4) -> JsonValue:
    decoded: JsonValue = json.loads(canonical_json_bytes(manifest.configuration).decode("utf-8"))
    return decoded


def _variant_violations(
    baseline: ExperimentManifestV4, candidate: ExperimentManifestV4
) -> list[str]:
    violations: list[str] = []
    if baseline.variant is not ExperimentVariant.BASELINE:
        violations.append(
            f"the baseline side of the comparison is a {baseline.variant.value} manifest"
        )
    if candidate.variant is not ExperimentVariant.CANDIDATE:
        violations.append(
            f"the candidate side of the comparison is a {candidate.variant.value} manifest"
        )
    return violations


def _shared_field_violations(
    baseline: ExperimentManifestV4, candidate: ExperimentManifestV4
) -> list[str]:
    return [
        f"the baseline and the candidate name a different {label}"
        for label, left, right in (
            ("Campaign", baseline.campaign_spec_digest, candidate.campaign_spec_digest),
            ("improvement program", baseline.program_ref, candidate.program_ref),
            ("public context", baseline.public_context, candidate.public_context),
            (
                "DataPolicy",
                baseline.configuration.data_policy_digest,
                candidate.configuration.data_policy_digest,
            ),
            (
                "OutcomeContract",
                baseline.configuration.outcome_contract_digest,
                candidate.configuration.outcome_contract_digest,
            ),
            (
                "execution plan",
                baseline.configuration.execution_plan_digest,
                candidate.configuration.execution_plan_digest,
            ),
        )
        if left != right
    ]


def _skill_count_violations(
    baseline: ExperimentManifestV4, candidate: ExperimentManifestV4, mutation: MutationContract
) -> list[str]:
    target = mutation.target_agent
    baseline_agent = baseline.configuration.agents.get(target)
    candidate_agent = candidate.configuration.agents.get(target)
    if baseline_agent is None or candidate_agent is None:
        return [f"a variant defines no {target} agent to compare"]
    baseline_skills = baseline_agent.harness.skills
    candidate_skills = candidate_agent.harness.skills
    violations: list[str] = []
    if mutation.kind is MutationKind.SKILL_INSERTION:
        if baseline_skills:
            violations.append(
                f"the baseline carries {len(baseline_skills)} candidate skills; a baseline "
                "carries none"
            )
    elif len(baseline_skills) != 1:
        violations.append(
            f"the baseline carries {len(baseline_skills)} skills; a replacement replaces "
            "exactly one"
        )
    if len(candidate_skills) != 1:
        violations.append(
            f"the candidate carries {len(candidate_skills)} skills; exactly one is measured"
        )
    if (
        mutation.kind is MutationKind.SKILL_REPLACEMENT
        and len(baseline_skills) == 1
        and len(candidate_skills) == 1
        and baseline_skills[0].digest == candidate_skills[0].digest
    ):
        violations.append(
            "the candidate skill has the baseline skill's root digest, so the replacement "
            "measures nothing"
        )
    return violations


def _pointer_violations(differences: list[JsonDifference], allowed: list[str]) -> list[str]:
    return [
        f"the candidate differs at {difference.pointer}, which the mutation contract does "
        "not permit"
        for difference in differences
        if not any(pointer_is_within(difference.pointer, root) for root in allowed)
    ]
