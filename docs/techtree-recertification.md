# Techtree re-certification runs for `climb-v0.5.0`

The Climbs now test agents on `openai/gpt-6-luna` instead of `qwen/qwen3.7-flash`, with Hermes
0.21.5 and roomier limits, so both Campaigns are new and have never been run against a real
model. Paid runs certify them. The founder approves each run, with its expected cost, before it
starts.

## What every run shares

| Item | Value |
| --- | --- |
| Release | `climb-v0.5.0`, regents-cli 1.3.0 |
| Provider and model | `prime`, `openai/gpt-6-luna`, reasoning effort "high", no temperature (Luna has none) |
| Prices | $0.10 per million input tokens and $0.50 per million output tokens, Prime's published rates on 2026-09-30 |
| Credential | the Prime CLI sign-in at `~/.prime/config.json` (`PRIME_API_KEY`); Techtree checks the file is there and never opens it |
| Evaluated agent | Hermes Agent `v2026.9.24` (0.21.5), already installed in the subject images, so no episode downloads anything (`scripts/techtree/subject-image`, `scripts/techtree/subject-image-cpp`) |

## The two Climbs

| | Hello World | Frontier-CS |
| --- | --- | --- |
| Climb | `hello-world-climb@1` | `frontier-cs-open-ended-climb@1` |
| Campaign | `sha256:dedfeb9257f7bd270503e210bb23dcfea210fc6b7b2e7589777b980c6d1aabbc` | `sha256:06d0ee0694a2d885518b13a2e840a75070e9cd01ce6f3918e02d715d9d3186eb` |
| Engine | `sha256:cf358eae…` | `sha256:b744c6ec…` |
| Candidate | starter Skill `sha256:596d1368…`, labelled `hello-world-v1` | starter Skill v3 `sha256:38cca019…`, labelled `frontier-cs-v3` |
| Episodes | 72: 36 tasks, once without the Skill and once with it | 20: 10 problems, once without the Skill and once with it |
| Limits per episode | 16,000 tokens per reply, 32,000 output, 500,000 input, 20 minutes | 32,000 tokens per reply, 96,000 output, 400,000 input, one hour |
| Declared maximum per run | $6.50 | $2.50 |
| Enforced bound | $6.28: Techtree refuses to start if the limits could add up past $6.50 | $2.35: the same check against $2.50 |
| Expected spend per run | about $0.40 to $0.70, going by the qwen runs' token counts at Luna's prices; thinking at "high" adds output | about $1 |

Each run needs Docker running, the Prime sign-in in place, and regents-cli at the release commit.
Every command runs from the repository root in the founder's own home, because that is where
the Prime sign-in lives.

## The commands

The same for every run; `<climb>` is one of the two Climb references above. Each run gets its
own draft, so step 3 is repeated.

1. `uv run regents techtree doctor --climb <climb> --json`: checks Docker, Hermes, the engine,
   the Prime sign-in and the container image. Nothing may be missing.
2. `uv run regents techtree skill starter --climb <climb> --json`: puts the starter Skill on the
   machine and prints its `skill_path`.
3. `uv run regents techtree climb prepare <climb> --skill <skill_path> --label <label> --json`:
   check the episode count, the declared maximum and a controlled comparison, and note its
   `draft_id`.
4. The founder reads the review and approves this run. Then start it, either way:
   - In the founder's own terminal: `uv run regents techtree climb start <draft_id>`. This shows
     the review and asks "Start this run?"; answering yes starts it.
   - From an agent, after the founder's yes in the conversation:
     `uv run regents techtree climb start <draft_id> --yes --reviewed-on host-agent --json`.
5. `uv run regents techtree run status <run_id> --timeout-seconds 90 --json`, repeated until the
   run is finished.
6. `uv run regents techtree run result <run_id> --json`: the score for each side and the cost.
7. `uv run regents techtree proof verify <run_id> --json`: must report verified, with no failed
   check.

Nothing is published. Publishing a finished run is a separate step with its own approval.

## What the runs prove

| Run | Proves |
| --- | --- |
| Hello World 1 | The new model, Hermes and Campaign work end to end. All 72 episodes finish, both sides are scored, the comparison is controlled, the cost stays under $6.50, and the proof verifies offline. Its scores set the expected band for Luna; the qwen band of 20 to 27 out of 36 no longer applies. |
| Hello World 2 and 3 | The result repeats: fresh drafts of the same Skill land near run 1 and their proofs verify. |
| Frontier-CS 1 | The C++ image, the hour-long episodes and the larger limits work end to end: all 20 episodes finish, the cost stays under $2.50 and the proof verifies. The Skill may or may not help; either result is a valid run. |

If a run fails, or its cost or proof is wrong, stop. Report it before running the next one.

## What has run

- 2026-09-30, a free run against a local stand-in model on the Hello World Campaign above: all 72
  episodes finished and the proof verifies offline (351 checks). The stand-in's log shows every
  model request going to Luna with reasoning effort "high", no temperature and a 16,000-token
  cap per reply. That run's proof is the test fixture in `tests/techtree/fixtures/run`.

- 2026-09-30, Hello World run 1 (`run_f5cb27c98a9e4b78ab152d77cc8a889a`): all 72 episodes
  completed, none failed. Candidate 24 of 36, baseline 1 of 36: 23 wins, no losses. About $0.35
  (3.31 million input and 40,000 output tokens, 2.5 million of the input from the provider's
  cache). The proof verifies offline: 351 checks, grade P1.
- 2026-09-30, Hello World run 2 (`run_8e48bb957acf4f6691be85fe585832f4`), a fresh draft: all 72
  episodes completed. Candidate 24 of 36, baseline 1 of 36, no losses. About $0.36. The proof
  verifies offline: 351 checks.
- 2026-09-30, Hello World run 3 (`run_5f49476ae32c435bb01060e8a60babc9`), a fresh draft: all 72
  episodes completed. Candidate 24 of 36, baseline 0 of 36, no losses. About $0.38. The proof
  verifies offline: 351 checks.
- 2026-09-30, Frontier-CS run 1 (`run_58462b74a3f947d8889f35ea954d0e24`), starter Skill v3: all 20
  episodes completed in 31 minutes. Mean score 0.521 without the Skill, 0.518 with it: 6 wins, 2
  losses and 2 ties, and the two losses outweighed the wins, so the Skill did not clear the bar. About $1.08 (8.76 million input and 414,000 output
  tokens, 8.1 million of the input from the provider's cache). The proof verifies offline: 143
  checks. Luna alone scores 0.521 where qwen scored 0.128, so the starter Skill has little to add.
  techtree.sh did not serve starter v3 until Techtree's switch, so the run used Techtree's
  committed copy, whose digest matches the one the release pins.

Hello World scored 24, 24 and 24 out of 36 from a baseline of 0 or 1, so its band on Luna is
about 24. The Hello World Campaign `sha256:dedfeb92…` is certified, and Frontier-CS runs end to
end. All four runs together cost about $2.17. The costs are worked out at full price; the
provider's cache makes the actual bill lower. The previous Hello World Campaign, on qwen, was
certified on 2026-09-28 and 29 with 23, 22 and 24 out of 36 from a baseline of 0.
