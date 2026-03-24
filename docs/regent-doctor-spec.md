# Regent Doctor Spec

Status: draft v0.1  
Audience: coding agent implementing `regent-cli` and `regent-runtime`  
Scope: local diagnostics for `regent-cli` against the current `regent-ai/techtree` Phoenix + SIWA-sidecar architecture

## 1. Purpose

`regent doctor` is the diagnostic surface for the local Regent agent runtime.

It answers one question:

> Can this machine, with this config and signer, successfully perform SIWA-authenticated Techtree work right now?

The command exists because the Regent/Techtree auth path has multiple failure points:
- local config/runtime issues
- missing identity fields required by Techtree
- Techtree API availability issues
- SIWA session absence/expiry
- malformed HTTP signature envelope
- SIWA sidecar denial of the authenticated request

The current Techtree API contract already exposes:
- `GET /health`
- `POST /v1/agent/siwa/nonce`
- `POST /v1/agent/siwa/verify`
- authenticated agent routes under `api_agent`, including `POST /v1/tree/nodes`, `POST /v1/tree/comments`, `GET /v1/tree/nodes/:id/work-packet`, `GET /v1/agent/inbox`, and `GET /v1/agent/opportunities`

## 2. Non-goals

`regent doctor` v0.1 must not:
- mutate Techtree state by default
- create wallets silently
- perform SIWA login silently without user intent
- create nodes/comments unless the user explicitly requests a full proof pass

## 3. Command surface

### 3.1 Top-level commands

```bash
regent doctor
regent doctor --json
regent doctor --verbose
regent doctor --fix
regent doctor --full
```

### 3.2 Scoped commands

```bash
regent doctor runtime
regent doctor auth
regent doctor techtree
regent doctor transports
regent doctor xmtp
```

### 3.3 Semantics

- `regent doctor` runs the safe, non-mutating default check set.
- `regent doctor --json` emits machine-readable JSON only.
- `regent doctor --verbose` includes structured check details.
- `regent doctor --fix` may apply safe local remediations.
- `regent doctor --full` may perform a real authenticated write proof.
- `regent doctor runtime|auth|techtree|transports|xmtp` runs only the named scope.

## 4. Architecture placement

The diagnostic logic belongs in the bundled runtime layer inside `@regentlabs/cli`, not in the shell-only command layer.

### 4.1 Responsibilities

Bundled runtime layer:
- executes checks
- reads config/session/state
- talks to local signer
- constructs HTTP auth envelopes
- talks to Techtree
- returns structured `DoctorReport`

`regent-cli`:
- parses flags/subcommands
- invokes runtime JSON-RPC methods
- renders human or JSON output
- optionally asks for confirmation when `--fix` or `--full` would mutate state

## 5. Current Techtree contract assumptions

The doctor implementation must be grounded in the current Techtree server contract.

### 5.1 Route assumptions

The current Phoenix router exposes:
- `GET /health`
- `POST /v1/agent/siwa/nonce`
- `POST /v1/agent/siwa/verify`
- authenticated routes under `api_agent`:
  - `POST /v1/tree/nodes`
  - `POST /v1/tree/comments`
  - `GET /v1/tree/nodes/:id/work-packet`
  - `POST /v1/tree/nodes/:id/watch`
  - `DELETE /v1/tree/nodes/:id/watch`
  - `GET /v1/agent/inbox`
  - `GET /v1/agent/opportunities`

### 5.2 Auth assumptions

Protected agent routes are enforced by `RequireAgentSiwa`, which requires:
- `x-agent-wallet-address`
- `x-agent-chain-id`
- `x-agent-registry-address`
- `x-agent-token-id`

That plug calls the SIWA sidecar `/v1/http-verify` path and only accepts a `200` body with `ok: true` and `code: "http_envelope_valid"`.

### 5.3 HTTP signature assumptions

The sidecar/vector harness requires covered components in the signature input for the normal receipt-header form:
- `@method`
- `@path`
- `x-siwa-receipt`
- `x-key-id`
- `x-timestamp`
- `x-agent-wallet-address`
- `x-agent-chain-id`
- `x-agent-registry-address`
- `x-agent-token-id`

The sidecar also validates:
- receipt format and expiry
- `x-key-id` binding to the receipt wallet
- `x-agent-wallet-address` binding to the receipt
- chain/registry/token bindings
- replay safety via nonce/timestamp/signature-input

## 6. Runtime JSON-RPC methods

Add these methods to the runtime control plane:

```ts
"doctor.run"
"doctor.runScoped"
"doctor.runFull"
```

### 6.1 Method signatures

```ts
interface DoctorRunParams {
  json?: boolean;
  verbose?: boolean;
  fix?: boolean;
}

interface DoctorRunScopedParams extends DoctorRunParams {
  scope: "runtime" | "auth" | "techtree" | "transports" | "xmtp" | "artifact" | "bbh";
}

interface DoctorRunFullParams extends DoctorRunParams {
  knownParentId?: number;
  cleanupCommentBodyPrefix?: string;
}
```

## 7. Output schema

### 7.1 Status vocabulary

Each check has one of four statuses:
- `ok`
- `warn`
- `fail`
- `skip`

### 7.2 Type definitions

```ts
export type DoctorStatus = "ok" | "warn" | "fail" | "skip";

export interface DoctorCheckResult {
  id: string;
  scope: "runtime" | "auth" | "techtree" | "transports" | "xmtp" | "artifact" | "bbh";
  status: DoctorStatus;
  title: string;
  message: string;
  details?: Record<string, unknown>;
  remediation?: string;
  fixApplied?: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface DoctorSummary {
  ok: number;
  warn: number;
  fail: number;
  skip: number;
}

export interface DoctorReport {
  ok: boolean;
  mode: "default" | "scoped" | "full";
  scope?: "runtime" | "auth" | "techtree" | "transports" | "xmtp" | "artifact" | "bbh";
  summary: DoctorSummary;
  checks: DoctorCheckResult[];
  nextSteps: string[];
  generatedAt: string;
}
```

### 7.3 Human output format

Example:

```text
Regent Doctor

[ok] config loaded
[ok] runtime socket reachable
[ok] wallet available
[ok] identity fields present
[ok] techtree health reachable
[warn] no active SIWA session
[skip] authenticated probe skipped (login required)

Summary: 5 ok, 1 warn, 1 skip
Next: run `regent auth siwa login`
```

### 7.4 JSON output format

```json
{
  "ok": false,
  "mode": "default",
  "summary": { "ok": 5, "warn": 1, "fail": 0, "skip": 1 },
  "checks": [
    {
      "id": "auth.session.present",
      "scope": "auth",
      "status": "warn",
      "title": "SIWA session",
      "message": "No active SIWA session found",
      "remediation": "Run `regent auth siwa login`",
      "startedAt": "2026-03-11T15:00:00.000Z",
      "finishedAt": "2026-03-11T15:00:00.010Z",
      "durationMs": 10
    }
  ],
  "nextSteps": ["Run `regent auth siwa login`"],
  "generatedAt": "2026-03-11T15:00:00.011Z"
}
```

## 8. Check catalog

Checks run in increasing cost order.

### 8.1 Runtime scope checks

#### `runtime.config.load`
Checks:
- config file exists
- config parses
- config validates

Fail when:
- config missing and cannot be auto-created
- malformed YAML/JSON
- required fields structurally invalid

Possible remediation:
- `regent create init`

#### `runtime.paths.ensure`
Checks:
- config dir exists
- state dir exists
- runtime dir exists
- socket parent dir exists

`--fix` may create missing dirs.

#### `runtime.socket.reachable`
Checks:
- if runtime is already running, control socket is reachable
- stale socket file detection

Possible remediation:
- remove stale socket under `--fix`
- suggest `regent run`

#### `runtime.wallet.source`
Checks:
- wallet source configured
- signer can be initialized

Fail when:
- env var missing
- file unreadable
- keystore/passphrase unavailable

### 8.2 Auth scope checks

#### `auth.identity.headers`
Checks that the runtime can produce all required protected-route identity headers:
- walletAddress
- chainId
- registryAddress
- tokenId

Validation:
- walletAddress valid `0x...40hex`
- registryAddress valid `0x...40hex`
- chainId positive integer
- tokenId positive integer string

#### `auth.siwa.nonce.endpoint`
Checks reachability of `POST /v1/agent/siwa/nonce`.

Implementation detail:
- send a minimal valid nonce request payload as the runtime expects for login preflight
- do not persist anything

#### `auth.siwa.verify.endpoint`
Checks reachability of `POST /v1/agent/siwa/verify`.

Implementation detail:
- endpoint can be checked by method/options/expected response class, but must not mint a fake session unless specifically testing login

#### `auth.session.present`
Checks:
- session exists
- session parses

Warn when:
- no session exists

#### `auth.session.freshness`
Checks:
- session has not expired
- session is not expiring imminently (threshold: default 5 minutes)

Warn when:
- expiry within threshold

Fail when:
- expired

#### `auth.session.binding`
Checks that the stored session/receipt binding matches current local identity:
- wallet address
- chainId
- registryAddress
- tokenId

Warn/fail when:
- runtime identity differs from stored session

#### `auth.http-envelope.build`
Checks that the runtime can build the authenticated request envelope without sending it.

Must verify local construction of:
- `x-siwa-receipt`
- `x-key-id`
- `x-timestamp`
- `signature-input`
- `signature`

Must verify the signature-input includes the required covered components.

### 8.3 Techtree scope checks

#### `techtree.health`
Checks `GET /health` returns a healthy response.

#### `techtree.public.read`
Checks at least one cheap public route, preferably `GET /v1/tree/nodes?limit=1`.

Purpose:
- distinguish general connectivity from protected-route auth issues

#### `techtree.authenticated.probe`
This is the most important default doctor check.

Checks a cheap authenticated route to prove the full path works:
- runtime identity headers
- receipt/session
- signature envelope
- Phoenix `RequireAgentSiwa`
- sidecar `/v1/http-verify`
- Techtree protected route success

Preferred route:
- `GET /v1/agent/opportunities`

Reason:
- authenticated
- read-only
- already exists
- cheaper and safer than node create

Fallback route:
- `GET /v1/agent/inbox`

If the route fails because no session exists, result should be `skip` with remediation.
If the route fails due to auth denial, result should be `fail` and surface the backend denial code/message when available.

### 8.4 Transport scope checks

#### `transports.gossipsub.config`
Stub check for:
- enabled/disabled known
- key path/bootstrap topics config parses

No real libp2p dial in v0.1.

## 9. Full mode checks

`regent doctor --full` is opt-in and may mutate Techtree state.

### 9.1 Preconditions

Must only run if:
- runtime checks pass
- auth checks pass
- authenticated probe passes
- a known parent node is provided or discoverable from config

If `knownParentId` is missing, fail with remediation instead of guessing.

### 9.2 Full proof steps

#### `full.node.create`
Create a disposable test node using `POST /v1/tree/nodes`.

Required payload fields:
- `seed`
- `kind`
- `title`
- `parent_id`
- `notebook_source`
- `idempotency_key`

Expected initial success shape:
- `201`
- `node_id`
- `manifest_cid`
- `status`
- `anchor_status`

Expected initial state:
- `status = "pinned"`
- `anchor_status = "pending"`

#### `full.comment.add`
Create a disposable comment on the created node using `POST /v1/tree/comments`.

Payload should include:
- `node_id`
- `body_markdown`
- `idempotency_key`

#### `full.comment.readback`
Verify the created comment by reading back via:
- `GET /v1/agent/tree/nodes/:id/comments`
- optionally `GET /v1/tree/nodes/:id/work-packet`

#### `full.node.status.note`
If node remains `pinned/pending`, doctor should emit an `ok` or `warn` note that publish is asynchronous and anchoring is not required for the proof to be considered successful.

## 10. Exit codes

Recommended exit codes:

- `0`: all required checks passed; warnings allowed only if no failures in default mode and a usable path exists
- `1`: one or more failing checks
- `2`: usage/config parsing error in the CLI invocation itself
- `3`: doctor internal exception

Suggested rule:
- default mode with only warnings and skips returns `0`
- any fail returns `1`
- full mode returns `1` if create or comment proof fails

## 11. Fix behavior

`--fix` may apply only safe, local remediations.

### 11.1 Allowed automatic fixes
- create missing runtime/config dirs
- create default config file skeleton
- remove stale socket file after validation
- suggest or print exact missing env vars
- optionally start runtime if not running and user explicitly passed `--fix`

### 11.2 Disallowed automatic fixes
- silently generate wallet/private key
- silently perform SIWA login
- silently create Techtree node/comment in default mode
- mutate Techtree auth identity fields without explicit confirmation

## 12. File-by-file implementation plan

### 12.1 bundled shared doctor types

Add:
- `src/doctor.ts`

Exports:
- `DoctorStatus`
- `DoctorCheckResult`
- `DoctorSummary`
- `DoctorReport`
- runtime JSON-RPC param/result types for doctor methods

### 12.2 bundled runtime implementation

Add:
- `src/doctor/types.ts`
- `src/doctor/checkRunner.ts`
- `src/doctor/checks/runtimeChecks.ts`
- `src/doctor/checks/authChecks.ts`
- `src/doctor/checks/techtreeChecks.ts`
- `src/doctor/checks/transportChecks.ts`
- `src/doctor/checks/fullChecks.ts`
- `src/doctor/renderNextSteps.ts`

Extend:
- `src/server/methodRouter.ts`
- `src/server/methods/doctor.ts`
- `src/runtime.ts`

Suggested runtime method implementations:
- `doctor.run(params)`
- `doctor.runScoped(params)`
- `doctor.runFull(params)`

Suggested helper methods:
- `buildCheckContext()`
- `runChecksSequentially(checks, ctx)`
- `summarizeChecks(results)`
- `deriveNextSteps(report)`

### 12.3 CLI command and printer layer

Add:
- `src/commands/doctor.ts`
- `src/printers/doctorPrinter.ts`

Extend parser:
- `regent doctor`
- `regent doctor runtime`
- `regent doctor auth`
- `regent doctor techtree`
- `regent doctor transports`
- `regent doctor xmtp`
- flags `--json`, `--verbose`, `--fix`, `--full`

## 13. Detailed method behavior

### 13.1 `doctor.run`

Flow:
1. load runtime context
2. run runtime checks
3. run auth checks
4. run techtree checks
5. run transport stub checks
6. summarize
7. derive next steps
8. return `DoctorReport`

### 13.2 `doctor.runScoped`

Flow:
1. load runtime context
2. run only checks for requested scope
3. summarize
4. return `DoctorReport`

### 13.3 `doctor.runFull`

Flow:
1. run default checks
2. abort if required preconditions fail
3. run full proof checks in order:
   - node create
   - comment add
   - comment readback
4. merge results into `DoctorReport`
5. return `DoctorReport`

## 14. Error handling rules

Doctor must preserve high-value backend/auth failure information.

### 14.1 Preserve backend denial data when available
If Techtree or sidecar returns structured JSON like:
- error code
- message
- detail

include it under `details.backend` or `details.sidecar`.

### 14.2 Categorize failures clearly
Examples:
- config parse error -> `runtime.config.load`
- missing wallet env -> `runtime.wallet.source`
- no SIWA session -> `auth.session.present`
- expired receipt/session -> `auth.session.freshness`
- malformed signature-input -> `auth.http-envelope.build`
- sidecar 401/422 on authenticated probe -> `techtree.authenticated.probe`

## 15. Testing plan

### 15.1 Unit tests

`packages/regent-cli/test/internal-runtime/doctor/*.test.ts`

Must cover:
- report summarization
- next-step derivation
- individual check pass/fail/warn/skip behavior
- `--fix` local remediations
- scoped run selection

### 15.2 Integration tests with mocked Techtree

Must cover:
- `/health` pass/fail
- nonce/verify reachable/unreachable
- authenticated probe 401/422/200 handling
- preserved denial metadata

### 15.3 Live integration target

For milestone proof, run against true local Phoenix + sidecar and verify:
- `regent doctor` passes through authenticated probe
- `regent doctor --full` proves node create + comment add + readback

## 16. Acceptance criteria

### 16.1 v0.1 acceptance

`regent doctor` is complete when:
- it exists in the CLI
- it returns human output and `--json`
- it validates config/runtime/wallet presence
- it validates identity readiness for protected routes
- it validates Techtree health
- it validates SIWA session presence/freshness
- it validates local HTTP envelope construction
- it performs a real authenticated read-only probe against Techtree

### 16.2 v0.2 acceptance

`regent doctor --full` is complete when:
- it creates a real test node
- it adds a real comment
- it reads the comment back
- it reports async publish state accurately

## 17. Recommended default next-step messages

Examples:
- missing config -> `Run \`regent create init\``
- missing wallet source -> `Set AGENT_WALLET_KEY or configure a wallet file`
- no SIWA session -> `Run \`regent auth siwa login\``
- runtime not running -> `Run \`regent run\``
- authenticated probe failed -> `Inspect auth headers and SIWA sidecar configuration`
- full proof needs parent -> `Re-run with --full --known-parent-id <id>`

## 18. Pseudocode

```ts
async function runDoctor(mode: "default" | "scoped" | "full", opts: DoctorOpts): Promise<DoctorReport> {
  const ctx = await buildCheckContext(opts);
  const results: DoctorCheckResult[] = [];

  const defaultChecks = [
    ...runtimeChecks(ctx),
    ...authChecks(ctx),
    ...techtreeChecks(ctx),
    ...transportChecks(ctx),
  ];

  results.push(...await runChecksSequentially(selectChecks(mode, defaultChecks, opts.scope), ctx));

  if (mode === "full" && !hasBlockingFailures(results)) {
    results.push(...await runChecksSequentially(fullChecks(ctx, opts), ctx));
  }

  const summary = summarizeChecks(results);
  const nextSteps = deriveNextSteps(results);

  return {
    ok: summary.fail === 0,
    mode,
    ...(mode === "scoped" && opts.scope ? { scope: opts.scope } : {}),
    summary,
    checks: results,
    nextSteps,
    generatedAt: new Date().toISOString(),
  };
}
```

## 19. Recommended first implementation order

1. types and JSON-RPC methods
2. runtime checks
3. auth identity/session checks
4. Techtree health/public checks
5. authenticated probe
6. CLI rendering
7. `--json`
8. `--fix`
9. `--full`

## 20. Short version for the coding agent

Implement `regent doctor` in the runtime, not the CLI. The default command must be safe and non-mutating. It must validate local config/runtime, wallet and protected-route identity readiness, Techtree connectivity, SIWA session freshness, local HTTP signature-envelope construction, and then perform one real authenticated read-only probe against a current Techtree protected route such as `GET /v1/agent/opportunities`. Add `--json`, scoped subcommands, `--fix` for safe local remediations, and `--full` for an opt-in real proof that creates a node, adds a comment, and reads it back.
