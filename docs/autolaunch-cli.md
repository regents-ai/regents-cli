# Autolaunch CLI

`autolaunch` is now a command group inside `regent-cli`.

There is no standalone `autolaunch` binary anymore. The only supported CLI surface is:

```bash
regent autolaunch ...
```

## Environment

- `AUTOLAUNCH_BASE_URL`
  Default: `http://127.0.0.1:4000`
- `AUTOLAUNCH_SESSION_COOKIE`
  Optional existing Phoenix session cookie.
- `AUTOLAUNCH_PRIVY_BEARER_TOKEN`
  Optional Privy bearer token for exchanging into a Phoenix session.
- `AUTOLAUNCH_DISPLAY_NAME`
  Optional display name sent during session exchange.
- `AUTOLAUNCH_WALLET_ADDRESS`
  Optional wallet address sent during session exchange.

If `AUTOLAUNCH_SESSION_COOKIE` is not set and `AUTOLAUNCH_PRIVY_BEARER_TOKEN` is present, the CLI exchanges the bearer token against `/api/auth/privy/session` before calling authenticated endpoints.

## Command groups

### Agents

```bash
regent autolaunch agents list [--launchable] [--json]
regent autolaunch agent <agent-id> [--json]
regent autolaunch agent readiness <agent-id> [--json]
```

### Launches

```bash
regent autolaunch launch preview \
  --agent <agent-id> \
  --chain-id <1|11155111> \
  --name "Agent Coin Name" \
  --symbol "AGENT" \
  --treasury-address <address> \
  [--total-supply <amount>] \
  [--launch-notes <text>] \
  [--json]

regent autolaunch launch create \
  --agent <agent-id> \
  --chain-id <1|11155111> \
  --name "Agent Coin Name" \
  --symbol "AGENT" \
  --treasury-address <address> \
  --wallet-address <address> \
  --nonce <nonce> \
  --message <message> \
  --signature <signature> \
  --issued-at <iso8601> \
  [--total-supply <amount>] \
  [--launch-notes <text>] \
  [--json]

regent autolaunch jobs watch <job-id> [--watch] [--interval <seconds>] [--json]
```

`--chain` aliases are also accepted:

- `ethereum` / `ethereum-mainnet` -> `1`
- `mainnet` -> `1`
- `ethereum-sepolia` -> `11155111`
- `sepolia` -> `11155111`

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

regent autolaunch auctions show <auction-id> [--json]
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

## JSON contract

The CLI is JSON-first. It forwards directly to the `autolaunch` Phoenix JSON API:

- `GET /api/agents`
- `GET /api/agents/:id`
- `GET /api/agents/:id/readiness`
- `POST /api/launch/preview`
- `POST /api/launch/jobs`
- `GET /api/launch/jobs/:id`
- `GET /api/auctions`
- `GET /api/auctions/:id`
- `POST /api/auctions/:id/bid_quote`
- `POST /api/auctions/:id/bids`
- `GET /api/me/bids`
- `POST /api/bids/:id/exit`
- `POST /api/bids/:id/claim`

State-changing bid commands do not submit wallet transactions themselves. They register confirmed onchain actions with the Phoenix app, so callers must provide the real transaction hash via `--tx-hash`.

Polling commands validate `--interval` and require a positive number.

Auction payloads also include the current trust fields used by listings:

- `ens_attached`
- `world_registered`
- `world_human_id`
- `world_launch_count`
