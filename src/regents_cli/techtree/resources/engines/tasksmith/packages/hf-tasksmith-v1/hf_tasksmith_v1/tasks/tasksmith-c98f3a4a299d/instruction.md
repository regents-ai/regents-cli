Add two new public utilities to `accelerate.utils` — `compile_regions` and `has_compiled_regions` — and extend `TorchDynamoPlugin` with a `use_regional_compilation` flag.

**`compile_regions(module, **compile_kwargs)`** applies regional compilation:
- A `torch.nn.ModuleList` where **all** elements share the same class → each element is compiled individually via `torch.compile(..., **compile_kwargs)`.
- A `torch.nn.ModuleList` with **mixed** element types → the entire list is compiled as one unit.
- A non-leaf module (has children) → a new instance of the same class is created and each child is processed recursively.
- A leaf module (no children) → compiled directly with `torch.compile`.
- The returned module stores `_orig_mod` referencing the original un-compiled module (unless the returned object is already an `OptimizedModule`, which already carries its own `_orig_mod`).

**`has_compiled_regions(module)`** returns `True` if any submodule of the given module is a `torch._dynamo.eval_frame.OptimizedModule`; `False` otherwise.

**`TorchDynamoPlugin`** gains `use_regional_compilation: bool = False`. Its `to_kwargs()` override must **exclude** `use_regional_compilation` from the returned dict.

**`extract_model_from_parallel`** must handle models with compiled regions (detected by `has_compiled_regions`): unwrap via `_orig_mod` and re-wrap when `keep_torch_compile=True`, the same way as for a fully-compiled module.

Both `compile_regions` and `has_compiled_regions` must be importable from `accelerate.utils`.

Work in `/workspace`. Submit your fix in Python source files under `src/accelerate`, `benchmarks/torch.compile`. Preserve the other public behavior. The environment is offline; dependencies are preinstalled. Grading runs the relevant repository tests in a fresh environment, using your submitted source files.
