"""Compatibility profiles (contract section 7): the one tuple each certifies and how it is checked.

M0 is Qwen3.5-9B on prime-rl v0.10.0 (9e15490). Its model-free step (7.4 step 1) runs in the
image built on this machine from `src/regents_cli/techtree/resources/model-climb-image`
(`make model-climb-image`), with no network: prime-rl resolves the training configuration with
`--dry-run`, renders the public synthetic fixtures and masks their loss, and matches the LoRA
targets on the model built on PyTorch's meta device, so no weight is downloaded or loaded.
Nothing here rents a machine; the paid step (7.4 step 2) is `profile_test`.
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

from regents_cli import output
from regents_cli.techtree.errors import TechtreeError, ValidationError
from regents_cli.techtree.model_climb.contracts import ModelRef
from regents_cli.techtree.models.base import JsonValue, NonEmptyString, ProtocolModel

UNSUPPORTED_CAPABILITY: Final = "unsupported_capability"
#: How long the container may take: it builds the model on the meta device and renders four
#: short fixtures, which takes well under a minute.
CHECK_TIMEOUT_SECONDS: Final = 900


@dataclass(frozen=True)
class Settings:
    """A profile's training settings: what its recipe pins, and what both the model-free check
    and the paid step's job resolve."""

    rank: int
    alpha: int
    dropout: float
    learning_rate: float
    weight_decay: float
    seed: int
    max_context_tokens: int
    batch_size: int
    micro_batch_size: int
    max_steps: int
    #: The one evaluation the training run makes, which is what writes the adapter.
    eval_max_tokens: int
    eval_temperature: float
    #: The Verifiers taskset both that evaluation and the paid step's fixture run use.
    taskset: str


@dataclass(frozen=True)
class Profile:
    name: str
    model: ModelRef
    #: The sha256 of each weight file and each tokenizer file at the pinned revision.
    weight_files: dict[str, str]
    tokenizer_files: dict[str, str]
    trainer_revision: str
    #: The sha256 of prime-rl's uv.lock at that revision.
    trainer_lock_sha256: str
    image: str
    renderer: str
    settings: Settings
    gpu_model: str
    gpu_count: int
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

    @property
    def recipe(self) -> dict[str, JsonValue]:
        """The settings as the image's scripts take them, one JSON argument."""
        settings = self.settings
        return {
            "rank": settings.rank,
            "alpha": settings.alpha,
            "dropout": settings.dropout,
            "learning_rate": settings.learning_rate,
            "weight_decay": settings.weight_decay,
            "seed": settings.seed,
            "seq_len": settings.max_context_tokens,
            "batch_size": settings.batch_size,
            "micro_batch_size": settings.micro_batch_size,
            "max_steps": settings.max_steps,
            "eval_max_tokens": settings.eval_max_tokens,
            "eval_temperature": settings.eval_temperature,
            "taskset": settings.taskset,
            "renderer": self.renderer,
            "targets": [*self.targets],
        }

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
    weight_files={
        "model.safetensors-00001-of-00004.safetensors": (
            "db6f444b43d318c92f360a13a25561a6a65b10c0631b8ed305a426dbaa6c380e"
        ),
        "model.safetensors-00002-of-00004.safetensors": (
            "31c7d7e2dd5d207840b31cc59083c8f4c4718959149e0358c0364052bb9a0330"
        ),
        "model.safetensors-00003-of-00004.safetensors": (
            "7ec36ba3a4176a44c3c0876ad80c56a2f70c84bf008d82e9501df642f17dadec"
        ),
        "model.safetensors-00004-of-00004.safetensors": (
            "b62b0c4cd7e44edee103ee8f4fe225f246d5e768e07bfd5f25b63a8aa1fdd0c6"
        ),
    },
    tokenizer_files={
        "tokenizer.json": "5f9e4d4901a92b997e463c1f46055088b6cca5ca61a6522d1b9f64c4bb81cb42",
        "tokenizer_config.json": "316230d6a809701f4db5ea8f8fc862bc3a6f3229c937c174e674ff3ca0a64ac8",
        "vocab.json": "ce99b4cb2983d118806ce0a8b777a35b093e2000a503ebde25853284c9dfa003",
        "merges.txt": "a9d356d7bdf1ef4949e3e748e95b8e10ad9d4e2e838eddc38a0a7b6b94d1db8d",
        "chat_template.jinja": "a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715",
    },
    trainer_revision="9e15490dcab1d506ce3462e69b8aa5dde45c6b3a",
    trainer_lock_sha256="d3ba57d0b68d01924b1a5c0882c7e8dccda13fdcbd527d7c8913f77d36014919",
    image="regents-model-climb:m0-qwen3.5-9b",
    renderer="qwen3.5",
    settings=Settings(
        rank=16,
        alpha=32,
        dropout=0.0,
        learning_rate=1e-4,
        weight_decay=0.0,
        seed=0,
        max_context_tokens=2048,
        batch_size=4,
        micro_batch_size=1,
        max_steps=40,
        eval_max_tokens=256,
        eval_temperature=0.0,
        taskset="model-climb-fixture",
    ),
    gpu_model="h100",
    gpu_count=2,
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
    try:
        ran = subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                profile.image,
                json.dumps(profile.recipe),
            ],
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


# What the resolved training configuration must show (contract 7.2 and 7.3).


def _setting(resolved: JsonValue, *path: str) -> JsonValue:
    """One setting of prime-rl's resolved configuration, or None where it has none."""
    for key in path:
        resolved = resolved.get(key) if isinstance(resolved, dict) else None
    return resolved


def config_checks(resolved: JsonValue) -> list[output.Check]:
    unmerged = _setting(resolved, "model", "fusions", "enabled") == []
    quiet = (
        _setting(resolved, "dashboard") is False
        and _setting(resolved, "heartbeat") is None
        and _setting(resolved, "control") is None
        and _setting(resolved, "monitors", "prime") is None
        and _setting(resolved, "monitors", "wandb") is None
    )
    return [
        output.Check(
            "Layer merging off",
            "pass" if unmerged else "fail",
            "LoRA attaches to the separate projections the coverage check counts",
        ),
        output.Check(
            "Nothing sent anywhere",
            "pass" if quiet else "fail",
            "no dashboard, heartbeat, run control port, Prime or W&B monitor; metrics stay in "
            "a local file"
            if quiet
            else "the configuration starts a dashboard, a heartbeat, a run control port or an "
            "online monitor",
        ),
    ]


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
