# API Contract Workflow

This is the hard-cutover contract-first workflow for the shipped Regent CLI surface.

## Source Of Truth

Backend HTTP contracts now live in exactly three OpenAPI files:

- [`../../techtree/docs/api-contract.openapiv3.yaml`](/Users/sean/Documents/regent/techtree/docs/api-contract.openapiv3.yaml)
- [`../../autolaunch/docs/api-contract.openapiv3.yaml`](/Users/sean/Documents/regent/autolaunch/docs/api-contract.openapiv3.yaml)
- [`regent-services-contract.openapiv3.yaml`](/Users/sean/Documents/regent/regent-cli/docs/regent-services-contract.openapiv3.yaml)

If an HTTP route changes, the owning OpenAPI file changes first. If the OpenAPI file did not change, the backend contract did not change.

CLI command contracts now live in exactly three YAML files:

- [`../../techtree/docs/cli-contract.yaml`](/Users/sean/Documents/regent/techtree/docs/cli-contract.yaml)
- [`../../autolaunch/docs/cli-contract.yaml`](/Users/sean/Documents/regent/autolaunch/docs/cli-contract.yaml)
- [`shared-cli-contract.yaml`](/Users/sean/Documents/regent/regent-cli/docs/shared-cli-contract.yaml)

If a shipped command changes, the owning CLI contract file changes first. If the CLI contract file did not change, the command surface did not change.

## Ownership

- `techtree` owns Techtree HTTP routes, including the `/v1/runtime/*` publish and fetch endpoints, the BBH stack, reviewer routes, and certificate verification.
- `autolaunch` owns Autolaunch HTTP routes, including AgentBook, launch, prelaunch, lifecycle, auctions, bids, ENS, subjects, and contracts.
- `shared-services` owns cross-product HTTP rails that are not Techtree-specific or Autolaunch-specific. The first cut is `regent-staking` only.

The checked-in command ownership registry lives at [`../packages/regent-cli/src/contracts/api-ownership.ts`](/Users/sean/Documents/regent/regent-cli/packages/regent-cli/src/contracts/api-ownership.ts). Every API-backed CLI command must map to one of those three owners.

## Generated Types

The CLI generates TypeScript contract types from those OpenAPI files into:

- [`../packages/regent-cli/src/generated/techtree-openapi.ts`](/Users/sean/Documents/regent/regent-cli/packages/regent-cli/src/generated/techtree-openapi.ts)
- [`../packages/regent-cli/src/generated/autolaunch-openapi.ts`](/Users/sean/Documents/regent/regent-cli/packages/regent-cli/src/generated/autolaunch-openapi.ts)
- [`../packages/regent-cli/src/generated/regent-services-openapi.ts`](/Users/sean/Documents/regent/regent-cli/packages/regent-cli/src/generated/regent-services-openapi.ts)

Regenerate them with:

```bash
pnpm generate:openapi
```

Check that the repo is in sync with the contract files with:

```bash
pnpm check:openapi
```

The release helper now treats `pnpm check:openapi` as a release gate.

## Required Change Order

When you change an HTTP-backed CLI command or backend route:

1. Edit the owning OpenAPI file if the backend HTTP contract changed.
2. Edit the owning CLI contract YAML if the shipped command surface changed.
3. Run `pnpm generate:openapi` in [`regent-cli`](/Users/sean/Documents/regent/regent-cli).
4. Update backend code to match the contract.
5. Update CLI code to match the contract.
6. Update or add tests.
7. Run `pnpm check:openapi`, `pnpm check:cli-contract`, `pnpm typecheck`, and the relevant test slices.

## Not In OpenAPI

Not everything in the CLI belongs in these three files.

- Local runtime JSON-RPC stays documented in [`json-rpc-methods.md`](/Users/sean/Documents/regent/regent-cli/docs/json-rpc-methods.md).
- Local chat transport stays outside OpenAPI. The CLI surface is `regent chatbox ...`, with `--agent` and `--webapp` selecting the two Techtree chat rooms.
- Purely local setup commands such as `regent run`, `regent create ...`, `regent config ...`, and doctor/runtime helpers do not belong in the HTTP contracts.
