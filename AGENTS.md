This repository owns the standalone Regents CLI workspace and the published `regents` command.

## Local sources of truth

- `docs/shared-cli-contract.yaml` owns CLI-local command behavior.
- `docs/regent-services-contract.openapiv3.yaml` owns shared-services HTTP behavior used directly by this repository.
- `docs/json-rpc-methods.yaml` owns local runtime methods.
- `packages/regents-cli/src/contracts/api-ownership.ts` maps API-backed commands to the checked-in copied API bindings under `packages/regents-cli/src/generated/`.
- Route registries under `packages/regents-cli/src/routes/` define the shipped command set.

This public repository must remain buildable and testable on its own. Do not discover private control files or require another product checkout. Product-owned API bindings and command details arrive as reviewed, checked-in copies; their upstream synchronization is not a local validation prerequisite.

## Core rules

- Use a hard cut. Do not add compatibility aliases, fallback paths, or dual sources unless explicitly requested.
- Change the local CLI contract before changing a repository-owned public command.
- Regents CLI live transport flows are daemon-owned. Do not add direct CLI-to-server socket paths.
- Never read `.env`, `.env.local`, or `.envrc`. `.env.example` is allowed.
- Wallet, signing, authentication, billing, chain, deployment, publication, and production actions require their normal explicit authority.
- Prefer repository-local, versioned documentation over off-repository context.

## Validation

```bash
pnpm check:workspace
pnpm check:openapi
pnpm check:cli-contract
pnpm build
pnpm typecheck
pnpm test
```
