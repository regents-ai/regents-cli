Add two public functions to PEFT that convert a non-LoRA PEFT adapter into an equivalent LoRA adapter using truncated SVD on each layer's delta weight.

**`convert_to_lora(model, rank, adapter_name="default", progressbar=False, compile_kwargs=None)`**

Returns `(LoraConfig, state_dict)`. For each `BaseTunerLayer` in the model that supports conversion, call `get_delta_weight(adapter_name)`, run full SVD on it (in float32), then truncate to the chosen rank to produce `lora_A` (row-slice of right singular vectors) and `lora_B` (left singular vectors scaled by singular values), so that `lora_B @ lora_A ≈ delta_weight`. The scaling is baked in: `lora_alpha == r` always. State dict keys follow the pattern `{module_name}.lora_A.weight` and `{module_name}.lora_B.weight`.

`rank` is either:
- `int > 0`: fixed rank for every layer. The returned `LoraConfig` has `r=rank`, `lora_alpha=rank`, populated `target_modules`, and empty `rank_pattern`/`alpha_pattern`.
- `float` in `(0, 1]`: energy threshold. For each layer the smallest rank k is chosen such that the top-k singular values account for at least that fraction of total squared singular value energy. The returned `LoraConfig` has `r=1`, `lora_alpha=1` (dummies), and per-layer values in `rank_pattern` and `alpha_pattern` (always equal to each other). Dynamic rank entries are stored in these patterns regardless of whether `target_modules` is a set or regex string.

When `progressbar=True`, a tqdm progress bar labelled "Converting to LoRA" is written to stderr.

When `compile_kwargs` is provided, the per-module conversion function is compiled with `torch.compile(**compile_kwargs)` before the loop.

The output weights preserve the original dtype of the adapter (SVD is computed in float32 internally, then cast back).

**`save_as_lora(path, model, rank, ...)`**

Thin wrapper: calls `convert_to_lora`, saves the state dict as a safetensors file, and saves the `LoraConfig` with `save_pretrained`. The saved checkpoint can be reloaded with `PeftModel.from_pretrained`.

**`PeftModel.supports_lora_conversion(adapter_name="default")`**

Returns `False` for prompt-learning methods or when the underlying tuner model does not expose `supports_lora_conversion`. Each tuner layer class exposes its own `supports_lora_conversion()`. The `BaseTuner` aggregates this: it returns `True` only if every `BaseTunerLayer` in the model supports it.

**Error conditions:**
- `TypeError("Could not detect any layer that supports LoRA conversion.")` — no convertible layers found (plain model, prompt tuning).
- `TypeError("Some module types on this model do not support LoRA conversion: ...")` — at least one `BaseTunerLayer` returns `False` from `supports_lora_conversion` (e.g. IA3, SHiRA, conv layers).
- `ValueError` — `rank=0`, float rank outside `(0, 1]`, or integer rank exceeds the layer's weight dimension.
- `ValueError("The adapter's config sets bias=...")` — adapter config has a trainable bias (`bias != "none"`).
- `UserWarning` — converting an adapter that is already LoRA.

**`set_peft_model_state_dict`** now returns a named tuple with `missing_keys` and `unexpected_keys` instead of `None`.

Work in `/workspace`. Submit your fix in Python source files under `src/peft`, `scripts`. Preserve the other public behavior. The environment is offline; dependencies are preinstalled. Grading runs the relevant repository tests in a fresh environment, using your submitted source files.
