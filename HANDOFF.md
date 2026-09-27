# Regents CLI Handoff

Regents CLI is its own repository (`regents-ai/regents-cli`), cut from `cli/` of the Regents repository on 2026-09-26 with its history. Its builds, tests, doctor reports, and contract checks use only files checked into this repository.

## Sources

- `docs/shared-cli-contract.yaml`: repository-owned CLI command contract
- `docs/regent-services-contract.openapiv3.yaml`: repository-owned shared-services HTTP contract
- `docs/json-rpc-methods.yaml`: local runtime contract
- `platforms.lock.json` and `platforms/<platform>/`: each platform's pinned files, copied by `scripts/sync-platforms.mjs` (Regents: the shared profile contract and the Platform API contract)
- `packages/regents-cli/src/contracts/api-ownership.ts`: command-to-API ownership map
- `packages/regents-cli/src/generated/`: checked-in generated bindings and copied product API inputs
- `packages/regents-cli/src/routes/`: shipped command handlers

Public command behavior is contract-first. Platform-owned inputs change by moving their pin; local validation never discovers another checkout.

## Checks

Run `make check` from the repository root.

Do not publish, deploy, push, sign, access production, or move value without explicit authority.
