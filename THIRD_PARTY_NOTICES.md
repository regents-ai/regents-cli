# Third-party notices

regents-cli's own code is under the MIT License (`LICENSE`). The files listed below come from
others and keep their own terms; the MIT License does not apply to them.

## HF Tasksmith tasks

`src/regents_cli/techtree/resources/engines/tasksmith/packages/hf-tasksmith-v1/hf_tasksmith_v1/tasks/`

These twelve task folders (task wording, tests, graders and reference solutions) are
republished from the Hugging Face dataset
[FineEnvs/HF_ML_Tasksmith](https://huggingface.co/datasets/FineEnvs/HF_ML_Tasksmith) at
revision `3c63c8b059d734fe74f932101f44dd0b16e7ee26`. The changes made to them are recorded in
`hf_tasksmith_v1/provenance.json`, and the dataset's own licence statement is
`hf_tasksmith_v1/LICENSES.md`. That statement says the release does not relicense its
sources, and Regents Labs grants no licence to these files either: they are carried so a
Tasksmith Climb can run, under whatever terms their authors set.

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

## Frontier-CS problems (MIT)

`src/regents_cli/techtree/resources/engines/frontier-cs/packages/frontier-cs-open-ended-v1/frontier_cs_open_ended_v1/problems/`

Ten problems and `testlib.h`, copied unchanged from
[Frontier-CS](https://github.com/FrontierCS/Frontier-CS) at commit
`dc91d8e06ad91ca5e926d9b9358f114ca43cc254`. Copyright (c) 2025 FrontierCS Team, under the
MIT License in that folder's `LICENSE`; `testlib.h` carries its own MIT notice. That folder's
`NOTICE.md` has the details.

## Skill2Env contract (Apache License 2.0)

`src/regents_cli/techtree/resources/forge/skill2env/`

`contract.json` is derived from [NVlabs/Skill2Env](https://github.com/NVlabs/Skill2Env) 0.3.0
at revision `9beb0b64a70290f862c8374bbef21f2ac88992ab`, and the two prompts are adapted from
its planning and task-construction stages. Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES,
under the Apache License, Version 2.0 in that folder's `LICENSE`. That folder's `README.md`
says what was taken and what was changed.
