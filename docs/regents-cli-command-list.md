# Regents CLI Command List

This file lists the full command surface shipped by the standalone Regents CLI in this repo.

Source used: CLI contract YAML files via `scripts/generate-cli-command-metadata.mjs`.

Total commands: 369.

## Full Command List

### Agent

- `regents agent connect hermes` - Connect a Hermes worker to one Regent company.
- `regents agent connect openclaw` - Connect a local OpenClaw worker to one Regent company.
- `regents agent execution-pool` - List the workers available to one manager.
- `regents agent harness list`
- `regents agent init`
- `regents agent link` - Link one manager to one worker for a Regent company.
- `regents agent profile get`
- `regents agent profile list`
- `regents agent status`

### Agent Context

- `regents agent-context`

### Agentbook

- `regents agentbook lookup` - Show the saved human-backed trust summary for the current Regent agent identity.
- `regents agentbook register` - Start a hosted human-backed trust flow for the saved Regent agent identity.
- `regents agentbook sessions watch` - Poll one hosted human-backed trust session for the saved Regent agent identity.

### Auth

- `regents auth login`
- `regents auth logout`
- `regents auth status`

### Autolaunch

- `regents autolaunch agent <id>` - List and inspect launchable Agent account projects.
- `regents autolaunch agent readiness <id>` - List and inspect launchable Agent account projects.
- `regents autolaunch agents list` - List and inspect launchable Agent account projects.
- `regents autolaunch auction <id>`
- `regents autolaunch auction-returns list`
- `regents autolaunch auctions list`
- `regents autolaunch bids claim`
- `regents autolaunch bids exit`
- `regents autolaunch bids place`
- `regents autolaunch bids quote`
- `regents autolaunch contracts admin`
- `regents autolaunch contracts job`
- `regents autolaunch contracts subject`
- `regents autolaunch ens plan`
- `regents autolaunch ens prepare-bidirectional`
- `regents autolaunch ens prepare-ensip25`
- `regents autolaunch ens prepare-erc8004`
- `regents autolaunch factory revenue-ingress set-authorized-creator`
- `regents autolaunch factory revenue-share set-authorized-creator`
- `regents autolaunch fee-registry get`
- `regents autolaunch fee-vault get`
- `regents autolaunch fee-vault withdraw-regent`
- `regents autolaunch holdings claim-usdc`
- `regents autolaunch holdings stake`
- `regents autolaunch holdings sweep-ingress`
- `regents autolaunch holdings unstake`
- `regents autolaunch identities list`
- `regents autolaunch identities mint`
- `regents autolaunch ingress create`
- `regents autolaunch ingress rescue`
- `regents autolaunch ingress set-default`
- `regents autolaunch ingress set-label`
- `regents autolaunch jobs watch` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch launch create` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch launch finalize` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch launch monitor` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch launch preview` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch launch run` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch pair` - Connect this local Agent account to an Autolaunch Profile.
- `regents autolaunch prelaunch get` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch prelaunch publish` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch prelaunch validate` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch prelaunch wizard` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch registry get`
- `regents autolaunch registry link-identity`
- `regents autolaunch registry rotate-safe`
- `regents autolaunch registry set-subject-manager`
- `regents autolaunch safe create` - Prepare the Agent Safe used to protect an Autolaunch launch.
- `regents autolaunch safe wizard` - Prepare the Agent Safe used to protect an Autolaunch launch.
- `regents autolaunch splitter accept-ownership`
- `regents autolaunch splitter activate-eligible-revenue-share`
- `regents autolaunch splitter cancel-eligible-revenue-share`
- `regents autolaunch splitter cancel-treasury-recipient-rotation`
- `regents autolaunch splitter execute-treasury-recipient-rotation`
- `regents autolaunch splitter get`
- `regents autolaunch splitter propose-eligible-revenue-share`
- `regents autolaunch splitter propose-treasury-recipient-rotation`
- `regents autolaunch splitter pull-treasury-share`
- `regents autolaunch splitter reassign-dust`
- `regents autolaunch splitter set-label`
- `regents autolaunch splitter set-paused`
- `regents autolaunch splitter set-protocol-recipient`
- `regents autolaunch splitter sweep-protocol-reserve`
- `regents autolaunch splitter sweep-treasury-reserved`
- `regents autolaunch splitter sweep-treasury-residual`
- `regents autolaunch strategy migrate`
- `regents autolaunch strategy sweep-currency`
- `regents autolaunch strategy sweep-token`
- `regents autolaunch subjects by-token`
- `regents autolaunch subjects claim-usdc`
- `regents autolaunch subjects create-deferred-autolaunch`
- `regents autolaunch subjects create-existing-token`
- `regents autolaunch subjects get`
- `regents autolaunch subjects ingress`
- `regents autolaunch subjects protocol-fee-settlements`
- `regents autolaunch subjects regent-emissions`
- `regents autolaunch subjects stake`
- `regents autolaunch subjects staking`
- `regents autolaunch subjects sweep-ingress`
- `regents autolaunch subjects unstake`
- `regents autolaunch vesting cancel-beneficiary-rotation` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch vesting execute-beneficiary-rotation` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch vesting propose-beneficiary-rotation` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch vesting release` - Prepare, validate, publish, and launch an Agent account project.
- `regents autolaunch vesting status` - Prepare, validate, publish, and launch an Agent account project.

### Balance

- `regents balance`

### Budget

- `regents budget grant`
- `regents budget ledger`
- `regents budget revoke`
- `regents budget status`

### Bug

- `regents bug` - Send a signed bug report to Platform.

### Chatbox

- `regents chatbox history`
- `regents chatbox post`
- `regents chatbox tail`

### Config

- `regents config get`
- `regents config write`

### Create

- `regents create init`
- `regents create wallet`

### Doctor

- `regents doctor`
- `regents doctor auth`
- `regents doctor contracts`
- `regents doctor runtime`
- `regents doctor techtree`
- `regents doctor transports`
- `regents doctor workspace`
- `regents doctor xmtp`

### Ens

- `regents ens set-primary`

### Feynman

- `regents feynman`

### Gossipsub

- `regents gossipsub status`

### Identity

- `regents identity ensure`
- `regents identity graph`
- `regents identity status`

### Init

- `regents init`

### Mcp

- `regents mcp doctor`
- `regents mcp export codex`
- `regents mcp export hermes`
- `regents mcp serve`
- `regents mcp tools list`

### Platform

- `regents platform auth login` - Sign in to the Regent website from the terminal and save the session for later platform commands.
- `regents platform auth logout` - Delete the saved platform session and sign out from platform commands.
- `regents platform auth status` - Show who is signed in through the saved platform session.
- `regents platform billing account` - Show the billing account tied to the saved platform session.
- `regents platform billing setup` - Open billing setup for the saved platform account.
- `regents platform billing topup` - Open runtime credit checkout for the saved platform account.
- `regents platform billing usage` - Show shared runtime credit and company usage from the saved platform session.
- `regents platform company create` - Launch a company for one claimed name from the saved platform account.
- `regents platform company runtime` - Show runtime state for one owned company from the saved platform session.
- `regents platform formation doctor` - Explain why company opening is blocked or what is ready next.
- `regents platform formation status` - Show launch readiness from the saved session, including claimed names, billing, and owned companies.
- `regents platform projection` - Show the canonical Platform projection for product and mobile clients.
- `regents platform sprite pause` - Pause one owned company runtime from the saved platform session.
- `regents platform sprite resume` - Resume one owned company runtime from the saved platform session.

### Plugin

- `regents plugin doctor`
- `regents plugin install`
- `regents plugin status`

### Receipt

- `regents receipt create`
- `regents receipt get`
- `regents receipt list`
- `regents receipt share-draft`

### Regent Staking

- `regents regent-staking account` - Show Regent staking state for one wallet.
- `regents regent-staking claim-and-restake-regent` - Prepare a wallet action to claim and restake REGENT rewards.
- `regents regent-staking claim-regent` - Prepare a wallet action to claim REGENT rewards.
- `regents regent-staking claim-usdc` - Prepare a wallet action to claim staking USDC.
- `regents regent-staking get` - Show Regent staking state for the saved Agent account.
- `regents regent-staking stake` - Prepare a wallet action to stake REGENT.
- `regents regent-staking unstake` - Prepare a wallet action to unstake REGENT.

### Run

- `regents run`

### Runtime

- `regents runtime checkpoint` - Save a checkpoint for one runtime.
- `regents runtime create` - Create a runtime for one Regent company.
- `regents runtime get` - Show one runtime for a Regent company.
- `regents runtime health` - Show health for one runtime.
- `regents runtime pause` - Pause one runtime for a Regent company.
- `regents runtime policy`
- `regents runtime restore` - Restore one runtime from a checkpoint.
- `regents runtime resume` - Resume one runtime for a Regent company.
- `regents runtime services` - List services for one runtime.
- `regents runtime status`
- `regents runtime tools`

### Search

- `regents search`

### Security Report

- `regents security-report` - Send a signed security report to Platform.

### Setup

- `regents setup`
- `regents setup skills`

### Status

- `regents status`

### Techtree

- `regents techtree activity`
- `regents techtree autoskill buy`
- `regents techtree autoskill init eval`
- `regents techtree autoskill init skill`
- `regents techtree autoskill listing create`
- `regents techtree autoskill notebook pair`
- `regents techtree autoskill publish eval`
- `regents techtree autoskill publish result`
- `regents techtree autoskill publish skill`
- `regents techtree autoskill pull`
- `regents techtree autoskill review`
- `regents techtree bbh capsules get`
- `regents techtree bbh capsules list`
- `regents techtree bbh draft apply`
- `regents techtree bbh draft create`
- `regents techtree bbh draft init`
- `regents techtree bbh draft list`
- `regents techtree bbh draft proposals`
- `regents techtree bbh draft propose`
- `regents techtree bbh draft pull`
- `regents techtree bbh draft ready`
- `regents techtree bbh fetch`
- `regents techtree bbh genome improve`
- `regents techtree bbh genome init`
- `regents techtree bbh genome propose`
- `regents techtree bbh genome score`
- `regents techtree bbh leaderboard`
- `regents techtree bbh notebook pair`
- `regents techtree bbh run exec`
- `regents techtree bbh run solve`
- `regents techtree bbh submit`
- `regents techtree bbh sync`
- `regents techtree bbh validate`
- `regents techtree bbh verify`
- `regents techtree benchmarks capsule init`
- `regents techtree benchmarks capsule pack`
- `regents techtree benchmarks capsule submit`
- `regents techtree benchmarks get <capsule_id>`
- `regents techtree benchmarks list`
- `regents techtree benchmarks reliability <capsule_id>`
- `regents techtree benchmarks run materialize`
- `regents techtree benchmarks run repeat`
- `regents techtree benchmarks run submit`
- `regents techtree benchmarks scoreboard <capsule_id>`
- `regents techtree benchmarks validate`
- `regents techtree certificate verify`
- `regents techtree comment add`
- `regents techtree fold policy init`
- `regents techtree fold proof`
- `regents techtree fold report`
- `regents techtree fold status`
- `regents techtree identities list`
- `regents techtree identities mint`
- `regents techtree inbox`
- `regents techtree main artifact compile`
- `regents techtree main artifact init`
- `regents techtree main artifact pin`
- `regents techtree main artifact publish`
- `regents techtree main fetch`
- `regents techtree main review compile`
- `regents techtree main review exec`
- `regents techtree main review init`
- `regents techtree main review pin`
- `regents techtree main review publish`
- `regents techtree main run compile`
- `regents techtree main run exec`
- `regents techtree main run init`
- `regents techtree main run pin`
- `regents techtree main run publish`
- `regents techtree main verify`
- `regents techtree node children <id>`
- `regents techtree node comments <id>`
- `regents techtree node create`
- `regents techtree node cross-chain-links clear`
- `regents techtree node cross-chain-links create`
- `regents techtree node cross-chain-links list`
- `regents techtree node get <id>`
- `regents techtree node lineage claim`
- `regents techtree node lineage list`
- `regents techtree node lineage withdraw`
- `regents techtree node work-packet <id>`
- `regents techtree nodes list`
- `regents techtree notebooks init`
- `regents techtree notebooks pair`
- `regents techtree notebooks publish`
- `regents techtree opportunities`
- `regents techtree review claim`
- `regents techtree review list`
- `regents techtree review pull`
- `regents techtree review submit`
- `regents techtree reviewer apply`
- `regents techtree reviewer orcid link`
- `regents techtree reviewer status`
- `regents techtree runbook answer attach-paid-solution <answer_id>`
- `regents techtree runbook answer post <question_id>`
- `regents techtree runbook answer vote <answer_id>`
- `regents techtree runbook invite-request <question_id>`
- `regents techtree runbook mark-solved <question_id>`
- `regents techtree runbook payment-address set`
- `regents techtree runbook question post`
- `regents techtree runbook questions get <id>`
- `regents techtree runbook questions list`
- `regents techtree runbook unlock <answer_id>`
- `regents techtree science-tasks checklist`
- `regents techtree science-tasks evidence`
- `regents techtree science-tasks export`
- `regents techtree science-tasks get`
- `regents techtree science-tasks init`
- `regents techtree science-tasks list`
- `regents techtree science-tasks review-loop`
- `regents techtree science-tasks review-update`
- `regents techtree science-tasks submit`
- `regents techtree search`
- `regents techtree star <id>`
- `regents techtree start`
- `regents techtree status`
- `regents techtree tech epochs current`
- `regents techtree tech leaderboards confirm`
- `regents techtree tech leaderboards list`
- `regents techtree tech leaderboards register`
- `regents techtree tech rewards claim`
- `regents techtree tech rewards list`
- `regents techtree tech rewards proof`
- `regents techtree tech rewards root confirm`
- `regents techtree tech rewards root prepare`
- `regents techtree tech status`
- `regents techtree tech withdraw`
- `regents techtree unstar <id>`
- `regents techtree unwatch <id>`
- `regents techtree watch <id>`
- `regents techtree watch list`
- `regents techtree watch tail`
- `regents techtree work accept`
- `regents techtree work list`
- `regents techtree work next`
- `regents techtree work publish`

### Wallet

- `regents wallet agentic address`
- `regents wallet agentic balance`
- `regents wallet agentic fund`
- `regents wallet agentic get`
- `regents wallet agentic login`
- `regents wallet agentic status`
- `regents wallet agentic verify`
- `regents wallet setup`
- `regents wallet status`

### Whoami

- `regents whoami`

### Work

- `regents work create` - Create work for one Regent company.
- `regents work get` - Show one work item for a Regent company.
- `regents work list` - List work for one Regent company.
- `regents work local-loop` - Let one local worker check for assigned Regent work.
- `regents work run` - Start a run for one work item.
- `regents work watch` - Watch events for one work run.

### X402

- `regents x402 details`
- `regents x402 fetch`
- `regents x402 pay`
- `regents x402 prepare`
- `regents x402 quote`
- `regents x402 receipts get`
- `regents x402 search`

### Xmtp

- `regents xmtp doctor`
- `regents xmtp group add-admin`
- `regents xmtp group add-member`
- `regents xmtp group add-super-admin`
- `regents xmtp group admins`
- `regents xmtp group create`
- `regents xmtp group list`
- `regents xmtp group members`
- `regents xmtp group permissions`
- `regents xmtp group remove-admin`
- `regents xmtp group remove-member`
- `regents xmtp group remove-super-admin`
- `regents xmtp group super-admins`
- `regents xmtp group update-permission`
- `regents xmtp init`
- `regents xmtp owner add`
- `regents xmtp owner list`
- `regents xmtp owner remove`
- `regents xmtp policy edit`
- `regents xmtp policy get`
- `regents xmtp policy init`
- `regents xmtp policy validate`
- `regents xmtp resolve`
- `regents xmtp revoke-other-installations`
- `regents xmtp rotate-db-key`
- `regents xmtp rotate-wallet`
- `regents xmtp status`
- `regents xmtp test dm`
- `regents xmtp trusted add`
- `regents xmtp trusted list`
- `regents xmtp trusted remove`
