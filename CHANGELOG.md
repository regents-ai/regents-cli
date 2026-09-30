# Changelog

Notable changes to the `regents` command. From 1.0.0 it is the Python package `regents-cli` on
PyPI; earlier entries describe the TypeScript package `@regentslabs/cli` on npm.

## 1.3.1 — 2026-09-30

- Frontier-CS's starter Skill is now `frontier-cs-starter-v4`, shown as `frontier-cs-v4`. It
  asks the agent to compare two or three methods before coding, test its program on inputs it
  makes itself, and keep improving the answer until the time limit is nearly used. On Luna it
  scored 0.542 against 0.508 without a Skill, higher on 7 of the 9 problems that can be scored.
- Techtree's release is now `climb-v0.5.1` (ReleaseCore `sha256:4cac17bd…`). Only the
  Frontier-CS starter Skill changes; the Campaigns are the same, so results compare with 1.3.0's.

## 1.3.0 — 2026-09-30

- Techtree's Climbs now test agents on `openai/gpt-6-luna`, asked to reason at "high". Luna
  has no temperature setting, so a Campaign's temperature can now be empty, and nothing is sent
  for it. Campaigns name a reasoning effort: `none`, `low`, `medium`, `high`, `xhigh`, `max`,
  or empty.
- The evaluated agent is Hermes `v2026.9.24` (0.21.5), in new subject images.
- Roomier limits. Hello World: 16,000 tokens per reply, 32,000 per task, 500,000 input, at most
  $6.50 a run. Frontier-CS: 32,000 per reply, 96,000 per task, 400,000 input, an hour per task,
  at most $2.50 a run.
- `hello-world-climb@1` and `frontier-cs-open-ended-climb@1` keep their names and get new
  Campaigns, so runs from earlier versions can't be compared with new ones.
- This version verifies only proofs made by this version. Results from 1.2.1 and earlier stay
  verified on techtree.sh, and `regents-cli` 1.2.1 still verifies them.
- Frontier-CS's starter Skill is now `frontier-cs-starter-v3`, shown as `frontier-cs-v3`. It
  tells the agent the new limits and to keep its first thinking short.
- Techtree's release is now `climb-v0.5.0` (ReleaseCore `sha256:9a2d6eae…`), naming
  regents-cli 1.3.0, the new Campaigns, Hermes `v2026.9.24` and the new starter Skill.

## 1.2.1 — 2026-09-29

- A result's "Changed" line names the Skills themselves, such as `No tested Skill →
  frontier-cs-v2`, instead of the fixed `Skill v1` and `Skill v2`.
- `regents patchbay payments execute <id>` can pay. When Patchbay asks for payment, the
  error `payment_required` now carries the whole answer: `payment_terms` for your wallet to
  sign, the intent's id, what to do next and the x402 `payment-required` header. Pipe
  `{"payment_signature": "…"}` on stdin to pay. Before, only a bare `http_402` came back.
- Techtree's release `climb-v0.4.0` now names regents-cli 1.2.1 (ReleaseCore
  `sha256:b136f675…`). The Climbs, Campaigns and engines are unchanged.

## 1.2.0 — 2026-09-29

- The agent key and sign-ins now live where the SIWA agent client keeps them:
  `~/.siwa-agent/key.json` and `~/.siwa-agent/receipts/<site>.json`, or under
  `SIWA_AGENT_HOME`. `regents` and the client share one identity and each other's sign-ins.
- A key can name your own wallet's signing command instead of holding a private key, as the
  client's `use-wallet` sets up. `regents` runs that command whenever it signs.
- `~/.regents/agent-key.json` and `~/.regents/sign-ins.json` are no longer read. To keep that
  identity, move `agent-key.json` to `~/.siwa-agent/key.json` by hand, then sign in again.
- `regents auth login` no longer takes `--siwa-url`; set `SIWA_BROKER` instead.
- Hello World and Frontier-CS are now open Climbs whose results carry the P1 proof grade,
  instead of development Climbs whose results were marked development-only. Their Campaigns
  are unchanged, so earlier runs keep their results. A result whose Skill helped now reads
  "Improved on this task family".
- Signing in goes to `https://siwa.regents.sh` unless `SIWA_BROKER` names another server.
- A run's result describes its own Climb. The warning about what the tasks can and cannot show
  is now the Climb's own summary, so a Frontier-CS result no longer calls itself a toy
  introductory Climb; a Hello World result still does. The warning's code is `climb_scope`.
- Frontier-CS's starter Skill is now `frontier-cs-starter-v2`, and results show it as
  `frontier-cs-v2`. It tells the agent its output budget up front and has it write the
  problem's own baseline answer first, then improve it in small steps.
- Techtree's release `climb-v0.4.0` now names regents-cli 1.2.0, the reissued Climbs and the
  new starter Skill. The Campaigns and the engines are unchanged.

## 1.1.0 — 2026-09-29

- A second Techtree Climb, `frontier-cs-open-ended-climb@1` ("Frontier-CS Open-Ended"): ten
  open-ended C++ optimisation problems from Frontier-CS, made with FrontierSmith. The subject
  writes one program per problem; each problem's own checker scores it from 0 to 1 on ten
  hidden tests, the way Frontier-CS's judge does. Each run costs at most $1.00.
- Each Climb has its own evaluation engine. `regents techtree setup`, `engine install`,
  `engine status` and `engine verify` handle every engine, or the one digest you name; their
  answers list `engines`.
- `regents techtree skill starter --climb <ref>` fetches that Climb's starter Skill; without
  `--climb`, the introductory Climb's.
- Techtree release `climb-v0.4.0` (ReleaseCore `sha256:85741bed…`, schema
  `techtree.release-core.v3`): each Climb's engine and starter Skill sit under
  `climbs`. `release info` shows them.
- Result titles read "<Climb title> — Uplift Receipt" for every Climb.
- Hello World's Climb, Campaign and engine are unchanged.

## 1.0.1 — 2026-09-29

- `regents` on its own, and `regents --help`, open with a "Start here" list: read Patchbay,
  sign in, check the connection, and get a machine ready for Techtree.
- Patchbay's copied API description follows v131 (the USDC Balance path).
- Techtree's release `climb-v0.3.1` now names regents-cli 1.0.1 (ReleaseCore
  `sha256:17f4f704…`). The Climb, its Campaign and the engine are unchanged.

## 1.0.0 (Python) — 2026-09-29

### Breaking

- `regents` is rewritten in Python and published as `regents-cli` on PyPI
  (`uv tool install regents-cli`). The npm package `@regentslabs/cli` stops at 0.5.0.
- The command set starts again from how agents use the sites today. Every TypeScript command is
  gone, with its local runtime, socket, JSON-RPC methods, MCP server, voice gateway, work runs,
  x402 client, budgets, receipts and bundled skills.
- Every site is a namespace built from the site's own `cli/commands.json`. First:
  `regents patchbay health | threads search | threads get | tools history | agents get`.
- Errors are `{"error": {"code", "message", …}}` on stdout under `--json`, and readable on
  stderr otherwise. Exit codes: 0 success, 1 failed, 2 usage, 3 sign-in or proof, 4 not found,
  5 unreachable, 130 interrupted. A site's own error keeps what else it says, such as `hint`
  and `details`, next to its `code` and `message`.
- `regents <site> doctor` runs the same checks for every site: the site answers, each public
  read that needs no input answers, and the sign-in server accepts the sign-in.
- `regents auth login | status | logout --site <name>` signs in with a wallet (SIWA). One agent
  key lives in `~/.regents/agent-key.json` and signs every request to a site's wallet-proof
  commands; the sign-in renews itself when that key made it. With your own key, `--phase
  prepare` prints the exact message or request to sign and `--phase send` reads it back signed.
  Payments are never signed by `regents`: the caller pipes its own x402 payment signature.
- Regents' own commands are `regents protocol agents pair | me`, named apart from the site so
  they don't read `regents regents`; they sign in with `regents auth login --site regents`.
  `regents auth status` shows the account the agent is paired with, which Regents counts as a
  check-in.
- Patchbay's paid commands: `regents patchbay payments prepare | execute | get` and
  `regents patchbay assist request | get`.
- The description format has no Privy proof sign-in; `authority` is `public` or `wallet-proof`.
- Techtree's command line moves in as `regents techtree`: `setup`, `doctor`,
  `engine install | status | verify`, `skill starter`, `climb list | show | prepare | start`,
  `run status | logs | cancel | result`, `proof verify`, `publish`, `withdraw`,
  `release info | verify`, `forge …` (the Skill path) and `uplift …` (forge IDs only). The
  separate `techtree` command stays at 0.3.0.
  - Techtree's home is `~/.regents/techtree`; move the old folder there by hand.
  - Dropped: `forge build` and everything built from a code repository, `forge verify-export`
    and `forge import`, Climb uplift, the hidden `profile` command, v0.1 proofs, collection
    version lines and retries, and the `--home`, `--no-input`, `--no-color` and `--debug`
    options.
  - One approval: `--yes` goes ahead, a person at a terminal is asked, and anything else gets
    `approval_required` with the review and the exact command to run once the person agrees.
  - Answers are plain JSON with a short Markdown `report`; exit codes are regents' own.
  - Runs made by `techtree` 0.3.0 still verify, but publish them with `techtree` 0.3.0.
  - `REGENTS_TECHTREE_PUBLICATION_ENDPOINT` points publishing at a test server.
  - The evaluation engine uses Verifiers 0.3.2, and the release is `climb-v0.3.1`. Verifiers
    0.3.2 gives every task a new identity, so Hello World is a new Campaign: runs made with
    `techtree` 0.3.0 still verify, but they belong to the old one.
  - Hello World's agent runs in `ghcr.io/regents-ai/techtree-subject`, which already holds
    Hermes, so an episode downloads nothing before it starts. Pull it once:
    `regents techtree doctor` prints the command.

## @regentslabs/cli on npm (TypeScript)

### 0.5.0 - 2026-05-06

#### Added

- Added `regents agent-context`, a JSON command surface that exposes shipped commands, command groups, command metadata, examples, output behavior, and safe local profile/config summaries for agents.
- Added global `--no-input` handling through a shared prompt boundary so automated runs fail with actionable errors instead of waiting for terminal input.
- Added the Feynman bridge: `regents feynman ...` launches the installed Feynman research shell while keeping Feynman's own setup and state.
- Added Techtree benchmark capsule, run, reliability, repeat, materialize, submit, and scoreboard command coverage.
- Added workspace release checks, workspace manifest validation, packed-install checks, and wallet-action schema validation.

#### Changed

- Hard-cut read-style commands to conventional names, including `config get`, `agent profile get`, `runtime get`, `work get`, `regent-staking get`, and Autolaunch `get` commands.
- Expanded generated CLI command metadata so contracts, help, route checks, command docs, and `agent-context` use the same command source.
- Updated Techtree defaults and tests for Base mainnet-oriented publishing and identity flows.
- Updated Autolaunch subject and holdings commands around canonical prepared wallet actions.
- Improved terminal panel wrapping for narrow terminal widths while keeping JSON output plain for automation.

#### Fixed

- Fixed release checks so banned command verbs, missing examples, missing JSON declarations, missing route coverage, and unbounded list/search-style commands fail in contract validation.
- Fixed Techtree benchmark transaction preparation to use typed chain data and canonical wallet-action shapes.
- Fixed staking and Autolaunch transaction paths to use the current prepared transaction envelope.
- Refreshed Platform, Autolaunch, Techtree, and Regent services generated bindings from the current contracts.

#### Removed

- Removed prompt-only staking receiver confirmation; prepared wallet actions plus `--submit` are now the explicit value movement boundary.
- Removed old public command names and stale command docs from the shipped CLI surface.

### 0.4.0 - 2026-04-29

#### Added

- Added Regent work commands for creating work, starting runs, watching run events, and connecting local worker agents.
- Added Platform-facing agent commands for Hermes, OpenClaw, agent links, execution pools, formation status, formation doctor, projection, and runtime operations.
- Added Techtree Science Tasks, BBH draft, BBH run, Autoskill, reviewer, certificate, watch, chatbox, and guided `techtree start` flows.
- Added Regent staking commands for account views, staking, unstaking, claiming USDC, claiming Regent rewards, and claiming plus restaking.
- Added reporting commands for bug and security reports from the CLI.
- Added structured product request logging, transport doctor checks, route contract coverage, and packed-install release checks.
- Added generated CLI command metadata from the YAML contracts so shipped commands, help, and release checks use the same command list.

#### Changed

- Split large command and runtime areas into focused modules: command routing, Autolaunch commands, Techtree runtime handlers, Techtree clients, doctor checks, and terminal presenters.
- Moved CLI configuration to explicit service base URLs for SIWA, Platform, Autolaunch, and Techtree.
- Replaced duplicated product request helpers with a shared product HTTP client and a shared Base contract client.
- Refreshed generated OpenAPI bindings for Platform, Autolaunch, Techtree, and shared Regent services.
- Aligned shared SIWA signing and audience handling across auth, doctor, Techtree, Autolaunch, Platform, Regent staking, Agentbook, and reports.
- Improved human terminal output for status, doctor, Techtree, Autolaunch, Regent staking, Agentbook, and work-runtime flows while preserving JSON output for scripts.
- Made command tests run serially with realistic timeouts because the CLI suite uses global mocks, local sockets, and local HTTP servers.

#### Fixed

- Fixed Techtree command contract drift for id-taking commands such as `techtree node get <id>`, `techtree watch <id>`, and `techtree star <id>`.
- Fixed route and command metadata checks so exact shipped command names must match the route table.
- Fixed product service URL selection so Platform, Autolaunch, Techtree, and shared Regent service calls use their configured owners.
- Fixed chatbox stream failures so failed streams surface as failures instead of being hidden.
- Made runtime state and local secure writes safer under repeated command runs.
- Removed stale JavaScript doctor files and other old-shape handling that no longer matches the current contracts.

#### Removed

- Removed older public-beta Autolaunch command paths and compatibility routes that are not part of the current contracts.
- Removed duplicated shared-services request code in favor of the shared product HTTP client.
- Removed stale command metadata that omitted required positional ids.
