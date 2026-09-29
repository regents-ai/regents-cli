# Techtree re-certification runs for `climb-v0.3.1`

Verifiers 0.3.2 gave every Hello World task a new identity, so the Campaign this release ships is
a new one and has never been run against a real model. Three paid runs certify it. The founder
approves each run before it starts.

## What every run shares

| Item | Value |
| --- | --- |
| Release | `climb-v0.3.1`, ReleaseCore `sha256:a8942d23ade4f2174fc2b77bf9c20b14cdfeaec94b73a343f87a81b28a8d2e80` |
| Engine | `sha256:cf358eae94a1922906247063a39abff4bfb941bf032ae6e9d1ca7e999b07af5b` (Verifiers `fc73e02`) |
| Climb | `hello-world-climb@1`, Campaign `sha256:93ee4627a7885aa90550d2bdccb1ebdce24f4a9232afd56fc5b8a8fc189187a1` |
| Provider and model | `prime`, `qwen/qwen3.7-flash`, temperature 0, at most 4,096 tokens per call |
| Credential | the Prime CLI sign-in at `~/.prime/config.json` (`PRIME_API_KEY`); Techtree checks the file is there and never opens it |
| Evaluated agent | Hermes Agent `v2026.7.20` (0.19.0), already installed in the subject image `ghcr.io/regents-ai/techtree-subject@sha256:0acde5ee…`, so no episode downloads anything (`scripts/techtree/subject-image`) |
| Candidate | the starter Skill, `sha256:596d1368ac157975accce7ceff835eed6bfb789eaf68528a0aefa25a68793b0b`, labelled `hello-world-v1` |
| Episodes | 72 per run: 36 tasks, once without the Skill and once with it |
| Declared maximum spend | $2.50 per run, $7.50 for all three |
| Enforced bound | $2.42 per run: Techtree refuses to start if the Campaign's per-episode limits could add up past $2.50, at Prime's recorded prices of $0.03 and $0.13 per million input and output tokens |
| Expected spend | about $0.10 to $0.20 per run, going by the 0.3.0 runs ($0.11 to $0.14) |

Each run needs Docker running, the Prime sign-in in place, and regents-cli at the release commit.
Every command runs from the repository root in the founder's own home, because that is where
the Prime sign-in lives.

## The commands

These are the same for all three runs. Each run gets its own draft, so step 3 is repeated.

1. `uv run regents techtree doctor --climb hello-world-climb@1 --json`: checks Docker, Hermes,
   the engine, the Prime sign-in and the container image. Nothing may be missing.
2. `uv run regents techtree skill starter --json`: puts the starter Skill on the machine and prints
   its `skill_path`.
3. `uv run regents techtree climb prepare hello-world-climb@1 --skill <skill_path> --label hello-world-v1 --json`:
   check that it reports 72 episodes, a declared maximum of $2.50 and a controlled comparison,
   and note its `draft_id`.
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

Nothing is published. Publishing a finished run is a separate step with its own approval, and it
is not part of re-certification.

## What each run proves

| Run | Proves |
| --- | --- |
| 1 | The new engine and the new Campaign work end to end against a real model. All 72 episodes finish, both sides are scored, the comparison is controlled, the cost stays under $2.50, and the proof verifies offline. The candidate's score must fall in the calibrated band of 20 to 27 out of 36, with the baseline at or near 0. |
| 2 | The result repeats. A fresh draft of the same Skill scores within the same 20 to 27 band and its proof verifies. |
| 3 | The band holds a third time, so the three scores together certify the Campaign the way 0.3.0's three runs did (23, 23 and 24 out of 36, each from a baseline of 0). |

If a run fails, or scores outside the band, stop. Report it before running the next one.

## What has run

- 2026-09-28, first run 1 (`run_866efcbf104b4fc19b1c573045d006be`), on the previous Campaign
  `sha256:f95fd132…`: failed as not usable. Each episode then installed Hermes from GitHub at
  its start; GitHub refused 10 of the 72 downloads (HTTP 429, one dropped connection), so 7
  baseline and 3 candidate episodes never ran. The rest: candidate 21 of 33, baseline 0 of 29.
  About $0.13 (3.89 million input and 81,000 output tokens). The founder chose to put Hermes in
  the subject image ("1 a"); that is the Campaign above, and run 1 starts again on it.
- 2026-09-28, run 1 (`run_eb031b6c07ba4b31a741d4cca777a8be`), on the Campaign above: all 72
  episodes completed, none failed. Candidate 23 of 36, baseline 0 of 36: 23 wins, 13 ties, no
  losses. About $0.17 (5.31 million input and 89,000 output tokens, 2.2 million of the input from
  the provider's cache). The proof verifies offline: 351 checks, grade P1. Not published.
- 2026-09-28, run 2 (`run_5d91bc6dfdcf4815a99d34369edc11a8`), a fresh draft on the same Campaign:
  all 72 episodes completed, none failed. Candidate 22 of 36, baseline 0 of 36: 22 wins, 14 ties,
  no losses. About $0.17 (5.32 million input and 92,000 output tokens, 2.0 million of the input
  from the provider's cache). The proof verifies offline: 351 checks, grade P1. Not published.
- 2026-09-29, run 3 (`run_f41f69151d834f46a1029f1607d201d5`), a fresh draft on the same Campaign:
  all 72 episodes completed, none failed. Candidate 24 of 36, baseline 0 of 36: 24 wins, 12 ties,
  no losses. About $0.16 (4.97 million input and 88,000 output tokens, 2.1 million of the input
  from the provider's cache). The proof verifies offline: 351 checks, grade P1. Not published.

All three runs landed in the band, 23, 22 and 24 of 36 from a baseline of 0, against 0.3.0's
23, 23 and 24. The Campaign `sha256:93ee4627…` is certified. Together they cost about $0.50.

## What is not known

The 0.3.0 re-certification (26–27 August 2026) recorded its provider, model, budgets, scores and
costs, but not the exact commands. The commands above are the regents-cli form of the path that
release documented, written from the command definitions. They have not been run against a
real model.
