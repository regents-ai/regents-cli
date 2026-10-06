Add LoRA loading support for `Ideogram4Pipeline` via a new `Ideogram4LoraLoaderMixin` and a state-dict conversion utility for non-diffusers (ai-toolkit/kohya) checkpoints.

**What must work:**

1. **`Ideogram4LoraLoaderMixin`** must be importable from `diffusers.loaders` and `Ideogram4Pipeline` must inherit from it (alongside `DiffusionPipeline`). It targets the `transformer` component only (`_lora_loadable_modules = ["transformer"]`).

2. **`_convert_non_diffusers_ideogram4_lora_to_diffusers(state_dict)`** in `diffusers.loaders.lora_conversion_utils`:

   - **Prefix stripping**: keys starting with `"diffusion_model."` or `"conditional_transformer."` have that prefix removed before conversion.
   - **Key format detection**: presence of `.lora_down.weight` keys signals kohya format; otherwise `lora_A`/`lora_B` is assumed.
   - **Fused QKV split**: a single `layers.N.attention.qkv` LoRA pair (one `lora_A`/`lora_down`, one `lora_B`/`lora_up`) is expanded into three separate pairs for `to_q`, `to_k`, `to_v`. All three share the same `lora_A` weight (cloned); the `lora_B` weight is split into thirds along dimension 0.
   - **Output projection rename**: `layers.N.attention.o` → `layers.N.attention.to_out.0`.
   - **Pass-through modules**: `feed_forward.w1`, `feed_forward.w2`, `feed_forward.w3`, `adaln_modulation` are renamed one-to-one with `.lora_A.weight` / `.lora_B.weight` suffixes.
   - **Alpha folding**: if a `.alpha` tensor is present for a module, the scale `alpha/rank` is split between down and up weights and multiplied in; the `.alpha` key is consumed. Missing alpha → scale of 1.0.
   - **Output prefix**: every output key is prefixed with `"transformer."`.
   - **Leftover-key error**: if any input keys remain unconsumed after processing all layers, raise `ValueError` whose message includes the leftover key names.

3. **`Ideogram4Transformer2DModel.forward`** must accept an `attention_kwargs` keyword argument (default `None`) and pass it through to the attention processor.

4. **`Ideogram4Pipeline.__call__`** must accept an `attention_kwargs` keyword argument and expose it via an `attention_kwargs` property during the call. The pipeline stores it as `self._attention_kwargs` and passes it to both the conditional and unconditional transformer calls.

Work in `/workspace`. Submit your fix in the existing Python source files under `src/diffusers`. Preserve the other public behavior. The environment is offline; dependencies are preinstalled. Grading runs the relevant repository tests in a fresh environment, using your submitted source files.
