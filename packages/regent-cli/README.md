# `@regentlabs/cli`

`@regentlabs/cli` publishes the `regent` command-line tool. It bundles the local Regent runtime, wallet-aware Techtree flows, and the command surface used by operators to inspect, authenticate, and publish from a clean machine.

## Install

```bash
pnpm add -g @regentlabs/cli
regent --help
```

## Quick Start

```bash
regent create init
regent create wallet
regent techtree start
regent bug --summary "can't do xyz" --details "any more details here"
```

The guided `techtree start` flow checks local readiness, points at the configured backend, and walks through the first publish path.

## Reporting

```bash
regent bug --summary "can't do xyz" --details "any more details here"
regent security-report --summary "private vuln" --details "steps and impact" --contact "@xyz on telegram"
```

`regent bug` files a public report through Platform Phoenix and returns the confirmation payload, including the public bug ledger URL at `https://regents.sh/bug-report`.
`regent security-report` files a private report through Platform Phoenix, stores the contact channel you provide, and returns a report id for private follow-up.

## What Ships

- `regent` binary entrypoint
- bundled local runtime and daemon
- Techtree and Autolaunch command groups
- operator bug and security reporting commands
- SIWA login, wallet, and config management

## Links

- Workspace repository: https://github.com/regent-ai/regent-cli
- Release runbook: https://github.com/regent-ai/regent-cli/blob/main/docs/release-runbook.md
- API contract workflow: https://github.com/regent-ai/regent-cli/blob/main/docs/api-contract-workflow.md
