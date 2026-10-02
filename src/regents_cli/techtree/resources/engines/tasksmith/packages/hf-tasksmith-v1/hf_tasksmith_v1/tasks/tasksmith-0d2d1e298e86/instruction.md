When using LoRA with `target_parameters`, it must now be possible to add multiple adapters to the same model, subject to one constraint: all adapters that use `target_parameters` must target the **same set of parameters**.

**Allowed:** two adapters both targeting `["linear.weight"]` — `add_adapter` succeeds and both adapter names appear in `model.peft_config`.

**Rejected:** a first adapter targeting `["linear.weight"]` and a second targeting `["embed.weight"]` — `add_adapter` raises `ValueError` containing the phrase `"all adapters must target the same set of parameters"`. The rejected adapter must **not** be added to `model.peft_config`.

**Loading:** `model.load_adapter(path, adapter_name="other")` onto a model that already has a `target_parameters` adapter must succeed (no error) when both use the same parameters.

Previously, adding *any* second adapter that used `target_parameters` raised an error (`"only one LoRA adapter per model with target_parameters is allowed"`). That blanket restriction is removed; only the mismatched-parameter case raises.

The same mismatch error must also be raised when targeting parameters via `get_peft_model` + `add_adapter` on a model that already has an existing `nn.utils.parametrize` parametrization on the target parameter.

Work in `/workspace`. Submit your fix in the existing Python source files under `src/peft`. Preserve the other public behavior. The environment is offline; dependencies are preinstalled. Grading runs the relevant repository tests in a fresh environment, using your submitted source files.
