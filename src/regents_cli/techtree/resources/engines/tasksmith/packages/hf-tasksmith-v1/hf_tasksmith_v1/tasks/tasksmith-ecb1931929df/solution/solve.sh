#!/bin/sh
set -eu
mkdir -p -- /workspace/scripts
cp /solution/reference/scripts/evaluate-lora-conversion.py /workspace/scripts/evaluate-lora-conversion.py
mkdir -p -- /workspace/src/peft
cp /solution/reference/src/peft/__init__.py /workspace/src/peft/__init__.py
mkdir -p -- /workspace/src/peft
cp /solution/reference/src/peft/peft_model.py /workspace/src/peft/peft_model.py
mkdir -p -- /workspace/src/peft/tuners
cp /solution/reference/src/peft/tuners/__init__.py /workspace/src/peft/tuners/__init__.py
mkdir -p -- /workspace/src/peft/tuners/c3a
cp /solution/reference/src/peft/tuners/c3a/layer.py /workspace/src/peft/tuners/c3a/layer.py
mkdir -p -- /workspace/src/peft/tuners/delora
cp /solution/reference/src/peft/tuners/delora/layer.py /workspace/src/peft/tuners/delora/layer.py
mkdir -p -- /workspace/src/peft/tuners/fourierft
cp /solution/reference/src/peft/tuners/fourierft/layer.py /workspace/src/peft/tuners/fourierft/layer.py
mkdir -p -- /workspace/src/peft/tuners/gralora
cp /solution/reference/src/peft/tuners/gralora/layer.py /workspace/src/peft/tuners/gralora/layer.py
mkdir -p -- /workspace/src/peft/tuners/loha
cp /solution/reference/src/peft/tuners/loha/layer.py /workspace/src/peft/tuners/loha/layer.py
mkdir -p -- /workspace/src/peft/tuners/lokr
cp /solution/reference/src/peft/tuners/lokr/layer.py /workspace/src/peft/tuners/lokr/layer.py
mkdir -p -- /workspace/src/peft/tuners/lora
cp /solution/reference/src/peft/tuners/lora/__init__.py /workspace/src/peft/tuners/lora/__init__.py
mkdir -p -- /workspace/src/peft/tuners/lora
cp /solution/reference/src/peft/tuners/lora/conversion.py /workspace/src/peft/tuners/lora/conversion.py
mkdir -p -- /workspace/src/peft/tuners/lora
cp /solution/reference/src/peft/tuners/lora/layer.py /workspace/src/peft/tuners/lora/layer.py
mkdir -p -- /workspace/src/peft/tuners/miss
cp /solution/reference/src/peft/tuners/miss/layer.py /workspace/src/peft/tuners/miss/layer.py
mkdir -p -- /workspace/src/peft/tuners/randlora
cp /solution/reference/src/peft/tuners/randlora/layer.py /workspace/src/peft/tuners/randlora/layer.py
mkdir -p -- /workspace/src/peft/tuners/shira
cp /solution/reference/src/peft/tuners/shira/layer.py /workspace/src/peft/tuners/shira/layer.py
mkdir -p -- /workspace/src/peft/tuners
cp /solution/reference/src/peft/tuners/tuners_utils.py /workspace/src/peft/tuners/tuners_utils.py
mkdir -p -- /workspace/src/peft/tuners/vblora
cp /solution/reference/src/peft/tuners/vblora/layer.py /workspace/src/peft/tuners/vblora/layer.py
mkdir -p -- /workspace/src/peft/tuners/vera
cp /solution/reference/src/peft/tuners/vera/layer.py /workspace/src/peft/tuners/vera/layer.py
mkdir -p -- /workspace/src/peft/tuners/waveft
cp /solution/reference/src/peft/tuners/waveft/layer.py /workspace/src/peft/tuners/waveft/layer.py
mkdir -p -- /workspace/src/peft/utils
cp /solution/reference/src/peft/utils/save_and_load.py /workspace/src/peft/utils/save_and_load.py
