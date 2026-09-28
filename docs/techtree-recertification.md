# Techtree re-certification runs for `climb-v0.3.1`

Verifiers 0.3.2 gave every Hello World task a new identity, so the Campaign this release ships is
a new one and has never been run against a real model. Three paid runs certify it. The founder
approves each run before it starts; nothing on this page has been run.

## What every run shares

| Item | Value |
| --- | --- |
| Release | `climb-v0.3.1`, ReleaseCore `sha256:c8d9f8a91b1680e81bb79b88c67bc8ae0d77eadec7b55b1ece0a766e54326cd3` |
| Engine | `sha256:cf358eae94a1922906247063a39abff4bfb941bf032ae6e9d1ca7e999b07af5b` (Verifiers `fc73e02`) |
| Climb | `hello-world-climb@1`, Campaign `sha256:f95fd132af01ddb3e4c97d1041885c0e4186ff13875b054bc5f1f63c87c711f2` |
| Provider and model | `prime`, `qwen/qwen3.7-flash`, temperature 0, at most 4,096 tokens per call |
| Credential | the Prime CLI sign-in at `~/.prime/config.json` (`PRIME_API_KEY`); Techtree checks the file is there and never opens it |
| Evaluated agent | Hermes Agent `v2026.7.20` (0.19.0) in Docker |
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

## What is not known

The 0.3.0 re-certification (26–27 August 2026) recorded its provider, model, budgets, scores and
costs, but not the exact commands. The commands above are the regents-cli form of the path that
release documented, written from the command definitions. They have not been run against a
real model.
