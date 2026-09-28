# Techtree in regents-cli

Techtree's command line (`techtree`, 0.3.0) moves into `regents` as `regents techtree …`. The
founder answered the audit's 15 questions on 2026-09-27, all with the recommended option. The
three audit reports are in `/Users/sean/Documents/regent/artifacts/regents-cli/techtree-audit-2026-09-27/`.

Port base: Techtree `origin/main` a226cd0 plus 36db5c4 (Harbor 0.23.0 and task schema 1.4, on
local branch `tt/v040` in `/Users/sean/Documents/regent/worktrees/techtree/t13-template`).
Branch `tt/p4a-boundary` 2cbe89e is never ported: ADR 0036 stands, with no credential check.
While the port runs, Techtree's own `cli/` is frozen and changes come to regents-cli as notes.
`techtree/cli` stays until `regents techtree` ships.

## The 15 decisions

1. v0.1 proofs are no longer checked. 0.3.0 runs, proofs and published entries stay readable
   byte for byte: schema strings, field names and canonical bytes don't change.
2. `forge build` (tasks from a code repository), Repo2RLEnv and its resources are dropped.
3. The Climb stays only as the introductory run and the publishable run. `uplift` works on forge
   IDs only; the plugin demo's second run moves to forge IDs.
4. `forge export` stays as a plain folder copy. `verify-export` and `import` are dropped.
5. Collection version lines, part inheritance and the `retry_of` chains of plan and construct
   are dropped. `correct-proposal` and `correct-task` stay.
6. Dropped: the fake executor, the `baseline_then_candidate` schedule, and the reserved
   vocabulary (hosted, provider, Fabric, cost provenance). Enums inside signed records are
   narrowed to the values actually written, and cost is always UNAVAILABLE. The local taskset
   re-check (tasksets service, resolver, verifiers_cli, provider) moves to the publisher tool.
7. The home is `~/.regents/techtree`. Users move their old folder by hand once, including
   `identities/` (the key that signs runs and withdrawals). There is no migration code.
8. Real runs read the model key from the Prime sign-in file, `~/.prime/config.json`, only.
9. The engine's `.installing-` marker and the active-engine setting are dropped: a folder without
   `installed.json` is rebuilt, and the active engine is always the one that ships.
10. An approval travels as one `approval` fact: the exact command with
    `--yes --reviewed-on host-agent`, plus the review lines, built by one shared `approve()`.
    Exit codes are regents' own (0, 1, 2, 3, 4, 5, 130), with the detail in `error.code`.
11. One compact Markdown report, used everywhere. `rich.py` and the plugin's 394-line copy go.
12. The byte-identical ReleaseCore shared by the command line, the plugin and the website stays
    for 0.3.x. The bootstrap and generate tooling moves out of the command line.
13. The 3,217 lines of copy-guard tests become one short list of banned claims.
14. The plugin keeps its 17 typed tools, pointed at `regents techtree … --json`.
15. The publication endpoint override stays as one setting,
    `REGENTS_TECHTREE_PUBLICATION_ENDPOINT`, for testing against a local server.

## Commands

```
regents techtree setup | doctor
regents techtree engine install | status | verify
regents techtree skill starter
regents techtree climb list | show | prepare | start
regents techtree run status | logs | cancel | result
regents techtree proof verify
regents techtree publish | withdraw
regents techtree release info | verify
regents techtree uplift context | skill-source | prepare | start        (forge IDs only)
regents techtree forge inspect-skill | plan | plan-start | correct-proposal | construct
                       construct-start | correct-task | collect | accept | verify | export
                       run | compare | status
```

Hidden, for Techtree's own use: `regents techtree _worker --run-id <id>` (the detached run) and
`regents techtree _supervise …` (one evaluation's supervisor), both started as
`sys.executable -m regents_cli techtree …`.

## Conventions

- **Layout.** `src/regents_cli/techtree/`, with the subpackages kept from Techtree
  (`models/`, `identity/`, `manifests/`, `receipts/`, `runs/`, `verifiers/`, `engines/`,
  `publication/`, `release/`, `forge/`, `skills/`, `drafts/`, `catalog/`, `presentation/`,
  `doctor/`), the commands in `commands/`, and `resources/` copied byte for byte. No
  `__init__` re-exports.
- **Answers.** Every command returns a dict for `output.emit`. With `--json` the dict is printed
  as it is. Report-style answers carry `report`, the compact Markdown text, which is also what
  a person sees.
- **Errors.** Techtree's errors become `CommandError` subclasses in `techtree/errors.py`, using
  regents' exit codes.
- **Approval.** `techtree/approval.py: approve(review, command)`. With `--yes` it goes ahead.
  When a person is at a terminal (stdin and stdout are terminals, and there's no `--json`), it
  asks. Otherwise it raises `approval_required` (exit 1), which carries `review` (lines) and
  `approval.command`: the exact command with `--yes --reviewed-on host-agent`, as shell text
  quoted by `shlex.join`, so `shlex.split` gives back the arguments. It never waits for input it
  can't get.
- **Home.** `~/.regents/techtree` (from `siwa.home()`), with no flag to move it. The worker
  finds it the same way.
- **Models.** V2 shapes only. Enums in signed records keep only the values actually written.
  One-line docstrings; comments only where a reader would otherwise go wrong.
- **Byte-identical parts** (checked against Techtree's own output before each slice is done):
  canonical JSON and digests, Ed25519 signing, identity key files, the engine bundle digest, the
  proof bundle layout, receipt IDs, the verdict arithmetic, and ReleaseCore.
- **Dependencies added:** `pydantic`, `rfc8785`, `cryptography` and `filelock`. EIP-55 comes
  from `eth-utils`, which is already present through `eth-account`. The publication transport
  uses `httpx`, with redirects refused and the body read in chunks against the 4 MiB cap.

## Slices

| Slice | Who | What | Done when |
|---|---|---|---|
| T0 | chief | Dependencies; the package skeleton; resources (minus the Repo2RLEnv files, the harness JSON and the forge README); paths; canonical, crypto, fs, ids and pointers; errors; `approve()`; the `regents techtree` group; pytest for the kept tests | `make check` is clean; canonical digests and signatures match Techtree's on the same inputs |
| T1a | chief | constants, models (V2), identity, manifests, receipts | a 0.3.0 proof made by `techtree` verifies with the ported verifier |
| T1b | writer | verifiers, engines, runs, the worker and supervisor, and the setup, doctor, engine, skill, climb and run commands | `setup`, `engine install/verify`, `doctor` and `climb prepare` work; a real run needs the founder's go |
| T2 | writer | publication, release, and the publish, withdraw, proof and release commands | `proof verify` accepts a real 0.3.0 proof; `release verify` against the pinned ReleaseCore; publish is checked against a local server only |
| T3 | writer | forge (Skill path), the one Skill intake, drafts, catalog, forge-only uplift, `membership_digest`, the compact report, and the forge, uplift and skill commands | `forge inspect-skill → plan → … → accept → verify → export` works up to the first model call (paid calls need the founder's go) |
| T4 | chief | Integration; the kept tests and the banned-claims list; README, CHANGELOG and HANDOFF; the exact commands and answer shapes for the plugin, sent to the Techtree lane | Every slice's done line is checked on the integrated main |

T1b, T2 and T3 run in parallel on their own branches and worktrees of regents-cli, after T1a.
The chief integrates them.

## Tests kept

About 30 named tests from the glue audit, each protecting one costly failure:
- publishing without consent, or sending data off the machine;
- trusting a forged withdrawal answer;
- spending more than was approved;
- hidden benchmark material leaking;
- a `--yes` that means no being run as yes;
- an agent hanging on a prompt;
- a drifted release reported as verified.

The plugin keeps its own shell, credential, install-approval and publication-offer tests.
There's also one byte check: a canonical digest, signature and verified proof made by 0.3.0.
Nothing else, and no tests that police old shapes.

## Open items

1. ReleaseCore names `cli_version` 0.3.0, and `release verify` compares it with the installed
   package, which will be regents-cli. So a ReleaseCore naming the regents-cli version has to
   be cut when regents-cli 1.0 is released, and the plugin and website need to take the new
   copy. That's release work for the Techtree lane, and it needs the founder's go.
2. Verifiers 0.3.2: the founder ordered it, and the Techtree lane is asking whether it happens
   in `techtree/cli` first or in this port. An engine change counts as a scoring change. The
   engine is ported unchanged until that answer arrives.
