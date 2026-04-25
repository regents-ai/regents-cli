# Autolaunch CLI

Autolaunch is a command group inside `regents-cli`.

If you already have an agent, use `regents autolaunch ...`. If you do not have an agent yet, use [regents.sh](https://regents.sh) to make one.

The source of truth for Autolaunch HTTP routes is the OpenAPI file at [`../../autolaunch/docs/api-contract.openapiv3.yaml`](/Users/sean/Documents/regent/autolaunch/docs/api-contract.openapiv3.yaml).

The shared `regent-staking` rail uses [`regent-services-contract.openapiv3.yaml`](/Users/sean/Documents/regent/regents-cli/docs/regent-services-contract.openapiv3.yaml) as its source of truth.

Chain language for this command group:

- test and rehearsal launches use Base Sepolia
- production launches use Base mainnet
- the `autolaunch` contract-linked path is Base-family only

The supported CLI surface is:

```bash
regents autolaunch ...
```

The separate company-token rewards rail is:

```bash
regents regent-staking ...
```

The product rules for this CLI surface are:

- recognized subject revenue is the configured Base-family USDC only
- that revenue only counts once it reaches the subject splitter
- launch operators should use the CLI-first flow
- launch participants should use the browser for auctions, claims, staking, and subject rewards
- ingress is a receive-and-sweep wrapper, not a second accounting system
- the Regent-side fee lane is a treasury payout path, not part of the active launch rewards path

## Why Autolaunch exists

Use this framing when the question is strategic:

- an agent with real edge still dies if it cannot keep paying for compute, APIs, storage, retries, and distribution
- Autolaunch gives that agent a way to raise before those costs set the pace
- the sale builds operating runway, the treasury keeps funding room on hand, and the post-launch rewards path gives supporters a reason to stay
- the short version is: turn agent edge into runway

## Current product surface

The CLI pairs with the current Autolaunch site:

- command-first launch planning and monitoring
- market search, position search, and shareable filtered views
- live Regent staking status through `regents regent-staking ...`
- cleaner subject pages for staking, claims, revenue, ingress, and next actions
- a unified action panel pattern for wallet actions and prepared operator actions
- Dragonfly-backed hot reads for subject revenue and wallet position state

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
  Required wallet address when using `AUTOLAUNCH_PRIVY_BEARER_TOKEN`.

If `AUTOLAUNCH_SESSION_COOKIE` is not set and `AUTOLAUNCH_PRIVY_BEARER_TOKEN` is present, the CLI exchanges the bearer token plus `AUTOLAUNCH_WALLET_ADDRESS` against `/api/auth/privy/session` before calling authenticated endpoints.

## Agent quick start

If you are operating Autolaunch as an agent, use the guided lifecycle through `regents autolaunch ...`.

From an installed package:

```bash
regents autolaunch ...
```

From the source checkout:

```bash
pnpm --filter @regentslabs/cli exec regents autolaunch ...
```

Before a real launch, the Autolaunch launch node should pass:

```bash
mix autolaunch.doctor
AUTOLAUNCH_MOCK_DEPLOY=true mix autolaunch.smoke
```

After a real launch reaches `ready`, verify it with:

```bash
mix autolaunch.verify_deploy --job <job-id>
```

`mix autolaunch.doctor` is the stop sign for missing launch dependencies. In particular, it now catches a deploy binary that exists on disk but cannot actually run.

If Base-network congestion or node slowness makes a legitimate deploy run longer than expected, increase `AUTOLAUNCH_DEPLOY_TIMEOUT_MS` on the Autolaunch launch node. The default is `180000`.

The recommended agent order is:

```bash
regents autolaunch safe wizard --backup-signer-address <address>
regents autolaunch safe create --backup-signer-address <address> --website-wallet-address <address>
regents autolaunch prelaunch wizard --agent <agent-id> --name "Agent Coin Name" --symbol "AGENT" --agent-safe-address <safe-address>
regents autolaunch prelaunch validate --plan <id>
regents autolaunch prelaunch publish --plan <id>
regents autolaunch launch run --plan <id>
regents autolaunch launch monitor --job <job-id> --watch
regents autolaunch launch finalize --job <job-id> [--submit]
regents autolaunch vesting status --job <job-id>
```

Skip the Safe commands only when the agent Safe already exists and the launch plan already points to it.

## Fixed economic rules

The launch shape is fixed:

- 10% of the 100 billion supply is sold in the auction
- 5% is reserved for LP migration
- 85% vests to the agent treasury over one year
- half of the auction USDC funds LP migration
- the other half of the auction USDC goes to the agent Safe for operating runway

The fee rules are fixed too:

- the official launch pool charges a fixed 2% fee
- that 2% split is fixed at 1% to Regent and 1% to the agent treasury
- recognized subject revenue first sends a fixed 1% skim to Regent
- the remaining 99% is governed by the live eligible revenue share
- that live share decides how much stays in the staker-eligible lane and how much goes straight into the subject reserve lane

## Primary operator journey

The main Autolaunch product is a guided lifecycle.

Start here:

```bash
regents autolaunch prelaunch wizard
regents autolaunch prelaunch validate [--plan <id>]
regents autolaunch prelaunch publish [--plan <id>]
regents autolaunch launch run [--plan <id>]
regents autolaunch launch monitor --job <job-id> [--watch]
regents autolaunch launch finalize --job <job-id> [--submit]
regents autolaunch vesting status --job <job-id>
regents autolaunch vesting release --job <job-id> [--submit]
regents autolaunch vesting propose-beneficiary-rotation --job <job-id> --beneficiary <address> [--json]
regents autolaunch vesting cancel-beneficiary-rotation --job <job-id> [--json]
regents autolaunch vesting execute-beneficiary-rotation --job <job-id> [--json]
```

These commands assume the Phoenix backend is alive and act as the guided operator front door.

### Prelaunch

```bash
regents autolaunch prelaunch wizard \
  --agent <agent-id> \
  --name "Agent Coin Name" \
  --symbol "AGENT" \
  --agent-safe-address <safe-address> \
  [--title <text>] \
  [--subtitle <text>] \
  [--description <text>] \
  [--website-url <url>] \
  [--image-url <url> | --image-file <path>]

regents autolaunch prelaunch show [--plan <id>]
regents autolaunch prelaunch validate [--plan <id>]
regents autolaunch prelaunch publish [--plan <id>]
```

`prelaunch wizard` creates or updates the saved launch draft, uploads the hosted image if needed, validates the draft, and saves the canonical local copy under the CLI state directory.

### Launch lifecycle

```bash
regents autolaunch launch run [--plan <id>] [--wallet-address <address>] [--watch] [--interval <seconds>]
regents autolaunch launch monitor --job <job-id> [--watch] [--interval <seconds>]
regents autolaunch launch finalize --job <job-id> [--submit]
regents autolaunch vesting status --job <job-id>
regents autolaunch vesting release --job <job-id> [--submit]
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

Everything below is advanced or later-lifecycle tooling. Treat the guided lifecycle as the main path for agents.

## REGENT staking rail

`regent-staking` is the separate Base-mainnet rewards rail for the existing `$REGENT` token. It is not the same thing as the per-agent subject splitter flow.

Use it when Regent income has already reached Base USDC:

```bash
regents regent-staking show
regents regent-staking account <wallet-address>
regents regent-staking stake --amount <regent-amount>
regents regent-staking unstake --amount <regent-amount>
regents regent-staking claim-usdc
```

Operational rule for v1:

- non-Base Regent income still lands in Treasury A first
- Treasury A bridges that income manually to Base USDC
- treasury-side deposits and treasury withdrawals are done through the safe or the deployment script flow, not through the CLI
- the staking contract pays the configured staker share to `$REGENT` stakers and leaves the rest accruing for treasury withdrawal

### Agents

```bash
regents autolaunch agents list [--launchable] [--json]
regents autolaunch agent <agent-id> [--json]
regents autolaunch agent readiness <agent-id> [--json]
```

For read surfaces, trust data now lives under the nested `trust` object:

- auction list items use `item.trust.erc8004`, `item.trust.ens`, `item.trust.world`, and `item.trust.x`
- single auction detail uses `auction.trust.erc8004`, `auction.trust.ens`, `auction.trust.world`, and `auction.trust.x`
- direct agent trust reads use `GET /api/trust/agents/:id`

### Low-level launches

```bash
regents autolaunch launch preview \
  --agent <agent-id> \
  --chain-id <84532> \
  --name "Agent Coin Name" \
  --symbol "AGENT" \
  --agent-safe-address <safe-address> \
  [--launch-notes <text>] \
  [--json]

regents autolaunch launch create \
  --agent <agent-id> \
  --chain-id <84532> \
  --name "Agent Coin Name" \
  --symbol "AGENT" \
  --agent-safe-address <safe-address> \
  --wallet-address <address> \
  --nonce <nonce> \
  --message <message> \
  --signature <signature> \
  --issued-at <iso8601> \
  [--launch-notes <text>] \
  [--json]

regents autolaunch jobs watch <job-id> [--watch] [--interval <seconds>] [--json]
```

`--chain` aliases are also accepted for launch creation:

- `base-sepolia` -> `84532`
- `base` / `base-mainnet` -> `8453`

Autolaunch launch creation accepts only Base Sepolia and Base mainnet.

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

Autolaunch still does not route the launch fee lane automatically into REGENT rewards. The Regent-side launch fee lane is still a direct treasury payout. The separate Base `regent-staking` rail is fed manually after bridging.

`launch preview`, `launch create`, and `jobs watch` return a `reputation_prompt` object in the JSON payload. It is the CLI-safe version of the optional follow-up step shown in the web app:

- It explains that linking ENS and connecting a human World ID are optional trust improvements.
- It includes the warning that skipping those steps can leave the launch looking less trusted.
- It carries the current instructions and, when available, direct links for the ENS and World follow-up pages.

### Auctions

```bash
regents autolaunch auctions list \
  [--sort hottest|recently_launched|expired] \
  [--status active|expired] \
  [--chain <chain-id>] \
  [--mine-only] \
  [--json]

regents autolaunch auction <auction-id> [--json]
```

### Bids

```bash
regents autolaunch bids quote \
  --auction <auction-id> \
  --amount <currency-amount> \
  --max-price <price-q96-or-ratio> \
  [--json]

regents autolaunch bids place \
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

regents autolaunch bids exit <bid-id> --tx-hash <hash> [--json]
regents autolaunch bids claim <bid-id> --tx-hash <hash> [--json]
```

### Subjects

```bash
regents autolaunch subjects show <subject-id> [--json]
regents autolaunch subjects ingress <subject-id> [--json]
regents autolaunch subjects stake <subject-id> --amount <token-amount> [--json]
regents autolaunch subjects unstake <subject-id> --amount <token-amount> [--json]
regents autolaunch subjects claim-usdc <subject-id> [--json]
regents autolaunch subjects sweep-ingress <subject-id> --address <ingress-address> [--json]
```

These commands use the same session-backed subject endpoints as the web app. They are useful after launch, but they are not the primary launch lifecycle.

### Contract reads

```bash
regents autolaunch contracts admin [--json]
regents autolaunch contracts job --job <job-id> [--json]
regents autolaunch contracts subject --subject <subject-id> [--json]
```

These commands expose the same read model that powers the `/contracts` page in the Phoenix app.

### Prepare-only contract actions

```bash
regents autolaunch strategy migrate --job <job-id> [--json]
regents autolaunch strategy sweep-token --job <job-id> [--json]
regents autolaunch strategy sweep-currency --job <job-id> [--json]
regents autolaunch vesting release --job <job-id> [--json]

regents autolaunch fee-registry show --job <job-id> [--json]

regents autolaunch fee-vault show --job <job-id> [--json]
regents autolaunch fee-vault withdraw-treasury --job <job-id> --currency <address> --amount <raw-units> --recipient <address> [--json]
regents autolaunch fee-vault withdraw-regent --job <job-id> --currency <address> --amount <raw-units> --recipient <address> [--json]

regents autolaunch splitter show --subject <subject-id> [--json]
regents autolaunch splitter set-paused --subject <subject-id> --paused true|false [--json]
regents autolaunch splitter set-label --subject <subject-id> --label <text> [--json]
regents autolaunch splitter propose-treasury-recipient-rotation --subject <subject-id> --recipient <address> [--json]
regents autolaunch splitter cancel-treasury-recipient-rotation --subject <subject-id> [--json]
regents autolaunch splitter execute-treasury-recipient-rotation --subject <subject-id> [--json]
regents autolaunch splitter set-protocol-recipient --subject <subject-id> --recipient <address> [--json]
regents autolaunch splitter sweep-treasury-residual --subject <subject-id> --amount <raw-units> [--json]
regents autolaunch splitter sweep-protocol-reserve --subject <subject-id> --amount <raw-units> [--json]
regents autolaunch splitter reassign-dust --subject <subject-id> --amount <raw-units> [--json]

regents autolaunch ingress create --subject <subject-id> --label <text> [--make-default true|false] [--json]
regents autolaunch ingress set-default --subject <subject-id> --address <ingress-address> [--json]
regents autolaunch ingress set-label --subject <subject-id> --address <ingress-address> --label <text> [--json]
regents autolaunch ingress rescue --subject <subject-id> --address <ingress-address> --token <address> --amount <raw-units> --recipient <address> [--json]

regents autolaunch registry show --subject <subject-id> [--json]
regents autolaunch registry set-subject-manager --subject <subject-id> --account <address> --enabled true|false [--json]
regents autolaunch registry link-identity --subject <subject-id> --identity-chain-id <id> --identity-registry <address> --identity-agent-id <id> [--json]
regents autolaunch registry rotate-safe --subject <subject-id> --new-safe <address> [--json]

regents autolaunch factory revenue-share set-authorized-creator --account <address> --enabled true|false [--json]
regents autolaunch factory revenue-ingress set-authorized-creator --account <address> --enabled true|false [--json]
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
- launch-chain RPC configured and reachable
  The backend needs it for launch-state reads, bid verification, and subject verification.
- the shared SIWA verification path reachable
  Launch creation depends on backend-side signature verification.
- the Foundry deploy binary and deploy workdir present on the backend node
  Without those, launch creation can queue but cannot actually execute.

Trust follow-up commands use the current trust-network configuration. Core launch, auction, subject, and contract-console flows use their own configured inputs.
