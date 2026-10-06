In `DistillationTrainer.log()`, add support for logging completion tables to the **trackio** backend alongside the existing wandb support.

**Required observable behaviour:**

Completion logging remains restricted to steps where `log_completions=True`, `global_step > 0`, and the step is divisible by `log_completions_steps`. Only the main process emits completion tables, and only when prompts are available.

- A configured `trackio` backend receives one completion log per eligible step. Existing wandb logging remains enabled only when `"wandb"` is in `args.report_to` and `wandb.run is not None`. Both backends must work together as well as individually; unselected backends receive no completion logs.
- Each completion log contains a `"completions"` value that is a table belonging to the receiving backend. Its pandas DataFrame has columns `"step"`, `"prompt"`, and `"completion"`, with the global step represented as a string and one row per prompt/completion pair before sampling.
- For a positive `num_completions_to_print` smaller than the number of rows, table contents match pandas row sampling with `random_state=42`. Both backends receive consistent rows in the same order. A limit of `None` or zero retains all backend-table rows, as does a limit at least as large as the row count.
- Preserve existing console printing, including its sample-limit behaviour, regardless of which backends are enabled.
- After an eligible logging step, both `_textual_logs["prompt"]` and `_textual_logs["completion"]` are cleared on all processes, including non-main processes and steps with no backend enabled. On other steps, retain both logs.

**Examples of expected observable behaviour:**

- `report_to=["trackio"]` → `trackio.log(...)` called once, `wandb.log` not called.
- `report_to=["wandb"]` with `wandb.run is None` → no backend called.
- `report_to=["wandb", "trackio"]` with `wandb.run` active → both backends receive one `log` call each.
- `num_completions_to_print=2` with 5 rows → DataFrame sampled to 2 rows before dispatch.
- After any logging step, both text-log lists are empty.

Work in `/workspace`. Submit your fix in the existing Python source files under `trl`. Preserve the other public behavior. The environment is offline; dependencies are preinstalled. Grading runs the relevant repository tests in a fresh environment, using your submitted source files.
