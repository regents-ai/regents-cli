# Model substitution: the CLI side

Techtree's model substitution spec (`docs/spec/model-substitution-v1.md` in the techtree
repository) sets the contract every repository agrees on. This file records what regents-cli
builds of it and the two points this side settled with Techtree on 28 Oct 2026.

## Digests over model files (spec section 3)

`src/regents_cli/techtree/model_files.py` computes `file_root`, `weights_root`,
`tokenizer_digest` and `chat_template_digest` exactly as section 3 sets out, and
`tests/techtree/test_model_files.py` checks the spec's test vector.

Links: a file that is a symbolic link is refused, with one exception agreed with Techtree. In a
Hugging Face cache snapshot (`.../models--<org>--<name>/snapshots/<40 hex>`) every file is a
link into that repository's `blobs/` folder, so there a link is followed when it resolves to a
regular file inside that same `blobs/` folder. Every other link stays refused. The bytes digested
are the same either way, so no root changes.

## The OBLITERATUS import (spec section 6)

```
regents techtree model import-obliteratus <checkpoint> --source <snapshot> \
  --vllm-version <version> --dtype <dtype> --max-model-len <tokens> [--quantization <name>]
```

It prints the baseline's model block, made from the source snapshot, and the candidate's, made
from the checkpoint, with one serving block on both. It reads files only: no OBLITERATUS code is
imported, vendored or run, and every digest is computed from the files.

It reads the pipeline export's `abliteration_metadata.json` (OBLITERATUS `abliterate.py`,
`_build_metadata`, at 43b5d6d). The distributed writer's schema 2 is not read: at 43b5d6d only
OBLITERATUS's own tests call that writer, and its records carry no method, method settings or
seed, so the derivation record could not be written from them. A schema 2 checkpoint refuses as
not a pipeline export.

It refuses, with `obliteratus_checkpoint_refused`, a checkpoint that:

- names no OBLITERATUS commit, or whose checkout was dirty or did not say;
- carries a repair adapter that is not merged;
- names no 40-character commit of its source, or was made from a local folder that is not a
  Hugging Face cache snapshot;
- was made from a different repository or commit than the `--source` snapshot;
- has a tokenizer or chat template that differs from the source's;
- has weights byte for byte the source's.

The candidate's `weights.repo` and `weights.revision` are null: the weights live on the
operator's machine.

## Runs

v1 starts from a Campaign, with no Climb in the catalog; Climbs stay `skill_insertion` until a
model Climb has a real use. A model pair's draft carries the candidate's model block in place of
a Skill, and no Skill is published. An open-weights run reaches the model through an
`open_weights` route: an operator-run vLLM server at a base URL, with the served model name
checked against each side's block. The route is built when a costed run plan exists.
