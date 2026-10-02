#!/bin/sh
set -eu
mkdir -p -- /workspace/examples/pvera
cp /solution/reference/examples/pvera/confidence_interval_generation.py /workspace/examples/pvera/confidence_interval_generation.py
mkdir -p -- /workspace/src/peft
cp /solution/reference/src/peft/__init__.py /workspace/src/peft/__init__.py
mkdir -p -- /workspace/src/peft/tuners
cp /solution/reference/src/peft/tuners/__init__.py /workspace/src/peft/tuners/__init__.py
mkdir -p -- /workspace/src/peft/tuners/pvera
cp /solution/reference/src/peft/tuners/pvera/__init__.py /workspace/src/peft/tuners/pvera/__init__.py
mkdir -p -- /workspace/src/peft/tuners/pvera
cp /solution/reference/src/peft/tuners/pvera/bnb.py /workspace/src/peft/tuners/pvera/bnb.py
mkdir -p -- /workspace/src/peft/tuners/pvera
cp /solution/reference/src/peft/tuners/pvera/config.py /workspace/src/peft/tuners/pvera/config.py
mkdir -p -- /workspace/src/peft/tuners/pvera
cp /solution/reference/src/peft/tuners/pvera/layer.py /workspace/src/peft/tuners/pvera/layer.py
mkdir -p -- /workspace/src/peft/tuners/pvera
cp /solution/reference/src/peft/tuners/pvera/model.py /workspace/src/peft/tuners/pvera/model.py
mkdir -p -- /workspace/src/peft/utils
cp /solution/reference/src/peft/utils/__init__.py /workspace/src/peft/utils/__init__.py
mkdir -p -- /workspace/src/peft/utils
cp /solution/reference/src/peft/utils/constants.py /workspace/src/peft/utils/constants.py
mkdir -p -- /workspace/src/peft/utils
cp /solution/reference/src/peft/utils/other.py /workspace/src/peft/utils/other.py
mkdir -p -- /workspace/src/peft/utils
cp /solution/reference/src/peft/utils/peft_types.py /workspace/src/peft/utils/peft_types.py
mkdir -p -- /workspace/src/peft/utils
cp /solution/reference/src/peft/utils/save_and_load.py /workspace/src/peft/utils/save_and_load.py
