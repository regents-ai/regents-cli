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
| Cost shown in a result (from regents-cli 1.3.3) | what the provider reported for every model call, added up over both sides; a run where any call came back without a cost shows none |
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
| Spend stop (from regents-cli 1.3.2) | Techtree adds up the cost the provider reports for each finished task and stops the run once it reaches $6.50 | the same, at $2.50 |
| Expected spend per run | about $0.13 to $0.14, as the provider reported it for the three certification runs | about $0.40 to $0.70, as reported for the four runs so far |

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

- 2026-10-28, a free run against a local stand-in model on `hello-world-climb@3`
  (`climb-v0.7.21`, the patched engines with msgpack 1.2.3, Prime-key route,
  `run_4d719cc590124e0ebad42d1d19d2ad78`): all 72 episodes finished and the proof verifies
  offline (355 checks). That run's proof is now the test fixture in `tests/techtree/fixtures/run`.
  It replaces `run_6932c346b0184d15b2c2cc0b6fb36b97`, the same run on the engine before msgpack
  moved.

- 2026-10-27, a free run against a local stand-in model on `tasksmith-climb@2` after the fix
  below (`run_203f5fbb350a44ec82461c65dedff3dd`), and one on its held-out tasks
  (`run_7f8bc1dbf2684e7ead353d5eedba5e4f`): in each, all 12 episodes finished and were scored
  under `reward`, and the proof verifies offline (115 checks). The stand-in answers every call "done",
  so every task scores 0; the run proves only that a Tasksmith run completes and is scored.

- 2026-10-27, the first paid Tasksmith run on `tasksmith-climb@2`
  (`run_1abd03c1f1534b5d8a970be482239865`, about $0.85) ended as unusable. Verifiers 0.4.0 names
  a Harbor task's score by its reward key, `reward`; the engine before named it after the
  scoring method, `solved`, and both Tasksmith Campaigns still asked for `solved`, so every
  trace failed the rubric check. The scores themselves were sound (one candidate task solved).
  Nine provider "502"s and one "520" during the run were all retried inside their tasks. The
  Campaigns now ask for `reward`; a free stand-in Tasksmith run comes before any paid one,
  because the catalog's own checks grade tasks without the episode's scorer.

- 2026-10-27, paid recertification on `climb-v0.7.20` (regents-cli 1.10.19, Verifiers
  `0.4.0+regents.1`, Prime-key route, billed to Regents Labs): Hello World 1, 2 and 3
  (`run_3f0e618b05834b33b37b051ff2325da6`, `run_c811e1636b504b38a0147b0e9473b39c`,
  `run_4c1fa831752f4e2eb46cd798f3bd9f50`) each finished all 72 episodes with candidate 24 of 36
  and baseline 0 of 36, about $0.13 to $0.14 each, proofs verified (355 checks). Run 1 absorbed
  20 provider "502"s by retrying them. Frontier-CS 1 (`run_e7b22e46920742f9aa0106f97ee8372f`)
  finished all 20 episodes, candidate mean 0.539 against 0.531, 6 wins and 3 losses, about
  $0.48, proof verified (147 checks).
  Tasksmith (`run_6a4b4b5ed5e14ac1921baaf279258c9e`) finished all 12 episodes: candidate 1 of
  6 against baseline 2 of 6, one loss and five ties, $0.92, proof verified (115 checks).
  Tasksmith held-out (`run_10f7ba0bc8da47149e5870fb6da0f4ab`): candidate 4 of 6 against 5 of 6,
  one loss and five ties, $0.78, proof verified (115 checks). The starter Skill does not help on
  Tasksmith; a losing result is a valid run. Three earlier Hello World 1 attempts and the
  first Tasksmith attempt above ended unusable. The six runs and those attempts cost $3.68 of
  the $5.50 approved.

- 2026-10-27, repeat runs on the same release: Hello World 4
  (`run_d2e7e61d709d416b893f11aa912d7246`) 24 of 36 against 0, $0.14, 355 checks; Frontier-CS 2
  (`run_d59aa9f77ec44dc09a5a16efa73f1378`) 0.512 against 0.499, 8 wins and 1 loss, $0.49, 147
  checks; Tasksmith 2 (`run_e883bb256d904fa38b302213efc44bc5`) and Tasksmith held-out 2
  (`run_76239b312a964872908f57c44bc1b910`) repeated the first runs' scores exactly (1 of 6 against
  2 of 6, and 4 of 6 against 5 of 6), $0.81 and $0.73, 115 checks each. Every proof verified.
  The four cost $2.17 of the $4.70 approved.

- 2026-10-27, why the two runs below lost tasks. Verifiers relayed every failed provider call to
  Hermes labelled as a bad request, and Hermes never retries a bad request, so one "502" ended
  the task. When that happened on a task's first model call the task ended as an error and the
  run was unusable. When it happened later, Hermes stopped cleanly, Verifiers counted the
  failure as handled and the task was scored on what was left, without any error on the record.
  regents-cli 1.10.19 installs Regents' copy of Verifiers (`regents-ai/verifiers`, version
  `0.4.0+regents.1`), which labels a provider's server errors as server errors, so Hermes
  retries them, and reruns a task, up to twice, whose provider failed before answering any
  model call. Every Climb now sets `retry_limit` to 2. A task whose last model call failed on
  the provider's side is recorded as not finished, so a run can no longer score it silently.
  Read with that rule, the saved records of Hello World run 3
  (`run_5f49476ae32c435bb01060e8a60babc9`) and the hill-climb's third run
  (`run_fb2a75504ca24b31b7acce2c4bd7f133`) each hold one task that was scored this way: one
  baseline task in each, cut off by a "502" after 3 and 5 model calls. Both stay published as
  they are (founder, "3 a"); neither result changes direction.

- 2026-10-27, two paid Hello World runs on `hello-world-climb@3` (`climb-v0.7.20`, Verifiers
  0.4.0, Prime-key route, billed to Regents Labs) stopped as unusable because Prime answered
  some model calls with "502 Service temporarily unavailable. Please retry.":
  `run_df7a4732ee6a4108b9b2b9d38479258e` lost 2 of 72 tasks (about $0.13) and
  `run_807eb67afc874cf6a4750c82266fea6d` lost 4 (about $0.12). No model call is retried, in
  this engine or the one before it, and every Climb sets `retry_limit` to 0, so one such answer
  makes a run unusable. An earlier attempt at 03:35Z found the Regents Labs wallet empty and
  cost nothing.

- 2026-10-27, a free run against a local stand-in model on `hello-world-climb@3`
  (`climb-v0.7.20`, Verifiers 0.4.0, Prime-key route): all 72 episodes finished and the proof
  verifies offline (355 checks). That run's proof was the test fixture until 2026-10-28.

- 2026-10-05, a free run against a local stand-in model on `hello-world-climb@3`
  (`climb-v0.7.0`, each task scored on the environment's weighted total of its rewards): all 72
  episodes finished and the proof verifies offline (351 checks). That run's proof was the test
  fixture until 2026-10-27.

- 2026-10-02, a free run against a local stand-in model on `hello-world-climb@2`
  (`climb-v0.6.0`, regents-cli 1.4.0): all 72 episodes finished and the proof verifies offline
  (351 checks). That run's proof was the test fixture until 2026-10-05.

- 2026-09-30, a free run against a local stand-in model on the Hello World Campaign above: all 72
  episodes finished and the proof verifies offline (351 checks). The stand-in's log shows every
  model request going to Luna with reasoning effort "high", no temperature and a 16,000-token
  cap per reply.

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

- 2026-09-30, the Frontier-CS starter hill-climb (founder's 2a): three runs of new starter
  Skills against the same Campaign. Round 1 (`run_adb9777de28649f78a91ea71e77e90a2`) scored
  0.494 without the Skill and 0.551 with it, about $1.62. Round 2
  (`run_fe36f4fabb6a47b383881b2eb1940703`), a stricter version, scored 0.497 and 0.528 with 3
  losses, about $2.70, and was dropped. Round 1's Skill run again unchanged
  (`run_fb2a75504ca24b31b7acce2c4bd7f133`) scored 0.457 and 0.534, about $1.55. Across both of
  its runs against all four runs without a Skill, round 1's Skill scores 0.542 against 0.508,
  higher on 7 of the 9 problems that can be scored. It is starter v4 in regents-cli 1.3.1
  (`climb-v0.5.1`). Every proof verifies offline. The model provider refuses problem 01 on
  both sides in every run.

Hello World scored 24, 24 and 24 out of 36 from a baseline of 0 or 1, so its band on Luna is
about 24. The Hello World Campaign `sha256:dedfeb92…` is certified, and Frontier-CS runs end to
end. Results from regents-cli 1.3.2 and earlier showed a cost worked out at full price, which
put all four runs at about $2.17; the provider's cache makes the actual bill lower. The
provider's own reported costs, added up from each run's records, were $0.13, $0.13 and $0.14 for the three Hello World runs and $0.38 for
Frontier-CS run 1. For the hill-climb, they were $0.49, $0.68 and $0.49. The previous Hello World Campaign, on qwen, was
certified on 2026-09-28 and 29 with 23, 22 and 24 out of 36 from a baseline of 0.
