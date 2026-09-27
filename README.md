# Regents CLI

[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)
[![npm @regentslabs/cli](https://img.shields.io/badge/npm-%40regentslabs%2Fcli-lightgrey)](https://www.npmjs.com/package/@regentslabs/cli)
[![Version 1.0.0](https://img.shields.io/badge/version-1.0.0-lightgrey)](CHANGELOG.md)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-lightgrey)](https://nodejs.org)
[![pnpm 10.28](https://img.shields.io/badge/pnpm-10.28-lightgrey)](https://pnpm.io)

Regents CLI, built by Regents Labs, publishes the `regents` command. It is the agent and operator control surface for Regent: install local agent tools, keep local Regent access open, check readiness, manage identity, and use Regents wallet and payment tools.

It is becoming the one command line for every Regent platform, each under its own
name: `regents patchbay …`, `regents autolaunch …`, `regents techtree …`. Today it holds
the Regents commands and the first Techtree commands; the rest move in platform by
platform. Each platform describes its commands in its own repository, in a
`cli/commands.json` that follows [`schemas/commands.v1.json`](schemas/commands.v1.json),
and this repository pins those descriptions by commit in
[`platforms.lock.json`](platforms.lock.json).

For existing wallets, delegated funds, and provider choices, start with the
[agent wallet guide](docs/agent-wallets.md). `regents wallet setup` only shows
choices until you explicitly select an action.

## Getting started from this checkout

The checkout contains the 1.0.0 release candidate. Hosted installer availability and
registry publication are separate release checks; do not infer either from this README.
With Node 22+ and the package manager version declared in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/regents-cli/dist/index.js --help
```

Use `--help` and the [command contract](docs/shared-cli-contract.yaml) before choosing
an operation. Initialization and runtime/plugin setup write local configuration;
wallet and paid operations require their own signer and spending authority.
The checked-in `scripts/install.sh` is a release artifact to review, not a promise
that `regents.sh/install.sh` is currently served.

## Product ownership

See the [Regents monorepo overview](../README.md) for current components and related products.
Each product owns its API and authorization; retained cross-product commands are not
a promise that their old server routes still exist.

## Local Verify evidence

> [!NOTE]
> Local receipts are operator-trusted evidence, not proof. An operator who controls local
> files can fabricate them.

`regents techtree verify run` emits receipts only as part of runner execution. Each receipt is bound to its non-symlinked local receipt store, and Uplift rejects receipts copied into another initialized store. Local receipts remain operator-trusted evidence: an operator who controls local files can fabricate them. Receipt digests and store binding are tamper-evident within the runner emission path and checkable by the report verifier. Cryptographic attestation is the planned post-v0.1 proof layer; receipt-store binding and the queued post-freeze independent report verifier are the v0.1 checkable layer.

## Important Commands

| Command | Use it for |
| --- | --- |
| `regents init` | Create local config and required folders, then print what still needs work. |
| `regents setup` | Detect agent runtimes and wire Regent plugins or MCP registration. |
| `regents status` | Show current local Regent readiness. |
| `regents run` | Keep local Regent access open for agents and terminal commands. |
| `regents doctor --fix` | Apply safe local repairs and print remaining next steps. |
| `regents identity ensure` | Set up or confirm the local Agent identity. |
| `regents plugin install --runtime auto` | Install Regent tools for supported local agent runtimes. |
| `regents update` | Update the installed CLI through npm. |
| `regents --version` | Print the installed CLI version. |

## Agent Orientation

Command behavior starts in [`docs/shared-cli-contract.yaml`](docs/shared-cli-contract.yaml), local route registries, and the checked-in API bindings under `packages/regents-cli/src/generated/`. The repository builds and validates without private coordination files or another product checkout.

Repo instructions live in [`AGENTS.md`](AGENTS.md). Agent skills ship under [`packages/regents-cli/skills/`](packages/regents-cli/skills/).

## Checks

Choose the checks that exercise the changed behavior. `make check` runs every gate,
as CI does, for releases and changes to command contracts:

| Command | What it does |
| --- | --- |
| `pnpm build` | Builds `@regentslabs/cli`. |
| `pnpm typecheck` | Type-checks the package. |
| `pnpm test` | Runs the unit suite. |
| `pnpm check:workspace` | Verifies the required contract and generated files are present and the generated command list is current. |
| `pnpm check:openapi` | Verifies the generated API bindings still match their contracts. |
| `pnpm check:cli-contract` | Verifies the command surface still matches the published CLI contract. |
| `pnpm check:platforms` | Verifies each platform's copies under `platforms/` match their pinned commits, and that each pinned command description fits the format and names real operations in that platform's OpenAPI documents. |

## Related products

- [Regents](https://regents.sh) · [source](https://github.com/regents-ai/regents)
- [Patchbay](https://patchbay.help) · [source](https://github.com/regents-ai/patchbay)
- [Autolaunch](https://autolaunch.sh) · [source](https://github.com/regents-ai/autolaunch)
- [Techtree](https://techtree.sh) · [source](https://github.com/regents-ai/techtree)

## License

MIT — see [LICENSE](LICENSE).
