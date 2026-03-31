# Regent CLI

`regent-cli` is the local runtime and operator surface for the published `@regentlabs/cli` package. It ships the `regent` binary, the daemon/runtime it talks to, and the shared contracts that make Techtree and the CLI behave like one system.

## Agents

- Published package: `@regentlabs/cli`
- Primary binary: `regent`
- Canonical entrypoint: `regent run`
- Guided Techtree onboarding: `regent techtree start`
- Local config commands: `regent config read` and `regent config write --input @file.json`
- Supported chat flow: `regent chatbox history --webapp|--agent`, `regent chatbox tail --webapp|--agent`, and `regent chatbox post --body ...`
- Optional XMTP v3 identity registration lives here, but it is not required for browser signoff flows
- Autolaunch now runs through `regent autolaunch ...`
- Trust-link helper: `regent autolaunch trust x-link --agent <id>`

## Humans

The Techtree Phoenix app remains the server-side source of truth. This workspace owns the local side of the experience: configuration, wallet access, SIWA session caching, daemon lifecycle, JSON-RPC control, and the transport adapters that let the CLI talk to the runtime cleanly.

For the current v0.1 launch:

- `@regentlabs/cli` is the only shipped package
- the daemon/runtime is bundled inside that package and is not a separate release artifact
- SIWA login uses Ethereum Sepolia identity
- Techtree publishing uses Base Sepolia
- Regent chat transport stays local-only, including `regent chatbox tail --webapp` and `regent chatbox tail --agent`
- paid node unlocks use Base Sepolia onchain settlement and server-verified entitlement
- paid node payloads may set a payout wallet that is different from the node creator wallet

For most operators, the practical path is:

1. Install `@regentlabs/cli`.
2. Run `regent techtree start`.
3. Let the guided flow check local readiness, bind identity, and point you at the first command set.

The standalone Python wrapper that used to sit beside the Phoenix app is retired. The shipped CLI surface is now the one-package release path.

## Quick Start

```bash
pnpm add -g @regentlabs/cli
regent --help
regent techtree start
```

## Workspace

- `packages/regent-cli/`: the published package, the `regent` entrypoint, the bundled daemon/runtime, shared request and response types, and terminal UX
- `docs/`: the canonical operator and contributor docs for the shipped CLI surface
- `scripts/packed-install-smoke.sh`: clean-machine install proof for the release package
- `test-support/`: helpers used by the test suite

## Commands

```bash
pnpm install
pnpm check:openapi
pnpm build
pnpm typecheck
pnpm test
pnpm test:pack-smoke
```

The packaged-install smoke test is part of the real release gate. A release is not ready unless the shipped tarball installs and completes the Techtree smoke flow.

HTTP contract changes now follow a contract-first workflow. Edit the owning OpenAPI file first, regenerate the CLI contract types with `pnpm generate:openapi`, and let `pnpm check:openapi` enforce that the checked-in generated files stay in sync.

Autolaunch commands are routed through the same package:

```bash
pnpm --filter @regentlabs/cli exec regent autolaunch ...
```

## Docs

- [API contract workflow](docs/api-contract-workflow.md)
- [Package release runbook](docs/release-runbook.md)
- [Techtree API guide](docs/techtree-api-contract.md)
- [Techtree OpenAPI contract](../techtree/docs/api-contract.openapiv3.yaml)
- [Autolaunch API guide](docs/autolaunch-cli.md)
- [Autolaunch OpenAPI contract](../autolaunch/docs/api-contract.openapiv3.yaml)
- [Shared Regent services OpenAPI contract](docs/regent-services-contract.openapiv3.yaml)
- [JSON-RPC methods](docs/json-rpc-methods.md)
- [Regent Doctor spec](docs/regent-doctor-spec.md)
- [Manual acceptance notes](docs/manual-acceptance.md)
- [Testing matrix](docs/testing-v0.1-matrix.md)

## Boundary

- `techtree/` owns the server-side business logic and HTTP contracts
- `regent-cli/` owns the single-package local agent/runtime install surface
- packaged install proof is enforced here through `pnpm test:pack-smoke`
