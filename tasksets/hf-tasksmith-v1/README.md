# hf-tasksmith-v1

Twelve coding tasks taken from merged pull requests to Hugging Face's machine-learning
libraries. In each one the agent gets the repository as it was just before the pull request,
plus a description of the change, and has to make it. A separate grader then runs the pull
request's own tests against the agent's files.

The tasks come from the Hugging Face dataset
[FineEnvs/HF_ML_Tasksmith](https://huggingface.co/datasets/FineEnvs/HF_ML_Tasksmith) at
revision `3c63c8b059d734fe74f932101f44dd0b16e7ee26`. Regents Labs packaged them for
[Techtree](https://techtree.sh), where they make up the Tasksmith Climb.

| | |
|---|---|
| **Taskset** | Harbor tasks, each with its own agent image and its own grader image |
| **Grading** | Separate: the agent's box is torn down, the files each task lists are copied into a fresh box from the grader image, and the tests run there. The agent never sees the tests |
| **Reward** | 1.0 when every listed test holds, 0.0 otherwise |
| **Network** | None, for the agent and for the grader |
| **Needs** | Docker (or the Prime runtime) and the `images` setting below |

## The tasks

| Task | Pull request | Tests that must start holding | Tests that must keep holding |
|---|---|---|---|
| `tasksmith-0d2d1e298e86` | [huggingface/peft#3350](https://github.com/huggingface/peft/pull/3350) | 4 | 1 |
| `tasksmith-35c1a487454c` | [huggingface/peft#3212](https://github.com/huggingface/peft/pull/3212) | 2 | 14 |
| `tasksmith-7bc616ce49d7` | [huggingface/diffusers#13921](https://github.com/huggingface/diffusers/pull/13921) | 38 | 2 |
| `tasksmith-9f3fb07e5766` | [huggingface/trl#6206](https://github.com/huggingface/trl/pull/6206) | 12 | 11 |
| `tasksmith-c488fc138ba1` | [huggingface/peft#3098](https://github.com/huggingface/peft/pull/3098) | 12 | 1 |
| `tasksmith-ecb1931929df` | [huggingface/peft#2939](https://github.com/huggingface/peft/pull/2939) | 20 | 1 |
| `tasksmith-0df9b3cd6191` | [huggingface/trl#6001](https://github.com/huggingface/trl/pull/6001) | 3 | 7 |
| `tasksmith-0ea2241cceeb` | [huggingface/trl#5501](https://github.com/huggingface/trl/pull/5501) | 7 | 5 |
| `tasksmith-1c5704b1f07f` | [huggingface/diffusers#12703](https://github.com/huggingface/diffusers/pull/12703) | 12 | 21 |
| `tasksmith-5dd11b34cce1` | [huggingface/transformers#35348](https://github.com/huggingface/transformers/pull/35348) | 12 | 1 |
| `tasksmith-9aea936e30e4` | [huggingface/peft#2952](https://github.com/huggingface/peft/pull/2952) | 14 | 1 |
| `tasksmith-c98f3a4a299d` | [huggingface/accelerate#3529](https://github.com/huggingface/accelerate/pull/3529) | 12 | 1 |

Techtree's Climb runs the first six every round and keeps the last six for its held-out check.
Each task folder holds `instruction.md` (what the agent reads), `task.toml` (limits, the files
handed to the grader, and the pull request and commits it came from), `tests/` and
`solution/` (the reference answer). `hf_tasksmith_v1/provenance.json` records the one line
changed in each published `task.toml` and the digest of every packaged folder.

## Images

Every task runs in two images, pinned by digest and public on GitHub's container registry. The
package carries none of them: you name them in `[env.taskset.images]`, one entry per task to
run, and only the tasks named there are loaded. To run fewer tasks, leave entries out. These
are the images Techtree uses:

```toml
[env.taskset]
id = "hf-tasksmith-v1"

[env.taskset.images.tasksmith-0d2d1e298e86]
agent = "ghcr.io/regents-ai/techtree-tasksmith@sha256:b6425ee9d5512122d1fcdc4f465849fb81c52709a48d3b266c269d2b68e59b49"
grader = "ghcr.io/regents-ai/techtree-tasksmith@sha256:e76502673d91bf2261f3e9f4892f23e9e22902c89632e8c6e31300d84c8827aa"

[env.taskset.images.tasksmith-0df9b3cd6191]
agent = "ghcr.io/regents-ai/techtree-tasksmith@sha256:694c4525e372bdd314ca36028977058eae28ba63965db66e78feddb405900139"
grader = "ghcr.io/regents-ai/techtree-tasksmith@sha256:ed1340461c0e5e24fa6e5708615c135ced64aeedc8308c4b51d4733ce1be967e"

[env.taskset.images.tasksmith-0ea2241cceeb]
agent = "ghcr.io/regents-ai/techtree-tasksmith@sha256:0ef23048795c6a35d155470cfd453c10fe3c5386856798966bf4bddb860f7317"
grader = "ghcr.io/regents-ai/techtree-tasksmith@sha256:4ba112600db8712280d2eedd57b81eadb2b676310151af9cd4a4d52aa77c68f5"

[env.taskset.images.tasksmith-1c5704b1f07f]
agent = "ghcr.io/regents-ai/techtree-tasksmith@sha256:3a93126842c8d9a529c4bb47e674f2b9509296fc76f46db1cde266052996c19e"
grader = "ghcr.io/regents-ai/techtree-tasksmith@sha256:c59e680ddfb5b9c5a32d1926678cf39009422afb4e685ad4e4cb8380ea2ebd4b"

[env.taskset.images.tasksmith-35c1a487454c]
agent = "ghcr.io/regents-ai/techtree-tasksmith@sha256:5dea2dad3530951b996c36b6d9083fcfe3538b5202ad8f70b03842a36b9b1a96"
grader = "ghcr.io/regents-ai/techtree-tasksmith@sha256:43820bc79efb0e182fea2f0dea84433e3ee35790d201c8c8d02cc3aa75f0bebc"

[env.taskset.images.tasksmith-5dd11b34cce1]
agent = "ghcr.io/regents-ai/techtree-tasksmith@sha256:5f285375a3a307cbc19468b63f7c9facef0872b84bdea3cb7064fd7f5d20f33b"
grader = "ghcr.io/regents-ai/techtree-tasksmith@sha256:cae1da55c43030f41df9bee874bc1e2be3781f0fa4b646b06f5f9ce0ea002adb"

[env.taskset.images.tasksmith-7bc616ce49d7]
agent = "ghcr.io/regents-ai/techtree-tasksmith@sha256:9151a207fe78b63c3e67150dbee499af9a1dd1e98ffaf70b930d86fb3f1ddec9"
grader = "ghcr.io/regents-ai/techtree-tasksmith@sha256:4a62fdba3463a277856fbe036975c2a559fb0e6200c8b65f161f74174f1c0968"

[env.taskset.images.tasksmith-9aea936e30e4]
agent = "ghcr.io/regents-ai/techtree-tasksmith@sha256:85740c29c5fa66c6fec405f136722beeeef629eaf89a86dd1d2c5f70a00e15c5"
grader = "ghcr.io/regents-ai/techtree-tasksmith@sha256:fc815cf3b02722bfd1cdd27636a8a48197acd7ee8dbf1ac3ea7fdd3aa82bc13d"

[env.taskset.images.tasksmith-9f3fb07e5766]
agent = "ghcr.io/regents-ai/techtree-tasksmith@sha256:4f3c9b94179ae550f7a6c60297bdd7db5d76f2bacff9cd0fb7c307a513cf67e4"
grader = "ghcr.io/regents-ai/techtree-tasksmith@sha256:b4de5c2e0c1b2a83b8c0a9927b53f6d586bf5ea4fa006d84487de2bd0985699c"

[env.taskset.images.tasksmith-c488fc138ba1]
agent = "ghcr.io/regents-ai/techtree-tasksmith@sha256:b499356ba08485bd456839d032399ededf770368c571c1001b5656b78f0ef5ad"
grader = "ghcr.io/regents-ai/techtree-tasksmith@sha256:f2c81997be59d589d615fba778a101eca79d8c814cba80326d3b3040fb8386f6"

[env.taskset.images.tasksmith-c98f3a4a299d]
agent = "ghcr.io/regents-ai/techtree-tasksmith@sha256:a09990596df5a270ac4a4bc54535b4087613020f8ce15742b1c8cad96859aa22"
grader = "ghcr.io/regents-ai/techtree-tasksmith@sha256:535678fe51a24c55553eea2a95075b3431e45118c895c0e9a0a8bc8ee2636eb9"

[env.taskset.images.tasksmith-ecb1931929df]
agent = "ghcr.io/regents-ai/techtree-tasksmith@sha256:626658b8e65a1f8ea61a69183180a14def3a24527d05718c2bc1e20b99c8415b"
grader = "ghcr.io/regents-ai/techtree-tasksmith@sha256:45afad838d6da0fcfb6a7206b1fac0d82cdf77de42fc99b74648e2caa7180f5a"

[env.agent.runtime]
type = "docker"
```

Save that as `tasksmith.toml`. The agent images are built from each task's `environment/`
folder in the dataset and the grader images from its `tests/Dockerfile`; both hold the
repository at the pull request's head commit with the pull request's source changes taken back
out.

## Run

`vf-validate` reads the same settings without the `env.` and `env.agent.` prefixes:

```bash
sed -e 's/^\[env\.taskset/[taskset/' -e 's/^\[env\.agent\.runtime\]/[runtime]/' \
  tasksmith.toml > validate.toml

# Model-free: for each task, grade the untouched repository (must score 0), then the
# reference answer (must score 1), each in a fresh grader box
uv run vf-validate @ validate.toml

# Check the configuration without starting anything
uv run vf-eval @ tasksmith.toml --model <model-id> --dry-run

# Evaluate
uv run vf-eval @ tasksmith.toml --model <model-id>
```

While loading, Verifiers warns for each task that `[verifier.environment]` names no
`docker_image` and that it will grade in the agent's image. The taskset then gives every task
its grader image from `images`, and grading starts a fresh box from that image; the warning is
about the published `task.toml`, not about what runs.

Without other flags the agent is Verifiers' `bash` harness; choose another with
`--env.agent.harness.id`. Each task's own time limits (600 seconds for the agent, 150 for the
grader) are ignored unless you pass `--no-env.taskset.ignore-timeouts`, as for every Harbor
taskset. `tasksmith-5dd11b34cce1` hands the grader all of `src/transformers`, so
`artifact_max_bytes` defaults to 128 MiB here instead of Verifiers' 32 MiB.

## Status

| Check | Result |
|---|---|
| `vf-validate`, Docker runtime, Verifiers commit `fc73e02` | 12 of 12 valid: every task scores 0 untouched and 1 with its reference answer |

## Dependencies

`verifiers[harbor]==0.3.2.dev147` (Verifiers commit `fc73e02`). No API keys or environment
variables of its own.

## Licences

This package's own code is MIT (`LICENSES/MIT.txt`). The task folders are republished from the
dataset under whatever terms their authors set: the dataset's statement
(`hf_tasksmith_v1/LICENSES.md`) says it does not relicense its sources, and Regents Labs grants
no licence to them either. The reference solutions are copies of Hugging Face source files
under the Apache License 2.0 (`LICENSES/Apache-2.0.txt`). `LICENSES/NOTICE.md` has the details.
