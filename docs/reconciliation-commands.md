# Chain / API Reconciliation Commands

Status: design accepted, `identity graph` shipped, four verify commands design-only pending sibling-repo contract entries.

The Regents CLI is the bridge that checks product workflow state against onchain truth.
These commands read public product APIs and chain RPC, then report where the two views
agree, disagree, or cannot be compared.

## Source-of-truth rules

- Onchain state wins for money, ownership, staking, and revenue.
- Product databases win for workflow state (queue position, draft status, labels).
- The CLI never reads a product database. It only uses contracted product HTTP APIs
  plus chain RPC reads.

## What the CLI can already reach (survey)

### Generated API bindings (`packages/regents-cli/src/generated/`)

| Binding | Contract file | Reconciliation-relevant operations |
| --- | --- | --- |
| `autolaunch-openapi.ts` | `autolaunch/docs/api-contract.openapiv3.yaml` | `agentListAgents`, `agentGetAgent`, `agentGetContractsAdminOverview`, `agentGetContractsJobOverview`, `agentGetContractsSubjectOverview`, `agentGetSubject`, `agentListSubjectsByToken`, `agentGetSubjectIngress`, `agentGetSubjectStaking`, `agentListSubjectBuybacks`, `agentGetAuction`, `agentGetLaunchJob`, `agentGetLifecycleJob`, `agentGetVestingStatus` |
| `techtree-openapi.ts` | `techtree/docs/api-contract.openapiv3.yaml` | `getTechStatus` (contract addresses), `getCurrentTechEpoch`, `listTechRewards` (manifests with `merkle_root`, `tx_hash`, `status`), `getTechRewardProof`, `getReviewerProfile` |
| `platform-openapi.ts` | `platform/api-contract.openapiv3.yaml` | `getAgentRegentStakingOverview`, `getAgentRegentStakingAccount` (both return `RegentStakingState` with `contract_address`, `chain_id`, totals, and per-wallet balances/claimables), `/api/agent-platform/projection` (`AgentPlatformProjection` with companies, runtime, public profiles) |
| `regent-services-openapi.ts` | `docs/regent-services-contract.openapiv3.yaml` | SIWA nonce/verify only. No reconciliation data. |

### Chain-read capability

- `viem` is a shipped dependency. `src/internal-runtime/base-contract-client.ts` already
  builds `createPublicClient` instances per chain and runs `call`, `estimateGas`, and
  `waitForTransactionReceipt`.
- RPC URLs come from the operator environment, never from product secrets:
  - Base mainnet: `BASE_MAINNET_RPC_URL` or `BASE_RPC_URL`
  - Base Sepolia: `BASE_SEPOLIA_RPC_URL`
  - Ethereum mainnet: `ETH_MAINNET_RPC_URL` or `ETHEREUM_RPC_URL`
  - Some command families also accept `--rpc-url` (Autolaunch safe-create pattern).
- Reconciliation reads use the same clients with `readContract` /
  `getTransactionReceipt` / `getBytecode`. When no RPC URL is configured, a chain check
  reports `UNVERIFIABLE` with the missing variable named; it never fails the command by
  itself.

### Auth rails

- Product `/v1/agent/*` routes use SIWA agent headers (`requestProductJson` with
  `requireAgentAuth`). The saved SIWA session carries one audience at a time, so one run
  can verify the products whose audience matches the saved sign-in; other products
  report `UNVERIFIABLE` with the exact `regents auth login --audience <product>`
  command as the reason.
- Platform app routes (`/api/agent-platform/*`) use the saved Platform session
  (`loadResolvedPlatformSession`).

### Contract ownership (what `pnpm check:cli-contract` enforces)

`scripts/check-cli-contract.mjs` requires the shipped command registry to equal the
union of four CLI contracts, and the dispatcher routes to match that registry exactly:

| Command family | Owning CLI contract | Editable from this repo |
| --- | --- | --- |
| `autolaunch ...` | `autolaunch/docs/cli-contract.yaml` | no |
| `techtree ...` | `techtree/docs/cli-contract.yaml` | no |
| `regent-staking ...` | `platform/cli-contract.yaml` (platform public command prefix) | no |
| `identity ...` | `docs/shared-cli-contract.yaml` | yes |

A route added without a matching contract entry fails
`CLI dispatcher contains route missing from shipped contracts`. Because sibling repos
must not be edited from this repo, the four verify commands below ship only after their
owning contract gains the entries listed in "Required sibling-repo entries". No stub or
degraded versions are shipped in the meantime.

## Shared output convention

Every reconciliation command renders one table row per check:

- `MATCH` — the API view and the chain view agree.
- `MISMATCH` — they disagree. The row carries a `Next:` line that applies the
  source-of-truth rule (chain wins for money/ownership/staking/revenue; the product API
  wins for workflow state) and names the command or owner that resolves it.
- `UNVERIFIABLE(reason)` — one side could not be read (no sign-in for that product, no
  RPC URL, API error, feature not exposed). The reason is printed verbatim.

Exit code is `0` only when no check is `MISMATCH`. `--json` prints the same payload as
a single JSON object:

```json
{
  "ok": true,
  "command": "<command name>",
  "status": "ready | mismatch | waiting",
  "checks": [
    { "item": "...", "status": "MATCH | MISMATCH | UNVERIFIABLE", "detail": "...", "reason": "...", "next": "..." }
  ]
}
```

`reason` is present only on `UNVERIFIABLE` rows, `next` only on `MISMATCH` rows.

---

## 1. `regents autolaunch contracts verify` (design-only)

Verifies that the contract addresses Autolaunch publishes are real deployed contracts
that still point at each other.

- Data sources (API): `agentGetContractsAdminOverview`
  (`GET /v1/agent/contracts/admin`), `agentGetContractsJobOverview`
  (`GET /v1/agent/contracts/jobs/{id}`, `--job`), `agentGetContractsSubjectOverview`
  (`GET /v1/agent/contracts/subjects/{id}`, `--subject`).
- Data sources (chain, Base): for every published address — `getBytecode` (deployed
  code present); for splitter/fee-vault/registry — `readContract` sanity reads such as
  `owner()`/`paused()` where the overview publishes expected values.
- Checks per published contract: `deployed code`, `owner matches API`,
  `paused state matches API`, `linked identity (registry) matches the subject's agent`.
- Verdict logic: address with no bytecode → `MISMATCH`
  (`Next: chain wins. The published address is not a deployed contract; report it to Autolaunch (incident class billing/launch_deployment).`).
  API owner/paused differs from chain read → `MISMATCH`
  (`Next: chain wins for ownership; refresh the Autolaunch record.`). Missing RPC URL →
  every chain row `UNVERIFIABLE(set BASE_MAINNET_RPC_URL or pass --rpc-url)`.
- Output: one table per scope (admin / job / subject) with the rows above; `--json`
  adds the raw API overview under `api_view` and the chain reads under `chain_view`.
- Missing from sibling APIs:
  - The contracts overviews are `LooseObject` in the OpenAPI contract. To diff
    field-by-field, `autolaunch/docs/api-contract.openapiv3.yaml` must type the admin,
    job, and subject overview payloads (addresses plus expected `owner`, `paused`,
    `skim_bps` values).
  - The API does not publish ABI fragments or expected function selectors; the CLI
    will carry the minimal read ABI (owner/paused) itself.

## 2. `regents autolaunch subjects verify` (design-only)

Verifies one subject's workflow state against onchain token/auction state.

- Data sources (API): `agentGetSubject` (`GET /v1/agent/subjects/{id}` — `Subject`
  schema: `token_address`, `splitter_address`, `ingress_address`, `treasury_address`,
  `protocol_fee_usdc_total`, `pending_buyback_usdc`), `agentGetSubjectStaking`,
  `agentGetSubjectIngress`, `agentListSubjectBuybacks`, and when the subject came from a
  launch: `agentGetLaunchJob` + `agentGetAuction` for auction status.
- Data sources (chain, Base): `getBytecode` for token/splitter/ingress; ERC-20 reads on
  `token_address` (`symbol`, `totalSupply`); USDC `balanceOf(ingress_address)` vs the
  API's unswept ingress amount; auction contract state for a live auction
  (`auction_address` from the launch record).
- Verdict logic: money rows (ingress balance, pending buybacks, splitter accounting) —
  chain wins; a difference is `MISMATCH` with
  `Next: chain wins for revenue. Sweep or settle (regents autolaunch subjects sweep-ingress / settle-buyback), then refresh.`
  Workflow rows (subject kind, label, team_shared_status) — product wins; a chain-side
  surprise that does not touch money is reported as `MISMATCH` with
  `Next: the product record wins for workflow state; update it in Autolaunch.`
- Output: table keyed by `subject_id` with token, splitter, ingress, staking, buyback
  rows; `--json` includes both views.
- Missing from sibling APIs:
  - `GET /v1/agent/subjects/{id}/ingress` must include the expected unswept USDC amount
    per ingress account (today the CLI cannot tell which part of the chain balance the
    product has already recognized).
  - Auction settlement records per subject (clearing price, raise totals) are not on the
    agent surface; `/v1/agent/auctions/{id}` covers live auctions only.

## 3. `regents regent-staking verify` (design-only)

Verifies the staking position and claimables the Platform staking API reports for a
wallet against the staking contract.

- Data sources (API): `getAgentRegentStakingOverview` (`GET /v1/agent/regent/staking`)
  and `getAgentRegentStakingAccount`
  (`GET /v1/agent/regent/staking/account/{address}`). `RegentStakingState` already
  publishes everything needed: `chain_id`, `contract_address`, `stake_token_address`,
  `usdc_address`, `total_staked_raw`, `wallet_stake_balance_raw`,
  `wallet_claimable_usdc_raw`, `wallet_claimable_regent_raw`, `paused`.
- Data sources (chain): on `contract_address` — staked balance, claimable USDC,
  claimable REGENT, total staked, and `paused()` for the wallet; ERC-20
  `balanceOf(wallet)` on `stake_token_address`.
- Checks: `staking contract deployed`, `total staked`, `wallet staked balance`,
  `wallet claimable USDC`, `wallet claimable REGENT`, `wallet REGENT balance`,
  `paused flag`.
- Verdict logic: all rows are money/staking rows — chain wins. Any difference is
  `MISMATCH` with
  `Next: chain wins for staking. Trust the chain numbers; if the API stays stale, this is incident class staking_claims (owner: platform).`
- Output: per-wallet table (defaults to the saved identity wallet, `<address>`
  positional like `regent-staking account`); `--json` includes `api_view` and
  `chain_view` raw values side by side.
- Missing from sibling APIs / contracts:
  - None for data — the API already publishes the contract address and raw values.
  - The staking contract read ABI (function names for staked balance and claimables) is
    not published anywhere the CLI can reach. Either platform publishes the read ABI /
    method names in `RegentStakingState`, or the CLI vendors the staking read ABI once
    the contract source is pinned.

## 4. `regents techtree settlement verify` (design-only)

Verifies TECH reward settlement records (paid-node / reward manifests) against chain
receipts.

- Data sources (API): `getTechStatus` (`GET /v1/tech/status` — `TechContractStatus`
  publishes `chain_id`, `token`, `reward_router`, `agent_reward_vault`,
  `emission_controller`, `leaderboard_registry`), `getCurrentTechEpoch`,
  `listTechRewards` (`GET /v1/tech/rewards?epoch=&lane=` — manifests with
  `merkle_root`, `manifest_hash`, `total_allocated_amount`, `status`, `tx_hash`),
  `getTechRewardProof` for one agent's allocation.
- Data sources (chain, Base): for each manifest with `status: posted` —
  `getTransactionReceipt(tx_hash)` (success, to-address equals `reward_router`);
  `readContract` on the reward router for the allocation root of `(epoch, lane)` and
  compare with `merkle_root`; optionally verify the agent's Merkle proof locally
  against the posted root (pure computation, no extra API).
- Verdict logic: posted manifest whose `tx_hash` receipt is missing/failed →
  `MISMATCH` (`Next: chain wins for rewards. The settlement record is not confirmed onchain; this is incident class paid_payload_entitlement (owner: techtree).`).
  Onchain root differs from the manifest root → `MISMATCH` (chain wins). Manifest in
  `prepared` state with no `tx_hash` → `MATCH` for workflow (product wins for
  not-yet-posted records), with the detail saying settlement is pending.
- Output: one row per `(epoch, lane)` manifest; with `--agent` adds an
  `allocation proof` row for that agent id; `--json` includes manifests and receipts.
- Missing from sibling APIs:
  - The reward-router read ABI (allocation-root getter name) is not published. Either
    techtree adds it to `TechContractStatus` or the CLI vendors the read ABI from
    `techtree/contracts` once pinned.

## 5. `regents identity graph` (shipped)

Renders the cross-product `agent_id` mapping anchored on
`/Users/sean/Documents/regent/docs/schemas/agent-identity-graph.schema.yaml`:
`agent_id` + `wallet_tuple` (wallet, chain, registry, token) with nested
`product_links` for platform, autolaunch, techtree, mobile, and the ERC-8004 record.

- Anchor (local): the saved identity receipt (`~/.regent/identity/receipt-v1.json`)
  provides `agent_id`, wallet, chain, registry, token id. Product links never come from
  local files; missing links are `null`, per the schema rules.
- Chain check: ERC-721 `ownerOf(token_id)` on the receipt's registry (Base or Base
  Sepolia per the receipt network, RPC from `BASE_MAINNET_RPC_URL`/`BASE_RPC_URL` or
  `BASE_SEPOLIA_RPC_URL`). Owner != receipt wallet → `MISMATCH`
  (`Next: chain wins for ownership. Run regents identity ensure ...`). No RPC URL →
  `UNVERIFIABLE`.
- Platform link: `GET /api/agent-platform/projection` via the saved Platform session.
  Maps `public_profiles[]`/`companies[]` to `platform_agent_id`, `company_id`,
  `public_slug`, `claimed_name`, `hosted_runtime_id` (sprite service name). A profile
  wallet that differs from the receipt wallet is `MISMATCH` (chain wins for ownership).
  No Platform session → `UNVERIFIABLE` with the sign-in command as the reason.
- Autolaunch link: `GET /v1/agent/agents` (SIWA, autolaunch audience). The agent card
  matching the receipt `agent_id` provides `auction_id` and the launched token address
  (`existing_token`); the token address resolves `subject_id` through
  `GET /v1/agent/subjects/by-token/{token}`. Card owner/registry/token that contradict
  the receipt are `MISMATCH`. No autolaunch-audience session → `UNVERIFIABLE`.
- Techtree link: `GET /v1/agent/reviewer/me` (SIWA, techtree audience). The reviewer
  profile is keyed by wallet; it becomes `profile_id`. `node_ids`, `bbh_run_ids`, and
  `review_ids` stay empty arrays (see missing APIs). No techtree-audience session →
  `UNVERIFIABLE`.
- Mobile link: always `null` with an `UNVERIFIABLE` check row — the iOS mobile-services
  contract is not part of the CLI surface (`cli_surface: false` in
  `docs/regent-workspace.yaml`).
- Exit code: `1` while no receipt exists (status `waiting`, as before) or when any
  check is `MISMATCH`; otherwise `0`.
- Missing from sibling APIs (links stay null/empty until added):
  - Autolaunch: the agent card does not expose a distinct `launch_id`
    (only `existing_token.auction_id`); `autolaunch/docs/api-contract.openapiv3.yaml`
    should add `launch_id` to the agent card.
  - Autolaunch contract drift: `GET /v1/agent/agents` is typed as `LooseListEnvelope`
    with a `data` array, but the server returns the list under `items`
    (`agent_controller.ex`). The CLI reads `items ?? data` until the contract matches
    the server.
  - Techtree: no agent-scoped listing for authored `node_ids`, `bbh_run_ids`, or
    `review_ids`; techtree should add an agent identity summary operation.
  - Platform: served through the Platform session only; an agent-SIWA equivalent of the
    projection would let one SIWA sign-in cover it.
  - One SIWA session carries one audience, so a single run cannot verify autolaunch and
    techtree links at once. A multi-audience session store would remove that limit.

## Required sibling-repo entries (do not implement from this repo)

- `autolaunch/docs/cli-contract.yaml`: add `autolaunch contracts verify`
  (flags: `--job`, `--subject`, `--rpc-url`, `--json`) bound to
  `agentGetContractsAdminOverview` / `agentGetContractsJobOverview` /
  `agentGetContractsSubjectOverview`, and `autolaunch subjects verify`
  (args: `<subject_id>`; flags: `--rpc-url`, `--json`) bound to `agentGetSubject`,
  `agentGetSubjectStaking`, `agentGetSubjectIngress`, `agentListSubjectBuybacks`.
  Mirror both in `packages/regents-cli/src/contracts/api-ownership.ts`
  (`autolaunchApiCommandGroups`) when implementing.
- `platform/cli-contract.yaml`: add `regents regent-staking verify`
  (positional `<address>` optional; flags: `--rpc-url`, `--json`) with
  `transport.operationIds: [getAgentRegentStakingOverview, getAgentRegentStakingAccount]`
  and availability `current` (it is a `regent-staking ` platform public command).
- `techtree/docs/cli-contract.yaml`: add `techtree settlement verify`
  (flags: `--epoch`, `--lane`, `--agent`, `--rpc-url`, `--json`) with path bindings
  `/v1/tech/status`, `/v1/tech/epochs/current`, `/v1/tech/rewards`,
  `/v1/tech/rewards/proof`, mirrored in `techtreeApiCommandGroups`.
- API gaps to file with owners: typed Autolaunch contracts overviews, subject ingress
  expected-unswept amounts, staking read ABI (platform), reward-router read ABI and
  agent activity summary (techtree), agent card `launch_id` (autolaunch), and the
  `LooseListEnvelope` drift on `GET /v1/agent/agents` — contract declares `data`,
  server returns `items` (autolaunch).

Once an owning contract gains its entry, the implementation follows the standard flow:
contract YAML → `pnpm generate:cli-command-metadata` → route in
`packages/regents-cli/src/routes/` → command file → presenter → vitest with stubbed
fetch/RPC → `pnpm check:cli-contract`, `pnpm check:openapi`, `pnpm typecheck`,
`pnpm test`.
