import { CLI_COMMANDS } from "./command-registry.js";
import { CLI_COMMANDS_BY_TOP_LEVEL_GROUP } from "./generated/cli-command-metadata.js";
import { CLI_PALETTE, printText, renderPanel, tone } from "./printer.js";

interface HelpEntry {
  readonly summary: string;
  readonly usage: string;
  readonly flags?: readonly string[];
  readonly examples?: readonly string[];
  readonly auth: string;
  readonly output: string;
  readonly nextStep: string;
}

interface HelpGroup {
  readonly summary: string;
  readonly auth: string;
  readonly output: string;
  readonly commands: readonly string[];
  readonly nextStep: string;
}

const globalNextStep =
  "For Autolaunch, run `regents auth login --audience autolaunch`, then `regents identity ensure`.";

const commandHelp: Record<string, HelpEntry> = {
  "auth login": {
    summary: "Save an Agent account sign-in for the selected app.",
    usage: "regents auth login --audience <platform|autolaunch|techtree|regent-services>",
    flags: ["--audience <name>", "--wallet-address <address>", "--chain-id <id>", "--config <path>"],
    examples: ["regents auth login --audience autolaunch"],
    auth: "No saved sign-in is needed.",
    output: "Shows the saved account and when it expires.",
    nextStep: "Run `regents identity ensure` before protected commands.",
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
  "regent-staking show": {
    summary: "Show Regent staking totals for the saved Agent account.",
    usage: "regents regent-staking show",
    flags: ["--config <path>"],
    examples: ["regents regent-staking show"],
    auth: "Needs `regents auth login --audience regent-services` and `regents identity ensure`.",
    output: "Shows staking balances and claimable amounts.",
    nextStep: "Use the stake, unstake, or claim command that matches the account state.",
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
  "runtime show": {
    summary: "Show one runtime for a Regent company.",
    usage: "regents runtime show <runtime-id> --company-id <id>",
    flags: ["--company-id <id>", "--origin <url>", "--session-file <path>"],
    examples: ["regents runtime show runtime_123 --company-id company_123"],
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
};

const groupHelp: Record<string, HelpGroup> = {
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
    nextStep: "Start with `regents regent-staking show`.",
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
  runtime: {
    summary: "Manage Regent company runtimes from the terminal.",
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows runtime status, services, health, checkpoints, and restore results. `--json` prints raw JSON.",
    commands: CLI_COMMANDS_BY_TOP_LEVEL_GROUP.runtime,
    nextStep: "Start with `regents runtime show <runtime-id> --company-id <id>` or create a runtime from the company setup.",
  },
  agent: {
    summary: "Manage local Agent setup and Regent company workers.",
    auth: "Worker connection needs `regents auth login --audience platform` and `regents identity ensure`.",
    output: "Shows connected worker ids, work links, and workers a manager can assign.",
    commands: CLI_COMMANDS_BY_TOP_LEVEL_GROUP.agent,
    nextStep: "Use `regents agent connect openclaw --company-id <id> --role executor` for local OpenClaw work.",
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

const summarizeCommand = (command: string): HelpEntry => {
  const group = helpGroupForCommand(command);

  return {
    summary: `Run ${command}.`,
    usage: `regents ${command}`,
    flags: ["--config <path>", "--json where supported"],
    examples: [`regents ${command}`],
    auth: group?.auth ?? "Check the command group help for sign-in needs.",
    output: "Prints command results. `--json` keeps output script-safe where supported.",
    nextStep: group?.nextStep ?? globalNextStep,
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
    entry.flags?.length
      ? renderPanel("◆ FLAGS", entry.flags.map((flag) => flag))
      : undefined,
    entry.examples?.length
      ? renderPanel("◆ EXAMPLES", entry.examples.map((example) => example))
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
      flags: ["--config <path>", "--help", "--json where supported"],
      examples: [
        "regents auth login --audience autolaunch",
        "regents identity ensure",
        "regents autolaunch agents list --launchable",
      ],
      auth: "Protected commands use a saved Agent account.",
      output: "Human output uses panels and status lines. `--json` prints raw JSON.",
      nextStep: `${globalNextStep} Default config: ${configPath}`,
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

export function printScopedHelp(positionals: readonly string[], configPath: string): void {
  printText(renderScopedHelp(positionals, configPath));
}
