"""Model Climb's model-free M0 check (contract model-climb-v1, 7.4 step 1), run inside the image.

Takes the recipe's training settings as one JSON argument, the same one the paid step's job
is given, and prints one JSON answer on stdout; prime-rl's own log goes to stderr. Every step
uses prime-rl's own code at the pinned commit: its `sft --dry-run` resolves the configuration,
its SFT dataset renders and masks the fixtures, and its LoRA target matcher runs over the
model built on the meta device, so no weight is ever loaded. The image runs with no network.
"""

from __future__ import annotations

import copy
import json
import os
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any

PRIME_RL = Path("/opt/prime-rl")
FIXTURES = Path("/opt/m0/fixtures.jsonl")
WORK = Path("/tmp/m0")
THINK_TAGS = ("<think>", "</think>")


def main() -> None:
    # prime-rl logs to stdout; the answer alone goes there, so everything else goes to stderr.
    answer_out = os.fdopen(os.dup(sys.stdout.fileno()), "w")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    recipe = json.loads(sys.argv[1])
    model_dir = Path(os.environ["MODEL_DIR"])
    model_id, model_revision = (model_dir / "PINNED").read_text().split()
    answer: dict[str, Any] = {
        "model": {"model_id": model_id, "revision": model_revision},
        "environment": environment(),
    }
    resolved = dry_run(recipe, model_dir, answer)
    if resolved is not None:
        from prime_rl.configs.sft import SFTConfig

        # Validating fills the evaluation source in place, so it reads a copy.
        config = SFTConfig.model_validate(copy.deepcopy(resolved))
        answer["fixtures"] = fixtures(config)
        answer["modules"] = modules(config, recipe["targets"])
    json.dump(answer, answer_out)
    answer_out.close()


def environment() -> dict[str, str]:
    import torch
    import transformers

    revision = subprocess.run(
        ["git", "-C", str(PRIME_RL), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return {
        "prime_rl_revision": revision,
        "python": platform.python_version(),
        "machine": platform.machine(),
        "torch": torch.__version__,
        "transformers": transformers.__version__,
    }


def sft_toml(recipe: dict[str, Any], model_dir: Path) -> str:
    targets = ", ".join(json.dumps(target) for target in recipe["targets"])
    return "\n".join(
        [
            f"max_steps = {recipe['max_steps']}",
            "dashboard = false",
            "",
            "[model]",
            f"name = {json.dumps(str(model_dir))}",
            # Named, not "auto": on an H100 "auto" picks a kernel neither image installs.
            'attn = "flash_attention_2"',
            'optimization_dtype = "bfloat16"',
            'reduce_dtype = "bfloat16"',
            "",
            "[model.fusions]",
            "enabled = []",
            "",
            "[model.lora]",
            f"rank = {recipe['rank']}",
            f"alpha = {recipe['alpha']}",
            f"dropout = {recipe['dropout']}",
            f"target_modules = [{targets}]",
            "",
            "[renderer]",
            f"name = {json.dumps(recipe['renderer'])}",
            "",
            "[data]",
            'type = "sft"',
            f"name = {json.dumps(str(FIXTURES.parent))}",
            f"batch_size = {recipe['batch_size']}",
            f"micro_batch_size = {recipe['micro_batch_size']}",
            f"seq_len = {recipe['seq_len']}",
            f"seed = {recipe['seed']}",
            "",
            "[data.loss_mask]",
            "assistant = true",
            "",
            "[optim]",
            f"lr = {recipe['learning_rate']}",
            f"weight_decay = {recipe['weight_decay']}",
            "",
            # One evaluation, after the last step. With LoRA it is what makes prime-rl write
            # the adapter in the form vLLM loads (contract 7.3).
            "[eval]",
            f"interval = {recipe['max_steps']}",
            "",
            "[eval.sampling]",
            f"max_completion_tokens = {recipe['eval_max_tokens']}",
            f"temperature = {recipe['eval_temperature']}",
            "",
            "[[eval.source]]",
            f"name = {json.dumps(recipe['taskset'])}",
            f"env.taskset.id = {json.dumps(recipe['taskset'])}",
            'env.agent.harness.id = "null"',
            'env.agent.runtime.type = "subprocess"',
            "",
            "[inference]",
            "",
            "[deployment]",
            "num_train_gpus = 1",
            "num_infer_gpus = 1",
            "",
        ]
    )


def dry_run(recipe: dict[str, Any], model_dir: Path, answer: dict[str, Any]) -> Any:
    """prime-rl's own `sft --dry-run`; the configuration it resolved, or None when it failed."""
    WORK.mkdir(parents=True, exist_ok=True)
    toml = WORK / "sft.toml"
    toml.write_text(sft_toml(recipe, model_dir))
    config_dir = WORK / "configs"
    run = subprocess.run(
        [str(PRIME_RL / ".venv/bin/sft"), "@", str(toml), "--dry-run"],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PRL_ATTEMPT_CONFIG_DIR": str(config_dir),
            "PRL_ATTEMPT_LOG_DIR": str(WORK / "logs"),
        },
    )
    sys.stderr.write(run.stdout + run.stderr)
    resolved_path = config_dir / "sft.json"
    succeeded = run.returncode == 0 and resolved_path.is_file()
    answer["dry_run"] = {
        "succeeded": succeeded,
        "exit_code": run.returncode,
        "input": toml.read_text(),
        "log_tail": (run.stdout + run.stderr).splitlines()[-40:],
    }
    if not succeeded:
        return None
    resolved = json.loads(resolved_path.read_text())
    answer["dry_run"]["resolved"] = resolved
    return resolved


def fixtures(config: Any) -> list[dict[str, Any]]:
    """Each fixture as prime-rl's SFT dataset renders it, and whether only the assistant's
    answers carry loss."""
    from datasets import Dataset
    from prime_rl.trainer.model import setup_tokenizer
    from prime_rl.trainer.sft.data import RendererResolver, SFTDataset

    rows = [json.loads(line) for line in FIXTURES.read_text().splitlines() if line.strip()]
    tokenizer = setup_tokenizer(config.tokenizer)
    resolver = RendererResolver(tokenizer, config.renderer, columns=config.data.columns.renderer)
    dataset = SFTDataset(
        Dataset.from_list(rows),
        renderers=resolver,
        shuffle=False,
        seq_len=config.data.seq_len,
        loss_mask_config=config.data.loss_mask,
        columns=config.data.columns,
    )
    scaffolding = {*tokenizer.all_special_tokens, *THINK_TAGS}
    results = []
    for row in rows:
        sample = dataset._process(row)
        messages = row.get("messages") or [*row["prompt"], *row["completion"]]
        answers = [message["content"] for message in messages if message["role"] == "assistant"]
        others = [message["content"] for message in messages if message["role"] != "assistant"]
        spans = masked_spans(tokenizer, sample["target_ids"], sample["loss_mask"])
        trained = "\n".join(spans)
        residue = trained
        for text in answers:
            residue = residue.replace(text, "", 1)
        for token in scaffolding:
            residue = residue.replace(token, "")
        results.append(
            {
                "id": row["id"],
                "renderer": type(resolver(row)).__name__,
                "tokens": len(sample["input_ids"]),
                "trained_tokens": sum(sample["loss_mask"]),
                "every_answer_trained": all(text in trained for text in answers),
                "no_prompt_trained": not any(text in trained for text in others),
                "residue": residue.strip(),
                "trained_spans": spans,
            }
        )
    return results


def masked_spans(tokenizer: Any, target_ids: list[int], loss_mask: list[bool]) -> list[str]:
    spans: list[list[int]] = []
    previous = False
    for token, trained in zip(target_ids, loss_mask, strict=True):
        if trained:
            if not previous:
                spans.append([])
            spans[-1].append(token)
        previous = trained
    return [tokenizer.decode(span) for span in spans]


def modules(config: Any, targets: list[str]) -> dict[str, Any]:
    """The module paths prime-rl's LoRA matcher picks on the model built on the meta device."""
    import torch
    from prime_rl.trainer.lora import _find_target_modules
    from prime_rl.trainer.model import get_model
    from transformers import AutoConfig

    model = get_model(config.model, device=torch.device("meta"), dtype=torch.bfloat16)
    text = AutoConfig.from_pretrained(config.model.name)
    text = getattr(text, "text_config", text)
    layers = [
        name
        for name, module in model.named_modules()
        if isinstance(module, torch.nn.ModuleList)
        and name.endswith(".layers")
        and len(module) == text.num_hidden_layers
        and "visual" not in name
    ]
    return {
        "model_class": type(model).__name__,
        "attn": config.model.attn,
        "language_layers": layers,
        "layer_types": list(text.layer_types),
        "matched": _find_target_modules(model, targets),
    }


if __name__ == "__main__":
    main()
