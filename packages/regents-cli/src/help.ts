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

const techtreeFailureChecks = [
  "If the command cannot connect locally, start `regents run` in another terminal.",
  "If the command says auth is missing, run `regents auth login --audience techtree` and `regents identity ensure`.",
  "If a workspace path is missing, create or pass the same folder path through the whole Techtree flow.",
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
      "--runtime hermes installs only the Hermes tools. Use this for a Hermes agent.",
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
      "Shows which runtime was selected and which tool files were written. If you installed the wrong runtime, nothing dangerous happened; run this command again with the runtime used by the agent app.",
    nextStep:
      "Run `regents plugin status --runtime hermes` or `regents plugin status --runtime openclaw` to confirm the intended agent app can see Regent, then start Regent with `regents run`.",
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
    auth: detail ? generatedAuthText(detail, group) : group?.auth ?? "Check the command group help for sign-in needs.",
    output: detail ? generatedOutputText(detail) : "Prints command results. `--json` keeps output script-safe where supported.",
    nextStep: detail?.next_step ?? group?.nextStep ?? globalNextStep,
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
