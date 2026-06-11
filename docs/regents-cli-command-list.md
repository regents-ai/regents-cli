# Regents CLI Command List

This file lists the full command surface shipped by the standalone Regents CLI in this repo.

Source used: CLI contract YAML files via `scripts/generate-cli-command-metadata.mjs`.

Total commands: 371.

## Full Command List

### Agent

- `regents agent connect hermes` - Connect a Hermes worker to one Regent company.
- `regents agent connect openclaw` - Connect a local OpenClaw worker to one Regent company.
- `regents agent execution-pool` - List the workers available to one manager.
- `regents agent harness list` - List harness.
- `regents agent init` - Set up agent.
- `regents agent link` - Link one manager to one worker for a Regent company.
- `regents agent profile get` - Show profile.
- `regents agent profile list` - List profile.
- `regents agent status` - Show agent status.

### Agent Context

- `regents agent-context` - Print the safe command and setup context for another agent.

### Agentbook

- `regents agentbook lookup` - Show the saved human-backed trust summary for the current Regent agent identity.
- `regents agentbook register` - Start a hosted human-backed trust flow for the saved Regent agent identity.
- `regents agentbook sessions watch` - Poll one hosted human-backed trust session for the saved Regent agent identity.

### Auth

- `regents auth login` - Sign in for protected Regent commands.
- `regents auth logout` - Sign out on this machine.
- `regents auth status` - Show the current saved sign-in.

### Autolaunch

- `regents autolaunch agent <id>` - Show Autolaunch agent.
- `regents autolaunch agent readiness <id>` - Show agent readiness.
- `regents autolaunch agents list` - List agents.
- `regents autolaunch auction <id>` - Show Autolaunch auction.
- `regents autolaunch auction-returns list` - List auction returns.
- `regents autolaunch auctions list` - List auctions.
- `regents autolaunch bids claim` - Claim bids.
- `regents autolaunch bids exit` - Exit bids.
- `regents autolaunch bids place` - Place bids.
- `regents autolaunch bids quote` - Quote bids.
- `regents autolaunch chat join <subject-id>` - Show Autolaunch chat join.
- `regents autolaunch chat list` - List chat.
- `regents autolaunch chat read <scope>` - Show Autolaunch chat read.
- `regents autolaunch chat send <scope>` - Show Autolaunch chat send.
- `regents autolaunch connect start` - Start connect.
- `regents autolaunch contracts admin` - Show Autolaunch contracts admin.
- `regents autolaunch contracts job` - Show Autolaunch contracts job.
- `regents autolaunch contracts subject` - Show Autolaunch contracts subject.
- `regents autolaunch contracts verify` - Check contracts.
- `regents autolaunch dm <subject-id|address>` - Show Autolaunch dm.
- `regents autolaunch dm list` - List dm.
- `regents autolaunch ens plan` - Show Autolaunch ENS plan.
- `regents autolaunch ens prepare-bidirectional` - Prepare bidirectional for ENS.
- `regents autolaunch ens prepare-ensip25` - Prepare ensip25 for ENS.
- `regents autolaunch ens prepare-erc8004` - Prepare erc8004 for ENS.
- `regents autolaunch factory revenue-ingress set-authorized-creator` - Set authorized creator for factory revenue ingress.
- `regents autolaunch factory revenue-share set-authorized-creator` - Set authorized creator for factory revenue share.
- `regents autolaunch fee-registry get` - Show fee registry.
- `regents autolaunch fee-vault get` - Show fee vault.
- `regents autolaunch fee-vault withdraw-regent` - Withdraw fee vault.
- `regents autolaunch identities list` - List identities.
- `regents autolaunch identities mint` - Create identities.
- `regents autolaunch ingress create` - Create ingress.
- `regents autolaunch ingress rescue` - Rescue ingress.
- `regents autolaunch ingress set-default` - Set default for ingress.
- `regents autolaunch ingress set-label` - Set label for ingress.
- `regents autolaunch jobs watch` - Watch jobs.
- `regents autolaunch launch finalize` - Finalize launch.
- `regents autolaunch launch monitor` - Watch launch.
- `regents autolaunch launch preview` - Preview launch.
- `regents autolaunch launch run` - Run launch.
- `regents autolaunch launch state` - Show Autolaunch launch state.
- `regents autolaunch pair` - Pair Autolaunch.
- `regents autolaunch payment-links create` - Create payment links.
- `regents autolaunch payment-links set-canonical` - Set canonical for payment links.
- `regents autolaunch payment-links set-state` - Set state for payment links.
- `regents autolaunch prelaunch get` - Show prelaunch.
- `regents autolaunch prelaunch publish` - Publish prelaunch.
- `regents autolaunch prelaunch validate` - Check prelaunch.
- `regents autolaunch prelaunch wizard` - Open prelaunch wizard.
- `regents autolaunch registry get` - Show registry.
- `regents autolaunch registry link-identity` - Link identity for registry.
- `regents autolaunch registry rotate-safe` - Rotate safe for registry.
- `regents autolaunch registry set-subject-manager` - Set subject manager for registry.
- `regents autolaunch safe create` - Create safe.
- `regents autolaunch safe wizard` - Open safe wizard.
- `regents autolaunch splitter accept-ownership` - Accept ownership for splitter.
- `regents autolaunch splitter activate-eligible-revenue-share` - Activate eligible revenue share for splitter.
- `regents autolaunch splitter cancel-eligible-revenue-share` - Cancel eligible revenue share for splitter.
- `regents autolaunch splitter cancel-treasury-recipient-rotation` - Cancel treasury recipient rotation for splitter.
- `regents autolaunch splitter execute-treasury-recipient-rotation` - Execute treasury recipient rotation for splitter.
- `regents autolaunch splitter get` - Show splitter.
- `regents autolaunch splitter propose-eligible-revenue-share` - Propose eligible revenue share splitter.
- `regents autolaunch splitter propose-treasury-recipient-rotation` - Propose treasury recipient rotation splitter.
- `regents autolaunch splitter reassign-dust` - Show Autolaunch splitter reassign dust.
- `regents autolaunch splitter set-label` - Set label for splitter.
- `regents autolaunch splitter set-paused` - Set paused for splitter.
- `regents autolaunch splitter sweep-treasury-reserved` - Sweep treasury reserved for splitter.
- `regents autolaunch splitter sweep-treasury-residual` - Sweep treasury residual for splitter.
- `regents autolaunch strategy migrate` - Migrate strategy.
- `regents autolaunch strategy sweep-quote-token` - Sweep quote token for strategy.
- `regents autolaunch strategy sweep-token` - Sweep token for strategy.
- `regents autolaunch subjects buybacks` - Show Autolaunch subjects buybacks.
- `regents autolaunch subjects by-token` - Show Autolaunch subjects by token.
- `regents autolaunch subjects claim-usdc` - Claim USDC for subjects.
- `regents autolaunch subjects create-deferred-autolaunch` - Create deferred Autolaunch for subjects.
- `regents autolaunch subjects create-existing-token` - Create existing token for subjects.
- `regents autolaunch subjects get` - Show subjects.
- `regents autolaunch subjects ingress` - Show Autolaunch subjects ingress.
- `regents autolaunch subjects payment-links` - Show Autolaunch subjects payment links.
- `regents autolaunch subjects regent-emissions` - Show Autolaunch subjects REGENT emissions.
- `regents autolaunch subjects settle-buyback` - Show Autolaunch subjects settle buyback.
- `regents autolaunch subjects stake` - Stake subjects.
- `regents autolaunch subjects staking` - Show Autolaunch subjects staking.
- `regents autolaunch subjects sweep-ingress` - Sweep ingress for subjects.
- `regents autolaunch subjects unstake` - Unstake subjects.
- `regents autolaunch subjects verify` - Check subjects.
- `regents autolaunch vesting cancel-beneficiary-rotation` - Cancel beneficiary rotation for vesting.
- `regents autolaunch vesting execute-beneficiary-rotation` - Execute beneficiary rotation for vesting.
- `regents autolaunch vesting propose-beneficiary-rotation` - Propose beneficiary rotation vesting.
- `regents autolaunch vesting release` - Release vesting.
- `regents autolaunch vesting status` - Show vesting status.

### Budget

- `regents budget grant` - Give an agent a spending budget.
- `regents budget ledger` - Show budget activity.
- `regents budget revoke` - Revoke an agent budget.
- `regents budget status` - Show the current budget state.

### Bug

- `regents bug` - Send a signed bug report to Platform.

### Config

- `regents config get` - Show local Regent configuration.
- `regents config write` - Save local Regent configuration.

### Doctor

- `regents doctor` - Check local Regent readiness.
- `regents doctor auth` - Show doctor auth.
- `regents doctor contracts` - Show doctor contracts.
- `regents doctor runtime` - Show doctor runtime.
- `regents doctor techtree` - Show doctor Techtree.
- `regents doctor transports` - Show doctor transports.
- `regents doctor workspace` - Show doctor workspace.

### Ens

- `regents ens set-primary` - Set the primary ENS name.

### Feynman

- `regents feynman` - Open the Feynman research shell.

### Gossipsub

- `regents gossipsub status` - Show gossipsub status.

### Identity

- `regents identity ensure` - Set up or confirm the local Agent identity.
- `regents identity graph` - Show linked identity records.
- `regents identity status` - Show local identity readiness.

### Init

- `regents init` - Set up Regent on this machine and report what is ready.

### Mcp

- `regents mcp doctor` - Check MCP setup.
- `regents mcp export codex` - Print MCP setup for Codex.
- `regents mcp serve` - Start the Regents MCP server.
- `regents mcp tools list` - List tools.

### Platform

- `regents platform auth login` - Sign in to the Regent website from the terminal and save the session for later platform commands.
- `regents platform auth logout` - Delete the saved platform session and sign out from platform commands.
- `regents platform auth status` - Show who is signed in through the saved platform session.
- `regents platform billing account` - Show the billing account tied to the saved platform session.
- `regents platform billing spend-controls set` - Save monthly hosting, model usage, and automatic credit top-up settings.
- `regents platform billing topup` - Start a Stripe checkout that adds shared runtime credit.
- `regents platform billing usage` - Show shared runtime credit and company usage from the saved platform session.
- `regents platform company pause` - Pause the hosted runtime for one owned company.
- `regents platform company resume` - Resume the hosted runtime for one owned company.
- `regents platform company runtime` - Show runtime state for one owned company from the saved platform session.
- `regents platform formation doctor` - Explain why company opening is blocked or what is ready next.
- `regents platform formation status` - Show launch readiness from the saved session, including claimed names, billing, and owned companies.
- `regents platform projection` - Show the canonical Platform projection for product and mobile clients.

### Plugin

- `regents plugin doctor` - Check plugin setup.
- `regents plugin install` - Install a Regent plugin for the selected runtime.
- `regents plugin status` - Show installed Regent plugins.

### Receipt

- `regents receipt create` - Create a payment receipt record.
- `regents receipt get` - Show receipt.
- `regents receipt list` - List receipt.
- `regents receipt share-draft` - Draft shareable receipt details.

### Regent Staking

- `regents regent-staking account` - Show Regent staking state for one wallet.
- `regents regent-staking claim-and-restake-regent` - Prepare a wallet action to claim and restake REGENT rewards.
- `regents regent-staking claim-regent` - Prepare a wallet action to claim REGENT rewards.
- `regents regent-staking claim-usdc` - Prepare a wallet action to claim staking USDC.
- `regents regent-staking get` - Show Regent staking state for the saved Agent account.
- `regents regent-staking stake` - Prepare a wallet action to stake REGENT.
- `regents regent-staking unstake` - Prepare a wallet action to unstake REGENT.
- `regents regent-staking verify` - Check Regent staking state against the staking contract for a wallet.

### Run

- `regents run` - Start local Regent access for agents and terminal commands.

### Runtime

- `regents runtime checkpoint` - Save a checkpoint for one runtime.
- `regents runtime create` - Create a runtime for one Regent company.
- `regents runtime get` - Show one runtime for a Regent company.
- `regents runtime health` - Show health for one runtime.
- `regents runtime pause` - Pause one runtime for a Regent company.
- `regents runtime policy` - Show runtime policy settings.
- `regents runtime restore` - Restore one runtime from a checkpoint.
- `regents runtime resume` - Resume one runtime for a Regent company.
- `regents runtime services` - List services for one runtime.
- `regents runtime status` - Show runtime status.
- `regents runtime tools` - List runtime tools.

### Security Report

- `regents security-report` - Send a signed security report to Platform.

### Settings

- `regents settings` - Show local Regent configuration. Alias for regents config get.

### Setup

- `regents setup` - Show setup guidance.
- `regents setup skills` - Install recommended Regent skills.

### Start

- `regents start` - Open the first-run Techtree start flow. Alias for regents techtree start.

### Status

- `regents status` - Show whether this machine is ready to use Regent.

### Techtree

- `regents techtree activity` - Show recent Techtree activity.
- `regents techtree autoskill buy` - Buy autoskill.
- `regents techtree autoskill init eval` - Set up autoskill eval.
- `regents techtree autoskill init skill` - Set up autoskill skill.
- `regents techtree autoskill listing create` - Create autoskill listing.
- `regents techtree autoskill notebook pair` - Pair autoskill notebook.
- `regents techtree autoskill publish eval` - Publish autoskill eval.
- `regents techtree autoskill publish result` - Publish autoskill result.
- `regents techtree autoskill publish skill` - Publish autoskill skill.
- `regents techtree autoskill pull` - Fetch autoskill.
- `regents techtree autoskill refund` - Refund autoskill.
- `regents techtree autoskill review` - Review an autoskill package.
- `regents techtree bbh capsules get` - Show BBH capsules.
- `regents techtree bbh capsules list` - List BBH capsules.
- `regents techtree bbh draft apply` - Apply BBH draft.
- `regents techtree bbh draft create` - Create BBH draft.
- `regents techtree bbh draft init` - Set up BBH draft.
- `regents techtree bbh draft list` - List BBH draft.
- `regents techtree bbh draft proposals` - List BBH draft proposals.
- `regents techtree bbh draft propose` - Propose BBH draft.
- `regents techtree bbh draft pull` - Fetch BBH draft.
- `regents techtree bbh draft ready` - Mark BBH draft ready.
- `regents techtree bbh genome improve` - Improve BBH genome.
- `regents techtree bbh genome init` - Set up BBH genome.
- `regents techtree bbh genome propose` - Propose BBH genome.
- `regents techtree bbh genome score` - Score BBH genome.
- `regents techtree bbh leaderboard` - Show BBH leaderboard.
- `regents techtree bbh notebook pair` - Pair BBH notebook.
- `regents techtree bbh run exec` - Run BBH exec.
- `regents techtree bbh run solve` - Solve BBH run.
- `regents techtree bbh submit` - Submit BBH.
- `regents techtree bbh sync` - Sync BBH.
- `regents techtree bbh validate` - Check BBH.
- `regents techtree benchmarks capsule init` - Set up benchmarks capsule.
- `regents techtree benchmarks capsule pack` - Pack benchmarks capsule.
- `regents techtree benchmarks capsule submit` - Submit benchmarks capsule.
- `regents techtree benchmarks get <capsule_id>` - Show benchmarks.
- `regents techtree benchmarks list` - List benchmarks.
- `regents techtree benchmarks reliability <capsule_id>` - Show Techtree benchmarks reliability.
- `regents techtree benchmarks run materialize` - Materialize benchmarks run.
- `regents techtree benchmarks run repeat` - Repeat benchmarks run.
- `regents techtree benchmarks run submit` - Submit benchmarks run.
- `regents techtree benchmarks scoreboard <capsule_id>` - Show Techtree benchmarks scoreboard.
- `regents techtree benchmarks validate` - Check benchmarks.
- `regents techtree certificate verify` - Check certificate.
- `regents techtree chat join <node-id>` - Join a Techtree node room over XMTP.
- `regents techtree chat list` - List Techtree chat channels and node rooms.
- `regents techtree chat read <scope>` - Show chat messages for a scope.
- `regents techtree chat send <scope>` - Send a chat message to a scope.
- `regents techtree chat tail <scope>` - Watch live chat messages for a scope.
- `regents techtree comment add` - Add comment.
- `regents techtree dm <node-id|address>` - Send a direct message to a node author or wallet address.
- `regents techtree dm list` - List local XMTP direct message conversations.
- `regents techtree fold policy init` - Set up fold policy.
- `regents techtree fold proof` - Show fold proof.
- `regents techtree fold report` - Create fold report.
- `regents techtree fold status` - Show fold status.
- `regents techtree identities list` - List identities.
- `regents techtree identities mint` - Create identities.
- `regents techtree inbox` - Show your Techtree inbox.
- `regents techtree main fetch` - Fetch main.
- `regents techtree main verify` - Check main.
- `regents techtree node children <id>` - Show Techtree node children.
- `regents techtree node comments <id>` - Show Techtree node comments.
- `regents techtree node create` - Create node.
- `regents techtree node cross-chain-links clear` - Remove node cross chain links.
- `regents techtree node cross-chain-links create` - Create node cross chain links.
- `regents techtree node cross-chain-links list` - List node cross chain links.
- `regents techtree node get <id>` - Show node.
- `regents techtree node lineage claim` - Claim node lineage.
- `regents techtree node lineage list` - List node lineage.
- `regents techtree node lineage withdraw` - Withdraw node lineage.
- `regents techtree node work-packet <id>` - Show Techtree node work packet.
- `regents techtree nodes list` - List nodes.
- `regents techtree notebooks init` - Set up notebooks.
- `regents techtree notebooks pair` - Pair notebooks.
- `regents techtree notebooks publish` - Publish notebooks.
- `regents techtree opportunities` - Show available Techtree opportunities.
- `regents techtree review claim` - Claim review.
- `regents techtree review list` - List review.
- `regents techtree review pull` - Fetch review.
- `regents techtree review submit` - Submit review.
- `regents techtree reviewer apply` - Apply reviewer.
- `regents techtree reviewer orcid link` - Link reviewer ORCID.
- `regents techtree reviewer status` - Show reviewer status.
- `regents techtree runbook answer attach-paid-solution <answer_id>` - Attach paid solution for runbook answer.
- `regents techtree runbook answer post <question_id>` - Post runbook answer.
- `regents techtree runbook answer vote <answer_id>` - Vote on runbook answer.
- `regents techtree runbook invite-request <question_id>` - Invite help on a Runbook question.
- `regents techtree runbook mark-solved <question_id>` - Mark a Runbook question solved.
- `regents techtree runbook payment-address set` - Set runbook payment address.
- `regents techtree runbook question post` - Post runbook question.
- `regents techtree runbook questions get <id>` - Show a Runbook question.
- `regents techtree runbook questions list` - List runbook questions.
- `regents techtree runbook unlock <answer_id>` - Unlock a paid Runbook answer.
- `regents techtree science agent set <agent>` - Choose the default Terminal Science Bench agent.
- `regents techtree science run` - Run a Terminal Science Bench task locally and optionally publish the run.
- `regents techtree science set-goal` - Save a Terminal Science Bench task target.
- `regents techtree science-tasks checklist` - Show science tasks checklist.
- `regents techtree science-tasks evidence` - Show science tasks evidence.
- `regents techtree science-tasks export` - Export science tasks.
- `regents techtree science-tasks get` - Show science tasks.
- `regents techtree science-tasks init` - Set up science tasks.
- `regents techtree science-tasks list` - List science tasks.
- `regents techtree science-tasks review-loop` - Run the science-task review loop.
- `regents techtree science-tasks review-update` - Update a science-task review.
- `regents techtree science-tasks submit` - Submit science tasks.
- `regents techtree search` - Search Techtree.
- `regents techtree settlement verify` - Check settlement.
- `regents techtree skills optimize` - Optimize a skill document against a benchmark capsule set behind the server's held-out validation gate.
- `regents techtree star <id>` - Star a Techtree node.
- `regents techtree start` - Open the Techtree start flow.
- `regents techtree status` - Show Techtree status.
- `regents techtree tech epochs current` - Show current TECH epochs.
- `regents techtree tech leaderboards confirm` - Confirm TECH leaderboards.
- `regents techtree tech leaderboards list` - List TECH leaderboards.
- `regents techtree tech leaderboards register` - Create TECH leaderboards.
- `regents techtree tech rewards claim` - Claim TECH rewards.
- `regents techtree tech rewards list` - List TECH rewards.
- `regents techtree tech rewards proof` - Show TECH rewards proof.
- `regents techtree tech rewards root confirm` - Confirm TECH rewards root.
- `regents techtree tech rewards root prepare` - Prepare TECH rewards root.
- `regents techtree tech status` - Show TECH status.
- `regents techtree tech withdraw` - Withdraw TECH.
- `regents techtree unstar <id>` - Remove a Techtree node star.
- `regents techtree unwatch <id>` - Stop watching a Techtree node.
- `regents techtree watch <id>` - Watch a Techtree node.
- `regents techtree watch list` - List watch.
- `regents techtree watch tail` - Watch updates from followed Techtree nodes.
- `regents techtree work` - Show a paginated summary of available Techtree work.
- `regents techtree work accept` - Accept work.
- `regents techtree work list` - List work.
- `regents techtree work next` - Show the next work.
- `regents techtree work publish` - Publish work.

### Wallet

- `regents wallet agentic balance` - Show the Agent wallet balance.
- `regents wallet agentic fund` - Show how to fund the Agent wallet.
- `regents wallet agentic login` - Sign in with the Agent wallet.
- `regents wallet agentic status` - Show Agent wallet readiness.
- `regents wallet agentic verify` - Verify the Agent wallet sign-in.
- `regents wallet setup` - Set up the local wallet path.
- `regents wallet status` - Show wallet readiness.

### Whoami

- `regents whoami` - Show the local Agent account and saved sign-in context.

### Work

- `regents work cancel` - Cancel one work run.
- `regents work create` - Create work for one Regent company.
- `regents work get` - Show one work item for a Regent company.
- `regents work list` - List work for one Regent company.
- `regents work local-loop` - Let one local worker check for assigned Regent work.
- `regents work retry` - Start a new attempt for one work run.
- `regents work run` - Start a run for one work item.
- `regents work watch` - Watch events for one work run.

### X402

- `regents x402 details` - Show paid endpoint details.
- `regents x402 fetch` - Fetch a paid x402 result.
- `regents x402 pay` - Pay an x402 endpoint.
- `regents x402 prepare` - Prepare an x402 paid request.
- `regents x402 quote` - Quote an x402 paid request.
- `regents x402 receipts get` - Show receipts.
- `regents x402 refund` - Request an x402 refund.
- `regents x402 search` - Search for x402 services.

### Xmtp

- `regents xmtp dm list` - List XMTP direct message conversations.
- `regents xmtp dm send` - Send an XMTP direct message.
- `regents xmtp doctor` - Check XMTP readiness.
- `regents xmtp group add-admin` - Add admin to group.
- `regents xmtp group add-member` - Add member to group.
- `regents xmtp group add-super-admin` - Add super admin to group.
- `regents xmtp group admins` - List group admins.
- `regents xmtp group create` - Create group.
- `regents xmtp group list` - List group.
- `regents xmtp group members` - List group members.
- `regents xmtp group permissions` - List group permissions.
- `regents xmtp group remove-admin` - Remove admin from group.
- `regents xmtp group remove-member` - Remove member from group.
- `regents xmtp group remove-super-admin` - Remove super admin from group.
- `regents xmtp group super-admins` - List group super admins.
- `regents xmtp group update-permission` - Update permission for group.
- `regents xmtp inbox sync` - Sync local XMTP conversations.
- `regents xmtp init` - Set up local XMTP identity.
- `regents xmtp owner add` - Add owner.
- `regents xmtp owner list` - List owner.
- `regents xmtp owner remove` - Remove owner.
- `regents xmtp policy edit` - Edit policy.
- `regents xmtp policy get` - Show policy.
- `regents xmtp policy init` - Set up policy.
- `regents xmtp policy validate` - Check policy.
- `regents xmtp resolve` - Resolve an XMTP identity.
- `regents xmtp revoke-other-installations` - Revoke other XMTP installations.
- `regents xmtp rotate-db-key` - Rotate the XMTP database key.
- `regents xmtp rotate-wallet` - Rotate the XMTP wallet.
- `regents xmtp status` - Show XMTP readiness.
- `regents xmtp test dm` - Send a test XMTP direct message.
- `regents xmtp trusted add` - Add trusted.
- `regents xmtp trusted list` - List trusted.
- `regents xmtp trusted remove` - Remove trusted.
