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

## The open_weights route (spec section 7, open question 3)

A model substitution run reaches each side's model on a vLLM server the operator runs. This is
the rule, as `src/regents_cli/techtree/model_server.py` checks it:

1. Each side has its own server, named by the base address of its OpenAI-compatible API: `http`
   or `https`, ending in `/v1`, with no user, password, query or fragment. One server per side
   (one GPU each in the first comparison) keeps the sides' calls apart; both run at once.
2. Each side is served under its own `weights.weights_root` as the served model name (vLLM
   `--served-model-name sha256:...`). The subject asks for that name, so its traces record the
   digest of the weights it was meant to be answered by, and the two sides cannot be swapped
   without the check below refusing.
3. Before the run, each server is asked two free reads. `GET <base>/models` must list the side's
   `weights_root` with `max_model_len` equal to the block's `serving.max_model_len`.
   `GET <server>/version` (the base address without `/v1`) must answer the block's
   `serving.version`. Anything else refuses with `model_server_mismatch`; a server that cannot be
   reached, answers other than 200, or asks for a key that is not set refuses with
   `model_server_unreachable`; an unusable address refuses with `model_server_url_invalid` and
   is never repeated, since it may carry a password.
4. A server that needs a key is given it through `VLLM_API_KEY`, vLLM's own name, sent as a
   bearer token and never written into an answer, a run input or a log line.
5. The addresses are the run's, not the Campaign's: like the forwarder's address on the
   ChatGPT plan route, they are not frozen into a Campaign or a proof bundle. What the bundle
   holds is each side's model block, and so its served name.
6. What a server cannot show, the bytes it loaded, its dtype and its quantization, stays the
   operator's statement. The route spends nothing (the operator runs the GPUs), so it has no
   spending maximum; a rerun by someone else (`independently_reproduced`) is what checks the
   statement.

`regents techtree model check-server --block <file> --base-url <url>` runs step 3 on its own, so
an operator can check each server before a run, or in a rehearsal:

```
regents techtree model import-obliteratus <checkpoint> --source <snapshot> ... --json > pair.json
jq .baseline pair.json > baseline.json
vllm serve <snapshot> --served-model-name "$(jq -r .weights.weights_root baseline.json)" ...
regents techtree model check-server --block baseline.json --base-url http://127.0.0.1:8000/v1
```

## Runs

v1 starts from a Campaign, with no Climb in the catalog; Climbs stay `skill_insertion` until a
model Climb has a real use. A model pair's draft carries the candidate's model block in place of
a Skill, and no Skill is published. Not built yet, and the next step: the model substitution
Campaign (`mutation_contract.kind` `model_substitution`, its subject naming an open-weights
block), its run on the route above with each side's server checked first, the comparison of
section 4, and its proof bundle. The first comparison's task collection is
`hello-world-climb@3`: exact checks, and no wallet, money or sign-in steps.
