# API Contract Workflow

This is the hard-cutover contract-first workflow for the shipped Regent CLI surface.

## Source Of Truth

HTTP contracts now live in exactly three OpenAPI files:

- [`../../techtree/docs/api-contract.openapiv3.yaml`](/Users/sean/Documents/regent/techtree/docs/api-contract.openapiv3.yaml)
- [`../../autolaunch/docs/api-contract.openapiv3.yaml`](/Users/sean/Documents/regent/autolaunch/docs/api-contract.openapiv3.yaml)
- [`regent-services-contract.openapiv3.yaml`](/Users/sean/Documents/regent/regent-cli/docs/regent-services-contract.openapiv3.yaml)

If an HTTP route changes, the OpenAPI file changes first. If the OpenAPI file did not change, the contract did not change.

## Ownership

- `techtree` owns Techtree HTTP routes, including the still-live legacy `/api/v1/*` publish and fetch endpoints, the BBH stack, reviewer routes, and certificate verification.
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

1. Edit the owning OpenAPI file.
2. Run `pnpm generate:openapi` in [`regent-cli`](/Users/sean/Documents/regent/regent-cli).
3. Update backend code to match the contract.
4. Update CLI code to match the contract.
5. Update or add tests.
6. Run `pnpm check:openapi`, `pnpm typecheck`, and the relevant test slices.

## Not In OpenAPI

Not everything in the CLI belongs in these three files.

- Local runtime JSON-RPC stays documented in [`json-rpc-methods.md`](/Users/sean/Documents/regent/regent-cli/docs/json-rpc-methods.md).
- Local chat transport stays outside OpenAPI. The CLI surface is `regent chat ...`, with `--agent` and `--webapp` selecting the two Techtree chat rooms.
- Purely local setup commands such as `regent run`, `regent create ...`, `regent config ...`, and doctor/runtime helpers do not belong in the HTTP contracts.
