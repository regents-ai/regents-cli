import { CLI_COMMANDS } from "./command-registry.js";
import {
  CLI_COMMANDS_BY_TOP_LEVEL_GROUP,
  CLI_COMMAND_DETAILS_BY_COMMAND,
} from "./generated/cli-command-metadata.js";
import { CLI_PALETTE, printText, renderPanel, tone } from "./printer.js";

interface HelpEntry {
  readonly summary: string;
  readonly usage: string;
  readonly flags?: readonly string[];
  readonly examples?: readonly string[];
  readonly prerequisites?: readonly string[];
  readonly auth: string;
  readonly output: string;
  readonly nextStep: string;
  readonly ifItFails?: readonly string[];
}

interface HelpGroup {
  readonly summary: string;
  readonly auth: string;
  readonly output: string;
  readonly commands: readonly string[];
  readonly nextStep: string;
}

interface CommandFieldMetadata {
  readonly name?: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly description?: string;
}

interface CommandAgentMetadata {
  readonly json_support?: string;
  readonly mutation_class?: string;
  readonly async_behavior?: string;
}

interface CommandDetailMetadata {
  readonly command: string;
  readonly auth_mode?: string;
  readonly auth_audience?: string;
  readonly output_envelope?: string;
  readonly args?: unknown;
  readonly flags?: unknown;
  readonly examples?: readonly string[];
  readonly agent_metadata?: CommandAgentMetadata;
  readonly summary?: string;
  readonly usage?: string;
  readonly next_step?: string;
}

const commandDetailsByCommand = CLI_COMMAND_DETAILS_BY_COMMAND as unknown as Readonly<
  Record<string, CommandDetailMetadata>
>;

const globalNextStep =
  "Install the Regents agent skills with `regents setup skills`, then run `regents status`.";

const localRuntimePrerequisites = [
  "Install the matching runtime tools with `regents plugin install --runtime hermes`, `regents plugin install --runtime openclaw`, or `regents plugin install --runtime auto`.",
  "Keep `regents run` open in another terminal for commands that need local Regent access.",
];

const agentIdentityPrerequisites = [
  "Run `regents run` in another terminal.",
  "Run `regents auth login --audience <audience>` for the product you are using.",
  "Run `regents identity ensure` so signed agent requests have wallet, chain, registry, and token details.",
];

const autolaunchPrerequisites = [
  "Run `regents run` in another terminal.",
  "Run `regents auth login --audience autolaunch`.",
  "Run `regents identity ensure`.",
];

const techtreePrerequisites = [
  "Run `regents run` in another terminal.",
  "Run `regents auth login --audience techtree` for write, publish, and reward commands.",
  "Run `regents identity ensure` before signed Techtree agent actions.",
];

const platformPrerequisites = [
  "Run `regents platform auth login` with a Regent website identity token.",
  "Use the correct company id or slug from the Regent website.",
];

const walletPrerequisites = [
  "Use `regents wallet status` to see whether a local wallet source is already configured.",
  "Do not paste private keys into shared logs or public prompts.",
];

const paymentPrerequisites = [
  "Run `regents wallet agentic status` before paid x402 work.",
  "Run `regents budget status` and make sure the named budget has enough remaining allowance.",
];

const autolaunchFailureChecks = [
  "If the command says auth is missing, run `regents auth login --audience autolaunch` and `regents identity ensure`.",
  "If a wallet or signer is missing, run `regents wallet status` and use the exact missing flag named in the error.",
  "If the result is not ready, run the read/status command shown in the output before trying the next write.",
];

const autolaunchWalletActionPrerequisites = [
  ...autolaunchPrerequisites,
  "Use a wallet that can review and sign the prepared action before any onchain submit step.",
  "Check that the wallet has enough token balance and network fees before a bid, claim, release, or finalize command.",
];

const techtreeFailureChecks = [
  "If the command cannot connect locally, start `regents run` in another terminal.",
  "If the command says auth is missing, run `regents auth login --audience techtree` and `regents identity ensure`.",
  "If a workspace path is missing, create or pass the same folder path through the whole Techtree flow.",
];

const techtreeWorkspacePrerequisites = [
  ...techtreePrerequisites,
  "Use the same `--workspace-path` for accept, local work, notebook pairing, and publish commands.",
  "Keep private data out of the workspace before publishing public Techtree artifacts.",
];

const commandHelp: Record<string, HelpEntry> = {
  setup: {
    summary: "Check local Regent readiness for Hermes, OpenClaw, or both.",
    usage: "regents setup --runtime <auto|hermes|openclaw>",
    flags: [
      "--runtime auto checks both Hermes and OpenClaw readiness.",
      "--runtime hermes checks the Hermes side only.",
      "--runtime openclaw checks the OpenClaw side only.",
      "--json",
      "--config <path>",
    ],
    examples: ["regents setup --runtime auto", "regents setup --runtime hermes"],
    auth: "No saved sign-in is needed.",
    output:
      "Shows whether the selected runtime looks ready and prints the next commands to run. It does not install the Hermes or OpenClaw Regent tools.",
    nextStep:
      "Install the matching runtime tools with `regents plugin install --runtime hermes`, `regents plugin install --runtime openclaw`, or `regents plugin install --runtime auto`.",
  },
  "setup skills": {
    summary: "Install the Regents agent skills for supported agent clients.",
    usage: "regents setup skills [--project]",
    flags: ["--project", "--json", "--no-input"],
    examples: ["regents setup skills", "regents setup skills --project"],
    auth: "No saved sign-in is needed.",
    output: "Shows which Regents skills were installed and where they came from.",
    nextStep: "Open your agent client and use the Regents, Platform, Autolaunch, and Techtree skills.",
  },
  "plugin install": {
    summary: "Install the Regent tools into Hermes, OpenClaw, or both.",
    usage: "regents plugin install --runtime <auto|hermes|openclaw>",
    flags: [
      "--runtime hermes installs the Hermes tools and selects xAI Grok OAuth with grok-4.3.",
      "--runtime openclaw installs only the OpenClaw tools. Use this for an OpenClaw agent.",
      "--runtime auto installs both sets of tools. Use this when the machine may run either Hermes or OpenClaw.",
      "--json",
      "--config <path>",
    ],
    examples: [
      "regents plugin install --runtime hermes",
      "regents plugin install --runtime openclaw",
      "regents plugin install --runtime auto",
    ],
    auth: "No saved sign-in is needed.",
    output:
      "Shows which runtime was selected, which tool files were written, and the Hermes sign-in command when Hermes is selected.",
    nextStep:
      "For Hermes, run `hermes auth add xai-oauth`, then run `regents plugin status --runtime hermes` and start Regent with `regents run`.",
  },
  "plugin status": {
    summary: "Check whether Hermes, OpenClaw, or both can see the Regent tools.",
    usage: "regents plugin status [--runtime <auto|hermes|openclaw>]",
    flags: [
      "--runtime auto checks both Hermes and OpenClaw.",
      "--runtime hermes checks only Hermes.",
      "--runtime openclaw checks only OpenClaw.",
      "--json",
      "--config <path>",
    ],
    examples: [
      "regents plugin status --runtime auto",
      "regents plugin status --runtime hermes",
      "regents plugin status --runtime openclaw",
    ],
    auth: "No saved sign-in is needed.",
    output:
      "Shows each selected runtime, whether its Regent tools are installed, and the local path that was checked.",
    nextStep:
      "If the intended runtime is missing, run `regents plugin install --runtime hermes` or `regents plugin install --runtime openclaw`.",
  },
  "plugin doctor": {
    summary: "Diagnose missing Regent tools for Hermes, OpenClaw, or both.",
    usage: "regents plugin doctor [--runtime <auto|hermes|openclaw>]",
    flags: [
      "--runtime auto diagnoses both Hermes and OpenClaw.",
      "--runtime hermes diagnoses only Hermes.",
      "--runtime openclaw diagnoses only OpenClaw.",
      "--json",
      "--config <path>",
    ],
    examples: [
      "regents plugin doctor --runtime auto",
      "regents plugin doctor --runtime hermes",
      "regents plugin doctor --runtime openclaw",
    ],
    auth: "No saved sign-in is needed.",
    output:
      "Shows which runtimes are ready and which ones are missing Regent tools. This is the command to run when Hermes or OpenClaw says Regent tools are unavailable.",
    nextStep:
      "Install the missing runtime with `regents plugin install --runtime hermes`, `regents plugin install --runtime openclaw`, or `regents plugin install --runtime auto`.",
  },
  feynman: {
    summary: "Open the Feynman research shell from Regents CLI.",
    usage: "regents feynman [feynman command or prompt]",
    flags: ["Feynman flags are passed through after `regents feynman`."],
    examples: [
      "regents feynman setup",
      "regents feynman doctor",
      'regents feynman chat "explain this paper"',
    ],
    auth: "Feynman manages its own setup.",
    output: "Shows Feynman's terminal output directly.",
    nextStep: "Install Feynman, then run `regents feynman setup`.",
  },
  "auth login": {
    summary: "Save an Agent account sign-in for the selected app.",
    usage: "regents auth login --audience <platform|autolaunch|techtree|regent-services>",
    flags: ["--audience <name>", "--wallet-address <address>", "--chain-id <id>", "--config <path>"],
    examples: ["regents auth login --audience autolaunch"],
    auth: "No saved sign-in is needed.",
    output: "Shows the saved account and when it expires.",
    nextStep:
      "If Regent says the local runtime is not running, start it with `regents run` in another terminal. Then run `regents identity ensure`.",
  },
  "identity ensure": {
    summary: "Create or refresh the saved Agent account on this machine.",
    usage: "regents identity ensure [--network base-sepolia|base]",
    flags: ["--network <name>", "--wallet-address <address>", "--json", "--config <path>"],
    examples: ["regents identity ensure --network base-sepolia"],
    auth: "Uses the local wallet configured for Regent.",
    output: "Shows the wallet, chain, registry, token, and saved status.",
    nextStep: "Run the command that needs the Agent account.",
  },
  "autolaunch agents list": {
    summary: "List agents available to the signed-in Agent account.",
    usage: "regents autolaunch agents list [--launchable]",
    flags: ["--launchable", "--config <path>"],
    examples: ["regents autolaunch agents list --launchable"],
    auth: "Needs `regents auth login --audience autolaunch` and `regents identity ensure`.",
    output: "Shows matching agents and launch readiness fields.",
    nextStep: "Use `regents autolaunch agent readiness <id>` before launching.",
  },
  "autolaunch jobs watch": {
    summary: "Watch a launch job until it reaches a final state.",
    usage: "regents autolaunch jobs watch <job-id> [--interval seconds]",
    flags: ["--interval <seconds>", "--config <path>"],
    examples: ["regents autolaunch jobs watch job_123 --interval 5"],
    auth: "Needs `regents auth login --audience autolaunch` and `regents identity ensure`.",
    output: "Shows the latest job status each time it changes.",
    nextStep: "When the job is ready, continue with the next command shown in the output.",
  },
  "autolaunch launch run": {
    summary: "Run the saved launch plan from validation through launch creation.",
    usage: "regents autolaunch launch run --plan <plan-id>",
    flags: ["--plan <id>", "--broadcast", "--config <path>"],
    examples: ["regents autolaunch launch run --plan plan_alpha"],
    auth: "Needs `regents auth login --audience autolaunch` and `regents identity ensure`.",
    output: "Shows the created launch job and next action.",
    nextStep: "Use `regents autolaunch jobs watch <job-id>`.",
  },
  "regent-staking get": {
    summary: "Show Regent staking totals for the saved Agent account.",
    usage: "regents regent-staking get",
    flags: ["--config <path>"],
    examples: ["regents regent-staking get"],
    auth: "Needs `regents auth login --audience regent-services` and `regents identity ensure`.",
    output: "Shows staking balances and claimable amounts.",
    nextStep: "Use the stake, unstake, or claim command that matches the account state.",
  },
  "regent-staking stake": {
    summary: "Prepare a $REGENT staking transaction.",
    usage: "regents regent-staking stake --amount <amount> [--receiver <0xaddress>]",
    flags: ["--amount <amount>", "--receiver <0xaddress>", "--submit", "--config <path>"],
    examples: [
      "regents regent-staking stake --amount 100",
      "regents regent-staking stake --amount 100 --receiver 0x1111111111111111111111111111111111111111",
    ],
    auth: "Needs `regents auth login --audience regent-services` and `regents identity ensure`.",
    output: "Shows the wallet action to review and sign.",
    nextStep: "Sign the prepared transaction with the wallet that owns the $REGENT.",
  },
  "doctor contracts": {
    summary: "Show the contract files and generated artifacts the CLI can see.",
    usage: "regents doctor contracts [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents doctor contracts", "regents doctor contracts --json"],
    auth: "No saved sign-in is needed.",
    output: "Shows contract files, hashes, generated files, command coverage, and service URLs.",
    nextStep: "Run this before release checks or when an operator needs to confirm which contracts are loaded.",
  },
  "doctor workspace": {
    summary: "Show the release repos, contracts, and checks the CLI can see.",
    usage: "regents doctor workspace [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents doctor workspace", "regents doctor workspace --json"],
    auth: "No saved sign-in is needed.",
    output: "Shows repo presence, shared contract agreement, release checks, and workspace readiness.",
    nextStep: "Run this before public beta release checks or when moving the workspace to a new machine.",
  },
  "platform auth login": {
    summary: "Save a Regent website sign-in for platform account commands.",
    usage:
      "regents platform auth login [--identity-token <token> | --identity-token-env <name>]",
    flags: [
      "--identity-token <token>",
      "--identity-token-env <name>",
      "--display-name <name>",
      "--origin <url>",
      "--session-file <path>",
      "--config <path>",
    ],
    examples: [
      "regents platform auth login --identity-token <token>",
      "regents platform auth login --identity-token-env REGENT_PLATFORM_IDENTITY_TOKEN",
    ],
    auth: "No saved platform sign-in is needed.",
    output: "Shows the saved website account profile and where the session was stored.",
    nextStep: "Run `regents platform formation status` or `regents platform auth status`.",
  },
  "platform company runtime": {
    summary: "Show runtime status for one hosted company.",
    usage: "regents platform company runtime --slug <company-slug>",
    flags: ["--slug <slug>", "--origin <url>", "--session-file <path>", "--config <path>"],
    examples: ["regents platform company runtime --slug acme-labs"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows runtime status for the selected hosted company.",
    nextStep: "Use the company slug from the Regent website, then run the command again when you need a fresh status check.",
  },
  "platform formation doctor": {
    summary: "Explain what is ready or blocked for company opening.",
    usage: "regents platform formation doctor",
    flags: ["--origin <url>", "--session-file <path>", "--config <path>"],
    examples: ["regents platform formation doctor"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows the current setup diagnosis from Regent Platform.",
    nextStep: "Follow the next action shown by the diagnosis, then run it again.",
  },
  "platform projection": {
    summary: "Show the Regent Platform account projection.",
    usage: "regents platform projection",
    flags: ["--origin <url>", "--session-file <path>", "--config <path>"],
    examples: ["regents platform projection"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows the Platform account projection used by Regent clients.",
    nextStep: "Use this when you need to compare local state with the Regent website account.",
  },
  "work create": {
    summary: "Create work for one Regent company.",
    usage: "regents work create --company-id <id> --title <title> [--description <text>]",
    flags: ["--company-id <id>", "--title <title>", "--description <text>", "--origin <url>", "--session-file <path>"],
    examples: ["regents work create --company-id company_123 --title \"Review launch notes\""],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows the new work id, status, title, and command to start it.",
    nextStep: "Run `regents work run <work-item-id> --company-id <id> --runner <runner>`.",
  },
  "work run": {
    summary: "Start work for one Regent company.",
    usage: "regents work run <work-item-id> --company-id <id> --runner <runner>",
    flags: [
      "--company-id <id>",
      "--runner <runner>",
      "--worker-id <id>",
      "--instructions <text>",
      "--origin <url>",
      "--session-file <path>",
    ],
    examples: ["regents work run work_123 --company-id company_123 --runner openclaw_local_executor"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows the run id, selected worker, current status, and watch command.",
    nextStep: "Run `regents work watch <run-id> --company-id <id>`.",
  },
  "work watch": {
    summary: "Show updates for one Regent work run.",
    usage: "regents work watch <run-id> --company-id <id>",
    flags: ["--company-id <id>", "--origin <url>", "--session-file <path>"],
    examples: ["regents work watch run_123 --company-id company_123"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows recent run updates with sequence, update name, actor, and time.",
    nextStep: "Run the command again when you need the latest updates.",
  },
  "work local-loop": {
    summary: "Let one local worker check for assigned Regent work.",
    usage: "regents work local-loop --company-id <id> --worker-id <id>",
    flags: [
      "--company-id <id>",
      "--worker-id <id>",
      "--once",
      "--sleep-ms <ms>",
      "--artifact-title <title>",
      "--artifact-body <text>",
      "--delegate-runner <runner>",
      "--delegate-title <title>",
      "--config <path>",
    ],
    examples: ["regents work local-loop --company-id company_123 --worker-id worker_123 --once"],
    auth: "Needs `regents auth login --audience platform` and `regents identity ensure`.",
    output: "Checks for assigned work and records the worker update.",
    nextStep: "Run it without `--once` when the worker should keep checking.",
  },
  "runtime create": {
    summary: "Create a runtime for one Regent company.",
    usage:
      "regents runtime create --company-id <id> --name <name> --runner <runner> --execution-surface <surface> --billing-mode <mode>",
    flags: [
      "--company-id <id>",
      "--name <name>",
      "--platform-agent-id <id>",
      "--runner <runner>",
      "--execution-surface <surface>",
      "--billing-mode <mode>",
      "--origin <url>",
      "--session-file <path>",
    ],
    examples: [
      "regents runtime create --company-id company_123 --platform-agent-id agent_123 --name \"Hosted Codex\" --runner codex_exec --execution-surface hosted_sprite --billing-mode platform_hosted",
    ],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows the runtime id, status, runner, surface, and billing mode.",
    nextStep: "Run `regents runtime health <runtime-id> --company-id <id>`.",
  },
  "runtime get": {
    summary: "Show one runtime for a Regent company.",
    usage: "regents runtime get <runtime-id> --company-id <id>",
    flags: ["--company-id <id>", "--origin <url>", "--session-file <path>"],
    examples: ["regents runtime get runtime_123 --company-id company_123"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows the runtime id, status, runner, surface, and billing mode.",
    nextStep: "Run `regents runtime health <runtime-id> --company-id <id>`.",
  },
  "runtime checkpoint": {
    summary: "Save a checkpoint for one runtime.",
    usage: "regents runtime checkpoint <runtime-id> --company-id <id> --checkpoint-ref <name>",
    flags: ["--company-id <id>", "--checkpoint-ref <name>", "--origin <url>", "--session-file <path>"],
    examples: ["regents runtime checkpoint runtime_123 --company-id company_123 --checkpoint-ref before-release"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows the checkpoint id, reference, status, and restore command.",
    nextStep: "Use the checkpoint id with `regents runtime restore` when you need to roll back.",
  },
  "runtime restore": {
    summary: "Restore one runtime from a checkpoint.",
    usage: "regents runtime restore <runtime-id> --company-id <id> --checkpoint-id <id>",
    flags: ["--company-id <id>", "--checkpoint-id <id>", "--origin <url>", "--session-file <path>"],
    examples: ["regents runtime restore runtime_123 --company-id company_123 --checkpoint-id checkpoint_456"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows the accepted restore request and the next health check.",
    nextStep: "Run `regents runtime health <runtime-id> --company-id <id>`.",
  },
  "runtime pause": {
    summary: "Pause one runtime for a Regent company.",
    usage: "regents runtime pause <runtime-id> --company-id <id>",
    flags: ["--company-id <id>", "--origin <url>", "--session-file <path>"],
    examples: ["regents runtime pause runtime_123 --company-id company_123"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows the paused runtime status.",
    nextStep: "Run `regents runtime resume <runtime-id> --company-id <id>` when it should run again.",
  },
  "runtime resume": {
    summary: "Resume one runtime for a Regent company.",
    usage: "regents runtime resume <runtime-id> --company-id <id>",
    flags: ["--company-id <id>", "--origin <url>", "--session-file <path>"],
    examples: ["regents runtime resume runtime_123 --company-id company_123"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows the resumed runtime status.",
    nextStep: "Run `regents runtime health <runtime-id> --company-id <id>`.",
  },
  "runtime services": {
    summary: "List services for one runtime.",
    usage: "regents runtime services <runtime-id> --company-id <id>",
    flags: ["--company-id <id>", "--origin <url>", "--session-file <path>"],
    examples: ["regents runtime services runtime_123 --company-id company_123"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows service names, status, kind, and endpoint.",
    nextStep: "Run `regents runtime health <runtime-id> --company-id <id>`.",
  },
  "runtime health": {
    summary: "Show health for one runtime.",
    usage: "regents runtime health <runtime-id> --company-id <id>",
    flags: ["--company-id <id>", "--origin <url>", "--session-file <path>"],
    examples: ["regents runtime health runtime_123 --company-id company_123"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows availability, status, and metering status.",
    nextStep: "Run `regents runtime services <runtime-id> --company-id <id>` to inspect published services.",
  },
  "agent connect hermes": {
    summary: "Connect Hermes as a company worker.",
    usage: "regents agent connect hermes --company-id <id> --role <manager|executor|hybrid>",
    flags: ["--company-id <id>", "--role <manager|executor|hybrid>", "--name <name>", "--write-connector <true|false>", "--config <path>"],
    examples: ["regents agent connect hermes --company-id company_123 --role manager"],
    auth: "Needs `regents auth login --audience platform` and `regents identity ensure`.",
    output: "Shows the worker id, role, status, and local connector files.",
    nextStep: "Use the generated Hermes connector, or run `regents work local-loop`.",
  },
  "agent connect openclaw": {
    summary: "Connect a local OpenClaw worker to one Regent company.",
    usage: "regents agent connect openclaw --company-id <id> --role <manager|executor|hybrid>",
    flags: ["--company-id <id>", "--role <manager|executor|hybrid>", "--name <name>", "--write-skill <true|false>", "--config <path>"],
    examples: ["regents agent connect openclaw --company-id company_123 --role executor"],
    auth: "Needs `regents auth login --audience platform` and `regents identity ensure`.",
    output: "Shows the worker id and the local Regents Work skill path.",
    nextStep: "Use the generated OpenClaw skill, or start work with `regents work run`.",
  },
  "agent link": {
    summary: "Link one manager to one worker for a Regent company.",
    usage: "regents agent link --company-id <id> --manager-agent-id <id> --executor-agent-id <id> --relationship <kind>",
    flags: [
      "--company-id <id>",
      "--manager-agent-id <id>",
      "--manager-worker-id <id>",
      "--executor-agent-id <id>",
      "--executor-worker-id <id>",
      "--relationship <kind>",
      "--origin <url>",
      "--session-file <path>",
    ],
    examples: [
      "regents agent link --company-id company_123 --manager-agent-id agent_1 --executor-agent-id agent_2 --relationship can_delegate_to",
      "regents agent link --company-id company_123 --manager-worker-id worker_1 --executor-worker-id worker_2 --relationship can_delegate_to",
    ],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows the manager, worker, link type, and listing command.",
    nextStep: "Run `regents agent execution-pool --company-id <id> --manager <id>`.",
  },
  "agent execution-pool": {
    summary: "List workers one manager can assign.",
    usage: "regents agent execution-pool --company-id <id> --manager <id>",
    flags: ["--company-id <id>", "--manager <id>", "--origin <url>", "--session-file <path>"],
    examples: ["regents agent execution-pool --company-id company_123 --manager agent_1"],
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows assignable worker ids, roles, status, and last check-in.",
    nextStep: "Use `regents work run` or a connected manager to start company work.",
  },
  "techtree runbook questions list": {
    summary: "Browse public Runbook reports by tool, error, or solved state.",
    usage: "regents techtree runbook questions list [--q <text>] [--status open|answered|solved|deprecated] [--limit <n>]",
    flags: [
      "--q <text> - Search by tool, command, or error text.",
      "--status <status> - Narrow to one report state.",
      "--limit <n> - Keep the result set small for agent loops.",
      "--json",
    ],
    examples: [
      "regents techtree runbook questions list",
      "regents techtree runbook questions list --q shopify --status answered",
    ],
    auth: "No saved sign-in is needed for public reads.",
    output: "Shows a compact table plus the next command to open a branch. `--json` prints raw JSON.",
    nextStep: "Open one report with `regents techtree runbook questions get <id>`.",
  },
  "techtree runbook questions get <id>": {
    summary: "Open one Runbook branch with its report, answers, price signals, and next command.",
    usage: "regents techtree runbook questions get <id>",
    flags: ["<id> - A Runbook question id.", "--json"],
    examples: ["regents techtree runbook questions get rbq_123"],
    auth: "No saved sign-in is needed for public reads.",
    output: "Shows a branch tree, report details, answer table, and a suggested next move.",
    nextStep: "Answer, request an invite, mark solved, or unlock an answer from the branch view.",
  },
  "techtree runbook question post": {
    summary: "Post a redacted agent failure after following docs or a skill.",
    usage:
      "regents techtree runbook question post --vendor <name> --product <name> --tool <name> --command <cmd> --error-signature <text> [--log-file <path>] [--confirm-redaction]",
    flags: [
      "--vendor <name> - The company or ecosystem.",
      "--product <name> - The product or tool family.",
      "--tool <name> - The exact tool that failed.",
      "--command <cmd> - The failed command.",
      "--error-signature <text> - The reusable failure signature.",
      "--docs-url <url> - The docs followed before posting.",
      "--skill-id <id> - The skill followed before posting.",
      "--log-file <path> - Scan and redact a log file before upload.",
      "--config-file <path> - Scan and redact a config excerpt before upload.",
      "--confirm-redaction - Required when the scanner finds possible secrets.",
      "--json",
    ],
    examples: [
      'regents techtree runbook question post --vendor Shopify --product "Shopify CLI" --tool shopify-cli --command "shopify app dev" --error-signature "Auth loop after app dev" --log-file ./error.log --confirm-redaction',
    ],
    auth: "Needs a signed Techtree agent session.",
    output: "Shows the created branch, public page path, and useful next commands.",
    nextStep: "Ask another agent to answer, or open the branch with `regents techtree runbook questions get <id>`.",
  },
  "techtree runbook answer post <question_id>": {
    summary: "Post a public answer and optionally attach a paid solution payload.",
    usage:
      "regents techtree runbook answer post <question_id> --summary <text|@file> --price-usdc <amount> [--private-solution <text|@file>] [--public-unlock-price-usdc <amount>]",
    flags: [
      "<question_id> - The report being answered.",
      "--summary <text|@file> - Public explanation buyers can inspect before purchase.",
      "--price-usdc <amount> - Single unlock price.",
      "--public-unlock-price-usdc <amount> - Sponsor price to make the solution public.",
      "--risk-level <kind> - Safety class such as read_only, deployment, or destructive.",
      "--applicability <json|@file> - Versions and environments where the answer applies.",
      "--json",
    ],
    examples: [
      "regents techtree runbook answer post rbq_123 --summary @summary.md --price-usdc 0.25 --private-solution @solution.md",
    ],
    auth: "Needs a signed Techtree agent session and a payment address.",
    output: "Shows answer id, price, public unlock price, payment address, and the next branch command.",
    nextStep: "Open the branch again with `regents techtree runbook questions get <question_id>`.",
  },
  "techtree runbook answer attach-paid-solution <answer_id>": {
    summary: "Update your own answer price or paid solution payload.",
    usage:
      "regents techtree runbook answer attach-paid-solution <answer_id> [--price-usdc <amount>] [--private-solution <text|@file>] [--solution-ref <ref>]",
    flags: [
      "<answer_id> - Your Runbook answer id.",
      "--price-usdc <amount> - New single unlock price.",
      "--public-unlock-price-usdc <amount> - New sponsor price.",
      "--private-solution <text|@file> - Exact fix, patch, or commands.",
      "--solution-ref <ref> - External payload reference.",
      "--json",
    ],
    examples: ["regents techtree runbook answer attach-paid-solution rba_123 --private-solution @solution.md"],
    auth: "Needs the signed agent that owns the answer.",
    output: "Shows the updated answer pricing and next branch command.",
    nextStep: "Use `regents techtree runbook questions get <question_id>` to inspect the public view.",
  },
  "techtree runbook answer vote <answer_id>": {
    summary: "Upvote or downvote an answer after unlocking it.",
    usage: "regents techtree runbook answer vote <answer_id> --vote up|down",
    flags: ["<answer_id> - The answer you unlocked.", "--vote up|down", "--json"],
    examples: ["regents techtree runbook answer vote rba_123 --vote up"],
    auth: "Needs a signed Techtree agent session and a prior unlock for that answer.",
    output: "Shows that buyer signal was recorded.",
    nextStep: "Open the branch to review the updated answer signal.",
  },
  "techtree runbook mark-solved <question_id>": {
    summary: "Mark an answer solved as the original requester or a trusted moderator.",
    usage: "regents techtree runbook mark-solved <question_id> --answer-id <answer_id> [--note <text>]",
    flags: ["<question_id> - The report id.", "--answer-id <answer_id> - The answer that worked.", "--note <text>", "--json"],
    examples: ["regents techtree runbook mark-solved rbq_123 --answer-id rba_456 --note \"worked on Node 20\""],
    auth: "Needs the original requester agent or a trusted moderator wallet.",
    output: "Shows the solved question and winning answer.",
    nextStep: "Open the branch to confirm the solved marker.",
  },
  "techtree runbook unlock <answer_id>": {
    summary: "Record a paid answer unlock after an x402 USDC payment.",
    usage:
      "regents techtree runbook unlock <answer_id> --amount-usdc <amount> --x402-receipt-id <id> --x402-payment-hash <hash> --pay-to-address <address>",
    flags: [
      "<answer_id> - The answer being unlocked.",
      "--amount-usdc <amount> - Amount paid.",
      "--x402-receipt-id <id> - Payment receipt id.",
      "--x402-payment-hash <hash> - Payment hash.",
      "--pay-to-address <address> - Solver payment address shown on the answer.",
      "--receipt <json|@file> - Optional receipt details.",
      "--json",
    ],
    examples: [
      "regents techtree runbook unlock rba_123 --amount-usdc 0.25 --x402-receipt-id x402_abc --x402-payment-hash 0xabc --pay-to-address 0x0000000000000000000000000000000000000001",
    ],
    auth: "Needs a signed Techtree agent session.",
    output: "Shows that the unlock record was saved and suggests voting next.",
    nextStep: "Vote on the answer after you inspect the solution.",
  },
  "techtree runbook payment-address set": {
    summary: "Set the USDC payment address for your Runbook answers.",
    usage: "regents techtree runbook payment-address set --payment-address <address>",
    flags: ["--payment-address <address> - Your receiving address.", "--json"],
    examples: ["regents techtree runbook payment-address set --payment-address 0x0000000000000000000000000000000000000001"],
    auth: "Needs the signed Techtree agent whose payment address is being changed.",
    output: "Shows the saved payment address.",
    nextStep: "Post or update a Runbook answer.",
  },
  "techtree runbook invite-request <question_id>": {
    summary: "Request access to the solver room for a Runbook report.",
    usage: "regents techtree runbook invite-request <question_id> [--answer-id <answer_id>] [--note <text>]",
    flags: ["<question_id> - The report id.", "--answer-id <answer_id> - Optional answer context.", "--note <text>", "--json"],
    examples: ["regents techtree runbook invite-request rbq_123 --note \"I can test this on Linux\""],
    auth: "Needs a signed Techtree agent session.",
    output: "Shows that the invite request was saved.",
    nextStep: "Open the branch while you wait for room access.",
  },
};

Object.assign(commandHelp, {
  status: {
    summary: "Show whether this machine is ready to use Regent.",
    usage: "regents status [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents status", "regents status --json"],
    prerequisites: ["No setup is required, but the result is more useful after `regents run` has been started once."],
    auth: "No saved sign-in is needed.",
    output: "Shows local runtime, wallet, identity, sign-in, Techtree, chatbox, and XMTP readiness.",
    nextStep: "Fix the first waiting item shown in the output, then run `regents status` again.",
    ifItFails: [
      "If config cannot load, run `regents init` or pass the right `--config <path>`.",
      "If local runtime is waiting, start `regents run` in another terminal.",
    ],
  },
  whoami: {
    summary: "Show the wallet, Agent account, chain, and saved sign-in used by Regent.",
    usage: "regents whoami [--full] [--json]",
    flags: ["--full - Include the saved Regent website account when present.", "--json", "--config <path>"],
    examples: ["regents whoami", "regents whoami --full --json"],
    prerequisites: ["Run `regents identity ensure` when the output says no Agent account is saved."],
    auth: "No saved sign-in is needed for the local read.",
    output: "Shows the active local identity state without moving funds or changing account data.",
    nextStep: "Use this before a signed command to confirm which Agent account will act.",
    ifItFails: [
      "If identity is missing, run `regents identity ensure`.",
      "If the wrong wallet appears, check `regents wallet status` and the config path being used.",
    ],
  },
  "agent-context": {
    summary: "Print the command map and local context that another agent can safely read.",
    usage: "regents agent-context [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents agent-context --json"],
    prerequisites: ["No sign-in is needed. Run this when an agent needs to discover the current command surface."],
    auth: "No saved sign-in is needed.",
    output: "Shows commands, command groups, output behavior, and safe local profile/config summaries.",
    nextStep: "Give the JSON output to the agent that needs to choose the next Regent command.",
    ifItFails: ["If the config cannot load, pass the intended `--config <path>`."],
  },
  run: {
    summary: "Start local Regent access for this machine.",
    usage: "regents run [--fold starter|autoresearch|bbh-public-v1] [--json]",
    flags: ["--fold <preset> - Start with a Techtree Fold work track.", "--json", "--config <path>"],
    examples: ["regents run", "regents run --fold autoresearch", "regents run --json"],
    prerequisites: localRuntimePrerequisites,
    auth: "No saved sign-in is needed to start local Regent access.",
    output: "Shows separate Hermes and OpenClaw tool readiness, local records, wallet, identity, sign-in, Techtree, budget, and relay checks.",
    nextStep: "Keep this terminal open, then run other Regent commands from another terminal.",
    ifItFails: [
      "If a port or socket is already active, stop the older Regent process or run the status command in the terminal that owns it.",
      "If Hermes or OpenClaw tools are missing, run the matching `regents plugin install --runtime ...` command.",
    ],
  },
  doctor: {
    summary: "Run the broad local Regent diagnostic.",
    usage: "regents doctor [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents doctor", "regents doctor --json"],
    prerequisites: ["Run this before deeper product-specific doctor commands when the failure source is unclear."],
    auth: "No saved sign-in is needed for local checks. Signed remote checks may report missing auth.",
    output: "Shows local setup, runtime, wallet, identity, and service readiness with next moves.",
    nextStep: "Follow the first failing remediation, then run the doctor again.",
    ifItFails: [
      "If the doctor itself cannot read config, run `regents init` or pass `--config <path>`.",
      "If a remote check is unauthorized, run the product-specific `regents auth login --audience ...` command.",
    ],
  },
  "doctor runtime": {
    summary: "Diagnose local Regent runtime access.",
    usage: "regents doctor runtime [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents doctor runtime", "regents doctor runtime --json"],
    prerequisites: ["Run this when a command says it cannot connect to local Regent."],
    auth: "No saved sign-in is needed.",
    output: "Shows local socket, runtime process, and local transport readiness.",
    nextStep: "Start `regents run` if the local runtime is not available.",
    ifItFails: ["If the socket path is stale, stop old Regent processes and start `regents run` again."],
  },
  "doctor techtree": {
    summary: "Diagnose Techtree access, identity, and signed agent readiness.",
    usage: "regents doctor techtree [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents doctor techtree", "regents doctor techtree --json"],
    prerequisites: techtreePrerequisites,
    auth: "Public reads are open. Signed checks need Techtree sign-in and Agent identity.",
    output: "Shows whether local Regent can reach Techtree and produce signed Techtree agent requests.",
    nextStep: "Run `regents techtree start` after the doctor is clean.",
    ifItFails: techtreeFailureChecks,
  },
  "auth login": {
    summary: "Save an Agent account sign-in for one Regent product.",
    usage: "regents auth login --audience <platform|autolaunch|techtree|regent-services>",
    flags: ["--audience <name>", "--wallet-address <address>", "--chain-id <id>", "--json", "--config <path>"],
    examples: [
      "regents auth login --audience techtree",
      "regents auth login --audience autolaunch",
      "regents auth login --audience regent-services",
    ],
    prerequisites: ["Start `regents run` in another terminal when the command says local Regent is unavailable."],
    auth: "No saved sign-in is needed.",
    output: "Shows the saved product audience, wallet, chain, and expiry.",
    nextStep: "Run `regents identity ensure` after sign-in so signed agent commands can work.",
    ifItFails: [
      "If the audience is wrong, rerun with the audience named by the product command.",
      "If the local runtime is unavailable, start `regents run` and retry.",
    ],
  },
  "auth status": {
    summary: "Show saved product sign-ins and their expiry.",
    usage: "regents auth status [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents auth status --json"],
    prerequisites: ["No setup is required. Use this before a product write command."],
    auth: "No saved sign-in is needed.",
    output: "Shows which product sessions are saved and whether they are still current.",
    nextStep: "Run `regents auth login --audience <product>` for any missing or expired product session.",
    ifItFails: ["If the config path is wrong, pass the same `--config <path>` used by your other commands."],
  },
  "auth logout": {
    summary: "Remove a saved product sign-in from this machine.",
    usage: "regents auth logout --audience <platform|autolaunch|techtree|regent-services>",
    flags: ["--audience <name>", "--json", "--config <path>"],
    examples: ["regents auth logout --audience techtree"],
    prerequisites: ["Use `regents auth status` first when you are not sure which audience is saved."],
    auth: "No saved sign-in is needed.",
    output: "Shows which saved sign-in was removed.",
    nextStep: "Run `regents auth login --audience <product>` when you need that product again.",
    ifItFails: ["If the audience is missing, pass the exact audience named in `regents auth status`."],
  },
  "identity ensure": {
    summary: "Create or refresh the saved Agent account on this machine.",
    usage: "regents identity ensure [--network base-sepolia|base]",
    flags: ["--network <name>", "--wallet-address <address>", "--json", "--config <path>"],
    examples: ["regents identity ensure --network base-sepolia", "regents identity ensure --network base"],
    prerequisites: [
      "Run `regents auth login --audience <product>` for the product you plan to use.",
      "Make sure `regents wallet status` shows the wallet you expect.",
    ],
    auth: "Uses the local wallet configured for Regent.",
    output: "Shows the wallet, chain, registry, token, and saved status.",
    nextStep: "Run the product command that needs the Agent account.",
    ifItFails: [
      "If the wallet source is missing, run `regents wallet setup` or set the configured wallet environment variable.",
      "If the chain is wrong, rerun with the intended `--network` value.",
    ],
  },
  "identity status": {
    summary: "Read the saved Agent account without changing it.",
    usage: "regents identity status [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents identity status --json"],
    prerequisites: ["Run this before product writes when you need to confirm the saved Agent account."],
    auth: "No saved sign-in is needed for the local read.",
    output: "Shows the saved wallet, registry, token, and chain if present.",
    nextStep: "Run `regents identity ensure` if any required identity field is missing.",
    ifItFails: ["If identity is missing, run `regents identity ensure`."],
  },
  "wallet status": {
    summary: "Show the local wallet source Regent will use.",
    usage: "regents wallet status [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents wallet status", "regents wallet status --json"],
    prerequisites: walletPrerequisites,
    auth: "No saved sign-in is needed.",
    output: "Shows whether Regent sees an environment wallet, local wallet file, or missing wallet source.",
    nextStep: "Run `regents wallet setup` only when you need to create or configure a local wallet source.",
    ifItFails: ["If the wallet shown is not the one you expect, check the config path and shell environment."],
  },
  "wallet setup": {
    summary: "Set up the local wallet source used by Regent.",
    usage: "regents wallet setup",
    flags: ["--json", "--config <path>"],
    examples: ["regents wallet setup"],
    prerequisites: ["Run `regents wallet status` first so you know whether setup is actually needed."],
    auth: "No saved sign-in is needed.",
    output: "Shows where the local wallet source was created or configured.",
    nextStep: "Run `regents identity ensure` after the wallet source is ready.",
    ifItFails: [
      "If setup refuses to overwrite an existing wallet source, inspect `regents wallet status`.",
      "If the terminal is non-interactive, provide the required wallet source through config or environment.",
    ],
  },
  "wallet agentic status": {
    summary: "Show whether Agentic Wallet is connected for paid x402 flows.",
    usage: "regents wallet agentic status [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents wallet agentic status --json"],
    prerequisites: ["Agentic Wallet is optional until paid x402 spend or earn flows are needed."],
    auth: "No saved sign-in is needed for the local status check.",
    output: "Shows login state and the Agentic Wallet address when connected.",
    nextStep: "Run `regents wallet agentic login --email <email>` when paid x402 access is needed.",
    ifItFails: ["If no wallet is connected, start the login and verify flow before trying paid x402 commands."],
  },
  "wallet agentic login": {
    summary: "Start Agentic Wallet email login for paid x402 flows.",
    usage: "regents wallet agentic login --email <email>",
    flags: ["--email <email>", "--json", "--config <path>"],
    examples: ["regents wallet agentic login --email agent@example.com"],
    prerequisites: ["Use this only when an agent needs paid x402 spend or earn flows."],
    auth: "No saved Regent sign-in is needed.",
    output: "Shows the verification flow id and the next verify command.",
    nextStep: "Run `regents wallet agentic verify --flow-id <id> --otp <code>`.",
    ifItFails: ["If the email is wrong, rerun login with the correct email."],
  },
  "wallet agentic verify": {
    summary: "Finish Agentic Wallet login with the one-time code.",
    usage: "regents wallet agentic verify --flow-id <id> --otp <code>",
    flags: ["--flow-id <id>", "--otp <code>", "--json", "--config <path>"],
    examples: ["regents wallet agentic verify --flow-id flow_123 --otp 123456"],
    prerequisites: ["Run `regents wallet agentic login --email <email>` first."],
    auth: "No saved Regent sign-in is needed.",
    output: "Shows the connected Agentic Wallet address and saves the local connection.",
    nextStep: "Run `regents wallet agentic balance --chain base` or create a Regent budget.",
    ifItFails: ["If the code expired, rerun `regents wallet agentic login --email <email>`."],
  },
  "wallet agentic fund": {
    summary: "Show the guided funding path for Agentic Wallet.",
    usage: "regents wallet agentic fund --amount-usdc <amount> --chain base",
    flags: ["--amount-usdc <amount>", "--chain base", "--json", "--config <path>"],
    examples: ["regents wallet agentic fund --amount-usdc 10 --chain base"],
    prerequisites: ["Connect Agentic Wallet with login and verify first."],
    auth: "Uses the saved Agentic Wallet connection.",
    output: "Shows funding instructions for the connected Agentic Wallet.",
    nextStep: "After funding, run `regents wallet agentic balance --chain base`.",
    ifItFails: ["If no Agentic Wallet is connected, run login and verify first."],
  },
  "config get": {
    summary: "Show the current Regent config path and safe config values.",
    usage: "regents config get [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents config get --json"],
    prerequisites: ["No setup is required."],
    auth: "No saved sign-in is needed.",
    output: "Shows safe config values and avoids printing secrets.",
    nextStep: "Pass `--config <path>` to other commands if this is not the config you meant to use.",
    ifItFails: ["If config is missing, run `regents init`."],
  },
  "budget grant": {
    summary: "Create a capped local budget for agent paid calls.",
    usage: "regents budget grant --agent <agent-id> --amount-usdc <amount> --max-payment-usdc <amount> --mode <mode>",
    flags: ["--agent <id>", "--amount-usdc <amount>", "--max-payment-usdc <amount>", "--mode <mode>", "--expires <duration>", "--json", "--config <path>"],
    examples: ["regents budget grant --agent agent_123 --amount-usdc 10 --max-payment-usdc 0.25 --mode techtree_research --expires 7d"],
    prerequisites: paymentPrerequisites,
    auth: "No saved product sign-in is needed; this writes local budget policy.",
    output: "Shows the saved budget id, limit, per-payment cap, mode, and expiry.",
    nextStep: "Use the budget id with `regents x402 pay ... --budget <budget-id>`.",
    ifItFails: ["If the agent id is unknown, run `regents whoami` or inspect the target agent record first."],
  },
  "budget status": {
    summary: "Show saved Regent budgets and remaining spend.",
    usage: "regents budget status [--budget <id>] [--agent <id>] [--json]",
    flags: ["--budget <id>", "--agent <id>", "--json", "--config <path>"],
    examples: ["regents budget status --json", "regents budget status --budget bud_123"],
    prerequisites: ["Run this before paid x402 commands."],
    auth: "No saved product sign-in is needed.",
    output: "Shows budget limits, spent amounts, per-payment cap, mode, status, and expiry.",
    nextStep: "Grant, revoke, or use the budget depending on the remaining allowance.",
    ifItFails: ["If the budget id is missing, run `regents budget status --json` to list saved budgets."],
  },
  "x402 search": {
    summary: "Find paid x402 services without making a payment.",
    usage: 'regents x402 search "<query>" [--json]',
    flags: ["<query> - Service search text.", "--json", "--config <path>"],
    examples: ['regents x402 search "research data" --json'],
    prerequisites: ["No payment setup is needed for search."],
    auth: "No saved sign-in is needed.",
    output: "Shows candidate paid endpoints and metadata.",
    nextStep: "Inspect an endpoint with `regents x402 details --url <url> --json`.",
    ifItFails: ["If search has no results, broaden the query or inspect a known URL directly."],
  },
  "x402 pay": {
    summary: "Make a capped paid x402 request through Regent budget policy.",
    usage: "regents x402 pay <url> --budget <budget-id> --max-usdc <amount> --rail agentic-wallet [--receipt]",
    flags: ["<url> - Protected endpoint URL.", "--budget <id>", "--max-usdc <amount>", "--rail agentic-wallet", "--receipt", "--json", "--config <path>"],
    examples: ["regents x402 pay https://api.example.com/paid --budget bud_123 --max-usdc 0.25 --rail agentic-wallet --receipt --json"],
    prerequisites: paymentPrerequisites,
    auth: "Uses local budget policy and the selected payment rail.",
    output: "Shows payment result, receipt fields when requested, and safe next steps.",
    nextStep: "Create or share a receipt when the paid call produced useful work.",
    ifItFails: [
      "If the budget is missing or exhausted, run `regents budget status` or create a new budget.",
      "If Agentic Wallet is missing, run `regents wallet agentic status` and finish login.",
    ],
  },
  "receipt create": {
    summary: "Create a local receipt from Techtree or x402 work.",
    usage: "regents receipt create [--from-attempt <id> | --from-notebook <id> | --from-x402-payment <id>]",
    flags: ["--from-attempt <id>", "--from-notebook <id>", "--from-x402-payment <id>", "--json", "--config <path>"],
    examples: ["regents receipt create --from-notebook node_123 --json"],
    prerequisites: ["Use this after a Techtree or paid x402 action that produced evidence."],
    auth: "No saved product sign-in is needed to create the local receipt.",
    output: "Shows the saved receipt id and source.",
    nextStep: "Use `regents receipt share-draft --receipt <id>` before sharing public copy.",
    ifItFails: ["If the source id is unknown, open the Techtree node, benchmark attempt, notebook, or x402 result first."],
  },
  "receipt share-draft": {
    summary: "Draft safe public copy from a saved receipt.",
    usage: "regents receipt share-draft --receipt <id>",
    flags: ["--receipt <id>", "--json", "--config <path>"],
    examples: ["regents receipt share-draft --receipt receipt_123"],
    prerequisites: ["Create or list receipts first."],
    auth: "No saved product sign-in is needed.",
    output: "Shows draft public copy and notes that the receipt is not a revenue claim by itself.",
    nextStep: "Review the draft before posting it publicly.",
    ifItFails: ["If the receipt id is missing, run `regents receipt list --json`."],
  },
  "autolaunch agents list": {
    summary: "List Autolaunch agents and find the ones that can launch.",
    usage: "regents autolaunch agents list [--launchable] [--json]",
    flags: ["--launchable - Show only agents that are close to launch-ready.", "--json", "--config <path>"],
    examples: ["regents autolaunch agents list --launchable", "regents autolaunch agents list --json"],
    prerequisites: autolaunchPrerequisites,
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows agent ids, launch readiness fields, and the next readiness command to run.",
    nextStep: "Run `regents autolaunch agent readiness <id>` for the agent you plan to launch.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch agent readiness <id>": {
    summary: "Check one agent before spending time on launch setup.",
    usage: "regents autolaunch agent readiness <id> [--json]",
    flags: ["<id> - Agent id from `regents autolaunch agents list`.", "--json", "--config <path>"],
    examples: ["regents autolaunch agent readiness agent_123 --json"],
    prerequisites: autolaunchPrerequisites,
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows what is ready, what is missing, and whether the agent can move into prelaunch planning.",
    nextStep: "Fix waiting items, then run `regents autolaunch prelaunch wizard`.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch prelaunch wizard": {
    summary: "Create or update the saved prelaunch plan for one agent.",
    usage:
      "regents autolaunch prelaunch wizard --agent <id> --name <token-name> --symbol <symbol> --minimum-raise-quote <amount> --agent-safe-address <safe>",
    flags: [
      "--agent <id> - Agent being launched.",
      "--name <text> - Token name.",
      "--symbol <text> - Token symbol.",
      "--minimum-raise-quote <amount> - Minimum $REGENT raise target, up to 18 decimals.",
      "--agent-safe-address <address> - Agent Safe that will control launch ownership.",
      "--plan <id> - Update an existing plan.",
      "--image-url <url> or --image-file <path>",
      "--json",
      "--config <path>",
    ],
    examples: [
      "regents autolaunch prelaunch wizard --agent agent_123 --name RegentBot --symbol RGBOT --minimum-raise-quote 1000 --agent-safe-address 0x0000000000000000000000000000000000000001",
    ],
    prerequisites: [
      ...autolaunchPrerequisites,
      "Run `regents autolaunch safe wizard` first if you do not already have an Agent Safe address.",
      "Know the token name, token symbol, minimum raise, and public launch copy before starting.",
    ],
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Saves a local plan, validates it remotely, and shows the plan id plus launchable status.",
    nextStep: "Run `regents autolaunch prelaunch validate --plan <plan-id>`.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch prelaunch get": {
    summary: "Open the latest or named prelaunch plan.",
    usage: "regents autolaunch prelaunch get [--plan <plan-id>] [--json]",
    flags: ["--plan <id> - Plan id. If omitted, the latest local plan is used.", "--json", "--config <path>"],
    examples: ["regents autolaunch prelaunch get --plan plan_123"],
    prerequisites: [...autolaunchPrerequisites, "Run `regents autolaunch prelaunch wizard` first so a plan exists."],
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows the saved plan and refreshes the local copy.",
    nextStep: "Run `regents autolaunch prelaunch validate --plan <plan-id>`.",
    ifItFails: [
      ...autolaunchFailureChecks,
      "If no local plan exists, rerun with `--plan <id>` or create one with `regents autolaunch prelaunch wizard`.",
    ],
  },
  "autolaunch prelaunch validate": {
    summary: "Check whether a prelaunch plan is ready to publish or launch.",
    usage: "regents autolaunch prelaunch validate [--plan <plan-id>] [--json]",
    flags: ["--plan <id> - Plan id. If omitted, the latest local plan is used.", "--json", "--config <path>"],
    examples: ["regents autolaunch prelaunch validate --plan plan_123"],
    prerequisites: [...autolaunchPrerequisites, "Create or fetch the plan before validating it."],
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows launchable status and the exact missing fields or approvals.",
    nextStep: "Run `regents autolaunch prelaunch publish --plan <plan-id>` when validation is clean.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch prelaunch publish": {
    summary: "Publish the launch page draft for a validated plan.",
    usage: "regents autolaunch prelaunch publish [--plan <plan-id>] [--json]",
    flags: ["--plan <id> - Plan id. If omitted, the latest local plan is used.", "--json", "--config <path>"],
    examples: ["regents autolaunch prelaunch publish --plan plan_123"],
    prerequisites: [
      ...autolaunchPrerequisites,
      "Run `regents autolaunch prelaunch validate --plan <plan-id>` and confirm it is clean.",
      "Review public copy and images before publishing.",
    ],
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows the published page state and the next launch command.",
    nextStep: "Run `regents autolaunch launch run --plan <plan-id>` when the operator is ready.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch safe wizard": {
    summary: "Prepare the Agent Safe inputs needed for launch ownership.",
    usage: "regents autolaunch safe wizard --backup-signer-address <wallet> [--website-wallet-address <wallet>]",
    flags: [
      "--backup-signer-address <address> - Backup signer wallet for the Safe.",
      "--website-wallet-address <address> - Website wallet when available.",
      "--agent-safe-address <address> - Existing Safe to reuse.",
      "--wait-for-website-wallet",
      "--json",
      "--config <path>",
    ],
    examples: ["regents autolaunch safe wizard --backup-signer-address 0x0000000000000000000000000000000000000001"],
    prerequisites: [
      "Run `regents wallet status` and confirm the local wallet is the agent signer you intend to use.",
      "Have a backup signer wallet ready before creating a new Safe.",
    ],
    auth: "No Autolaunch sign-in is needed for the local Safe planning step.",
    output: "Explains the Safe setup and shows the values to use in the prelaunch plan.",
    nextStep: "Use the Safe address with `regents autolaunch prelaunch wizard --agent-safe-address <safe>`.",
    ifItFails: [
      "If a signer is missing, run `regents wallet status` and pass the missing wallet flag named in the error.",
      "If you already have a Safe, rerun with `--agent-safe-address <safe>`.",
    ],
  },
  "autolaunch safe create": {
    summary: "Create the Agent Safe used by an Autolaunch project.",
    usage: "regents autolaunch safe create --backup-signer-address <wallet> [--website-wallet-address <wallet>]",
    flags: [
      "--backup-signer-address <address> - Required backup signer wallet.",
      "--website-wallet-address <address> - Optional website wallet.",
      "--json",
      "--config <path>",
    ],
    examples: ["regents autolaunch safe create --backup-signer-address 0x0000000000000000000000000000000000000001"],
    prerequisites: [
      "Run `regents autolaunch safe wizard` first unless you already know the exact Safe signer layout.",
      "Confirm the local wallet is allowed to create the Safe and has enough network fees.",
    ],
    auth: "No Autolaunch sign-in is needed for the local Safe creation step.",
    output: "Shows the created Safe address and the launch command that needs it.",
    nextStep: "Run `regents autolaunch prelaunch wizard --agent-safe-address <safe>`.",
    ifItFails: [
      "If the backup signer is missing, rerun with `--backup-signer-address <wallet>`.",
      "If the local wallet cannot sign, run `regents wallet status` and correct the wallet source.",
    ],
  },
  "autolaunch launch preview": {
    summary: "Preview the launch payload before creating a launch job.",
    usage:
      "regents autolaunch launch preview --agent <id> --name <token-name> --symbol <symbol> --agent-safe-address <safe> --minimum-raise-quote <amount>",
    flags: [
      "--agent <id>",
      "--name <text>",
      "--symbol <text>",
      "--agent-safe-address <address>",
      "--minimum-raise-quote <amount> - Minimum $REGENT raise target, up to 18 decimals.",
      "--launch-notes <text>",
      "--json",
      "--config <path>",
    ],
    examples: [
      "regents autolaunch launch preview --agent agent_123 --name RegentBot --symbol RGBOT --agent-safe-address 0x0000000000000000000000000000000000000001 --minimum-raise-quote 1000",
    ],
    prerequisites: autolaunchPrerequisites,
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows the launch data that would be used without creating the launch job.",
    nextStep: "Create or run the launch only after the preview matches the intended project.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch launch run": {
    summary: "Run the launch flow for a validated prelaunch plan.",
    usage: "regents autolaunch launch run [--plan <plan-id>] [--watch] [--interval <seconds>] [--json]",
    flags: [
      "--plan <id> - Plan id. If omitted, the latest local plan is used.",
      "--wallet-address <address> - Wallet that signs the launch authorization when needed.",
      "--watch - Keep polling until the launch reaches a final state.",
      "--interval <seconds>",
      "--json",
      "--config <path>",
    ],
    examples: ["regents autolaunch launch run --plan plan_123 --watch"],
    prerequisites: [
      ...autolaunchWalletActionPrerequisites,
      "Run `regents autolaunch prelaunch validate --plan <plan-id>` and confirm it is launchable.",
      "Run `regents autolaunch prelaunch publish --plan <plan-id>` if the public page should be visible first.",
    ],
    auth: "Needs Autolaunch sign-in, saved Agent account, and a launch-authorizing wallet.",
    output: "Shows the launch job id, current job status, and the command to keep watching it.",
    nextStep: "Run `regents autolaunch jobs watch <job-id> --watch` until the job is ready, failed, or blocked.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch jobs watch": {
    summary: "Watch an Autolaunch job until it reaches a final state.",
    usage: "regents autolaunch jobs watch <job-id> [--watch] [--interval <seconds>] [--json]",
    flags: ["<job-id> - Job id from launch run.", "--watch", "--interval <seconds>", "--json", "--config <path>"],
    examples: ["regents autolaunch jobs watch job_123 --watch --interval 5"],
    prerequisites: [...autolaunchPrerequisites, "Start this after a command prints a launch job id."],
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows the latest job status and stops when the job is ready, failed, or blocked unless asked to keep watching.",
    nextStep: "Run the next command shown in the job output, usually launch monitor or finalize.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch launch monitor": {
    summary: "Watch the lifecycle job after the launch job starts.",
    usage: "regents autolaunch launch monitor --job <job-id> [--watch] [--interval <seconds>] [--json]",
    flags: ["--job <id>", "--watch", "--interval <seconds>", "--json", "--config <path>"],
    examples: ["regents autolaunch launch monitor --job job_123 --watch --interval 5"],
    prerequisites: [...autolaunchPrerequisites, "Run this only after launch output gives you a lifecycle job id."],
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows lifecycle status and the recommended next action.",
    nextStep: "Run `regents autolaunch launch finalize --job <job-id>` when the monitor recommends finalizing.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch launch finalize": {
    summary: "Prepare or submit the final launch action for a lifecycle job.",
    usage: "regents autolaunch launch finalize --job <job-id> [--submit] [--json]",
    flags: ["--job <id>", "--submit - Sign and submit the prepared action.", "--json", "--config <path>"],
    examples: ["regents autolaunch launch finalize --job job_123", "regents autolaunch launch finalize --job job_123 --submit"],
    prerequisites: [
      ...autolaunchWalletActionPrerequisites,
      "Run `regents autolaunch launch monitor --job <job-id>` and confirm finalize is the recommended action.",
      "Run without `--submit` first when you want to inspect the prepared action.",
    ],
    auth: "Needs Autolaunch sign-in, saved Agent account, and a wallet able to sign the final action.",
    output: "Without `--submit`, shows the prepared action. With `--submit`, shows the transaction result.",
    nextStep: "Run `regents autolaunch vesting status --job <job-id>` after finalization.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch auctions list": {
    summary: "List active and recent Autolaunch auctions.",
    usage: "regents autolaunch auctions list [--sort hottest|newest] [--status <status>] [--mine-only] [--json]",
    flags: ["--sort <value>", "--status <status>", "--chain <chain>", "--mine-only", "--json", "--config <path>"],
    examples: ["regents autolaunch auctions list --sort hottest --json"],
    prerequisites: autolaunchPrerequisites,
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows auction ids, subject ids, status, and pricing fields needed for quote commands.",
    nextStep: "Run `regents autolaunch auction <id>` or `regents autolaunch bids quote --auction <id> ...`.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch auction <id>": {
    summary: "Open one Autolaunch auction.",
    usage: "regents autolaunch auction <id> [--json]",
    flags: ["<id> - Auction id from `regents autolaunch auctions list`.", "--json", "--config <path>"],
    examples: ["regents autolaunch auction auction_123 --json"],
    prerequisites: autolaunchPrerequisites,
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows auction state, subject details, bid fields, and current pricing context.",
    nextStep: "Run `regents autolaunch bids quote --auction <id> --amount <regent> --max-price <price>` before placing a bid.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch bids quote": {
    summary: "Quote a bid before spending funds.",
    usage: "regents autolaunch bids quote --auction <auction-id> --amount <regent> --max-price <price> [--json]",
    flags: [
      "--auction <id>",
      "--amount <regent> - $REGENT bid budget.",
      "--max-price <price> - Maximum $REGENT price per agent token.",
      "--json",
      "--config <path>",
    ],
    examples: ["regents autolaunch bids quote --auction auction_123 --amount 100 --max-price 0.50 --json"],
    prerequisites: [
      ...autolaunchPrerequisites,
      "Open the auction first so the $REGENT amount, max price, and status are current.",
      "Use this before every bid because auction conditions can change.",
    ],
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows the estimated bid result and the fields to carry into a place-bid command after payment is signed.",
    nextStep: "Only place the bid after reviewing the quote and signing the matching wallet transaction.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch bids place": {
    summary: "Record a signed bid transaction for an auction.",
    usage:
      "regents autolaunch bids place --auction <auction-id> --amount <regent> --max-price <price> --tx-hash <hash> [--json]",
    flags: [
      "--auction <id>",
      "--amount <regent> - $REGENT bid budget.",
      "--max-price <price> - Maximum $REGENT price per agent token.",
      "--tx-hash <hash> - Transaction hash for the signed bid.",
      "--current-clearing-price <amount>",
      "--projected-clearing-price <amount>",
      "--json",
      "--config <path>",
    ],
    examples: ["regents autolaunch bids place --auction auction_123 --amount 100 --max-price 0.50 --tx-hash 0xabc --json"],
    prerequisites: [
      ...autolaunchWalletActionPrerequisites,
      "Run `regents autolaunch bids quote --auction <id> --amount <regent> --max-price <price>` immediately before placing.",
      "Submit the wallet transaction first, then pass the resulting `--tx-hash`.",
    ],
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows the recorded bid and the next command to inspect the auction or claim results.",
    nextStep: "Run `regents autolaunch auction <id>` to confirm the bid appears.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch subjects get": {
    summary: "Open one launched subject by subject id.",
    usage: "regents autolaunch subjects get <subject-id> [--json]",
    flags: ["<subject-id> - Subject id from an auction, launch, or claim record.", "--json", "--config <path>"],
    examples: ["regents autolaunch subjects get subject_123 --json"],
    prerequisites: autolaunchPrerequisites,
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows subject state, revenue lanes, staking status, and available prepared actions.",
    nextStep: "Run staking, claim, or ingress commands only after checking the current subject state.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch subjects staking": {
    summary: "Show staking state for one Autolaunch subject.",
    usage: "regents autolaunch subjects staking <subject-id> [--json]",
    flags: ["<subject-id> - Subject id.", "--json", "--config <path>"],
    examples: ["regents autolaunch subjects staking subject_123 --json"],
    prerequisites: autolaunchPrerequisites,
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Shows staking balances, reward state, and whether stake or unstake actions are available.",
    nextStep: "Use subject stake, unstake, or claim commands only after reviewing this state.",
    ifItFails: autolaunchFailureChecks,
  },
  "autolaunch subjects claim-usdc": {
    summary: "Prepare a USDC claim for one Autolaunch subject.",
    usage: "regents autolaunch subjects claim-usdc <subject-id> [--submit] [--json]",
    flags: ["<subject-id> - Subject id.", "--submit - Sign and submit the prepared claim action.", "--json", "--config <path>"],
    examples: ["regents autolaunch subjects claim-usdc subject_123", "regents autolaunch subjects claim-usdc subject_123 --submit --json"],
    prerequisites: [
      ...autolaunchWalletActionPrerequisites,
      "Run `regents autolaunch subjects get <subject-id>` and confirm there is claimable USDC.",
    ],
    auth: "Needs Autolaunch sign-in and a saved Agent account.",
    output: "Without `--submit`, shows the prepared claim action. With `--submit`, shows the submitted claim result.",
    nextStep: "Run `regents autolaunch subjects get <subject-id>` again to confirm the updated balances.",
    ifItFails: autolaunchFailureChecks,
  },
  "techtree start": {
    summary: "Start the default Techtree working view.",
    usage: "regents techtree start [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents techtree start"],
    prerequisites: ["Run `regents run` first when you want local agent work and publishing features."],
    auth: "Public reads are open. Signed work needs Techtree sign-in and a saved Agent account.",
    output: "Shows Techtree readiness and a suggested first public-work command.",
    nextStep: "Run `regents techtree work next` or `regents techtree runbook questions list`.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree status": {
    summary: "Show local and Techtree readiness.",
    usage: "regents techtree status [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents techtree status --json"],
    prerequisites: ["No sign-in is needed for a basic status read. Signed work needs Techtree sign-in and identity setup."],
    auth: "Public reads are open. Signed work needs Techtree sign-in and a saved Agent account.",
    output: "Shows whether Techtree can be reached and whether signed work appears ready.",
    nextStep: "Run `regents doctor techtree` when status shows a blocked item.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree search": {
    summary: "Search public Techtree nodes.",
    usage: "regents techtree search --query <text> [--limit <n>] [--json]",
    flags: ["--query <text> or --q <text>", "--limit <n>", "--json", "--config <path>"],
    examples: ['regents techtree search --query "x402 runbook" --limit 10 --json'],
    prerequisites: ["No sign-in is needed for public search."],
    auth: "No saved sign-in is needed for public reads.",
    output: "Shows matching public nodes with ids to open next.",
    nextStep: "Run `regents techtree node get <id>` for a result you want to inspect.",
    ifItFails: ["If search cannot reach Techtree, run `regents doctor techtree`."],
  },
  "techtree work next": {
    summary: "Ask Techtree for the next useful work unit.",
    usage: "regents techtree work next [--kind <kind>] [--json]",
    flags: ["--kind <kind> - benchmark, science-task, paper-notebook, autoskill, fold-proof, and related work types.", "--json", "--config <path>"],
    examples: ["regents techtree work next --kind benchmark --json"],
    prerequisites: techtreePrerequisites,
    auth: "Signed Techtree work needs Techtree sign-in and a saved Agent account.",
    output: "Shows one recommended work unit and the accept command for it.",
    nextStep: "Run `regents techtree work accept --work-unit <id> --workspace-path <path>`.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree work accept": {
    summary: "Accept a Techtree work unit and prepare a local workspace.",
    usage: "regents techtree work accept --work-unit <id> [--workspace-path <path>] [--json]",
    flags: ["--work-unit <id>", "--workspace-path <path>", "--json", "--config <path>"],
    examples: ["regents techtree work accept --work-unit benchmark:bench_123 --workspace-path ./work/bench_123"],
    prerequisites: [
      "Start `regents run` in another terminal first.",
    ],
    auth: "Signed Techtree work needs Techtree sign-in and a saved Agent account.",
    output: "Shows the accepted work unit, local workspace path, and next local work command.",
    nextStep: "Do the work in the workspace, then run `regents techtree work publish --workspace-path <path>`.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree work publish": {
    summary: "Publish a completed Techtree work workspace.",
    usage: "regents techtree work publish --workspace-path <path> [--json]",
    flags: ["--workspace-path <path>", "--json", "--config <path>"],
    examples: ["regents techtree work publish --workspace-path ./work/bench_123 --json"],
    prerequisites: [
      ...techtreeWorkspacePrerequisites,
      "Review the workspace for secrets, raw private logs, and unapproved customer data before publishing.",
    ],
    auth: "Signed Techtree publish needs Techtree sign-in and a saved Agent account.",
    output: "Shows the public node, receipt fields, and follow-up commands.",
    nextStep: "Create or share a receipt when the published work is useful evidence.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree notebooks init": {
    summary: "Create a Techtree notebook workspace for paper or freeform work.",
    usage: "regents techtree notebooks init --kind <paper|freeform> --title <title> --workspace-path <path> [--source <source>]",
    flags: ["--kind paper|freeform", "--title <title>", "--workspace-path <path>", "--source <source>", "--json", "--config <path>"],
    examples: ['regents techtree notebooks init --kind paper --title "Paper title" --source arxiv:2401.00001 --workspace-path ./paper-note'],
    prerequisites: techtreeWorkspacePrerequisites,
    auth: "Signed Techtree notebook setup needs Techtree sign-in and a saved Agent account.",
    output: "Creates the local notebook workspace and prints the next pairing command.",
    nextStep: "Run `regents techtree notebooks pair --workspace-path <path>`.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree notebooks pair": {
    summary: "Pair a local notebook workspace with Techtree.",
    usage: "regents techtree notebooks pair --workspace-path <path> [--no-open] [--json]",
    flags: ["--workspace-path <path>", "--no-open", "--json", "--config <path>"],
    examples: ["regents techtree notebooks pair --workspace-path ./paper-note --no-open"],
    prerequisites: techtreeWorkspacePrerequisites,
    auth: "Signed Techtree notebook pairing needs Techtree sign-in and a saved Agent account.",
    output: "Shows the paired notebook record and the publish command.",
    nextStep: "Work in the notebook, then run `regents techtree notebooks publish --workspace-path <path>`.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree notebooks publish": {
    summary: "Publish a paired notebook to Techtree.",
    usage: "regents techtree notebooks publish --workspace-path <path> [--parent-id <node-id>] [--json]",
    flags: ["--workspace-path <path>", "--parent-id <node-id>", "--json", "--config <path>"],
    examples: ["regents techtree notebooks publish --workspace-path ./paper-note --parent-id 1 --json"],
    prerequisites: [
      ...techtreeWorkspacePrerequisites,
      "Pair the notebook first and remove private notes before publishing.",
    ],
    auth: "Signed Techtree notebook publish needs Techtree sign-in and a saved Agent account.",
    output: "Shows the public notebook node and receipt-ready evidence.",
    nextStep: "Run `regents receipt create --from-notebook <id>` if you need a local receipt.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree runbook questions list": {
    summary: "Browse public Runbook questions by tool, error, or solved state.",
    usage: "regents techtree runbook questions list [--q <text>] [--status open|answered|solved|deprecated] [--limit <n>]",
    flags: ["--q <text>", "--status <status>", "--limit <n>", "--json", "--config <path>"],
    examples: ["regents techtree runbook questions list --q shopify --status answered --json"],
    prerequisites: ["No sign-in is needed for public Runbook browsing."],
    auth: "No saved sign-in is needed for public reads.",
    output: "Shows a compact table of Runbook questions and the command to open one branch.",
    nextStep: "Run `regents techtree runbook questions get <id>`.",
    ifItFails: ["If results are empty, broaden `--q` or remove the status filter."],
  },
  "techtree runbook questions get <id>": {
    summary: "Open one Runbook branch with questions, answers, and paid solution signals.",
    usage: "regents techtree runbook questions get <id> [--json]",
    flags: ["<id> - Runbook question id.", "--json", "--config <path>"],
    examples: ["regents techtree runbook questions get rbq_123 --json"],
    prerequisites: ["No sign-in is needed for public Runbook reads."],
    auth: "No saved sign-in is needed for public reads.",
    output: "Shows the question, answers, solved status, prices, and safe next commands.",
    nextStep: "Answer, request an invite, mark solved, or unlock an answer from the branch view.",
    ifItFails: ["If the id is not found, rerun the list command and copy the exact id."],
  },
  "techtree runbook question post": {
    summary: "Post a redacted Runbook question after a tool, docs, or skill failure.",
    usage:
      "regents techtree runbook question post --vendor <name> --product <name> --tool <name> --command <cmd> --error-signature <text> [--log-file <path>] [--confirm-redaction]",
    flags: [
      "--vendor <name>",
      "--product <name>",
      "--tool <name>",
      "--command <cmd>",
      "--error-signature <text>",
      "--docs-url <url>",
      "--skill-id <id>",
      "--log-file <path>",
      "--config-file <path>",
      "--confirm-redaction",
      "--json",
      "--config <path>",
    ],
    examples: [
      'regents techtree runbook question post --vendor Shopify --product "Shopify CLI" --tool shopify-cli --command "shopify app dev" --error-signature "Auth loop after app dev" --log-file ./error.log --confirm-redaction',
    ],
    prerequisites: [
      ...techtreePrerequisites,
      "Redact secrets before posting. Use `--confirm-redaction` when the scanner reports possible secrets.",
      "Include the docs URL or skill id you followed so other agents can reproduce the problem.",
    ],
    auth: "Needs Techtree sign-in and a saved Agent account.",
    output: "Shows the created Runbook branch, public page path, and next commands.",
    nextStep: "Open the branch with `regents techtree runbook questions get <id>`.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree runbook answer post <question_id>": {
    summary: "Post a public Runbook answer and optionally attach a paid solution.",
    usage:
      "regents techtree runbook answer post <question_id> --summary <text|@file> --price-usdc <amount> [--private-solution <text|@file>]",
    flags: [
      "<question_id> - Runbook question id.",
      "--summary <text|@file> - Public answer summary.",
      "--price-usdc <amount> - Unlock price.",
      "--private-solution <text|@file> - Exact private fix or patch.",
      "--public-unlock-price-usdc <amount>",
      "--risk-level <kind>",
      "--applicability <json|@file>",
      "--json",
      "--config <path>",
    ],
    examples: ["regents techtree runbook answer post rbq_123 --summary @summary.md --price-usdc 0.25 --private-solution @solution.md"],
    prerequisites: [
      ...techtreePrerequisites,
      "Run `regents techtree runbook payment-address set --payment-address <address>` before paid answers.",
      "Keep the public summary useful without leaking the private solution payload.",
    ],
    auth: "Needs Techtree sign-in, a saved Agent account, and a payment address for paid answers.",
    output: "Shows the answer id, price, payment address, and branch command.",
    nextStep: "Open the branch with `regents techtree runbook questions get <question_id>`.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree science-tasks list": {
    summary: "List available Science Tasks.",
    usage: "regents techtree science-tasks list [--stage <stage>] [--science-domain <domain>] [--limit <n>] [--json]",
    flags: ["--stage <stage>", "--science-domain <domain>", "--science-field <field>", "--limit <n>", "--json", "--config <path>"],
    examples: ["regents techtree science-tasks list --science-domain biology --limit 10 --json"],
    prerequisites: ["No sign-in is needed for public discovery. Signed work needs Techtree sign-in and identity setup."],
    auth: "Public reads are open. Signed task work needs Techtree sign-in and a saved Agent account.",
    output: "Shows task ids, stages, domains, and commands to open or initialize task work.",
    nextStep: "Run `regents techtree science-tasks get <id>` or initialize a workspace.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree science-tasks get": {
    summary: "Open one Science Task.",
    usage: "regents techtree science-tasks get <id> [--json]",
    flags: ["<id> - Science Task id.", "--json", "--config <path>"],
    examples: ["regents techtree science-tasks get 123 --json"],
    prerequisites: ["No sign-in is needed for public task reads."],
    auth: "Public reads are open. Signed task work needs Techtree sign-in and a saved Agent account.",
    output: "Shows task details, checklist state, and workspace commands.",
    nextStep: "Run `regents techtree science-tasks init --workspace-path <path>` when you are ready to work.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree science-tasks init": {
    summary: "Create a local workspace for a Science Task.",
    usage: "regents techtree science-tasks init --workspace-path <path> [--title <title>] [--science-domain <domain>]",
    flags: ["--workspace-path <path>", "--title <title>", "--summary <text>", "--science-domain <domain>", "--science-field <field>", "--task-slug <slug>", "--claimed-expert-time <text>", "--json", "--config <path>"],
    examples: ['regents techtree science-tasks init --workspace-path ./science-task --title "Replication note" --science-domain biology'],
    prerequisites: techtreeWorkspacePrerequisites,
    auth: "Signed Science Task setup needs Techtree sign-in and a saved Agent account.",
    output: "Creates the workspace and shows checklist/evidence commands.",
    nextStep: "Run `regents techtree science-tasks checklist --workspace-path <path>`.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree science-tasks review-loop": {
    summary: "Run the review loop for a Science Task workspace.",
    usage: "regents techtree science-tasks review-loop --workspace-path <path> --pr-url <url> [--timeout-seconds <n>]",
    flags: ["--workspace-path <path>", "--pr-url <url>", "--timeout-seconds <n>", "--json", "--config <path>"],
    examples: ["regents techtree science-tasks review-loop --workspace-path ./science-task --pr-url https://github.com/org/repo/pull/1"],
    prerequisites: [
      ...techtreeWorkspacePrerequisites,
      "Create the workspace, collect evidence, and open the review PR before starting the loop.",
    ],
    auth: "Signed Science Task review needs Techtree sign-in and a saved Agent account.",
    output: "Shows review status, open concerns, and follow-up actions.",
    nextStep: "Run `regents techtree science-tasks submit --workspace-path <path>` when review is clean.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree science set-goal": {
    summary: "Save a Terminal Science Bench task target.",
    usage: "regents techtree science set-goal --task harbor-framework/terminal-bench-science:tasks/<domain>/<field>/<task>",
    flags: ["--task <task>", "--agent <codex|openclaw|hermes|custom>", "--model <model>", "--env <docker>", "--json", "--config <path>"],
    examples: [
      "regents techtree science set-goal --task harbor-framework/terminal-bench-science:tasks/physical-sciences/chemistry-and-materials/example-name",
    ],
    prerequisites: techtreeWorkspacePrerequisites,
    auth: "Needs Regent running on this machine.",
    output: "Shows the saved task, runner, model, and environment.",
    nextStep: "Run `regents techtree science run --run-dir ./science-runs/<task>` when you are ready.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree science run": {
    summary: "Run a Terminal Science Bench task and save local result files.",
    usage: "regents techtree science run [--task harbor-framework/terminal-bench-science:tasks/<domain>/<field>/<task>] [--run-dir <path>]",
    flags: ["--task <task>", "--run-dir <path>", "--agent <codex|openclaw|hermes|custom>", "--model <model>", "--env <docker>", "--timeout-seconds <n>", "--json", "--config <path>"],
    examples: [
      "regents techtree science run --task harbor-framework/terminal-bench-science:tasks/physical-sciences/chemistry-and-materials/example-name --run-dir ./science-runs/example-name",
      "regents techtree science run --run-dir ./science-runs/latest",
    ],
    prerequisites: [
      "Start `regents run` in another terminal first.",
      "Install Harbor and prepare the selected local runner before starting a run.",
      "Keep raw logs private unless you deliberately review and share them.",
    ],
    auth: "Needs Regent running on this machine.",
    output: "Shows the run folder, verifier result, public summary, and saved file paths.",
    nextStep: "Open the printed run folder or rerun with another task.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree benchmarks list": {
    summary: "List benchmark capsules.",
    usage: "regents techtree benchmarks list [--domain <domain>] [--field <field>] [--limit <n>] [--json]",
    flags: ["--domain <domain>", "--field <field>", "--status <status>", "--difficulty <value>", "--limit <n>", "--json", "--config <path>"],
    examples: ["regents techtree benchmarks list --domain biology --limit 10 --json"],
    prerequisites: ["No sign-in is needed for public benchmark discovery."],
    auth: "Public reads are open. Benchmark runs and submissions need Techtree sign-in and a saved Agent account.",
    output: "Shows benchmark capsule ids and filters for selecting a run target.",
    nextStep: "Run `regents techtree benchmarks get <capsule_id>`.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree benchmarks get <capsule_id>": {
    summary: "Open one benchmark capsule.",
    usage: "regents techtree benchmarks get <capsule_id> [--json]",
    flags: ["<capsule_id> - Benchmark capsule id.", "--json", "--config <path>"],
    examples: ["regents techtree benchmarks get bench_123 --json"],
    prerequisites: ["No sign-in is needed for public benchmark reads."],
    auth: "Public reads are open. Benchmark runs and submissions need Techtree sign-in and a saved Agent account.",
    output: "Shows capsule details, versions, run setup, and scoreboard commands.",
    nextStep: "Run `regents techtree benchmarks run materialize --workspace-path <path> --capsule-id <id>`.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree benchmarks run materialize": {
    summary: "Create a local benchmark run workspace.",
    usage: "regents techtree benchmarks run materialize --workspace-path <path> --capsule-id <id> [--model-id <id>]",
    flags: ["--workspace-path <path>", "--capsule-id <id>", "--version-id <id>", "--runner-kind <kind>", "--model-id <id>", "--harness-version <version>", "--json", "--config <path>"],
    examples: ["regents techtree benchmarks run materialize --workspace-path ./bench-run --capsule-id bench_123 --model-id gpt-5.2"],
    prerequisites: techtreeWorkspacePrerequisites,
    auth: "Signed benchmark work needs Techtree sign-in and a saved Agent account.",
    output: "Creates a benchmark run workspace and prints the submit command.",
    nextStep: "Run the benchmark locally, then `regents techtree benchmarks run submit --workspace-path <path>`.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree benchmarks run submit": {
    summary: "Submit a completed benchmark run.",
    usage: "regents techtree benchmarks run submit --workspace-path <path> [--json]",
    flags: ["--workspace-path <path>", "--json", "--config <path>"],
    examples: ["regents techtree benchmarks run submit --workspace-path ./bench-run --json"],
    prerequisites: [
      ...techtreeWorkspacePrerequisites,
      "Run the benchmark and keep output files in the workspace before submitting.",
    ],
    auth: "Signed benchmark submission needs Techtree sign-in and a saved Agent account.",
    output: "Shows submitted run id, receipt-ready evidence, and scoreboard follow-up.",
    nextStep: "Run `regents techtree benchmarks scoreboard <capsule_id>` or create a receipt.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree fold status": {
    summary: "Show Techtree Fold reward and proof readiness.",
    usage: "regents techtree fold status [--json]",
    flags: ["--json", "--config <path>"],
    examples: ["regents techtree fold status --json"],
    prerequisites: techtreePrerequisites,
    auth: "Needs Techtree sign-in and a saved Agent account for signed Fold status.",
    output: "Shows policy state, proof readiness, and reward reporting state.",
    nextStep: "Run `regents techtree fold proof --attempt <attempt-id>` when a finished attempt needs proof.",
    ifItFails: techtreeFailureChecks,
  },
  "techtree fold proof": {
    summary: "Create a Fold proof for a completed attempt.",
    usage: "regents techtree fold proof --attempt <attempt-id> [--json]",
    flags: ["--attempt <id>", "--json", "--config <path>"],
    examples: ["regents techtree fold proof --attempt attempt_123 --json"],
    prerequisites: [
      ...techtreePrerequisites,
      "Use an attempt id from a completed Techtree work, benchmark, or notebook flow.",
    ],
    auth: "Needs Techtree sign-in and a saved Agent account.",
    output: "Shows the generated proof fields and next reporting command.",
    nextStep: "Run `regents techtree fold report --agent <agent-id>` when you need a summary packet.",
    ifItFails: techtreeFailureChecks,
  },
});

const groupHelp: Record<string, HelpGroup> = {
  setup: {
    summary: "Install local support files for agents and first-run use.",
    auth: "No saved sign-in is needed.",
    output: "Shows what was installed and the next action.",
    commands: (CLI_COMMANDS_BY_TOP_LEVEL_GROUP as Readonly<Record<string, readonly string[]>>).setup ?? [],
    nextStep: "Start with `regents setup skills`.",
  },
  autolaunch: {
    summary: "Launch and manage Agent account projects from the terminal.",
    auth: "Most commands need `regents auth login --audience autolaunch` and `regents identity ensure`.",
    output: "Human output uses panels and status lines. `--json` prints raw JSON.",
    commands: CLI_COMMANDS_BY_TOP_LEVEL_GROUP.autolaunch,
    nextStep: "Start with `regents autolaunch agents list --launchable` or `regents autolaunch prelaunch wizard`.",
  },
  auth: {
    summary: "Manage saved Agent account sign-ins.",
    auth: "No saved sign-in is needed.",
    output: "Shows the saved session, account, and expiry.",
    commands: CLI_COMMANDS_BY_TOP_LEVEL_GROUP.auth,
    nextStep: "For Autolaunch, run `regents auth login --audience autolaunch`.",
  },
  identity: {
    summary: "Create or refresh the local Agent account.",
    auth: "Uses the local wallet configured for Regent.",
    output: "Shows wallet, chain, registry, token, and saved status.",
    commands: CLI_COMMANDS_BY_TOP_LEVEL_GROUP.identity,
    nextStep: "Run `regents identity ensure` after signing in.",
  },
  "regent-staking": {
    summary: "Manage Regent staking for the saved Agent account.",
    auth: "Needs `regents auth login --audience regent-services` and `regents identity ensure`.",
    output: "Shows balances, prepared actions, and claim results.",
    commands: CLI_COMMANDS_BY_TOP_LEVEL_GROUP["regent-staking"],
    nextStep: "Start with `regents regent-staking get`.",
  },
  platform: {
    summary: "Use the Regent website account from the terminal.",
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows account, readiness, billing, and runtime status. Some beta actions return an unavailable status.",
    commands: CLI_COMMANDS_BY_TOP_LEVEL_GROUP.platform,
    nextStep: "Start with `regents platform auth login`, then `regents platform formation status`.",
  },
  work: {
    summary: "Create and run Regent company work from the terminal.",
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows concise work summaries, run status, and update lists.",
    commands: CLI_COMMANDS_BY_TOP_LEVEL_GROUP.work,
    nextStep: "Start with `regents work create --company-id <id> --title <title>`.",
  },
  techtree: {
    summary: "Browse and publish public agent work, benchmarks, Runbook reports, and paid solution records.",
    auth: "Public reads are open. Agent writes need a signed Techtree agent session.",
    output: "Human output uses panels, tables, and branch views. `--json` prints raw JSON.",
    commands: CLI_COMMANDS_BY_TOP_LEVEL_GROUP.techtree,
    nextStep: "Start with `regents techtree runbook questions list` or `regents techtree start`.",
  },
  runtime: {
    summary: "Manage Regent company runtimes from the terminal.",
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows runtime status, services, health, checkpoints, and restore results. `--json` prints raw JSON.",
    commands: CLI_COMMANDS_BY_TOP_LEVEL_GROUP.runtime,
    nextStep: "Start with `regents runtime get <runtime-id> --company-id <id>` or create a runtime from the company setup.",
  },
  agent: {
    summary: "Manage local Agent setup and Regent company workers.",
    auth: "Worker connection needs `regents auth login --audience platform` and `regents identity ensure`.",
    output: "Shows connected worker ids, work links, and workers a manager can assign.",
    commands: CLI_COMMANDS_BY_TOP_LEVEL_GROUP.agent,
    nextStep: "Use `regents agent connect openclaw --company-id <id> --role executor` for local OpenClaw work.",
  },
  feynman: {
    summary: "Open the Feynman research shell from Regents CLI.",
    auth: "Feynman manages its own setup.",
    output: "Shows Feynman's terminal output directly.",
    commands: CLI_COMMANDS_BY_TOP_LEVEL_GROUP.feynman,
    nextStep: "Install Feynman, then run `regents feynman setup`.",
  },
};

const helpGroupForCommand = (command: string): HelpGroup | null => {
  if (command.startsWith("autolaunch ")) {
    return groupHelp.autolaunch;
  }

  if (command.startsWith("auth ")) {
    return groupHelp.auth;
  }

  if (command.startsWith("identity ")) {
    return groupHelp.identity;
  }

  if (command.startsWith("regent-staking ")) {
    return groupHelp["regent-staking"];
  }

  if (command.startsWith("platform ")) {
    return groupHelp.platform;
  }

  if (command.startsWith("work ")) {
    return groupHelp.work;
  }

  if (command.startsWith("techtree ")) {
    return groupHelp.techtree;
  }

  if (command.startsWith("runtime ")) {
    return groupHelp.runtime;
  }

  if (command.startsWith("agent ")) {
    return groupHelp.agent;
  }

  if (command.startsWith("setup ")) {
    return groupHelp.setup;
  }

  if (command === "feynman") {
    return groupHelp.feynman;
  }

  return null;
};

const isPlaceholderPart = (part: string): boolean => part.startsWith("<") && part.endsWith(">");

interface HelpMatchScore {
  readonly literalMatches: number;
  readonly placeholderMatches: number;
  readonly totalParts: number;
}

const scoreHelpMatch = (command: string, input: readonly string[]): HelpMatchScore | null => {
  const commandParts = command.split(" ");
  if (input.length > commandParts.length) {
    return null;
  }

  let literalMatches = 0;
  let placeholderMatches = 0;

  for (const [index, inputPart] of input.entries()) {
    const commandPart = commandParts[index];
    if (!commandPart) {
      return null;
    }

    if (isPlaceholderPart(commandPart)) {
      if (!inputPart) {
        return null;
      }
      placeholderMatches += 1;
      continue;
    }

    if (commandPart !== inputPart) {
      return null;
    }

    literalMatches += 1;
  }

  if (!commandParts.slice(input.length).every((part) => isPlaceholderPart(part))) {
    return null;
  }

  return {
    literalMatches,
    placeholderMatches,
    totalParts: commandParts.length,
  };
};

const commandForInput = (positionals: readonly string[]): string | null => {
  const helpMatches = CLI_COMMANDS.flatMap((command) => {
    const score = scoreHelpMatch(command, positionals);
    return score ? [{ command, score }] : [];
  });

  if (helpMatches.length === 0) {
    return null;
  }

  return helpMatches.reduce((best, candidate) => {
    if (candidate.score.literalMatches !== best.score.literalMatches) {
      return candidate.score.literalMatches > best.score.literalMatches ? candidate : best;
    }

    if (candidate.score.placeholderMatches !== best.score.placeholderMatches) {
      return candidate.score.placeholderMatches < best.score.placeholderMatches ? candidate : best;
    }

    if (candidate.score.totalParts !== best.score.totalParts) {
      return candidate.score.totalParts < best.score.totalParts ? candidate : best;
    }

    return best;
  }).command;
};

const isCommandFieldMetadata = (value: unknown): value is CommandFieldMetadata =>
  Boolean(value) && typeof value === "object" && typeof (value as CommandFieldMetadata).name === "string";

const fieldTypeSuffix = (field: CommandFieldMetadata): string => {
  if (!field.type || field.type === "boolean") {
    return "";
  }

  if (field.name?.includes("<")) {
    return "";
  }

  return ` <${field.type}>`;
};

const formatFieldMetadata = (field: CommandFieldMetadata): string => {
  const name = field.name ?? "";
  const required = field.required ? " required" : "";
  const description = field.description ? ` - ${field.description}` : "";
  return `${name}${fieldTypeSuffix(field)}${required}${description}`;
};

const generatedFields = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isCommandFieldMetadata)
    .map(formatFieldMetadata)
    .filter((line) => line.length > 0);
};

const generatedAuthText = (detail: CommandDetailMetadata, group: HelpGroup | null): string => {
  if (detail.auth_mode === "none") {
    return "No saved sign-in is needed.";
  }

  if (detail.auth_audience) {
    return `Needs \`regents auth login --audience ${detail.auth_audience}\` and \`regents identity ensure\`.`;
  }

  return group?.auth ?? "Check the command group help for sign-in needs.";
};

const generatedOutputText = (detail: CommandDetailMetadata): string => {
  if (detail.output_envelope === "passthrough") {
    return "Shows the launched tool output directly.";
  }

  if (detail.agent_metadata?.json_support === "supported") {
    return "Human output is concise. `--json` prints raw JSON.";
  }

  if (detail.agent_metadata?.json_support === "not_supported") {
    return "Shows human terminal output.";
  }

  return "Prints command results. `--json` keeps output script-safe where supported.";
};

const generatedPrerequisites = (command: string, detail: CommandDetailMetadata | undefined): readonly string[] => {
  if (command.startsWith("autolaunch ")) {
    return autolaunchPrerequisites;
  }

  if (command.startsWith("techtree ") || command.startsWith("chatbox ")) {
    return techtreePrerequisites;
  }

  if (command.startsWith("platform ") || command.startsWith("runtime ") || command.startsWith("work ") || command.startsWith("agent connect ") || command.startsWith("agent link") || command.startsWith("agent execution-pool")) {
    return platformPrerequisites;
  }

  if (command.startsWith("regent-staking ")) {
    return agentIdentityPrerequisites;
  }

  if (command.startsWith("x402 ")) {
    return command === "x402 search" || command === "x402 details" || command === "x402 quote" ? ["No payment is needed to inspect or quote a paid service."] : paymentPrerequisites;
  }

  if (command.startsWith("wallet ")) {
    return walletPrerequisites;
  }

  if (command.startsWith("xmtp ")) {
    return ["Run `regents xmtp status` first when you are not sure the local XMTP identity is ready."];
  }

  if (detail?.auth_audience) {
    return [`Run \`regents auth login --audience ${detail.auth_audience}\`.`, "Run `regents identity ensure` before signed agent actions."];
  }

  return ["Run the command with `--help` before using it in an unattended agent loop."];
};

const generatedFailureChecks = (command: string): readonly string[] => {
  if (command.startsWith("autolaunch ")) {
    return autolaunchFailureChecks;
  }

  if (command.startsWith("techtree ") || command.startsWith("chatbox ")) {
    return techtreeFailureChecks;
  }

  if (command.startsWith("platform ") || command.startsWith("runtime ") || command.startsWith("work ") || command.startsWith("agent connect ") || command.startsWith("agent link") || command.startsWith("agent execution-pool")) {
    return [
      "If the command says sign-in is missing, run `regents platform auth login`.",
      "If a company, runtime, worker, or work id is not found, copy it again from the Regent website or the previous command output.",
    ];
  }

  if (command.startsWith("x402 ")) {
    return [
      "If the command needs payment, check `regents wallet agentic status` and `regents budget status`.",
      "If the endpoint is unavailable, run `regents x402 details --url <url>` before paying.",
    ];
  }

  if (command.startsWith("xmtp ")) {
    return [
      "If local XMTP identity is missing, run `regents xmtp init`.",
      "If a room command fails, check the conversation id and your room permissions.",
    ];
  }

  return ["Check the command spelling, required flags, saved sign-in, and local Regent status, then run the command again."];
};

const generatedUsage = (command: string, detail: CommandDetailMetadata | undefined): string =>
  detail?.usage ?? `regents ${command}`;

const exampleParts = (example: string): readonly string[] => {
  const trimmed = example.trim();
  const withoutBinary = trimmed.startsWith("regents ") ? trimmed.slice("regents ".length) : trimmed;
  return withoutBinary.split(/\s+/).filter((part) => part.length > 0);
};

const exampleMatchesCommand = (command: string, example: string): boolean => {
  const commandParts = command.split(" ");
  const parts = exampleParts(example);
  if (parts.length < commandParts.length) {
    return false;
  }

  return commandParts.every((part, index) => isPlaceholderPart(part) || parts[index] === part);
};

const generatedExamples = (command: string, detail: CommandDetailMetadata | undefined): readonly string[] => {
  const matchingExample = detail?.examples?.find((example) => exampleMatchesCommand(command, example));
  return [matchingExample ?? generatedUsage(command, detail)];
};

const summarizeCommand = (command: string): HelpEntry => {
  const group = helpGroupForCommand(command);
  const detail = commandDetailsByCommand[command];
  const flags = [
    ...generatedFields(detail?.args),
    ...generatedFields(detail?.flags),
    "--config <path>",
    "--json where supported",
  ];

  return {
    summary: detail?.summary ?? `Run ${command}.`,
    usage: generatedUsage(command, detail),
    flags: Array.from(new Set(flags)),
    examples: generatedExamples(command, detail),
    prerequisites: generatedPrerequisites(command, detail),
    auth: detail ? generatedAuthText(detail, group) : group?.auth ?? "Check the command group help for sign-in needs.",
    output: detail ? generatedOutputText(detail) : "Prints command results. `--json` keeps output script-safe where supported.",
    nextStep: detail?.next_step ?? group?.nextStep ?? globalNextStep,
    ifItFails: generatedFailureChecks(command),
  };
};

const renderEntry = (title: string, entry: HelpEntry): string =>
  [
    renderPanel(title, [
      entry.summary,
      "",
      `${tone("usage", CLI_PALETTE.secondary, true)} ${entry.usage}`,
      `${tone("auth", CLI_PALETTE.secondary, true)} ${entry.auth}`,
      `${tone("output", CLI_PALETTE.secondary, true)} ${entry.output}`,
      `${tone("next", CLI_PALETTE.secondary, true)} ${entry.nextStep}`,
    ]),
    entry.prerequisites?.length
      ? renderPanel("◆ BEFORE YOU RUN THIS", entry.prerequisites.map((prerequisite) => prerequisite))
      : undefined,
    entry.flags?.length
      ? renderPanel("◆ FLAGS", entry.flags.map((flag) => flag))
      : undefined,
    entry.examples?.length
      ? renderPanel("◆ EXAMPLES", entry.examples.map((example) => example))
      : undefined,
    entry.ifItFails?.length
      ? renderPanel("◆ IF THIS FAILS", entry.ifItFails.map((failure) => failure))
      : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

const renderGroup = (name: string, group: HelpGroup): string => {
  const visibleCommands = group.commands.slice(0, 36).map((command) => `regents ${command}`);
  const remaining = group.commands.length - visibleCommands.length;

  return [
    renderPanel(`◆ ${name.toUpperCase()} HELP`, [
      group.summary,
      "",
      `${tone("auth", CLI_PALETTE.secondary, true)} ${group.auth}`,
      `${tone("output", CLI_PALETTE.secondary, true)} ${group.output}`,
      `${tone("next", CLI_PALETTE.secondary, true)} ${group.nextStep}`,
    ]),
    renderPanel(
      "◆ COMMANDS",
      remaining > 0
        ? [...visibleCommands, `and ${remaining} more commands. Use command-level --help for details.`]
        : visibleCommands,
    ),
  ].join("\n\n");
};

export function renderScopedHelp(positionals: readonly string[], configPath: string): string {
  if (positionals.length === 0) {
    return renderEntry("◆ REGENT CLI HELP", {
      summary: "Work with Regent from the terminal.",
      usage: "regents <command> [flags]",
      flags: ["--config <path>", "--help", "--json where supported", "--no-input"],
      examples: [
        "regents setup skills",
        "regents run",
        "regents auth login --audience autolaunch",
        "regents identity ensure",
        "regents autolaunch agents list --launchable",
      ],
      auth: "Protected commands use a saved Agent account.",
      output: "Human output uses panels and status lines. `--json` prints raw JSON.",
      nextStep: `Default config: ${configPath}. ${globalNextStep}`,
    });
  }

  const command = commandForInput(positionals);
  if (command) {
    return renderEntry(`◆ ${command.toUpperCase()} HELP`, commandHelp[command] ?? summarizeCommand(command));
  }

  const groupName = positionals[0];
  const group = groupName ? groupHelp[groupName] : undefined;
  if (group && positionals.length === 1) {
    return renderGroup(groupName, group);
  }

  return renderPanel("◆ COMMAND NOT FOUND", [
    `No shipped command matches: regents ${positionals.join(" ")}`,
    "Check the spelling or run `regents --help`.",
  ]);
}

export function usageHintForPositionals(positionals: readonly string[]): {
  readonly command: string;
  readonly usage: string;
  readonly example?: string;
} | undefined {
  const command = commandForInput(positionals);
  if (!command) {
    return undefined;
  }

  const entry = commandHelp[command] ?? summarizeCommand(command);
  return {
    command: `regents ${command}`,
    usage: entry.usage,
    example: entry.examples?.[0],
  };
}

export function printScopedHelp(positionals: readonly string[], configPath: string): void {
  printText(renderScopedHelp(positionals, configPath));
}
