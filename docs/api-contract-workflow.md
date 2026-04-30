# API Contract Workflow

This is the hard-cutover contract-first workflow for the shipped Regents CLI surface.

## Source Of Truth

The portfolio release contract lives in:

- [`regent-workspace.yaml`](/Users/sean/Documents/regent/regents-cli/docs/regent-workspace.yaml)

That file declares the required repos, owned domains, contract files, generated bindings, release checks, shared contract mirrors, money-movement rows, and incident classes. Cross-repo release checks read from that file instead of keeping separate path lists.

Backend HTTP contracts now live in exactly four OpenAPI files:

- [`../../platform/api-contract.openapiv3.yaml`](/Users/sean/Documents/regent/platform/api-contract.openapiv3.yaml)
- [`../../techtree/docs/api-contract.openapiv3.yaml`](/Users/sean/Documents/regent/techtree/docs/api-contract.openapiv3.yaml)
- [`../../autolaunch/docs/api-contract.openapiv3.yaml`](/Users/sean/Documents/regent/autolaunch/docs/api-contract.openapiv3.yaml)
- [`regent-services-contract.openapiv3.yaml`](/Users/sean/Documents/regent/regents-cli/docs/regent-services-contract.openapiv3.yaml)

If an HTTP route changes, the owning OpenAPI file changes first. If the OpenAPI file did not change, the backend contract did not change.

CLI command contracts now live in exactly four YAML files:

- [`../../platform/cli-contract.yaml`](/Users/sean/Documents/regent/platform/cli-contract.yaml)
- [`../../techtree/docs/cli-contract.yaml`](/Users/sean/Documents/regent/techtree/docs/cli-contract.yaml)
- [`../../autolaunch/docs/cli-contract.yaml`](/Users/sean/Documents/regent/autolaunch/docs/cli-contract.yaml)
- [`shared-cli-contract.yaml`](/Users/sean/Documents/regent/regents-cli/docs/shared-cli-contract.yaml)

If a shipped command changes, the owning CLI contract file changes first. If the CLI contract file did not change, the command surface did not change.

## Ownership

- `techtree` owns Techtree HTTP routes, including the public `/v1/runtime/*` read endpoints and agent-authenticated `/v1/agent/runtime/*` publish endpoints, the BBH stack, reviewer routes, and certificate verification.
- `autolaunch` owns Autolaunch HTTP routes, including AgentBook, launch, prelaunch, lifecycle, auctions, bids, ENS, subjects, and contracts.
- `platform` owns Platform HTTP routes, including AgentBook trust sessions, platform-managed ENS preparation, and `regent-staking`.
- `shared-services` owns shared SIWA auth, signed request verification, health, metrics, contract discovery, and internal keyring routes.

The shared SIWA codebase is [`/Users/sean/Documents/regent/elixir-utils/siwa/siwa-elixir`](/Users/sean/Documents/regent/elixir-utils/siwa/siwa-elixir). Product repos may host adapters or route mounts, but they do not own the shared SIWA contract.

The checked-in command ownership registry lives at [`../packages/regents-cli/src/contracts/api-ownership.ts`](/Users/sean/Documents/regent/regents-cli/packages/regents-cli/src/contracts/api-ownership.ts). Every API-backed CLI command must map to one of those four owners.

## Generated Types

The CLI generates TypeScript contract types from those OpenAPI files into:

- [`../packages/regents-cli/src/generated/platform-openapi.ts`](/Users/sean/Documents/regent/regents-cli/packages/regents-cli/src/generated/platform-openapi.ts)
- [`../packages/regents-cli/src/generated/techtree-openapi.ts`](/Users/sean/Documents/regent/regents-cli/packages/regents-cli/src/generated/techtree-openapi.ts)
- [`../packages/regents-cli/src/generated/autolaunch-openapi.ts`](/Users/sean/Documents/regent/regents-cli/packages/regents-cli/src/generated/autolaunch-openapi.ts)
- [`../packages/regents-cli/src/generated/regent-services-openapi.ts`](/Users/sean/Documents/regent/regents-cli/packages/regents-cli/src/generated/regent-services-openapi.ts)

Regenerate them with:

```bash
pnpm generate:openapi
```

Check that the repo is in sync with the contract files with:

```bash
pnpm check:workspace
pnpm check:openapi
```

The release helper now treats `pnpm check:workspace` and `pnpm check:openapi` as release gates.

## Required Change Order

When you change an HTTP-backed CLI command or backend route:

1. Edit the owning OpenAPI file if the backend HTTP contract changed.
2. Edit the owning CLI contract YAML if the shipped command surface changed.
3. Run `pnpm generate:openapi` in [`regents-cli`](/Users/sean/Documents/regent/regents-cli).
4. Update backend code to match the contract.
5. Update CLI code to match the contract.
6. Update or add tests.
7. Run `pnpm check:workspace`, `pnpm check:openapi`, `pnpm check:cli-contract`, `pnpm typecheck`, and the relevant test slices.

## Not In OpenAPI

Not everything in the CLI belongs in these three files.

- Local runtime JSON-RPC stays documented in [`json-rpc-methods.md`](/Users/sean/Documents/regent/regents-cli/docs/json-rpc-methods.md).
- Local chat transport stays outside OpenAPI. The CLI surface is `regents chatbox ...`, with `--agent` and `--webapp` selecting the two Techtree chat rooms.
- Purely local setup commands such as `regents run`, `regents create ...`, `regents config ...`, and doctor/runtime helpers do not belong in the HTTP contracts.
