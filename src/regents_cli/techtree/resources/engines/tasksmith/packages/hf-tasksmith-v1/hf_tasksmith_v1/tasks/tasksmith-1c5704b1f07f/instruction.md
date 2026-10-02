Add `ZImageTransformer2DModel` and `ZImagePipeline` to the diffusers library.

**Transformer model** (`ZImageTransformer2DModel`):

- Importable as `from diffusers import ZImageTransformer2DModel`
- Inherits `ModelMixin`, `ConfigMixin`, `PeftAdapterMixin`, `FromOriginalModelMixin`
- Constructor parameters (with defaults): `all_patch_size=(2,)`, `all_f_patch_size=(1,)`, `in_channels=16`, `dim=3840`, `n_layers=30`, `n_refiner_layers=2`, `n_heads=30`, `n_kv_heads=30`, `norm_eps=1e-5`, `qk_norm=True`, `cap_feat_dim=2560`, `rope_theta=256.0`, `t_scale=1000.0`, `axes_dims=[32,48,48]`, `axes_lens=[1024,512,512]`. Requirement: `sum(axes_dims) == dim // n_heads`.
- Forward signature: `forward(x: List[Tensor], t: Tensor, cap_feats: List[Tensor], patch_size=2, f_patch_size=1) -> (List[Tensor], dict)`. Each `x[i]` has shape `(in_channels, F, H, W)`. Each `cap_feats[i]` has shape `(N_tokens, cap_feat_dim)`. Returns a list of tensors each with shape `(in_channels, F, H, W)` plus an empty dict.
- Internally patchifies images and captions (padding sequences to multiples of 32), runs separate noise-refiner blocks (with adaLN timestep modulation) and context-refiner blocks (without modulation), concatenates into a unified sequence for the main transformer layers, then unpatchifies. RoPE embeddings are applied inside the attention processor.
- Supports `enable_gradient_checkpointing()` / `disable_gradient_checkpointing()`.
- `save_pretrained` / `from_pretrained` round-trip must reproduce identical outputs.

**Custom attention processor** (`ZSingleStreamAttnProcessor`): self-attention only (no cross-attention); applies QK norm (RMSNorm), RoPE via `freqs_cis`, and SDPA. Raises `ImportError` if `torch.nn.functional.scaled_dot_product_attention` is absent.

**Pipeline** (`ZImagePipeline`):

- Importable as `from diffusers import ZImagePipeline`
- Components: `scheduler` (FlowMatchEulerDiscreteScheduler), `vae` (AutoencoderKL), `text_encoder` (PreTrainedModel), `tokenizer` (AutoTokenizer), `transformer` (ZImageTransformer2DModel)
- `model_cpu_offload_seq = "text_encoder->transformer->vae"`
- `__call__` accepts `prompt`, `height`, `width`, `num_inference_steps`, `guidance_scale`, `cfg_normalization`, `cfg_truncation`, `negative_prompt`, `prompt_embeds` (pre-computed as `List[Tensor]`), `negative_prompt_embeds`, `latents=None`, `output_type`, `return_dict`, `callback_on_step_end`, `callback_on_step_end_tensor_inputs=["latents"]`, `max_sequence_length`
- Returns `ZImagePipelineOutput(images=...)` when `return_dict=True`, else a tuple
- CFG truncation: when `cfg_truncation <= 1.0` and normalized timestep exceeds `cfg_truncation`, guidance scale drops to 0 for that step
- Height and width must each be divisible by `vae_scale_factor * 2`; raise `ValueError` otherwise

**Registry hooks**: register `ZSingleStreamAttnProcessor` in `AttentionProcessorRegistry` and `ZImageTransformerBlock` in `TransformerBlockRegistry` (with `return_hidden_states_index=0`, `return_encoder_hidden_states_index=None`).

Both `ZImageTransformer2DModel` and `ZImagePipeline` must appear in the top-level `diffusers` namespace.

Work in `/workspace`. Submit your fix in Python source files under `src/diffusers`. Preserve the other public behavior. The environment is offline; dependencies are preinstalled. Grading runs the relevant repository tests in a fresh environment, using your submitted source files.


For model inspection and checkpoint compatibility, expose the noise-refiner modules as
`noise_refiner`, supporting standard PyTorch forward hooks. Learned padding parameters
are available as `x_pad_token` and `cap_pad_token`. Noise-refiner activations themselves
must depend differentiably on the timestep, before main blocks or final output projection.

The pipeline supports BF16 model/VAE execution, with float32 scheduler latents. Precomputed
positive and negative embeddings allow generation without a tokenizer or text encoder.
Z-Image predicts negative denoising velocity: active classifier-free guidance uses
`conditional + guidance_scale * (conditional - unconditional)` before conversion to the
scheduler's velocity convention. Truncation disables guidance only on steps whose
normalized time exceeds the threshold; earlier steps must retain guidance. Locally
initialized tiny models, VAEs and embeddings are sufficient to exercise these contracts.


`latents` may supply initial noise as a tensor with shape
`(batch_size, transformer.in_channels, height // vae_scale_factor, width // vae_scale_factor)`;
a mismatched shape raises `ValueError`. Supplied float32 latents are stepped by the scheduler.
After each denoising step, `callback_on_step_end(pipeline, step_index, timestep, values)`
receives the requested tensor inputs (by default `values["latents"]`) and returns a dictionary
of replacements, which may be unchanged. `output_type="latent"` returns final latent tensors;
`output_type="np"` decodes through the VAE and returns NumPy images shaped `(batch, height,
width, channels)`. `return_dict=False` returns the same images in a one-element tuple.


CPU execution scope: the installed PyTorch FlexAttention backend is available to both
users and the verifier through the existing public
`transformer.set_attention_backend("flex")` API. Tiny CPU pipeline generation,
including the real batched classifier-free guidance path, is evaluated with this
backend and equal-length positive/negative precomputed embeddings. Preserve this
public backend selection behavior. This CPU task does not require the default
native SDPA backend to support batched padding masks, or claim variable-length
padding-mask equivalence across attention backends. Actual transformer, scheduler,
VAE decoding, CFG arithmetic and truncation behavior remain required; no per-sample
replacement or mocked attention substitutes for the real pipeline.
