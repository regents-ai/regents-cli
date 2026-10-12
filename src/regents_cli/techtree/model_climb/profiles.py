"""Compatibility profiles (contract section 7): the one tuple each certifies and how it is checked.

M0 is Qwen3.5-9B on prime-rl 1e53181. Its model-free step (7.4 step 1) runs in the image built
on this machine from `scripts/techtree/model-climb-image` (`make model-climb-image`), with no
network: prime-rl resolves the training configuration with `--dry-run`, renders the public
synthetic fixtures and masks their loss, and matches the LoRA targets on the model built on
PyTorch's meta device, so no weight is downloaded or loaded. Nothing here rents a machine.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final, Literal

from pydantic import ValidationError as PydanticValidationError

from regents_cli.techtree.errors import TechtreeError, ValidationError
from regents_cli.techtree.model_climb.contracts import ModelRef
from regents_cli.techtree.models.base import JsonValue, NonEmptyString, ProtocolModel

UNSUPPORTED_CAPABILITY: Final = "unsupported_capability"
#: How long the container may take: it builds the model on the meta device and renders four
#: short fixtures, which takes well under a minute.
CHECK_TIMEOUT_SECONDS: Final = 900


@dataclass(frozen=True)
class Profile:
    name: str
    model: ModelRef
    trainer_revision: str
    image: str
    renderer: str
    #: The text stack's layers, as the model names them.
    language_layers: str
    #: For each kind of text layer, the block holding its LoRA targets and the targets; then
    #: the block and targets every layer carries.
    layer_targets: dict[str, tuple[str, tuple[str, ...]]]
    mlp_targets: tuple[str, tuple[str, ...]]
    expected_modules: int

    @property
    def targets(self) -> list[str]:
        """The LoRA targets prime-rl matches, as regexes anchored to the text layers, so no
        module of the vision encoder or the multi-token-prediction layer can match."""
        layer = re.escape(self.language_layers) + r"\.\d+\."
        blocks = [*self.layer_targets.values(), self.mlp_targets]
        return [rf"^{layer}{re.escape(block)}\.({'|'.join(leaves)})$" for block, leaves in blocks]

    def module_names(self, layer_types: Sequence[str]) -> list[str]:
        """Every module the targets must match in a text stack with these layer kinds."""
        return [
            f"{self.language_layers}.{index}.{block}.{leaf}"
            for index, kind in enumerate(layer_types)
            for block, leaves in (self.layer_targets[kind], self.mlp_targets)
            for leaf in leaves
        ]


M0: Final = Profile(
    name="m0-qwen3.5-9b",
    model=ModelRef(model_id="Qwen/Qwen3.5-9B", revision="c202236235762e1c871ad0ccb60c8ee5ba337b9a"),
    trainer_revision="1e5318108da29d10960e91e54b80305f597de39d",
    image="regents-model-climb:m0-qwen3.5-9b",
    renderer="qwen3.5",
    language_layers="model.language_model.layers",
    layer_targets={
        "full_attention": ("self_attn", ("q_proj", "k_proj", "v_proj", "o_proj")),
        "linear_attention": (
            "linear_attn",
            ("in_proj_qkv", "in_proj_z", "in_proj_b", "in_proj_a", "out_proj"),
        ),
    },
    mlp_targets=("mlp", ("gate_proj", "up_proj", "down_proj")),
    expected_modules=248,
)
PROFILES: Final = {M0.name: M0}

#: The training settings the dry run resolves. They shape no result: M0's paid step reads its
#: settings from a TrainingRecipe.
DRY_RUN_RECIPE: Final[dict[str, JsonValue]] = {
    "rank": 16,
    "alpha": 32,
    "dropout": 0.0,
    "learning_rate": 1e-5,
    "seq_len": 2048,
    "batch_size": 1,
    "micro_batch_size": 1,
    "max_steps": 1,
}


# What the image prints: one JSON answer, read strictly.


class CheckEnvironment(ProtocolModel):
    prime_rl_revision: NonEmptyString
    python: NonEmptyString
    machine: NonEmptyString
    torch: NonEmptyString
    transformers: NonEmptyString


class CheckDryRun(ProtocolModel):
    succeeded: bool
    exit_code: int
    input: str
    log_tail: list[str]
    resolved: JsonValue = None


class CheckFixture(ProtocolModel):
    id: NonEmptyString
    renderer: NonEmptyString
    tokens: int
    trained_tokens: int
    every_answer_trained: bool
    no_prompt_trained: bool
    residue: str
    trained_spans: list[str]


class CheckModules(ProtocolModel):
    model_class: NonEmptyString
    attn: NonEmptyString
    language_layers: list[str]
    layer_types: list[str]
    matched: list[str]


class CheckAnswer(ProtocolModel):
    model: ModelRef
    environment: CheckEnvironment
    dry_run: CheckDryRun
    fixtures: list[CheckFixture] | None = None
    modules: CheckModules | None = None


@dataclass(frozen=True)
class Ran:
    answer: CheckAnswer
    image_id: str
    log: str


def docker_available() -> bool:
    """Whether a Docker engine answers on this machine."""
    if shutil.which("docker") is None:
        return False
    try:
        probe = subprocess.run(
            ["docker", "info", "--format", "{{.ServerVersion}}"],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except subprocess.TimeoutExpired:
        return False
    return probe.returncode == 0


def run_check(profile: Profile) -> Ran:
    """Run the profile's model-free check in its image, with no network."""
    if not docker_available():
        raise TechtreeError(
            "the model-free check runs in a container, and no Docker engine answers on this "
            "machine. Start Docker and run it again; nothing else can stand in for it.",
            code=UNSUPPORTED_CAPABILITY,
            details={"step": "docker"},
        )
    inspected = subprocess.run(
        ["docker", "image", "inspect", "--format", "{{.Id}}", profile.image],
        capture_output=True,
        text=True,
    )
    if inspected.returncode != 0:
        raise TechtreeError(
            f"the image {profile.image} isn't built on this machine. In a regents-cli "
            "checkout, run make model-climb-image, then run this again.",
            code=UNSUPPORTED_CAPABILITY,
            details={"step": "image", "image": profile.image},
        )
    recipe = {**DRY_RUN_RECIPE, "renderer": profile.renderer, "targets": profile.targets}
    try:
        ran = subprocess.run(
            ["docker", "run", "--rm", "--network", "none", profile.image, json.dumps(recipe)],
            capture_output=True,
            text=True,
            timeout=CHECK_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise TechtreeError(
            f"the check did not finish within {CHECK_TIMEOUT_SECONDS} seconds",
            code=UNSUPPORTED_CAPABILITY,
            details={"step": "check"},
        ) from error
    try:
        answer = CheckAnswer.model_validate_json(ran.stdout)
    except PydanticValidationError as error:
        raise TechtreeError(
            f"the check stopped before it answered (exit {ran.returncode}): "
            f"{_last_line(ran.stderr)}",
            code=UNSUPPORTED_CAPABILITY,
            details={"step": "check", "exit_code": ran.returncode, "log_tail": ran.stderr[-4000:]},
        ) from error
    return Ran(answer=answer, image_id=inspected.stdout.strip(), log=ran.stderr)


def _last_line(text: str) -> str:
    lines = [line for line in text.splitlines() if line.strip()]
    return lines[-1] if lines else "no output"


# The coverage check (contract 7.2).


@dataclass(frozen=True)
class Coverage:
    expected: int
    matched: int
    missing: list[str]
    unexpected: list[str]

    @property
    def holds(self) -> bool:
        return not self.missing and not self.unexpected


def coverage(profile: Profile, matched: Sequence[str], *, layer_types: Sequence[str]) -> Coverage:
    """The matched modules against the expected set, which they must equal exactly: in each
    text layer, each target for its kind once, and nothing anywhere else (the vision encoder,
    the multi-token-prediction layer).
    """
    unknown = sorted(set(layer_types) - set(profile.layer_targets))
    if unknown:
        raise ValidationError(
            f"the model has layers of a kind the {profile.name} profile doesn't know: "
            f"{', '.join(unknown)}",
            details={"layer_types": unknown},
        )
    expected = profile.module_names(layer_types)
    counts = Counter(matched)
    missing = [name for name in expected if name not in counts]
    if len(expected) != profile.expected_modules:
        missing.append(
            f"the model's text layers expect {len(expected)} modules, not the "
            f"{profile.expected_modules} the profile pins"
        )
    wanted = set(expected)
    unexpected = [name for name in matched if name not in wanted]
    unexpected += sorted(name for name, count in counts.items() if count > 1 and name in wanted)
    return Coverage(
        expected=profile.expected_modules,
        matched=len(matched),
        missing=missing,
        unexpected=unexpected,
    )


type CheckStatus = Literal["pass", "fail"]
