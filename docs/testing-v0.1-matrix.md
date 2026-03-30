# Regent CLI v0.1 Testing Matrix

## Scope

This matrix tracks the current single-package Regent CLI workspace in [`regent-cli`](../).

`@regentlabs/cli` is the only shipped package. The local daemon/runtime and shared TypeScript contracts are bundled inside that package and are tested there.

Test levels used here:

- `Dispatch`: command parsing and argument-shape coverage
- `Functional`: real filesystem and local runtime coverage through the shipped CLI package
- `Integration`: live local Techtree coverage when the opt-in integration flag is enabled
- `Pack smoke`: clean-machine install proof from a packed `@regentlabs/cli` tarball

## Priority Order

### P0

- `regent run`
- `regent auth siwa login`
- `regent auth siwa status`
- `regent techtree node create`
- `regent techtree node get`
- `regent techtree node children`
- `regent techtree comment add`
- `regent techtree node comments`
- `regent techtree autoskill buy`
- `regent chat tail --webapp`
- `regent chat tail --agent`
- runtime JSON-RPC `ping` and `status`
- SIWA signing and protected-header coverage
- idempotency for node/comment writes
- packed-install smoke from a tarball

### P1

- `regent techtree status`
- `regent techtree nodes list`
- `regent techtree activity`
- `regent techtree search`
- `regent techtree node work-packet`
- `regent techtree watch`
- `regent techtree unwatch`
- `regent techtree inbox`
- `regent techtree opportunities`
- `regent create init`
- `regent create wallet`
- `regent config read`
- `regent config write`
- daemon restart with persisted session/state

### P2

- richer Gossipsub surfaces
- formatter snapshot coverage
- live Techtree golden flows against the Phoenix app

## Current Test Surface

### CLI command coverage

- Dispatch coverage:
  - [`cli-command-dispatch.test.ts`](../packages/regent-cli/test/cli-command-dispatch.test.ts)
  - [`techtree-identity-dispatch.test.ts`](../packages/regent-cli/test/techtree-identity-dispatch.test.ts)
- Config and create flows:
  - [`cli-config-create.test.ts`](../packages/regent-cli/test/cli-config-create.test.ts)
  - [`commands/create.test.ts`](../packages/regent-cli/test/commands/create.test.ts)
  - [`commands/config.test.ts`](../packages/regent-cli/test/commands/config.test.ts)
- Auth and Techtree functional flows:
  - [`commands/functional.test.ts`](../packages/regent-cli/test/commands/functional.test.ts)
- Doctor CLI coverage:
  - [`doctor-command.test.ts`](../packages/regent-cli/test/doctor-command.test.ts)
- XMTP CLI coverage:
  - [`cli-xmtp.test.ts`](../packages/regent-cli/test/cli-xmtp.test.ts)
- Autolaunch and agentbook command coverage:
  - [`commands/autolaunch.test.ts`](../packages/regent-cli/test/commands/autolaunch.test.ts)
  - [`commands/agentbook.test.ts`](../packages/regent-cli/test/commands/agentbook.test.ts)

### Bundled runtime coverage

- Runtime daemon lifecycle and JSON-RPC:
  - [`internal-runtime/runtime-daemon.functional.test.ts`](../packages/regent-cli/test/internal-runtime/runtime-daemon.functional.test.ts)
  - [`internal-runtime/runtime-start.test.ts`](../packages/regent-cli/test/internal-runtime/runtime-start.test.ts)
- Runtime config and state:
  - [`internal-runtime/config.test.ts`](../packages/regent-cli/test/internal-runtime/config.test.ts)
- Techtree client coverage:
  - [`internal-runtime/techtree-client.functional.test.ts`](../packages/regent-cli/test/internal-runtime/techtree-client.functional.test.ts)
  - [`internal-runtime/techtree-trollbox-client.test.ts`](../packages/regent-cli/test/internal-runtime/techtree-trollbox-client.test.ts)
  - [`internal-runtime/techtree.integration.test.ts`](../packages/regent-cli/test/internal-runtime/techtree.integration.test.ts)
- Docs parity coverage:
  - [`json-rpc-docs.test.ts`](../packages/regent-cli/test/json-rpc-docs.test.ts)
- Doctor subsystem coverage:
  - [`internal-runtime/doctor/check-runner.test.ts`](../packages/regent-cli/test/internal-runtime/doctor/check-runner.test.ts)
  - [`internal-runtime/doctor/doctor-daemon.functional.test.ts`](../packages/regent-cli/test/internal-runtime/doctor/doctor-daemon.functional.test.ts)
  - [`internal-runtime/doctor/runtime-scoped.test.ts`](../packages/regent-cli/test/internal-runtime/doctor/runtime-scoped.test.ts)
  - [`internal-runtime/doctor/auth-envelope.test.ts`](../packages/regent-cli/test/internal-runtime/doctor/auth-envelope.test.ts)
  - [`internal-runtime/doctor/techtree-probe.test.ts`](../packages/regent-cli/test/internal-runtime/doctor/techtree-probe.test.ts)
- Signing, Gossipsub, and BBH workload coverage:
  - [`internal-runtime/siwa-signing.test.ts`](../packages/regent-cli/test/internal-runtime/siwa-signing.test.ts)
  - [`internal-runtime/gossipsub-adapter.test.ts`](../packages/regent-cli/test/internal-runtime/gossipsub-adapter.test.ts)
  - [`internal-runtime/bbh-workload.test.ts`](../packages/regent-cli/test/internal-runtime/bbh-workload.test.ts)

### Release proof

- Single-tarball packed install smoke:
  - [`scripts/packed-install-smoke.sh`](../scripts/packed-install-smoke.sh)

This release proof is part of the required gate in both CI and the release helper.

## Standard Validation Commands

Run from [`regent-cli`](../):

```bash
pnpm check:openapi
pnpm build
pnpm typecheck
pnpm test
pnpm test:pack-smoke
```

## Current Pending Coverage

No documented v0.1 CLI/runtime coverage gaps remain open.

## v0.1 Exit Criteria Status

Overall status: satisfied.

- `Every current CLI command has at least one functional or dispatch-backed test variation.` Current status: met.
- `Every mutating command has happy-path coverage plus at least one failure-path check.` Current status: met.
- `The bundled runtime has both direct subsystem tests and daemon-backed functional coverage.` Current status: met.
- `The packed release path is validated from a clean tarball install and treated as a release gate.` Current status: met.
