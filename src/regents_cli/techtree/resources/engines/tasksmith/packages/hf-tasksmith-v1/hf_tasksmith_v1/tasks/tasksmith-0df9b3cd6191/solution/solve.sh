#!/bin/sh
set -eu
mkdir -p -- /workspace/trl/experimental/async_grpo
cp /solution/reference/trl/experimental/async_grpo/async_rollout_worker.py /workspace/trl/experimental/async_grpo/async_rollout_worker.py
mkdir -p -- /workspace/trl/experimental/dppo
cp /solution/reference/trl/experimental/dppo/dppo_trainer.py /workspace/trl/experimental/dppo/dppo_trainer.py
mkdir -p -- /workspace/trl/experimental/gfpo
cp /solution/reference/trl/experimental/gfpo/gfpo_trainer.py /workspace/trl/experimental/gfpo/gfpo_trainer.py
mkdir -p -- /workspace/trl/experimental/grpo_with_replay_buffer
cp /solution/reference/trl/experimental/grpo_with_replay_buffer/grpo_with_replay_buffer_trainer.py /workspace/trl/experimental/grpo_with_replay_buffer/grpo_with_replay_buffer_trainer.py
mkdir -p -- /workspace/trl/trainer
cp /solution/reference/trl/trainer/grpo_trainer.py /workspace/trl/trainer/grpo_trainer.py
