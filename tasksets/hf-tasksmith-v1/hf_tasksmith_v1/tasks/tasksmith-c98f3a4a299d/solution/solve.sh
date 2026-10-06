#!/bin/sh
set -eu
mkdir -p -- /workspace/benchmarks/torch.compile
cp /solution/reference/benchmarks/torch.compile/regional_compilation.py /workspace/benchmarks/torch.compile/regional_compilation.py
mkdir -p -- /workspace/src/accelerate
cp /solution/reference/src/accelerate/accelerator.py /workspace/src/accelerate/accelerator.py
mkdir -p -- /workspace/src/accelerate/utils
cp /solution/reference/src/accelerate/utils/__init__.py /workspace/src/accelerate/utils/__init__.py
mkdir -p -- /workspace/src/accelerate/utils
cp /solution/reference/src/accelerate/utils/dataclasses.py /workspace/src/accelerate/utils/dataclasses.py
mkdir -p -- /workspace/src/accelerate/utils
cp /solution/reference/src/accelerate/utils/other.py /workspace/src/accelerate/utils/other.py
