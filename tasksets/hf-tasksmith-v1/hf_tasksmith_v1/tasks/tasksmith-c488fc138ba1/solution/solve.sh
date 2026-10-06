#!/bin/sh
set -eu
mkdir -p -- /workspace/examples/glora_finetuning
cp /solution/reference/examples/glora_finetuning/glora_finetuning.py /workspace/examples/glora_finetuning/glora_finetuning.py
mkdir -p -- /workspace/src/peft
cp /solution/reference/src/peft/__init__.py /workspace/src/peft/__init__.py
mkdir -p -- /workspace/src/peft/tuners
cp /solution/reference/src/peft/tuners/__init__.py /workspace/src/peft/tuners/__init__.py
mkdir -p -- /workspace/src/peft/tuners/glora
cp /solution/reference/src/peft/tuners/glora/__init__.py /workspace/src/peft/tuners/glora/__init__.py
mkdir -p -- /workspace/src/peft/tuners/glora
cp /solution/reference/src/peft/tuners/glora/config.py /workspace/src/peft/tuners/glora/config.py
mkdir -p -- /workspace/src/peft/tuners/glora
cp /solution/reference/src/peft/tuners/glora/layer.py /workspace/src/peft/tuners/glora/layer.py
mkdir -p -- /workspace/src/peft/tuners/glora
cp /solution/reference/src/peft/tuners/glora/model.py /workspace/src/peft/tuners/glora/model.py
mkdir -p -- /workspace/src/peft/utils
cp /solution/reference/src/peft/utils/__init__.py /workspace/src/peft/utils/__init__.py
mkdir -p -- /workspace/src/peft/utils
cp /solution/reference/src/peft/utils/constants.py /workspace/src/peft/utils/constants.py
mkdir -p -- /workspace/src/peft/utils
cp /solution/reference/src/peft/utils/other.py /workspace/src/peft/utils/other.py
mkdir -p -- /workspace/src/peft/utils
cp /solution/reference/src/peft/utils/peft_types.py /workspace/src/peft/utils/peft_types.py
