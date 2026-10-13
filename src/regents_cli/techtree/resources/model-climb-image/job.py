"""Model Climb's paid M0 step (contract model-climb-v1, 7.4 step 2), run inside the GPU image.

One batch job on two GPUs. It takes its settings as JSON in MODEL_CLIMB_JOB, the same recipe
the model-free check resolved, and measures; the CLI judges what it measured. In order:

1. Record the machine: GPUs, driver, kernel and the installed versions.
2. Download the pinned model revision, then go offline for good, and check every weight and
   tokenizer file against the pinned sha256. A file that differs ends the job before training.
3. Run prime-rl's SFT on the four fixtures with one online evaluation, which is what writes
   the adapter in the form vLLM loads.
4. Read the adapter: which modules it holds, and whether every lora_B tensor is nonzero.
5. Start a fresh vLLM, with no prime-rl patch loaded, on the base revision with the adapter.
6. Run the one Verifiers fixture against the adapter with --no-push.
7. Ask the base model each fixture twice and the adapter once, with token log-probabilities.

The whole measurement goes to $GMN_RESULT_PATH, which the provider hands back with the job.
`profile.json` is written into $GMN_OUTPUT_DIR only when every step ran to its end, and that
file is the job's success check. The job holds no key and no token, installs nothing, and
writes nowhere else.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from importlib import metadata
from pathlib import Path
from typing import Any

from check import FIXTURES, PRIME_RL, sft_toml

WORK = Path("/tmp/m0")
VENV_BIN = PRIME_RL / ".venv/bin"
SERVE_PORT = 9000
SERVE_URL = f"http://127.0.0.1:{SERVE_PORT}"
BASE_NAME = "m0-base"
ADAPTER_NAME = "m0-adapter"
SERVE_READY_SECONDS = 1500
REQUEST_SECONDS = 600
SCHEMA = Path(__file__).with_name("invoice-fields.schema.json")
SCHEMA_FIXTURE = "invoice-fields"
#: The one reward model_climb_fixture.py gives.
REWARD = "fixture_reward"
PACKAGES = ("torch", "transformers", "vllm", "verifiers", "prime-rl", "safetensors")
#: The image sets these so uv can neither look a package up nor fetch one while the job runs.
PACKAGE_TOOLS = ("UV_FROZEN", "UV_NO_INDEX")


class StopJob(Exception):
    """A step found something that ends the job; the message says what."""


def main() -> None:
    spec = json.loads(os.environ["MODEL_CLIMB_JOB"])
    output = Path(os.environ["GMN_OUTPUT_DIR"])
    output.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    result: dict[str, Any] = {"profile": spec["profile"], "completed": False}
    memory = GpuMemory()
    memory.start()
    step = "environment"
    try:
        result["environment"] = environment()
        step = "download"
        result["download"] = download(spec)
        step = "train"
        result["train"] = train(spec, output)
        step = "adapter"
        adapter_dir = latest_adapter()
        result["adapter"] = read_adapter(adapter_dir)
        step = "serve"
        server = serve(spec, adapter_dir, output)
        try:
            step = "verifiers"
            result["verifiers"] = verifiers_fixture(spec, output)
            step = "answers"
            result["answers"] = answers(spec)
        finally:
            server.terminate()
            server.wait(timeout=120)
        result["completed"] = True
    except StopJob as stop:
        result["stopped"] = {"step": step, "reason": str(stop)}
    except Exception as error:
        traceback.print_exc()
        result["stopped"] = {"step": step, "reason": f"{type(error).__name__}: {error}"}
    result["gpu_peak_memory_mib"] = memory.stop()
    text = json.dumps(result, sort_keys=True)
    Path(os.environ["GMN_RESULT_PATH"]).write_text(text)
    if result["completed"]:
        (output / "profile.json").write_text(text)
    sys.exit(0 if result["completed"] else 1)


# 1. The machine.


class GpuMemory(threading.Thread):
    """The most memory each GPU held at any moment of the job, as the driver reports it."""

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self.peaks: dict[str, int] = {}
        self.done = threading.Event()

    def run(self) -> None:
        while not self.done.wait(2.0):
            for index, used in gpu_query("index,memory.used"):
                self.peaks[index] = max(self.peaks.get(index, 0), int(used))

    def stop(self) -> dict[str, int]:
        self.done.set()
        self.join(timeout=30)
        return self.peaks


def gpu_query(fields: str) -> list[list[str]]:
    ran = subprocess.run(
        ["nvidia-smi", f"--query-gpu={fields}", "--format=csv,noheader,nounits"],
        capture_output=True,
        text=True,
    )
    if ran.returncode != 0:
        return []
    return [[cell.strip() for cell in line.split(",")] for line in ran.stdout.splitlines() if line]


def environment() -> dict[str, Any]:
    import torch

    revision = subprocess.run(
        ["git", "-C", str(PRIME_RL), "rev-parse", "HEAD"], capture_output=True, text=True
    ).stdout.strip()
    gpus = [
        {"index": index, "name": name, "memory_total_mib": int(total), "driver": driver}
        for index, name, total, driver in gpu_query("index,name,memory.total,driver_version")
    ]
    if len(gpus) < 2:
        raise StopJob(f"the job needs two GPUs and sees {len(gpus)}")
    return {
        "gpus": gpus,
        "cuda": torch.version.cuda,
        "kernel": platform.release(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "prime_rl_revision": revision,
        "packages": {name: metadata.version(name) for name in PACKAGES},
        "package_tools": {name: os.environ.get(name) for name in PACKAGE_TOOLS},
    }


# 2. The pinned model.


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1 << 24):
            digest.update(chunk)
    return digest.hexdigest()


def download(spec: dict[str, Any]) -> dict[str, Any]:
    from huggingface_hub import snapshot_download

    model_dir = Path(os.environ["MODEL_DIR"])
    started = time.monotonic()
    snapshot_download(
        spec["model"]["model_id"],
        revision=spec["model"]["revision"],
        local_dir=model_dir,
        token=False,
    )
    # Nothing after this line reaches the network: every later process inherits these.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    seconds = round(time.monotonic() - started)
    pinned = {**spec["weight_files"], **spec["tokenizer_files"]}
    found = {name: sha256_file(model_dir / name) for name in pinned}
    differing = sorted(name for name in pinned if found[name] != pinned[name])
    if differing:
        raise StopJob(f"these files differ from their pinned sha256: {', '.join(differing)}")
    return {"seconds": seconds, "files_checked": len(pinned)}


# 3. Training.


def train(spec: dict[str, Any], output: Path) -> dict[str, Any]:
    toml = WORK / "sft.toml"
    toml.write_text(sft_toml(spec["recipe"], Path(os.environ["MODEL_DIR"])))
    config_dir = WORK / "configs"
    log_dir = WORK / "logs"
    started = time.monotonic()
    ran = subprocess.run(
        [str(VENV_BIN / "sft"), "@", str(toml)],
        env={
            **os.environ,
            "PRL_ATTEMPT_CONFIG_DIR": str(config_dir),
            "PRL_ATTEMPT_LOG_DIR": str(log_dir),
        },
    )
    seconds = round(time.monotonic() - started)
    shutil.copytree(log_dir, output / "train-logs", dirs_exist_ok=True)
    resolved = config_dir / "sft.json"
    if resolved.is_file():
        shutil.copy(resolved, output / "sft.json")
    if ran.returncode != 0:
        raise StopJob(f"prime-rl's sft ended with exit code {ran.returncode}")
    return {"seconds": seconds, "resolved": json.loads(resolved.read_text())}


# 4. The adapter.


def latest_adapter() -> Path:
    """The adapter prime-rl's weight broadcast wrote at the last step."""
    found = sorted(
        Path(os.environ["PRL_OUTPUT_DIR"]).rglob("step_*/adapter_model.safetensors"),
        key=lambda path: int(path.parent.name.removeprefix("step_")),
    )
    if not found:
        raise StopJob("the training run wrote no adapter_model.safetensors")
    return found[-1].parent


def read_adapter(adapter_dir: Path) -> dict[str, Any]:
    from safetensors import safe_open

    weights = adapter_dir / "adapter_model.safetensors"
    modules: list[str] = []
    zero: list[str] = []
    with safe_open(str(weights), framework="pt") as tensors:
        for key in sorted(tensors.keys()):
            if ".lora_B" not in key:
                continue
            modules.append(key.split(".lora_B")[0])
            if not bool(tensors.get_tensor(key).count_nonzero()):
                zero.append(key)
    return {
        "step": int(adapter_dir.name.removeprefix("step_")),
        "sha256": sha256_file(weights),
        "config": json.loads((adapter_dir / "adapter_config.json").read_text()),
        "modules": modules,
        "zero_lora_b": zero,
    }


# 5. A fresh vLLM.


def serve(spec: dict[str, Any], adapter_dir: Path, output: Path) -> subprocess.Popen[bytes]:
    log = (output / "vllm.log").open("wb")
    server = subprocess.Popen(
        [
            str(VENV_BIN / "vllm"),
            "serve",
            os.environ["MODEL_DIR"],
            "--served-model-name",
            BASE_NAME,
            "--host",
            "127.0.0.1",
            "--port",
            str(SERVE_PORT),
            "--dtype",
            "bfloat16",
            "--max-model-len",
            str(spec["recipe"]["seq_len"]),
            "--enable-lora",
            "--max-lora-rank",
            str(spec["recipe"]["rank"]),
            "--lora-modules",
            f"{ADAPTER_NAME}={adapter_dir}",
        ],
        # prime-rl registers a vLLM plugin that patches the server; a name that matches no
        # plugin loads none, so this is vLLM as released.
        env={**os.environ, "VLLM_PLUGINS": "none", "CUDA_VISIBLE_DEVICES": "0"},
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    deadline = time.monotonic() + SERVE_READY_SECONDS
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise StopJob(f"vLLM ended with exit code {server.returncode} before it was ready")
        try:
            with urllib.request.urlopen(f"{SERVE_URL}/health", timeout=5) as answer:
                if answer.status == 200:
                    return server
        except (urllib.error.URLError, OSError):
            time.sleep(5)
    server.terminate()
    raise StopJob(f"vLLM was not ready within {SERVE_READY_SECONDS} seconds")


# 6. The Verifiers fixture.


def verifiers_fixture(spec: dict[str, Any], output: Path) -> dict[str, Any]:
    recipe = spec["recipe"]
    folder = output / "verifiers"
    toml = WORK / "eval.toml"
    toml.write_text(
        "\n".join(
            [
                f"model = {json.dumps(ADAPTER_NAME)}",
                f"output_dir = {json.dumps(str(folder))}",
                "",
                "[client]",
                f"base_url = {json.dumps(SERVE_URL + '/v1')}",
                'api_key_var = "VLLM_API_KEY"',
                "",
                "[sampling]",
                f"temperature = {recipe['eval_temperature']}",
                f"max_tokens = {recipe['eval_max_tokens']}",
                "",
                "[env.taskset]",
                f"id = {json.dumps(recipe['taskset'])}",
                "",
                "[env.agent.harness]",
                'id = "null"',
                "",
                "[env.agent.runtime]",
                'type = "subprocess"',
                "",
            ]
        )
    )
    ran = subprocess.run(
        [str(VENV_BIN / "vf-eval"), "@", str(toml), "--no-push", "--no-rich"],
        env={**os.environ, "VLLM_API_KEY": "none"},
        cwd=WORK,
    )
    if ran.returncode != 0:
        raise StopJob(f"vf-eval ended with exit code {ran.returncode}")
    [written] = list(folder.rglob("traces.jsonl"))
    episodes = [json.loads(line) for line in written.read_text().splitlines() if line.strip()]
    return {
        "taskset": recipe["taskset"],
        "pushed": False,
        "episodes": len(episodes),
        "rewards": [fixture_reward(episode) for episode in episodes],
    }


def fixture_reward(episode: dict[str, Any]) -> float | None:
    """The fixture's score in one episode; None when the episode ended in an error."""
    if not episode["ok"]:
        return None
    [trace] = episode["traces"]
    return trace["rewards"][REWARD]["score"]


# 7. Base against adapter.


def prompt_of(row: dict[str, Any]) -> list[dict[str, str]]:
    """A fixture's messages up to its last answer, which is what the model is asked."""
    messages = row.get("messages") or [*row["prompt"], *row["completion"]]
    return messages[:-1]


def ask(model: str, row: dict[str, Any], recipe: dict[str, Any]) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "messages": prompt_of(row),
        "temperature": recipe["eval_temperature"],
        "max_tokens": recipe["eval_max_tokens"],
        "seed": recipe["seed"],
        "logprobs": True,
        # The fixtures were trained with an empty thinking block before each answer.
        "chat_template_kwargs": {"enable_thinking": False},
    }
    if row["id"] == SCHEMA_FIXTURE:
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": SCHEMA_FIXTURE, "schema": json.loads(SCHEMA.read_text())},
        }
    request = urllib.request.Request(
        f"{SERVE_URL}/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=REQUEST_SECONDS) as answer:
        choice = json.loads(answer.read())["choices"][0]
    return {
        "text": choice["message"]["content"],
        "tokens": [
            {"token": item["token"], "logprob": item["logprob"]}
            for item in choice["logprobs"]["content"]
        ],
    }


def largest_difference(first: dict[str, Any], second: dict[str, Any]) -> float | None:
    """The largest difference in any token's log-probability, over the tokens the two answers
    share position by position; None when they share none."""
    shared = [
        abs(one["logprob"] - other["logprob"])
        for one, other in zip(first["tokens"], second["tokens"], strict=False)
        if one["token"] == other["token"]
    ]
    return max(shared) if shared else None


def answers(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Each fixture asked of the base model twice and of the adapter once, in the same fresh
    vLLM process: two identical requests give the noise, base against adapter the signal."""
    rows = [json.loads(line) for line in FIXTURES.read_text().splitlines() if line.strip()]
    compared = []
    for row in rows:
        base = ask(BASE_NAME, row, spec["recipe"])
        again = ask(BASE_NAME, row, spec["recipe"])
        adapter = ask(ADAPTER_NAME, row, spec["recipe"])
        compared.append(
            {
                "id": row["id"],
                "structured_output": row["id"] == SCHEMA_FIXTURE,
                "base_text": base["text"],
                "base_again_text": again["text"],
                "adapter_text": adapter["text"],
                "noise": largest_difference(base, again),
                "signal": largest_difference(base, adapter),
            }
        )
    return compared


if __name__ == "__main__":
    main()
