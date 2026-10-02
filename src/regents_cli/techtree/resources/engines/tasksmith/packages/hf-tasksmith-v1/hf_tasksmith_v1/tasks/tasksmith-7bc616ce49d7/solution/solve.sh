#!/bin/sh
set -eu
mkdir -p -- /workspace/src/diffusers/loaders
cp /solution/reference/src/diffusers/loaders/__init__.py /workspace/src/diffusers/loaders/__init__.py
mkdir -p -- /workspace/src/diffusers/loaders
cp /solution/reference/src/diffusers/loaders/lora_conversion_utils.py /workspace/src/diffusers/loaders/lora_conversion_utils.py
mkdir -p -- /workspace/src/diffusers/loaders
cp /solution/reference/src/diffusers/loaders/lora_pipeline.py /workspace/src/diffusers/loaders/lora_pipeline.py
mkdir -p -- /workspace/src/diffusers/models/transformers
cp /solution/reference/src/diffusers/models/transformers/transformer_ideogram4.py /workspace/src/diffusers/models/transformers/transformer_ideogram4.py
mkdir -p -- /workspace/src/diffusers/pipelines/ideogram4
cp /solution/reference/src/diffusers/pipelines/ideogram4/pipeline_ideogram4.py /workspace/src/diffusers/pipelines/ideogram4/pipeline_ideogram4.py
