# Regents CLI Handoff

Last updated: 2026-07-02, orchestration round 3 close (idiom slices + XMTP residue scrub)

This is the repo-level handoff for `/Users/sean/Documents/regent/regents-cli`. The master workspace handoff is [../HANDOFF.md](../HANDOFF.md).

## 1. How to operate here

Start with:

- `../.agents/skills/regent-workflow/SKILL.md`
- `../founder.md`
- `../meta/stack.yaml`
- `repo.yaml`
- `layer2.md`

Use `bd` from `/Users/sean/Documents/regent`.

CLI behavior is contract-first. Update the owning CLI contract before changing shipped command behavior. Product HTTP route shape comes from the owning OpenAPI contracts.

Hard cutover applies. Do not keep old command paths, compatibility aliases, fallback origins, or dual route shapes unless the current canonical contract says so.

Never read `.env`, `.env.local`, or `.envrc`. `.env.example` is allowed.

## 2. Current state

Nothing has been committed or pushed.

The CLI tree is dirty with unified-app command work, generated metadata, the CLI HTTP route drift gate, and the packed `regents init` fix — plus round 3: the `regent-4fp` XMTP residue scrub (−379 lines) and seven idiom slices (`regent-bh5r`, net −298 lines on touched files). Commit separation is still required.

Final verified CLI state (round 3 close):

- `pnpm build`, `pnpm typecheck`, `pnpm check:cli-contract`, and `pnpm test:pack-smoke` green
- `pnpm test`: 652 of 654 passing; the single failure is the Platform/CLI security-release
  alignment proof in `test/flywheel-integration-proof.test.ts`, broken by external platform
  contract edits at 11:41 on 2026-07-02 (`regent-d7bp`); the pre-edit run at 11:27 was fully
  green (653 passed, 1 skipped)
- `pnpm check:openapi` red for the same external contract drift (`regent-d7bp`)

## 3. Completed CLI work

Closed or verified this session:

- `regent-du5o`: Autolaunch CLI mutation cleanup has clean-env verification recorded.
- `regent-baq2`: packed `regents init` fixed; pack-smoke passing.
- `regent-34ng`: CLI HTTP route drift gate shipped inside `pnpm check:cli-contract`.

Autolaunch command outcome from `regent-du5o`:

- Fixed to existing signed-agent prepare routes:
  - `subjects sweep-ingress`
  - `payment-links create`
  - `payment-links set-canonical`
  - `payment-links set-state`
- Deleted because no canonical platform route exists:
  - `subjects stake`
  - `subjects unstake`
  - `subjects claim-usdc`
  - `subjects settle-buyback`

Product decision remains `regent-qhgx`.

Round 3 (2026-07-02):

- `regent-4fp` closed: XMTP residue scrub — stale metadata-generator entries, `skills/regents/SKILL.md`
  XMTP commands, `AGENTS.md` prose, the 362-line dead XMTP test-mock block, "XMTP not called"
  policing tests, and xmtp config fixtures all deleted; generated command metadata byte-identical
  after regeneration; zero xmtp references remain outside the changelog.
- `regent-bh5r` closed: seven idiom slices — help.ts dead duplicate overlay keys, shared JSON-object
  parsing in techtree.ts (now canonical `CliUsageError`), centralized non-negative-integer flag
  parsing, autolaunch private-key helper dedup (golden-path + safe-shared), `requirePositional`
  replaced by the canonical `parse.ts` helper across autolaunch/agentbook callers, and concurrent
  runtime `status()` reads.
- `regent-kvcs` closed: the 49 in-sandbox test failures were Codex-sandbox listener EPERM artifacts;
  the suite is green outside the sandbox.
- Codex adversarial review of the round: verdict approve, no material findings.

## 4. Drift gate

`pnpm check:cli-contract` now includes the CLI HTTP route check.

It checks shipped command handlers against the OpenAPI contracts included for CLI checks by `meta/stack.yaml`. It reports commands whose direct HTTP call points at a method/path missing from the owning contract.

Use this gate before trusting new or regenerated CLI command metadata.

## 5. Open decisions and follow-ups

- `regent-qhgx`: decide whether the deleted Autolaunch mutation commands stay deleted or return through proper agent routes.
- `regent-y0lc`: 5 Platform workers with no producers; affects whether the liveness gate can become a normal precommit gate.
- `regent-6aub`: Sprite metering per-window redesign.
- `regent-74dt`: Techtree x402 paid payload price rounding.
- `regent-tg8t`: SIWA replay-store architecture.
- `regent-235t`: Platform app.css adoption of the simplified design system.
- `regent-d7bp`: re-sync generated OpenAPI bindings (`pnpm generate:openapi`) once the parallel
  platform contract lane lands; `pnpm check:openapi` and the flywheel alignment test are red from
  that external drift until then.

Release ticket still open:

- `regent-27g`: publish `@regentslabs/cli` release containing the setup wizard and bump `install.sh` pin. Do not publish until Sean approves the release cut.

## 6. Checks

CLI:

```sh
cd /Users/sean/Documents/regent/regents-cli
pnpm build
pnpm typecheck
pnpm test
pnpm check:openapi
pnpm check:cli-contract
pnpm test:pack-smoke
```

Cross-repo sync:

```sh
cd /Users/sean/Documents/regent
scripts/sync-contract-artifacts.sh --check
```
