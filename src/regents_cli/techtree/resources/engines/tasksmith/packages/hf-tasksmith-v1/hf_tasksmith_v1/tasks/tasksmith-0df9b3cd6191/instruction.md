Refactor environment and per-rollout tool setup in `GRPOTrainer`, `DPPOTrainer`, `GRPOWithReplayBufferTrainer`, and `_AsyncRolloutLoop` so environments are created lazily and reused across generation batches.

At present, providing `environment_factory` eagerly constructs a fixed pool at initialization and builds tool dictionaries by slot. Replace that behavior with the following contract.

1. **Single probe at init.** When `environment_factory` is provided, call the factory exactly once during `__init__`. Validate that the returned instance has a callable `reset`, raising `ValueError` with `"reset"` in its message otherwise. Discover its public, non-`reset`, non-underscore-prefixed methods as environment tools. Keep this probe instance available for actual generation.

2. **Tools available at init.** `self.tools` contains the directly passed tools plus the environment methods discovered from the probe. Without a factory, it contains only the directly passed tools.

3. **Bounded environment construction.** The factory must never be called more times than the peak number of concurrent rollouts across all batches. Reuse existing instances when a later batch needs fewer or the same number of rollouts. Within a batch, concurrent rollouts use distinct instances. This applies to the three synchronous trainers named above and the async loop.

4. **Reset and correct tool binding.** For `GRPOTrainer`, `DPPOTrainer`, and `_AsyncRolloutLoop`: Instances must be reused (via `reset`) rather than re-created. Call `reset` with the current input row before each rollout, so a reused instance sees the new row. Each rollout's tool dictionary contains the directly passed tools and the public methods of that rollout's own environment. In `GRPOWithReplayBufferTrainer`, the scope is lazy pool reuse and correct per-rollout tool binding; preserve its existing generation and replay-buffer behavior.

5. **Synchronous environment state.** In `GRPOTrainer`, `DPPOTrainer`, and `GRPOWithReplayBufferTrainer`, initialize `self.environments` to `None`. Before generation, set it to the actual batch's environment instances when a factory is present. Leave it as `None` when there is no factory, including during reward processing.

6. **Async tools rejected at init.** `_AsyncRolloutLoop` raises `ValueError` matching `"[Aa]synchronous"` if either a directly passed tool or an environment method is a coroutine function.

Keep the existing public constructor APIs. `GFPOTrainer` is an adjacent compatibility concern: preserve its existing no-factory construction and generation path. Its constructor does not expose `environment_factory` or `tools` arguments.

Work in `/workspace`. Submit your fix in the existing Python source files under `trl`. Preserve the other public behavior. The environment is offline; dependencies are preinstalled. Grading runs the relevant repository tests in a fresh environment, using your submitted source files.
