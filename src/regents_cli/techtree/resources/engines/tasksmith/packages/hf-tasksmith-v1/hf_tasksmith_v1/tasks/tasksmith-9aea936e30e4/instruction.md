Add the PVeRA (Probabilistic Vector-based Random Matrix Adaptation) adapter to the PEFT library, exposed as `PveraConfig` and `PveraModel` in the top-level `peft` namespace alongside the other adapters.

**Algorithm summary.** PVeRA extends VeRA by learning a distribution over low-rank adaptations instead of a single deterministic one.  
- Two global shared random projection matrices are created per adapter name: `pvera_A` of shape `(r*2, max_in_features)` and `pvera_B` of shape `(max_out_features, r)`. "Max" is the largest in- or out-dimension across all targeted linear layers. These are frozen buffers initialised deterministically from `projection_prng_key`.  
- Each adapted layer receives two trainable parameter vectors: `lambda_b` of size `out_features` and `lambda_d` of size `r*2`. With the default `init_weights=True`, they are initialised to zeros and `d_initial` (default 0.1), respectively.  
- During forward: compute `h = lambda_d * F.linear(dropout(x), sliced_A)`, split `h` into equal halves `(mu, logvar)` along the last dimension. Reparameterise `z = mu + randn_like(std) * std` during training (where `std = exp(0.5*logvar)`). At eval, use `z = mu` unless `sample_at_inference=True` for that layer, in which case sampling continues. Output the base-layer result plus `lambda_b * F.linear(z, sliced_B)`.

**Config fields** (all dataclass, subclass of `PeftConfig`):
- `r` (int, default 256): rank  
- `projection_prng_key` (int, default 0): seed for A/B initialisation  
- `save_projection` (bool, default True): include pvera_A/pvera_B in checkpoint; if False, they are excluded and re-derived from the PRNG key on load  
- `pvera_dropout` (float, default 0.0)  
- `d_initial` (float, default 0.1)  
- `sample_at_inference` (bool or dict, default False): if dict, per-adapter-key flag  
- `init_weights` (bool, default True), as in VeRA: the default initializes `lambda_b` to zeros and `lambda_d` to `d_initial`. With False, initialize `lambda_b` to ones and `lambda_d` from a standard normal distribution, so the adapter is active immediately.  
- `fan_in_fan_out`, `bias`, `target_modules`, `modules_to_save`, `layers_to_transform`, `layers_pattern` as in VeRA  
- Setting `layers_pattern` without `layers_to_transform` must raise `ValueError` at config construction  

**Multiple adapters.** If a second adapter is added with the same `projection_prng_key`, its `pvera_A` and `pvera_B` references point to the same tensor objects as the first adapter (memory sharing). If the key differs, `add_adapter` must raise `ValueError` with a message containing both keys.

**Checkpoint behaviour.** When `save_projection=True`, keys `base_model.pvera_A.<adapter_name>` and `base_model.pvera_B.<adapter_name>` appear in the saved state dict. When `save_projection=False`, they must not appear. Both modes must support round-trip save/load with correct inference outputs.

**`PeftType.PVERA`** must be a member of the `PeftType` enum.

Example:
```python
from peft import PveraConfig, get_peft_model
config = PveraConfig(r=8, target_modules=["lin1"], d_initial=0.1)
peft_model = get_peft_model(base_model, config)
```

Work in `/workspace`. Submit your fix in Python source files under `src/peft`, `examples/pvera`. Preserve the other public behavior. The environment is offline; dependencies are preinstalled. Grading runs the relevant repository tests in a fresh environment, using your submitted source files.
