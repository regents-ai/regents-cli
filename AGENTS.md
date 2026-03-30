This repository owns the standalone Regent CLI workspace.

## Core Rules

- Hard cutover only. Do not add backwards compatibility shims, migration glue, or dual paths unless explicitly requested.
- Regent CLI live transport flows are daemon-owned. Do not add direct CLI-to-Phoenix socket paths.
- For API <-> backend functionality, the Regent CLI contract surface is the source of truth.
- Start API work here, in this order:
  - `/Users/sean/Documents/regent/regent-cli/docs/api-contract-workflow.md`
  - `/Users/sean/Documents/regent/techtree/docs/api-contract.openapiv3.yaml`
  - `/Users/sean/Documents/regent/autolaunch/docs/api-contract.openapiv3.yaml`
  - `/Users/sean/Documents/regent/regent-cli/docs/regent-services-contract.openapiv3.yaml`
  - `/Users/sean/Documents/regent/regent-cli/packages/regent-cli/src/contracts/api-ownership.ts`
  - `/Users/sean/Documents/regent/regent-cli/packages/regent-cli/src/generated/`
- Do not treat backend route files or old markdown notes as the source of truth for HTTP behavior. Change the CLI-owned contract surface first, then make backend code and CLI command code match it.
- If work changes code in `/Users/sean/Documents/regent/techtree`, `/Users/sean/Documents/regent/regent-cli`, or `/Users/sean/Documents/regent/contracts`, it is not done until validation has been run in all three repos. Run `mix precommit` in `techtree`, `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm test:pack-smoke` in `regent-cli`, and `forge test --offline` from `/Users/sean/Documents/regent/contracts/techtree` for the Techtree contracts workspace.
- Prefer repository-local, versioned docs over off-repo context.

## Validation

```bash
cd /Users/sean/Documents/regent/regent-cli
pnpm check:openapi
pnpm build
pnpm typecheck
pnpm test
pnpm test:pack-smoke
```
