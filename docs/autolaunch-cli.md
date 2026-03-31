# Autolaunch CLI

`autolaunch` is now a command group inside `regent-cli`.

The source of truth for Autolaunch HTTP routes is now the OpenAPI file at [`../../autolaunch/docs/api-contract.openapiv3.yaml`](/Users/sean/Documents/regent/autolaunch/docs/api-contract.openapiv3.yaml).

The shared `regent-staking` rail is no longer documented as part of the Autolaunch contract. Its source of truth is [`regent-services-contract.openapiv3.yaml`](/Users/sean/Documents/regent/regent-cli/docs/regent-services-contract.openapiv3.yaml).

Chain language for this command group:

- `autolaunch` launch creation is Ethereum Sepolia only
- this is distinct from `Techtree`, which uses Ethereum Sepolia for agent identity login and Base Sepolia for the registry publishing test path

There is no standalone `autolaunch` binary anymore. The only supported CLI surface is:

```bash
regent autolaunch ...
```

The separate company-token rewards rail is:

```bash
regent regent-staking ...
```

## Environment

- `AUTOLAUNCH_BASE_URL`
  Default: `http://127.0.0.1:4010`
- `AUTOLAUNCH_SESSION_COOKIE`
  Optional existing Phoenix session cookie.
- `AUTOLAUNCH_PRIVY_BEARER_TOKEN`
  Optional Privy bearer token for exchanging into a Phoenix session.
- `AUTOLAUNCH_DISPLAY_NAME`
  Optional display name sent during session exchange.
- `AUTOLAUNCH_WALLET_ADDRESS`
  Optional wallet address sent during session exchange.

If `AUTOLAUNCH_SESSION_COOKIE` is not set and `AUTOLAUNCH_PRIVY_BEARER_TOKEN` is present, the CLI exchanges the bearer token against `/api/auth/privy/session` before calling authenticated endpoints.

## Primary operator journey

The main Autolaunch product is now a guided lifecycle, not a bag of raw contract commands.

Start here:

```bash
regent autolaunch prelaunch wizard
regent autolaunch prelaunch validate [--plan <id>]
regent autolaunch prelaunch publish [--plan <id>]
regent autolaunch launch run [--plan <id>]
regent autolaunch launch monitor --job <job-id> [--watch]
regent autolaunch launch finalize --job <job-id> [--submit]
regent autolaunch vesting status --job <job-id>
regent autolaunch vesting release --job <job-id> [--submit]
```

These commands assume the Phoenix backend is alive and act as the guided operator front door.

### Prelaunch

```bash
regent autolaunch prelaunch wizard \
  --agent <agent-id> \
  --name "Agent Coin Name" \
  --symbol "AGENT" \
  --treasury-safe-address <safe-address> \
  --auction-proceeds-recipient <address> \
  --ethereum-revenue-treasury <address> \
  [--backup-safe-address <address>] \
  [--fallback-operator-wallet <address>] \
  [--title <text>] \
  [--subtitle <text>] \
  [--description <text>] \
  [--website-url <url>] \
  [--image-url <url> | --image-file <path>]

regent autolaunch prelaunch show [--plan <id>]
regent autolaunch prelaunch validate [--plan <id>]
regent autolaunch prelaunch publish [--plan <id>]
```

`prelaunch wizard` creates or updates the saved launch draft, uploads the hosted image if needed, validates the draft, and saves the canonical local copy under the CLI state directory.

### Launch lifecycle

```bash
regent autolaunch launch run [--plan <id>] [--wallet-address <address>] [--watch] [--interval <seconds>]
regent autolaunch launch monitor --job <job-id> [--watch] [--interval <seconds>]
regent autolaunch launch finalize --job <job-id> [--submit]
regent autolaunch vesting status --job <job-id>
regent autolaunch vesting release --job <job-id> [--submit]
```

`launch run` loads the saved plan, revalidates it, obtains the SIWA signature bundle, queues the launch, and immediately reads back the job state.

`launch monitor` uses the lifecycle API to answer:

- whether migration is ready
- whether token sweep is ready
- whether currency sweep is ready
- whether vesting release is ready
- what action is recommended next

`launch finalize` is the preferred post-auction path. It either returns the prepared next transaction or, with `--submit`, sends it through the configured signer and registers the resulting transaction hash.

`vesting status` is the preferred read surface for the vesting wallet. `vesting release` is still available directly when the release path is ready.

## Advanced command groups

Everything below still exists, but it is advanced or later-lifecycle tooling. Do not treat it as the main path for agents unless the guided lifecycle is not sufficient.

## REGENT staking rail

`regent-staking` is the separate Base-mainnet rewards rail for the existing `$REGENT` token. It is not the same thing as the per-agent subject splitter flow.

Use it when Regent income has already reached Base USDC:

```bash
regent regent-staking show
regent regent-staking account <wallet-address>
regent regent-staking stake --amount <regent-amount>
regent regent-staking unstake --amount <regent-amount>
regent regent-staking claim-usdc
```

Operational rule for v1:

- non-Base Regent income still lands in Treasury A first
- Treasury A bridges that income manually to Base USDC
- treasury-side deposits and treasury withdrawals are done through the safe or the deployment script flow, not through the CLI
- the staking contract pays the configured staker share to `$REGENT` stakers and leaves the rest accruing for treasury withdrawal

### Agents

```bash
regent autolaunch agents list [--launchable] [--json]
regent autolaunch agent <agent-id> [--json]
regent autolaunch agent readiness <agent-id> [--json]
```

### Trust

```bash
regent autolaunch trust x-link --agent <agent-id>
```

This helper starts the X-link browser flow for one Autolaunch agent identity.

- It calls `POST /api/trust/x/start`.
- It opens the returned `redirect_path` in the browser using the configured `AUTOLAUNCH_BASE_URL`.
- If the browser cannot be opened automatically, it prints the full URL so the operator can open it manually.
- The CLI does not run OAuth itself. The browser and backend finish that part.

For read surfaces, trust data now lives under the nested `trust` object:

- auction list items use `item.trust.erc8004`, `item.trust.ens`, `item.trust.world`, and `item.trust.x`
- single auction detail uses `auction.trust.erc8004`, `auction.trust.ens`, `auction.trust.world`, and `auction.trust.x`
- direct agent trust reads use `GET /api/trust/agents/:id`

### Low-level launches

```bash
regent autolaunch launch preview \
  --agent <agent-id> \
  --chain-id <11155111> \
  --name "Agent Coin Name" \
  --symbol "AGENT" \
  --treasury-address <address> \
  [--launch-notes <text>] \
  [--json]

regent autolaunch launch create \
  --agent <agent-id> \
  --chain-id <11155111> \
  --name "Agent Coin Name" \
  --symbol "AGENT" \
  --treasury-address <address> \
  --wallet-address <address> \
  --nonce <nonce> \
  --message <message> \
  --signature <signature> \
  --issued-at <iso8601> \
  [--launch-notes <text>] \
  [--json]

regent autolaunch jobs watch <job-id> [--watch] [--interval <seconds>] [--json]
```

`--chain` aliases are also accepted for launch creation:

- `sepolia` -> `11155111`
- `ethereum` / `ethereum-sepolia` -> `11155111`

Autolaunch launch creation is Ethereum Sepolia only.

Successful launch output now includes the live V2 stack fields:

- `strategy_address`
- `vesting_wallet_address`
- `hook_address`
- `launch_fee_registry_address`
- `launch_fee_vault_address`
- `subject_registry_address`
- `subject_id`
- `revenue_share_splitter_address`
- `default_ingress_address`
- `pool_id`

Autolaunch still does not route the Sepolia Regent fee lane automatically into REGENT rewards. The Regent-side launch fee lane is still a direct treasury payout. The separate Base `regent-staking` rail is fed manually after bridging.

`launch preview`, `launch create`, and `jobs watch` return a `reputation_prompt` object in the JSON payload. It is the CLI-safe version of the optional follow-up step shown in the web app:

- It explains that linking ENS and connecting a human World ID are optional trust improvements.
- It includes the warning that skipping those steps can leave the launch looking less trusted.
- It carries the current instructions and, when available, direct links for the ENS and World follow-up pages.

### Auctions

```bash
regent autolaunch auctions list \
  [--sort hottest|recently_launched|expired] \
  [--status active|expired] \
  [--chain <chain-id>] \
  [--mine-only] \
  [--json]

regent autolaunch auction <auction-id> [--json]
```

### Bids

```bash
regent autolaunch bids quote \
  --auction <auction-id> \
  --amount <currency-amount> \
  --max-price <price-q96-or-ratio> \
  [--json]

regent autolaunch bids place \
  --auction <auction-id> \
  --amount <currency-amount> \
  --max-price <price-q96-or-ratio> \
  --tx-hash <hash> \
  [--current-clearing-price <value>] \
  [--projected-clearing-price <value>] \
  [--estimated-tokens-if-end-now <value>] \
  [--estimated-tokens-if-no-other-bids-change <value>] \
  [--inactive-above-price <value>] \
  [--status-band <value>] \
  [--json]

regent autolaunch bids mine \
  [--auction <auction-id>] \
  [--status active|borderline|inactive|claimable|exited|claimed] \
  [--json]

regent autolaunch bids exit <bid-id> --tx-hash <hash> [--json]
regent autolaunch bids claim <bid-id> --tx-hash <hash> [--json]
```

### Subjects

```bash
regent autolaunch subjects show <subject-id> [--json]
regent autolaunch subjects ingress <subject-id> [--json]
regent autolaunch subjects stake <subject-id> --amount <token-amount> [--json]
regent autolaunch subjects unstake <subject-id> --amount <token-amount> [--json]
regent autolaunch subjects claim-usdc <subject-id> [--json]
regent autolaunch subjects sweep-ingress <subject-id> --address <ingress-address> [--json]
```

These commands use the same session-backed subject endpoints as the web app. They are useful after launch, but they are not the primary launch lifecycle.

### Contract reads

```bash
regent autolaunch contracts admin [--json]
regent autolaunch contracts job --job <job-id> [--json]
regent autolaunch contracts subject --subject <subject-id> [--json]
```

These commands expose the same read model that powers the `/contracts` page in the Phoenix app.

### Prepare-only contract actions

```bash
regent autolaunch strategy migrate --job <job-id> [--json]
regent autolaunch strategy sweep-token --job <job-id> [--json]
regent autolaunch strategy sweep-currency --job <job-id> [--json]
regent autolaunch vesting release --job <job-id> [--json]

regent autolaunch fee-registry show --job <job-id> [--json]
regent autolaunch fee-registry set-hook-enabled --job <job-id> --enabled true|false [--json]

regent autolaunch fee-vault show --job <job-id> [--json]
regent autolaunch fee-vault withdraw-treasury --job <job-id> --currency <address> --amount <raw-units> --recipient <address> [--json]
regent autolaunch fee-vault withdraw-regent --job <job-id> --currency <address> --amount <raw-units> --recipient <address> [--json]

regent autolaunch splitter show --subject <subject-id> [--json]
regent autolaunch splitter set-paused --subject <subject-id> --paused true|false [--json]
regent autolaunch splitter set-label --subject <subject-id> --label <text> [--json]
regent autolaunch splitter set-treasury-recipient --subject <subject-id> --recipient <address> [--json]
regent autolaunch splitter set-protocol-recipient --subject <subject-id> --recipient <address> [--json]
regent autolaunch splitter set-protocol-skim-bps --subject <subject-id> --skim-bps <bps> [--json]
regent autolaunch splitter withdraw-treasury-residual --subject <subject-id> --amount <raw-units> --recipient <address> [--json]
regent autolaunch splitter withdraw-protocol-reserve --subject <subject-id> --amount <raw-units> --recipient <address> [--json]
regent autolaunch splitter reassign-dust --subject <subject-id> --amount <raw-units> [--json]

regent autolaunch ingress create --subject <subject-id> --label <text> [--make-default true|false] [--json]
regent autolaunch ingress set-default --subject <subject-id> --address <ingress-address> [--json]
regent autolaunch ingress set-label --subject <subject-id> --address <ingress-address> --label <text> [--json]
regent autolaunch ingress rescue --subject <subject-id> --address <ingress-address> --token <address> --amount <raw-units> --recipient <address> [--json]

regent autolaunch registry show --subject <subject-id> [--json]
regent autolaunch registry set-subject-manager --subject <subject-id> --account <address> --enabled true|false [--json]
regent autolaunch registry link-identity --subject <subject-id> --identity-chain-id <id> --identity-registry <address> --identity-agent-id <id> [--json]

regent autolaunch factory revenue-share set-authorized-creator --account <address> --enabled true|false [--json]
regent autolaunch factory revenue-ingress set-authorized-creator --account <address> --enabled true|false [--json]
```

These commands do not sign or broadcast. They return prepared transaction payloads so operators can submit them through the right signer or multisig flow.

## JSON contract

The CLI is JSON-first. It forwards directly to the `autolaunch` Phoenix JSON API:

- `GET /api/agents`
- `GET /api/agents/:id`
- `GET /api/agents/:id/readiness`
- `GET /api/prelaunch/plans`
- `POST /api/prelaunch/plans`
- `GET /api/prelaunch/plans/:id`
- `PATCH /api/prelaunch/plans/:id`
- `POST /api/prelaunch/plans/:id/validate`
- `POST /api/prelaunch/plans/:id/publish`
- `POST /api/prelaunch/plans/:id/launch`
- `POST /api/prelaunch/assets`
- `POST /api/prelaunch/plans/:id/metadata`
- `GET /api/prelaunch/plans/:id/metadata-preview`
- `POST /api/launch/preview`
- `POST /api/launch/jobs`
- `GET /api/launch/jobs/:id`
- `GET /api/lifecycle/jobs/:id`
- `POST /api/lifecycle/jobs/:id/finalize/prepare`
- `POST /api/lifecycle/jobs/:id/finalize/register`
- `GET /api/lifecycle/jobs/:id/vesting`
- `GET /api/auctions`
- `GET /api/auctions/:id`
- `POST /api/auctions/:id/bid_quote`
- `POST /api/auctions/:id/bids`
- `GET /api/me/bids`
- `POST /api/bids/:id/exit`
- `POST /api/bids/:id/claim`
- `GET /api/subjects/:id`
- `GET /api/subjects/:id/ingress`
- `POST /api/subjects/:id/stake`
- `POST /api/subjects/:id/unstake`
- `POST /api/subjects/:id/claim-usdc`
- `POST /api/subjects/:id/ingress/:address/sweep`
- `GET /api/contracts/admin`
- `GET /api/contracts/jobs/:id`
- `GET /api/contracts/subjects/:id`
- `POST /api/contracts/jobs/:id/:resource/:action/prepare`
- `POST /api/contracts/subjects/:id/:resource/:action/prepare`
- `POST /api/contracts/admin/:resource/:action/prepare`

State-changing bid commands do not submit wallet transactions themselves. They register confirmed onchain actions with the Phoenix app, so callers must provide the real transaction hash via `--tx-hash`.

Subject stake, unstake, claim, and ingress sweep commands use the same wallet-friendly JSON API as the web app. Contract admin commands are different: they return a prepared transaction payload and leave signing or submission to the caller.

Polling commands validate `--interval` and require a positive number.

Auction payloads also include the current trust fields used by listings:

- `ens_attached`
- `world_registered`
- `world_human_id`
- `world_launch_count`

## What has to be alive

The CLI is not a standalone contract client for Autolaunch. It depends on a live Phoenix backend.

That backend must have:

- Phoenix running
  The CLI uses it for session exchange, authenticated launch and subject flows, quote reads, contract-read aggregation, and prepared transaction generation.
- Postgres running
  Launch jobs, bids, and subject action registrations are persisted there.
- Sepolia RPC configured and reachable
  The backend needs it for launch-state reads, bid verification, and subject verification.
- the SIWA sidecar reachable
  Launch creation depends on backend-side signature verification.
- the Foundry deploy binary and deploy workdir present on the backend node
  Without those, launch creation can queue but cannot actually execute.

If trust-network config is missing, trust follow-up commands and views degrade first. Core launch, auction, subject, and contract-console flows should still be available.
