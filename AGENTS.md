<!-- BEGIN REGENT META GENERATED -->
## Repo Contract

Generated from `meta/stack.yaml` and repo `repo.yaml` files. Local notes may live outside this block.

- Repo contract: `regents-cli/repo.yaml`
- Owner: `regents-cli`
- Release group: `public_beta`
- Owned areas: `operator_control_surface`, `generated_bindings`, `local_runtime`, `portfolio_release_checks`.
- Change API or CLI behavior in the owning YAML contract before changing code.
- Use `bd` only for execution state: tickets, claims, blockers, dependencies, and closure evidence.
<!-- END REGENT META GENERATED -->
This repository owns the standalone Regents CLI workspace.

## Regent Dependency Skills

The Regent dependency skills are installed in `/Users/sean/Documents/regent/.agents/skills` and `/Users/sean/.codex/skills`. Open the matching skill before touching these areas:

- `contract-first-cli-api`: command contracts, OpenAPI inputs, generated clients, command routing, and cross-product CLI/backend alignment.
- `shared-siwa`: identity login, SIWA receipts, signed request envelopes, nonce/replay handling, and saved auth state.
- `ens-agent-identity`: ENS, Basenames, ERC-8004 identity, resolver reads, and wallet-ready identity actions.
- `agentbook-agentworld`: AgentBook, World ID trust evidence, and proof lookup/registration commands.
- `xmtp-rooms`: room commands, XMTP inbox state, public room mirrors, and message sync behavior.
- `safe-viem-wallet-actions`: Safe Protocol Kit, viem, prepared transactions, wallet action envelopes, preflight, and chain confirmation.
- `rich-terminal-output`: terminal UI output, tables, panels, progress, and structured command results.

## Core Rules

- Hard cutover only. Do not add backwards compatibility shims, migration glue, or dual paths unless explicitly requested.
- Regents CLI live transport flows are daemon-owned. Do not add direct CLI-to-Phoenix socket paths.
- Runtime plugin install has one command family: use `regents plugin install --runtime hermes` for Hermes, `regents plugin install --runtime openclaw` for OpenClaw, and `regents plugin install --runtime auto` when both should be prepared. `regents setup --runtime ...` is a readiness report, not an installer.
- For API <-> backend functionality, the Regents CLI contract surface is the source of truth.
- Contract file meanings:
  - `api-contract.openapiv3.yaml` is the source of truth for a product's HTTP backend contract, including routes, auth, request bodies, response shapes, and stable error envelopes.
  - `regent-services-contract.openapiv3.yaml` is the source of truth for shared HTTP backend contracts that are not owned by one product, including shared SIWA auth and `regent-staking`.
  - `cli-contract.yaml` is the source of truth for a product's shipped CLI surface, including command names, flags/args, auth mode, whether a command is HTTP-backed or local/runtime-backed, and which backend contract operation it is allowed to use.
- Start API work here, in this order:
  - `/Users/sean/Documents/regent/regents-cli/docs/api-contract-workflow.md`
  - `/Users/sean/Documents/regent/platform/contracts/platform/api-contract.openapiv3.yaml`
  - `/Users/sean/Documents/regent/platform/contracts/techtree/api-contract.openapiv3.yaml`
  - `/Users/sean/Documents/regent/platform/contracts/autolaunch/api-contract.openapiv3.yaml`
  - `/Users/sean/Documents/regent/regents-cli/docs/regent-services-contract.openapiv3.yaml`
  - `/Users/sean/Documents/regent/platform/contracts/platform/cli-contract.yaml`
  - `/Users/sean/Documents/regent/platform/contracts/techtree/cli-contract.yaml`
  - `/Users/sean/Documents/regent/platform/contracts/autolaunch/cli-contract.yaml`
  - `/Users/sean/Documents/regent/regents-cli/docs/shared-cli-contract.yaml`
  - `/Users/sean/Documents/regent/regents-cli/packages/regents-cli/src/contracts/api-ownership.ts`
  - `/Users/sean/Documents/regent/regents-cli/packages/regents-cli/src/generated/`
- Do not treat backend route files or old markdown notes as the source of truth for HTTP behavior. Change the CLI-owned contract surface first, then make backend code and CLI command code match it.
- For Techtree Fold work, keep CLI commands, Techtree contracts, generated OpenAPI, `README.md`, `docs/techtree-api-contract.md`, and `packages/regents-cli/skills/regents-techtree/SKILL.md` aligned. Fold installs local Hermes/OpenClaw skills and checks proof; it must not touch Platform worker registration.
- When Platform public copy names Regents CLI commands, run `pnpm check:platform-public-cli-copy`. This check compares Platform's published CLI examples against the Platform, Techtree, Autolaunch, and shared CLI contracts, and it is included in `pnpm check:cli-contract`.
- Shared SIWA code lives in `/Users/sean/Documents/regent/elixir-utils/siwa/siwa-elixir`. Do not present Platform, Techtree, or Autolaunch as the code owner for shared SIWA behavior.
- Validate where the change lives before calling work done. Work touching Techtree or Autolaunch web behavior validates in `/Users/sean/Documents/regent/platform` with `mix precommit`. CLI work validates in `/Users/sean/Documents/regent/regents-cli` with `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm test:pack-smoke`. Solidity and contract-surface work validates in the Foundry workspace at `/Users/sean/Documents/regent/platform/contracts` with `forge test --offline`.
- Prefer repository-local, versioned docs over off-repo context.

## Validation

```bash
cd /Users/sean/Documents/regent/regents-cli
pnpm check:openapi
pnpm check:cli-contract
pnpm build
pnpm typecheck
pnpm test
pnpm test:pack-smoke
```
