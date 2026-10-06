# Notice

This package's own code (`hf_tasksmith_v1/__init__.py` and `hf_tasksmith_v1/taskset.py`) is
under the MIT License (`LICENSES/MIT.txt`). The files listed below come from others and keep
their own terms; the MIT License does not apply to them.

## HF Tasksmith tasks

`hf_tasksmith_v1/tasks/`

These twelve task folders (task wording, tests, graders and reference solutions) are
republished from the Hugging Face dataset
[FineEnvs/HF_ML_Tasksmith](https://huggingface.co/datasets/FineEnvs/HF_ML_Tasksmith) at
revision `3c63c8b059d734fe74f932101f44dd0b16e7ee26`. The changes made to them are recorded in
`hf_tasksmith_v1/provenance.json`, and the dataset's own licence statement is
`hf_tasksmith_v1/LICENSES.md`. That statement says the release does not relicense its
sources, and Regents Labs grants no licence to these files either: they are carried so the
tasks can be run, under whatever terms their authors set.

## Hugging Face libraries (Apache License 2.0)

The tasks are built from pull requests to these Hugging Face projects, and the files under
each task's `solution/reference/` are copies of their source files, with the copyright and
licence headers they carry:

- [transformers](https://github.com/huggingface/transformers)
- [trl](https://github.com/huggingface/trl)
- [peft](https://github.com/huggingface/peft)
- [diffusers](https://github.com/huggingface/diffusers)
- [accelerate](https://github.com/huggingface/accelerate)

Copyright The HuggingFace Team and their contributors. Licensed under the Apache License,
Version 2.0 (`LICENSES/Apache-2.0.txt`). Each task's `task.toml` names the pull request and
the commits it was made from.
