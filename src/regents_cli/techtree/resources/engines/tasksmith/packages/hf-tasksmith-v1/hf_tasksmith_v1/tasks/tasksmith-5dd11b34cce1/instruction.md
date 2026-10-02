Add a `Dinov2WithRegisters` model family to the `transformers` library. This is a variant of DINOv2 that inserts additional "register" tokens into the sequence, which improves feature map quality.

Implement the following public classes under `src/transformers/models/dinov2_with_registers/`:

**`Dinov2WithRegistersConfig`** (model_type `"dinov2-with-registers-base"`)
Key parameters beyond the standard ViT ones:
- `num_register_tokens` (int, default 4) – number of register tokens
- `interpolate_antialias` (bool, default True) – antialiasing during positional encoding interpolation
- `interpolate_offset` (float, default 0.0) – offset applied when interpolating position encodings
- `layerscale_value` (float, default 1.0) – initial value for layer scale
- `use_swiglu_ffn` (bool, default False) – use SwiGLU FFN instead of standard MLP
- Backbone fields: `apply_layernorm`, `reshape_hidden_states`, `out_features`, `out_indices`
- `stage_names` = `["stem"] + ["stage{i}" for i in range(1, num_hidden_layers+1)]`

**`Dinov2WithRegistersModel`**
- Embedding sequence layout: `[CLS, reg_0, …, reg_{R-1}, patch_0, …, patch_{N-1}]`
  (register tokens are inserted after CLS, before patch tokens, **after** positional encoding is added to CLS+patches)
- `last_hidden_state` shape: `(batch, 1 + num_register_tokens + num_patches, hidden_size)`
- `pooler_output` = `last_hidden_state[:, 0, :]` (CLS token)
- Missing `pixel_values` raises `ValueError`

**`Dinov2WithRegistersForImageClassification`**
- Classifier input = `cat([cls_token, patch_tokens.mean(dim=1)], dim=-1)` where `patch_tokens = sequence_output[:, 1:]` (all tokens except CLS, including registers)
- Linear head size: `hidden_size * 2 → num_labels`

**`Dinov2WithRegistersBackbone`**
- When `reshape_hidden_states=True`, strips register tokens from each selected stage's hidden state using `hidden_state[:, num_register_tokens + 1:]` before reshaping to `(batch, hidden_size, H//patch_size, W//patch_size)`
- When `reshape_hidden_states=False`, returns 3-D tensor of shape `(batch, seq_len, hidden_size)` without stripping

Register the model in auto-classes (`AutoConfig`, `AutoModel`, `AutoModelForImageClassification`, `AutoBackbone`) with type string `"dinov2_with_registers"`. Export `Dinov2WithRegistersConfig`, `Dinov2WithRegistersModel`, `Dinov2WithRegistersForImageClassification`, `Dinov2WithRegistersBackbone`, `Dinov2WithRegistersPreTrainedModel` from the top-level `transformers` namespace.

Work in `/workspace`. Submit your fix in Python source files under `src/transformers`, `utils`. Preserve the other public behavior. The environment is offline; dependencies are preinstalled. Grading runs the relevant repository tests in a fresh environment, using your submitted source files.
