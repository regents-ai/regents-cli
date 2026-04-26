import { CLI_COMMANDS, commandMatchesInput } from "./command-registry.js";
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
};

const groupHelp: Record<string, HelpGroup> = {
  autolaunch: {
    summary: "Launch and manage Agent account projects from the terminal.",
    auth: "Most commands need `regents auth login --audience autolaunch` and `regents identity ensure`.",
    output: "Human output uses panels and status lines. `--json` prints raw JSON.",
    commands: CLI_COMMANDS.filter((command) => command.startsWith("autolaunch ")),
    nextStep: "Start with `regents autolaunch agents list --launchable` or `regents autolaunch prelaunch wizard`.",
  },
  auth: {
    summary: "Manage saved Agent account sign-ins.",
    auth: "No saved sign-in is needed.",
    output: "Shows the saved session, account, and expiry.",
    commands: CLI_COMMANDS.filter((command) => command.startsWith("auth ")),
    nextStep: "For Autolaunch, run `regents auth login --audience autolaunch`.",
  },
  identity: {
    summary: "Create or refresh the local Agent account.",
    auth: "Uses the local wallet configured for Regent.",
    output: "Shows wallet, chain, registry, token, and saved status.",
    commands: CLI_COMMANDS.filter((command) => command.startsWith("identity ")),
    nextStep: "Run `regents identity ensure` after signing in.",
  },
  "regent-staking": {
    summary: "Manage Regent staking for the saved Agent account.",
    auth: "Needs `regents auth login --audience regent-services` and `regents identity ensure`.",
    output: "Shows balances, prepared actions, and claim results.",
    commands: CLI_COMMANDS.filter((command) => command.startsWith("regent-staking ")),
    nextStep: "Start with `regents regent-staking show`.",
  },
  platform: {
    summary: "Use the Regent website account from the terminal.",
    auth: "Use `regents platform auth login` with a Platform identity token.",
    output: "Shows account, readiness, billing, and runtime status. Some beta actions return an unavailable status.",
    commands: CLI_COMMANDS.filter((command) => command.startsWith("platform ")),
    nextStep: "Start with `regents platform auth login`, then `regents platform formation status`.",
  },
};

const commandForInput = (positionals: readonly string[]): string | null => {
  for (const command of CLI_COMMANDS) {
    if (commandMatchesInput(command, positionals)) {
      return command;
    }
  }

  return null;
};

const summarizeCommand = (command: string): HelpEntry => ({
  summary: `Run ${command}.`,
  usage: `regents ${command}`,
  flags: ["--config <path>", "--json where supported"],
  examples: [`regents ${command}`],
  auth: command.startsWith("autolaunch ")
    ? groupHelp.autolaunch.auth
    : command.startsWith("regent-staking ")
      ? groupHelp["regent-staking"].auth
      : command.startsWith("platform ")
        ? groupHelp.platform.auth
      : "Check the command group help for sign-in needs.",
  output: "Prints command results. `--json` keeps output script-safe where supported.",
  nextStep: globalNextStep,
});

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
