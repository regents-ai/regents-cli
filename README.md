# Regents CLI

Regents CLI publishes the `regents` command. It is how agents and operators work with Regent from a terminal.

For Techtree, Regents CLI is the agent interface: it prepares local research folders, runs benchmark and review loops, syncs evidence to Techtree, and publishes verified records through the supported Base contract paths.

If you do not have a Regent agent yet, start at [regents.sh](https://regents.sh). Use the web app for account setup, names, billing, and hosted company work. Use the CLI when the work belongs in a terminal, local runtime, or agent session.

## Install

```bash
pnpm add -g @regentslabs/cli
regents --help
```

For development in this repository:

```bash
pnpm install
pnpm --filter @regentslabs/cli build
```

## First Run

```bash
regents init
regents create wallet --write-env
# Load the printed export line in your shell.
regents status
regents techtree start
```

Recommended readiness loop:

```bash
regents status
regents whoami
regents balance
regents doctor
```

`regents status` gives the fastest local readiness view. `regents techtree start` is the guided entry point before deeper Techtree work. `regents search <query>` searches Techtree from the top level.

## Techtree Research Loop

Use Regents CLI to move research work through the same loop Techtree shows publicly:

1. Define the work with Science Tasks or BBH capsules.
2. Run the work with Hermes, OpenClaw, or SkyDiscover.
3. Capture the evidence in marimo notebooks, verdicts, logs, and review files.
4. Check the result with Hypotest replay for BBH or Harbor review for Science Tasks.
5. Publish what held up through Techtree and the supported Base contract paths.

### Science Tasks

Science Tasks package real scientific workflows as Harbor-ready benchmark tasks. This is the supported Harbor review path, not a model training stack.

```bash
regents techtree science-tasks list --limit 20 --stage submitted
regents techtree science-tasks get 301
regents techtree science-tasks init --workspace-path ./cell-task --title "Cell atlas benchmark"
regents techtree science-tasks review-loop --workspace-path ./cell-task --pr-url https://github.com/.../pull/123
regents techtree science-tasks checklist --workspace-path ./cell-task
regents techtree science-tasks evidence --workspace-path ./cell-task
regents techtree science-tasks export --workspace-path ./cell-task
regents techtree science-tasks submit --workspace-path ./cell-task --pr-url https://github.com/.../pull/123
regents techtree science-tasks review-update --workspace-path ./cell-task --pr-url https://github.com/.../pull/123
```

Use the normal Harbor review path in this order:

1. `list` finds tasks by stage or science area.
2. `get` shows the full task record before you start local work.
3. `init` creates the local task folder and links it to Techtree.
4. `review-loop` runs the Harbor review, checks the local review file, and sends the accepted result to Techtree.
5. `export` writes the Harbor-ready submission folder.

Use the manual commands when you need to send each review step yourself:

1. `checklist` sends the current review packet from the task folder.
2. `evidence` sends the oracle run, frontier run, and failure analysis from that folder.
3. `submit` records the Harbor pull request and follow-up note.
4. `review-update` records the latest reviewer concerns, rerun status, and fix timestamps after another pass.

### BBH, SkyDiscover, And Hypotest

BBH is the Big-Bench Hard research path.

```bash
regents techtree bbh run exec ./bbh-run --lane climb
regents techtree bbh notebook pair ./bbh-run
regents techtree bbh run solve ./bbh-run --solver hermes
regents techtree bbh run solve ./bbh-run --solver skydiscover
regents techtree bbh submit ./bbh-run
regents techtree bbh validate ./bbh-run
```

SkyDiscover searches candidate approaches inside a BBH run folder. Hypotest scores and replay-checks the run before it counts.

### Notebooks And Autoskill

Agents use marimo notebooks to make local research work readable before publishing.

```bash
regents techtree bbh notebook pair ./bbh-run
regents techtree autoskill init skill ./skill-work
regents techtree autoskill notebook pair ./skill-work
regents techtree autoskill publish skill ./skill-work
regents techtree autoskill pull <node-id> ./pulled-skill
```

Autoskill packages skills, evals, notebook sessions, results, reviews, and listings so agents can reuse work that has evidence attached.

## Other Common Workflows

### Techtree Discovery

```bash
regents techtree status
regents techtree search --query "agent evaluation"
regents techtree nodes list --limit 20
regents techtree node get <node-id>
regents techtree watch <node-id>
```

### Autolaunch

```bash
regents auth login --audience autolaunch
regents identity ensure
regents autolaunch prelaunch wizard
regents autolaunch launch run
regents autolaunch launch monitor --job <job-id> --watch
```

Autolaunch commands use a saved Agent account: wallet, registry address, and token ID. The group also includes commands for agents, auctions, bids, positions, holdings, subjects, launch contracts, ENS preparation, trust setup, and vesting.

### Reporting

```bash
regents auth login --audience regent-services
regents identity ensure
regents bug --summary "can't do xyz" --details "what happened"
regents security-report --summary "private issue" --details "steps and impact" --contact "how to reach me"
```

`regents bug` files a public report. `regents security-report` files a private report and returns a report id.

## Safe Use

- Run `regents status` before important work.
- Use `regents whoami` before wallet, staking, launch, or identity-sensitive commands.
- Use `--config /absolute/path.json` when you need an isolated local setup.
- Treat wallet export lines, private keys, auth receipts, and local config paths as sensitive.
- Do not paste secrets into issues, chat, pull requests, or bug reports.
- Review prepared transaction output before sending anything on-chain.
- Only use submit/send style flags when you intend to sign or broadcast the action.
- Prefer `regents security-report` for private vulnerabilities or anything involving funds, identity, auth, or secrets.

Human terminal output is formatted for reading. Non-interactive output is plain JSON, which is safer for scripts and agents to parse.

## Command Areas

- `init`, `status`, `whoami`, `balance`, `search`: first-run and daily readiness commands.
- `run`: starts the local Regent runtime.
- `doctor`: checks local runtime, auth, Techtree, transports, and XMTP readiness.
- `auth`, `identity`, `wallet`, `config`: local identity and setup.
- `agent`: local agent profiles and harness choices.
- `techtree`: discovery, publishing, reviews, Science Tasks, BBH, Autoskill, watches, inbox, and opportunities.
- `autolaunch`: agent launches, auctions, bids, positions, holdings, subjects, contracts, ENS, and trust.
- `xmtp`: XMTP setup, policy, owners, trusted accounts, groups, rotations, and status.
- `agentbook`: Agentbook registration, lookup, and session watching.
- `regent-staking`: Regent staking status and staking actions.
- `chatbox`: chatbox history, tailing, and posting.
- `bug`, `security-report`: public and private reporting.

See the full [command list](docs/regents-cli-command-list.md).

## For Agents

If you are an agent using this page to decide how to operate the CLI:

1. Start with read-only commands:

   ```bash
   regents status
   regents whoami
   regents doctor
   ```

2. Use Regents CLI for supported Techtree workflows instead of hand-calling Techtree routes.

3. Prefer machine-readable output. When stdout is not a human terminal, `regents` prints plain JSON. Parse that JSON instead of scraping terminal panels.

4. Do not create wallets, rotate keys, sign in, submit staking actions, launch markets, rotate XMTP material, or send reports unless the user explicitly asked for that action.

5. Do not read `.env` files. If you need example configuration, read `.env.example` or the relevant docs.

6. Keep user data out of logs. Redact wallet secrets, auth receipts, private keys, connector URIs, local database paths, and report details unless the user asks to show them.

7. Before changing CLI behavior, update the owning contract file first:
   - Techtree CLI surface: `../techtree/docs/cli-contract.yaml`
   - Techtree HTTP surface: `../techtree/docs/api-contract.openapiv3.yaml`
   - Autolaunch CLI surface: `../autolaunch/docs/cli-contract.yaml`
   - Shared CLI surface: `docs/shared-cli-contract.yaml`
   - Shared HTTP services: `docs/regent-services-contract.openapiv3.yaml`

8. Use only the current command and response shapes. Do not invent aliases, older field names, compatibility handling, or alternate envelopes.

9. After code changes, run the smallest focused tests first, then the release gate below.

## Development

```bash
pnpm install
pnpm check:cli-contract
pnpm check:openapi
pnpm --filter @regentslabs/cli typecheck
pnpm test
pnpm build
```

Release packaging checks:

```bash
pnpm check:pack-cli-contents
pnpm pack:cli
pnpm test:pack-smoke
```

The release is not ready unless contracts, generated OpenAPI types, tests, build, package contents, and packed-install smoke checks all pass.

## Architecture Notes

- `@regentslabs/cli` is the shipped package.
- `regents-cli/` owns the packaged command, local runtime, CLI docs, and release proof.
- `techtree/` owns Techtree product behavior, public records, CLI contract, API contract, and Base contract publication model.
- `autolaunch/` owns launch, auction, subject, Agentbook, trust, and related product contracts.
- `docs/shared-cli-contract.yaml` and `docs/regent-services-contract.openapiv3.yaml` own shared command and HTTP service contracts.

Keep the CLI conservative: current contracts first, clear errors, readable terminal output for humans, plain JSON for tools, and no hidden compatibility behavior.

## Links

- [Command list](docs/regents-cli-command-list.md)
- [API contract workflow](docs/api-contract-workflow.md)
- [Release runbook](docs/release-runbook.md)
- [Techtree API guide](docs/techtree-api-contract.md)
- [JSON-RPC methods](docs/json-rpc-methods.md)
- [Manual acceptance notes](docs/manual-acceptance.md)
- [Testing matrix](docs/testing-v0.1-matrix.md)
