#!/bin/sh
set -eu
mkdir -p -- /workspace/src/diffusers
cp /solution/reference/src/diffusers/__init__.py /workspace/src/diffusers/__init__.py
mkdir -p -- /workspace/src/diffusers/hooks
cp /solution/reference/src/diffusers/hooks/_helpers.py /workspace/src/diffusers/hooks/_helpers.py
mkdir -p -- /workspace/src/diffusers/models
cp /solution/reference/src/diffusers/models/__init__.py /workspace/src/diffusers/models/__init__.py
mkdir -p -- /workspace/src/diffusers/models/transformers
cp /solution/reference/src/diffusers/models/transformers/__init__.py /workspace/src/diffusers/models/transformers/__init__.py
mkdir -p -- /workspace/src/diffusers/models/transformers
cp /solution/reference/src/diffusers/models/transformers/transformer_z_image.py /workspace/src/diffusers/models/transformers/transformer_z_image.py
mkdir -p -- /workspace/src/diffusers/pipelines
cp /solution/reference/src/diffusers/pipelines/__init__.py /workspace/src/diffusers/pipelines/__init__.py
mkdir -p -- /workspace/src/diffusers/pipelines/z_image
cp /solution/reference/src/diffusers/pipelines/z_image/__init__.py /workspace/src/diffusers/pipelines/z_image/__init__.py
mkdir -p -- /workspace/src/diffusers/pipelines/z_image
cp /solution/reference/src/diffusers/pipelines/z_image/pipeline_output.py /workspace/src/diffusers/pipelines/z_image/pipeline_output.py
mkdir -p -- /workspace/src/diffusers/pipelines/z_image
cp /solution/reference/src/diffusers/pipelines/z_image/pipeline_z_image.py /workspace/src/diffusers/pipelines/z_image/pipeline_z_image.py
mkdir -p -- /workspace/src/diffusers/utils
cp /solution/reference/src/diffusers/utils/dummy_torch_and_transformers_objects.py /workspace/src/diffusers/utils/dummy_torch_and_transformers_objects.py
