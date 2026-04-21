This repository owns the standalone Regents CLI workspace.

## Core Rules

- Hard cutover only. Do not add backwards compatibility shims, migration glue, or dual paths unless explicitly requested.
- Regents CLI live transport flows are daemon-owned. Do not add direct CLI-to-Phoenix socket paths.
- For API <-> backend functionality, the Regents CLI contract surface is the source of truth.
- Contract file meanings:
  - `api-contract.openapiv3.yaml` is the source of truth for a product's HTTP backend contract, including routes, auth, request bodies, response shapes, and stable error envelopes.
  - `regent-services-contract.openapiv3.yaml` is the source of truth for shared HTTP backend contracts that are not owned by one product, including shared SIWA auth and `regent-staking`.
  - `cli-contract.yaml` is the source of truth for a product's shipped CLI surface, including command names, flags/args, auth mode, whether a command is HTTP-backed or local/runtime-backed, and which backend contract operation it is allowed to use.
- Start API work here, in this order:
  - `/Users/sean/Documents/regent/regents-cli/docs/api-contract-workflow.md`
  - `/Users/sean/Documents/regent/platform/api-contract.openapiv3.yaml`
  - `/Users/sean/Documents/regent/techtree/docs/api-contract.openapiv3.yaml`
  - `/Users/sean/Documents/regent/autolaunch/docs/api-contract.openapiv3.yaml`
  - `/Users/sean/Documents/regent/regents-cli/docs/regent-services-contract.openapiv3.yaml`
  - `/Users/sean/Documents/regent/platform/cli-contract.yaml`
  - `/Users/sean/Documents/regent/techtree/docs/cli-contract.yaml`
  - `/Users/sean/Documents/regent/autolaunch/docs/cli-contract.yaml`
  - `/Users/sean/Documents/regent/regents-cli/docs/shared-cli-contract.yaml`
  - `/Users/sean/Documents/regent/regents-cli/packages/regents-cli/src/contracts/api-ownership.ts`
  - `/Users/sean/Documents/regent/regents-cli/packages/regents-cli/src/generated/`
- Do not treat backend route files or old markdown notes as the source of truth for HTTP behavior. Change the CLI-owned contract surface first, then make backend code and CLI command code match it.
- Shared SIWA code lives in `/Users/sean/Documents/regent/elixir-utils/siwa/siwa-elixir`. Do not present Platform, Techtree, or Autolaunch as the code owner for shared SIWA behavior.
- If work changes code in `/Users/sean/Documents/regent/techtree`, `/Users/sean/Documents/regent/regents-cli`, or `/Users/sean/Documents/regent/contracts`, it is not done until validation has been run in all three repos. Run `mix precommit` in `techtree`, `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm test:pack-smoke` in `regents-cli`, and `forge test --offline` from `/Users/sean/Documents/regent/contracts/techtree` for the Techtree contracts workspace.
- Prefer repository-local, versioned docs over off-repo context.

## Validation

```bash
cd /Users/sean/Documents/regent/regents-cli
pnpm check:openapi
pnpm build
pnpm typecheck
pnpm test
pnpm test:pack-smoke
```
