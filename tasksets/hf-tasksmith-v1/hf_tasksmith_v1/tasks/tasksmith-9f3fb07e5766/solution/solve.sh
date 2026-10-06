#!/bin/sh
set -eu
mkdir -p -- /workspace/trl/trainer
cp /solution/reference/trl/trainer/dpo_trainer.py /workspace/trl/trainer/dpo_trainer.py
mkdir -p -- /workspace/trl/trainer
cp /solution/reference/trl/trainer/reward_trainer.py /workspace/trl/trainer/reward_trainer.py
mkdir -p -- /workspace/trl/trainer
cp /solution/reference/trl/trainer/sft_trainer.py /workspace/trl/trainer/sft_trainer.py
