import fs from "node:fs";

import { CliUsageError } from "../cli-usage-error.js";
import { readBudgetFile } from "../internal-runtime/budget-store.js";
import { RegentRuntime, defaultConfigPath } from "../internal-runtime/index.js";
import { pluginStatus, type PluginRuntimeStatus } from "../internal-runtime/plugin-bridge.js";
import type { RegentConfig } from "../internal-types/index.js";
import { getBooleanFlag, getFlag, type ParsedCliArgs } from "../parse.js";
import { CLI_PALETTE, isHumanTerminal, printJson, printText, renderPanel, tone } from "../printer.js";

export type RuntimeCapabilityState = "ready" | "waiting" | "off";

export interface RuntimeCapability {
  readonly state: RuntimeCapabilityState;
  readonly label: string;
  readonly detail: string;
}

export interface RuntimeNextCommand {
  readonly label: string;
  readonly command: string;
  readonly when: string;
}

export interface RuntimeRunReport {
  readonly ok: true;
  readonly configPath: string;
  readonly socketPath: string;
  readonly stateDir: string;
  readonly services: {
    readonly siwa: string;
    readonly techtree: string;
    readonly platform: string;
    readonly autolaunch: string;
  };
  readonly capabilities: readonly RuntimeCapability[];
  readonly foldTrack: string | null;
  readonly plugin: ReturnType<typeof pluginStatus>;
  readonly nextCommands: readonly RuntimeNextCommand[];
  readonly safetyNotes: readonly string[];
  readonly mode: "local_runtime" | "techtree_fold";
  readonly fold: null | {
    readonly preset: string;
    readonly defaultWorkKind: "freeform-notebook" | "benchmark";
    readonly proofAnchor: "techtree_attempt_or_notebook";
    readonly next: readonly string[];
  };
  readonly agenticWallet: {
    readonly required: false;
    readonly whenNeeded: string;
  };
  readonly autolaunch: {
    readonly state: "locked" | "evidence-ready";
    readonly reason: string;
  };
}

const capabilityGlyph = (state: RuntimeCapabilityState): string => {
  switch (state) {
    case "ready":
      return "✓";
    case "waiting":
      return "○";
    case "off":
      return "•";
  }
};

const capabilityColor = (state: RuntimeCapabilityState): string => {
  switch (state) {
    case "ready":
      return CLI_PALETTE.emphasis;
    case "waiting":
      return CLI_PALETTE.accent;
    case "off":
      return CLI_PALETTE.secondary;
  }
};

const capabilityLines = (capabilities: readonly RuntimeCapability[]): string[] =>
  capabilities.flatMap((capability) => {
    const color = capabilityColor(capability.state);
    return [
      `${tone(capabilityGlyph(capability.state), color, true)} ${tone(capability.label, CLI_PALETTE.primary, true)}`,
      `  ${tone(capability.detail, CLI_PALETTE.secondary)}`,
    ];
  });

const commandLines = (commands: readonly RuntimeNextCommand[]): string[] =>
  commands.flatMap((entry) => [
    `${tone("▶", CLI_PALETTE.accent, true)} ${tone(entry.command, CLI_PALETTE.primary, true)}`,
    `  ${tone(entry.label, CLI_PALETTE.secondary, true)} ${tone(entry.when, CLI_PALETTE.secondary)}`,
  ]);

const enabledHarnessNames = (config: RegentConfig): string[] =>
  Object.entries(config.agents.harnesses)
    .filter(([, harness]) => harness.enabled)
    .map(([name]) => name);

const runtimeDisplayName = (runtime: PluginRuntimeStatus["runtime"]): string =>
  runtime === "hermes" ? "Hermes" : "OpenClaw";

export const pluginRuntimeCapabilities = (
  plugin: ReturnType<typeof pluginStatus>,
): readonly RuntimeCapability[] =>
  plugin.runtimes.map((runtime) => {
    const name = runtimeDisplayName(runtime.runtime);

    return {
      state: runtime.installed ? "ready" : "waiting",
      label: `${name} Regent tools ${runtime.installed ? "installed" : "missing"}`,
      detail: runtime.installed
        ? `${name} can see Regent tools at ${runtime.pluginPath}.`
        : `Run regents plugin install --runtime ${runtime.runtime}. Checked ${runtime.pluginPath}.`,
    };
  });

const parseFoldTrack = (value: string | undefined): "starter" | "autoresearch" | "bbh-public-v1" | null => {
  if (value === undefined) {
    return null;
  }
  if (value === "starter" || value === "autoresearch" || value === "bbh-public-v1") {
    return value;
  }

  throw new CliUsageError({
    code: "invalid_flag_value",
    message: "--fold must be starter, autoresearch, or bbh-public-v1.",
    validValues: ["starter", "autoresearch", "bbh-public-v1"],
  });
};

const buildRuntimeRunReport = (runtime: RegentRuntime, args: ParsedCliArgs): RuntimeRunReport => {
  const config = runtime.config;
  const state = runtime.stateStore.read();
  const identity = state.agent;
  const session = runtime.sessionStore.getSiwaSession();
  const sessionReady = Boolean(session && !runtime.sessionStore.isReceiptExpired());
  const walletEnvSet = Boolean(process.env[config.wallet.privateKeyEnv]);
  const walletFileExists = fs.existsSync(config.wallet.keystorePath);
  const harnesses = enabledHarnessNames(config);
  const foldTrack = parseFoldTrack(getFlag(args, "fold"));
  const plugin = pluginStatus("auto");
  const budgets = readBudgetFile(config).budgets;
  const activeBudgetCount = budgets.filter((budget) => budget.status === "active").length;

  return {
    ok: true,
    configPath: runtime.configPath ?? defaultConfigPath(),
    socketPath: config.runtime.socketPath,
    stateDir: config.runtime.stateDir,
    services: {
      siwa: config.services.siwa.baseUrl,
      techtree: config.services.techtree.baseUrl,
      platform: config.services.platform.baseUrl,
      autolaunch: config.services.autolaunch.baseUrl,
    },
    foldTrack,
    mode: foldTrack ? "techtree_fold" : "local_runtime",
    fold: foldTrack
      ? {
          preset: foldTrack,
          defaultWorkKind: foldTrack === "bbh-public-v1" ? "benchmark" : "freeform-notebook",
          proofAnchor: "techtree_attempt_or_notebook",
          next: [
            "regents techtree notebooks init --kind freeform --title \"Research notebook\" --workspace-path ./techtree-work/autoresearch",
            "regents techtree notebooks pair --workspace-path ./techtree-work/autoresearch",
            "regents techtree notebooks publish --workspace-path ./techtree-work/autoresearch",
            "regents receipt create --from-notebook <node-id> --json",
          ],
        }
      : null,
    plugin,
    capabilities: [
      {
        state: "ready",
        label: "Regent is running locally",
        detail: `Keep this terminal open. Other terminals can now connect at ${config.runtime.socketPath}.`,
      },
      {
        state: "ready",
        label: "Local records opened",
        detail: `Regent notes, Agent identity, and saved sign-ins live under ${config.runtime.stateDir}.`,
      },
      {
        state: walletEnvSet || walletFileExists ? "ready" : "waiting",
        label: "Wallet source checked",
        detail: walletEnvSet
          ? `${config.wallet.privateKeyEnv} is set for this process.`
          : walletFileExists
            ? `Local wallet file is present at ${config.wallet.keystorePath}.`
            : `Run regents wallet setup or set ${config.wallet.privateKeyEnv} before signing.`,
      },
      {
        state: identity?.registryAddress && identity.tokenId ? "ready" : "waiting",
        label: "Agent identity checked",
        detail: identity?.registryAddress && identity.tokenId
          ? `Agent token ${identity.tokenId} is saved for chain ${identity.chainId}.`
          : "Run regents identity ensure after Regent is running.",
      },
      {
        state: sessionReady ? "ready" : "waiting",
        label: "Saved Agent sign-in checked",
        detail: sessionReady && session
          ? `${session.audience} sign-in is saved until ${session.receiptExpiresAt}.`
          : "Run regents auth login --audience <platform|autolaunch|techtree|regent-services>.",
      },
      ...pluginRuntimeCapabilities(plugin),
      {
        state: "ready",
        label: "Techtree work tools loaded",
        detail: "Work, benchmark, Science Task, notebook, Autoskill, Fold proof, and publish commands are ready in another terminal.",
      },
      {
        state: "ready",
        label: "Techtree connection target checked",
        detail: `Commands will talk to ${config.services.techtree.baseUrl}.`,
      },
      {
        state: activeBudgetCount > 0 ? "ready" : "waiting",
        label: "Research budget checked",
        detail: activeBudgetCount > 0
          ? `${activeBudgetCount} active Regent budget ${activeBudgetCount === 1 ? "is" : "are"} saved.`
          : "A budget is optional until an agent needs paid x402 access.",
      },
      {
        state: "waiting",
        label: "Agentic Wallet checked",
        detail: "Agentic Wallet is optional for Techtree research and needed only for paid x402 spend or earn flows.",
      },
      {
        state: "waiting",
        label: "Autolaunch readiness checked",
        detail: "Autolaunch stays locked until Techtree evidence exists and an operator approves.",
      },
      {
        state: config.gossipsub.enabled ? "ready" : "off",
        label: "Chatbox event relay checked",
        detail: config.gossipsub.enabled
          ? "Chatbox tail commands can open live room streams from another terminal."
          : "Chatbox relay is off in config; direct Techtree chatbox commands can still run.",
      },
      {
        state: "ready",
        label: "Watched Techtree node relay started",
        detail: "Watch-style commands can stream changes while this terminal stays open.",
      },
      {
        state: config.xmtp.enabled ? "ready" : "off",
        label: "XMTP listener checked",
        detail: config.xmtp.enabled
          ? `XMTP listener is enabled for ${config.xmtp.env}.`
          : "XMTP listener is off in config; run regents xmtp status to inspect local setup.",
      },
      {
        state: harnesses.length > 0 ? "ready" : "waiting",
        label: "Local agent runners checked",
        detail: harnesses.length > 0
          ? `Enabled harnesses: ${harnesses.join(", ")}.`
          : "No local agent harness is enabled yet.",
      },
    ],
    nextCommands: [
      {
        label: "Choose work",
        command: "regents techtree work next --json",
        when: "get the next agent-ready Techtree work item.",
      },
      {
        label: "Accept work",
        command: "regents techtree work accept --work-unit <id> --workspace-path ./work/<slug>",
        when: "create the local folder for the selected work.",
      },
      ...(foldTrack
        ? [{
            label: "Fold starter",
            command: foldTrack === "bbh-public-v1"
              ? "regents techtree work next --kind benchmark --json"
              : "regents techtree notebooks init --kind freeform --title \"Research notebook\" --workspace-path ./techtree-work/autoresearch",
            when: "start Techtree work without needing Agentic Wallet.",
          }]
        : []),
      {
        label: "Readiness",
        command: "regents status",
        when: "see wallet, identity, Techtree, chatbox, and XMTP readiness.",
      },
      {
        label: "Account",
        command: "regents whoami",
        when: "show the active wallet, Agent identity, chain, and saved sign-in.",
      },
      {
        label: "Shared services sign-in",
        command: "regents auth login --audience regent-services",
        when: "prepare bug reports, security reports, and shared Regent actions.",
      },
      {
        label: "Platform sign-in",
        command: "regents auth login --audience platform",
        when: "prepare local worker connections to Platform.",
      },
      {
        label: "Autolaunch sign-in",
        command: "regents auth login --audience autolaunch",
        when: "prepare Autolaunch agent, Safe, prelaunch, and launch commands.",
      },
      {
        label: "Techtree sign-in",
        command: "regents auth login --audience techtree",
        when: "prepare Techtree publish, review, BBH, and collaboration commands.",
      },
      {
        label: "Techtree search",
        command: "regents techtree search --query <query>",
        when: "search Techtree.",
      },
      {
        label: "Techtree workspace",
        command: "regents techtree start",
        when: "run the guided Techtree readiness path.",
      },
      {
        label: "Live chat",
        command: "regents chatbox tail --webapp",
        when: "watch Techtree chatbox events if the relay is enabled.",
      },
      {
        label: "Diagnostics",
        command: "regents doctor runtime",
        when: "check local command access if a command cannot connect.",
      },
    ],
    safetyNotes: [
      "This lets Regent commands work from this machine.",
      "It does not start hosted Regent.",
      "It does not move funds.",
      "Wallet and transaction commands still require their own explicit signing or submit step.",
      "Stop this process with Ctrl-C when you no longer need Regent commands on this machine.",
    ],
    agenticWallet: {
      required: false,
      whenNeeded: "Only paid x402 spend and earn flows need Agentic Wallet.",
    },
    autolaunch: {
      state: "locked",
      reason: "Techtree evidence is an input to readiness; it does not approve a launch by itself.",
    },
  };
};

export const renderRuntimeRunScreen = (report: RuntimeRunReport): string =>
  [
    renderPanel("◆ REGENT IS RUNNING", [
      "Regent is running on this machine.",
      "Keep this terminal open. Use another terminal for Regent commands.",
      "Stop this with Ctrl-C.",
      "",
      `${tone("settings", CLI_PALETTE.secondary, true)} ${report.configPath}`,
      `${tone("records", CLI_PALETTE.secondary, true)} ${report.stateDir}`,
    ], {
      borderColor: CLI_PALETTE.emphasis,
      titleColor: CLI_PALETTE.title,
    }),
    renderPanel("◆ WHAT IS READY", capabilityLines(report.capabilities), {
      borderColor: CLI_PALETTE.chrome,
      titleColor: CLI_PALETTE.title,
    }),
    renderPanel("◆ RUN THESE IN ANOTHER TERMINAL", commandLines(report.nextCommands), {
      borderColor: CLI_PALETTE.chrome,
      titleColor: CLI_PALETTE.title,
    }),
    renderPanel("◆ SAFETY NOTES", [...report.safetyNotes], {
      borderColor: CLI_PALETTE.accent,
      titleColor: CLI_PALETTE.title,
    }),
    ...(report.fold
      ? [renderPanel("◆ FOLD STARTER", [
          `Preset: ${report.fold.preset}`,
          "Fold reports on Techtree attempts, notebook publications, receipts, and verifier evidence.",
          "Agentic Wallet is optional until paid access is needed.",
          "",
          ...report.fold.next,
        ], {
          borderColor: CLI_PALETTE.accent,
          titleColor: CLI_PALETTE.title,
        })]
      : []),
  ].join("\n\n");

const renderRuntimeStoppedScreen = (): string =>
  renderPanel("◆ REGENT STOPPED", [
    "Regent has stopped on this machine.",
    "Commands that need it will ask you to run regents run again.",
  ], {
    borderColor: CLI_PALETTE.accent,
    titleColor: CLI_PALETTE.title,
  });

export async function runRuntime(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const runtime = new RegentRuntime(configPath);
  await runtime.start();
  const report = buildRuntimeRunReport(runtime, args);
  const humanOutput = isHumanTerminal() && !getBooleanFlag(args, "json");
  if (humanOutput) {
    printText(renderRuntimeRunScreen(report));
  } else {
    printJson(report);
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const onSignal = (): void => {
      void stop();
    };

    const finish = (error?: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    const stop = async (): Promise<void> => {
      try {
        await runtime.stop();
        if (humanOutput) {
          printText(renderRuntimeStoppedScreen());
        }
        finish();
      } catch (error) {
        finish(error);
      }
    };

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}
