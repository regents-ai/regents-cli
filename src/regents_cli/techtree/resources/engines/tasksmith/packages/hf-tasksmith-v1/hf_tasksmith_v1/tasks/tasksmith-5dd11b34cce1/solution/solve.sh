#!/bin/sh
set -eu
mkdir -p -- /workspace/src/transformers
cp /solution/reference/src/transformers/__init__.py /workspace/src/transformers/__init__.py
mkdir -p -- /workspace/src/transformers/models
cp /solution/reference/src/transformers/models/__init__.py /workspace/src/transformers/models/__init__.py
mkdir -p -- /workspace/src/transformers/models/auto
cp /solution/reference/src/transformers/models/auto/configuration_auto.py /workspace/src/transformers/models/auto/configuration_auto.py
mkdir -p -- /workspace/src/transformers/models/auto
cp /solution/reference/src/transformers/models/auto/modeling_auto.py /workspace/src/transformers/models/auto/modeling_auto.py
mkdir -p -- /workspace/src/transformers/models/dinov2_with_registers
cp /solution/reference/src/transformers/models/dinov2_with_registers/__init__.py /workspace/src/transformers/models/dinov2_with_registers/__init__.py
mkdir -p -- /workspace/src/transformers/models/dinov2_with_registers
cp /solution/reference/src/transformers/models/dinov2_with_registers/configuration_dinov2_with_registers.py /workspace/src/transformers/models/dinov2_with_registers/configuration_dinov2_with_registers.py
mkdir -p -- /workspace/src/transformers/models/dinov2_with_registers
cp /solution/reference/src/transformers/models/dinov2_with_registers/convert_dinov2_with_registers_to_hf.py /workspace/src/transformers/models/dinov2_with_registers/convert_dinov2_with_registers_to_hf.py
mkdir -p -- /workspace/src/transformers/models/dinov2_with_registers
cp /solution/reference/src/transformers/models/dinov2_with_registers/modeling_dinov2_with_registers.py /workspace/src/transformers/models/dinov2_with_registers/modeling_dinov2_with_registers.py
mkdir -p -- /workspace/src/transformers/models/dinov2_with_registers
cp /solution/reference/src/transformers/models/dinov2_with_registers/modular_dinov2_with_registers.py /workspace/src/transformers/models/dinov2_with_registers/modular_dinov2_with_registers.py
mkdir -p -- /workspace/src/transformers/utils
cp /solution/reference/src/transformers/utils/dummy_pt_objects.py /workspace/src/transformers/utils/dummy_pt_objects.py
mkdir -p -- /workspace/utils
cp /solution/reference/utils/check_repo.py /workspace/utils/check_repo.py
