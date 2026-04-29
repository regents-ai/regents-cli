import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";

import type { AuthStatusResponse, DoctorReport, RegentConfig } from "../internal-types/index.js";

import {
  callJsonRpc,
  defaultConfigPath,
  loadConfig,
  runDoctor,
  runScopedDoctor,
  writeInitialConfigIfMissing,
} from "../internal-runtime/index.js";
import { getBooleanFlag, getFlag, type ParsedCliArgs, parseCliArgs } from "../parse.js";
import { CLI_PALETTE, isHumanTerminal, printText, renderPanel, tone } from "../printer.js";
import { renderDoctorReport } from "../printers/doctorPrinter.js";
import {
  listTechtreeIdentities,
  mintTechtreeIdentity,
  type TechtreeIdentityListResult as IdentityListResult,
  type TechtreeIdentityMintResult as IdentityMintResult,
} from "./techtree-identities.js";

type WizardStep =
  | "config"
  | "runtime"
  | "wallet"
  | "identity"
  | "auth"
  | "techtree"
  | "bbh";

interface StartWizardResult {
  readonly ready: boolean;
  readonly createdConfig: boolean;
  readonly daemonStarted: boolean;
  readonly configPath: string;
  readonly baseUrl: string;
  readonly walletEnvName: string;
  readonly selectedIdentity: { registryAddress: string; tokenId: string } | null;
}

interface StartWizardDeps {
  readonly writeInitialConfigIfMissing: typeof writeInitialConfigIfMissing;
  readonly loadConfig: typeof loadConfig;
  readonly callJsonRpc: typeof callJsonRpc;
  readonly runDoctor: typeof runDoctor;
  readonly runScopedDoctor: typeof runScopedDoctor;
  readonly listIdentities: typeof listTechtreeIdentities;
  readonly mintIdentity: typeof mintTechtreeIdentity;
  readonly authStatus: (configPath?: string) => Promise<{
    authenticated: boolean;
    protectedRoutesReady: boolean;
    missingIdentityFields: string[];
    agentIdentity: {
      registryAddress?: string;
      tokenId?: string;
    } | null;
  }>;
  readonly authLogin: (
    params: {
      registryAddress: `0x${string}`;
      tokenId: string;
    },
    configPath?: string,
  ) => Promise<unknown>;
  readonly bbhProbe: (configPath?: string) => Promise<unknown>;
  readonly printText: typeof printText;
  readonly renderDoctorReport: typeof renderDoctorReport;
  readonly isHumanTerminal: typeof isHumanTerminal;
  readonly promptConfirm: (message: string) => Promise<boolean>;
  readonly promptChoice: (message: string, options: readonly string[]) => Promise<number>;
  readonly wait: (ms: number) => Promise<void>;
  readonly spawnDetachedRuntime: (configPath?: string) => Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ensureRuntimeDirs = (config: RegentConfig, configPath: string): void => {
  const dirs = [
    path.dirname(configPath),
    config.runtime.stateDir,
    path.dirname(config.runtime.socketPath),
    path.dirname(config.wallet.keystorePath),
    path.dirname(config.xmtp.dbPath),
    path.dirname(config.xmtp.publicPolicyPath),
    path.dirname(config.gossipsub.peerIdPath),
    config.workloads.bbh.workspaceRoot,
    ...Object.values(config.agents.harnesses).map((harness) => harness.workspaceRoot),
  ];

  for (const dirPath of dirs) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const withDefaultBaseSepoliaChain = (args: ParsedCliArgs): ParsedCliArgs => {
  if (getFlag(args, "chain") || getFlag(args, "chain-id")) {
    return args;
  }

  return parseCliArgs([...args.raw, "--chain", "base-sepolia"]);
};

const promptConfirm = async (message: string): Promise<boolean> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
};

const promptChoice = async (message: string, options: readonly string[]): Promise<number> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const choice = (await rl.question(`${message} [1-${options.length}] `)).trim();
      const index = Number.parseInt(choice, 10);
      if (Number.isSafeInteger(index) && index >= 1 && index <= options.length) {
        return index - 1;
      }
    }
  } finally {
    rl.close();
  }
};

const spawnDetachedRuntime = async (configPath?: string): Promise<void> => {
  const invokedPath = process.argv[1];
  if (!invokedPath) {
    throw new Error("unable to resolve the current Regents CLI entrypoint for daemon startup");
  }

  const child = spawn(process.execPath, [invokedPath, "run", ...(configPath ? ["--config", configPath] : [])], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
};

const defaultAuthStatus = async (configPath?: string): Promise<AuthStatusResponse> => {
  return await callJsonRpc(
    loadConfig(configPath).runtime.socketPath,
    "auth.siwa.status",
  ) as unknown as AuthStatusResponse;
};

const defaultAuthLogin = async (
  params: {
    registryAddress: `0x${string}`;
    tokenId: string;
  },
  configPath?: string,
): Promise<unknown> => {
  return callJsonRpc(
    loadConfig(configPath).runtime.socketPath,
    "auth.siwa.login",
    params,
  );
};

const defaultBbhProbe = async (configPath?: string): Promise<unknown> => {
  return callJsonRpc(
    loadConfig(configPath).runtime.socketPath,
    "techtree.v1.bbh.leaderboard",
    { split: "benchmark" },
  );
};

export const startWizardDeps: StartWizardDeps = {
  writeInitialConfigIfMissing,
  loadConfig,
  callJsonRpc,
  runDoctor,
  runScopedDoctor,
  listIdentities: listTechtreeIdentities,
  mintIdentity: mintTechtreeIdentity,
  authStatus: defaultAuthStatus,
  authLogin: defaultAuthLogin,
  bbhProbe: defaultBbhProbe,
  printText,
  renderDoctorReport,
  isHumanTerminal,
  promptConfirm,
  promptChoice,
  wait: sleep,
  spawnDetachedRuntime,
};

const wizardHeader = (configPath: string): string =>
  renderPanel("◆ T E C H T R E E   S T A R T", [
    tone("guided local setup for Techtree", CLI_PALETTE.secondary),
    `${tone("config", CLI_PALETTE.secondary)} ${tone(configPath, CLI_PALETTE.primary, true)}`,
    "",
    `${tone("checks", CLI_PALETTE.accent, true)} local config, wallet, runtime, identity, and readiness`,
    `${tone("prep", CLI_PALETTE.accent, true)} Base Sepolia RPC plus Base Sepolia ETH only matter if this start needs to mint a new agent identity`,
    `${tone("prep", CLI_PALETTE.accent, true)} Techtree services must already be reachable for local testing`,
  ], {
    borderColor: CLI_PALETTE.chrome,
    titleColor: CLI_PALETTE.title,
  });

const renderProgressPanel = (completed: readonly WizardStep[], current: WizardStep): string => {
  const stages: readonly WizardStep[] = ["config", "runtime", "wallet", "identity", "auth", "techtree", "bbh"];
  const labels: Record<WizardStep, string> = {
    config: "Config",
    runtime: "Runtime",
    wallet: "Wallet",
    identity: "Identity",
    auth: "Auth",
    techtree: "Techtree",
    bbh: "BBH",
  };
  const completedSet = new Set(completed);
  return renderPanel("◆ START PROGRESS", stages.map((stage, index) => {
    const done = completedSet.has(stage);
    const active = stage === current;
    const glyph = done ? "✓" : active ? "▶" : "•";
    const color = done ? CLI_PALETTE.emphasis : active ? CLI_PALETTE.accent : CLI_PALETTE.secondary;
    return `${tone(`${index + 1}. ${labels[stage]}`, CLI_PALETTE.primary, done || active)} ${tone(glyph, color, true)} ${tone(done ? "done" : active ? "now" : "next", color)}`;
  }), {
    borderColor: CLI_PALETTE.emphasis,
    titleColor: CLI_PALETTE.title,
  });
};

const stepPanel = (title: string, lines: string[]): string =>
  renderPanel(title, lines, { borderColor: CLI_PALETTE.chrome, titleColor: CLI_PALETTE.title });

const blockerPanel = (step: WizardStep, message: string, lines: string[]): string =>
  renderPanel(`◆ START BLOCKED · ${step.toUpperCase()}`, [message, "", ...lines], {
    borderColor: CLI_PALETTE.accent,
    titleColor: CLI_PALETTE.title,
  });

const nextCommandPanel = (title: string, commands: string[]): string =>
  renderPanel(title, commands.map((command) => `${tone("▶", CLI_PALETTE.accent, true)} ${command}`), {
    borderColor: CLI_PALETTE.emphasis,
    titleColor: CLI_PALETTE.title,
  });

const doctorFailures = (report: DoctorReport): string =>
  startWizardDeps.renderDoctorReport(report, { onlyFailures: true });

const waitForRuntimeSocket = async (config: RegentConfig): Promise<boolean> => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await startWizardDeps.callJsonRpc(config.runtime.socketPath, "runtime.ping");
      return true;
    } catch {
      await startWizardDeps.wait(250);
    }
  }

  return false;
};

const chooseIdentity = async (
  identities: IdentityListResult,
  args: ParsedCliArgs,
): Promise<{ registryAddress: string; tokenId: string } | null> => {
  const explicitRegistry = getFlag(args, "registry-address");
  const explicitTokenId = getFlag(args, "token-id");
  if ((explicitRegistry && !explicitTokenId) || (!explicitRegistry && explicitTokenId)) {
    throw new Error("use --registry-address and --token-id together");
  }

  if (explicitRegistry && explicitTokenId) {
    return {
      registryAddress: explicitRegistry,
      tokenId: explicitTokenId,
    };
  }

  if (identities.launchable.length === 0) {
    return null;
  }

  if (identities.launchable.length === 1) {
    return {
      registryAddress: identities.launchable[0].registry_address,
      tokenId: identities.launchable[0].token_id,
    };
  }

  const choices = identities.launchable.map(
    (identity) => `${identity.name} · ${identity.access_mode} · token ${identity.token_id}`,
  );

  if (!startWizardDeps.isHumanTerminal()) {
    return {
      registryAddress: identities.launchable[0].registry_address,
      tokenId: identities.launchable[0].token_id,
    };
  }

  startWizardDeps.printText(stepPanel("◆ IDENTITY PICK", choices.map((choice, index) => `${index + 1}. ${choice}`)));
  const selected = await startWizardDeps.promptChoice("Choose the Techtree identity to use for this machine", choices);
  const identity = identities.launchable[selected];
  return {
    registryAddress: identity.registry_address,
    tokenId: identity.token_id,
  };
};

const tokenIdFromAgentId = (agentId: string | null): string | null => {
  if (!agentId) {
    return null;
  }

  const parts = agentId.split(":");
  return parts.length === 2 ? parts[1] ?? null : null;
};

const ensureIdentity = async (
  args: ParsedCliArgs,
  configPath: string,
): Promise<{ registryAddress: string; tokenId: string } | null> => {
  const identityArgs = withDefaultBaseSepoliaChain(args);
  const existing = await startWizardDeps.listIdentities(identityArgs);
  const chosenExisting = await chooseIdentity(existing, args);
  if (chosenExisting) {
    startWizardDeps.printText(stepPanel("◆ IDENTITY READY", [
      `${tone("registry", CLI_PALETTE.secondary)} ${chosenExisting.registryAddress}`,
      `${tone("token", CLI_PALETTE.secondary)} ${chosenExisting.tokenId}`,
    ]));
    return chosenExisting;
  }

  const rpcReady = Boolean(getFlag(identityArgs, "rpc-url") || process.env.BASE_SEPOLIA_RPC_URL);
  if (!rpcReady) {
    startWizardDeps.printText(blockerPanel("identity", "No Techtree agent identity was found.", [
      "To mint one from this guided start, set BASE_SEPOLIA_RPC_URL first.",
      "Minting is a real Base Sepolia transaction, so the wallet also needs Base Sepolia ETH.",
      "",
      `Rerun: ${configRerunCommand(configPath, ["--mint"])}`,
    ]));
    return null;
  }

  const wantsMintFlag = getBooleanFlag(args, "mint") || getBooleanFlag(args, "yes");
  let shouldMint = wantsMintFlag;
  if (!shouldMint) {
    if (!startWizardDeps.isHumanTerminal()) {
      startWizardDeps.printText(blockerPanel("identity", "No Techtree agent identity was found.", [
        "This guided start can mint one, but only with explicit confirmation.",
        "Rerun with `--mint` after confirming the wallet has Base Sepolia ETH.",
      ]));
      return null;
    }

    shouldMint = await startWizardDeps.promptConfirm(
      "No Techtree identity is ready. Mint a new Base Sepolia ERC-8004 identity now so the guided start can continue?",
    );
  }

  if (!shouldMint) {
    startWizardDeps.printText(blockerPanel("identity", "Identity minting was declined.", [
      "Nothing was changed.",
      "When you are ready, rerun `regents techtree start --mint` to continue the guided start.",
    ]));
    return null;
  }

  let minted: IdentityMintResult;
  try {
    minted = await startWizardDeps.mintIdentity(identityArgs);
  } catch (error) {
    startWizardDeps.printText(blockerPanel("identity", "Identity minting failed.", [
      error instanceof Error ? error.message : String(error),
      "",
      "Common causes:",
      "• missing Base Sepolia ETH",
      "• a bad or rate-limited Base Sepolia RPC URL",
      "• the wallet key not matching the intended funding account",
    ]));
    return null;
  }

  const tokenId = tokenIdFromAgentId(minted.agent_id);
  if (!tokenId) {
    startWizardDeps.printText(blockerPanel("identity", "Identity minting finished, but the new token id could not be read.", [
      `transaction ${minted.tx_hash}`,
      "Re-run `regents techtree start --mint`, or inspect the identity manually with `regents techtree identities list --chain base-sepolia`.",
    ]));
    return null;
  }

  const selected = {
    registryAddress: minted.registry_address,
    tokenId,
  };
  startWizardDeps.printText(stepPanel("◆ IDENTITY MINTED", [
    `${tone("registry", CLI_PALETTE.secondary)} ${selected.registryAddress}`,
    `${tone("token", CLI_PALETTE.secondary)} ${selected.tokenId}`,
    `${tone("tx", CLI_PALETTE.secondary)} ${minted.tx_hash}`,
  ]));
  return selected;
};

const configRerunCommand = (configPath: string, extra: string[] = []): string =>
  ["regents", "techtree", "start", "--config", configPath, ...extra].join(" ");

export async function runTechtreeStart(args: ParsedCliArgs, configPath?: string): Promise<StartWizardResult> {
  const resolvedConfigPath = configPath ?? defaultConfigPath();
  startWizardDeps.printText(wizardHeader(resolvedConfigPath));

  const createdConfig = startWizardDeps.writeInitialConfigIfMissing(resolvedConfigPath);
  const config = startWizardDeps.loadConfig(resolvedConfigPath);
  ensureRuntimeDirs(config, resolvedConfigPath);
  startWizardDeps.printText(renderProgressPanel([], "config"));

  startWizardDeps.printText(stepPanel("◆ LOCAL READY", [
    createdConfig ? "Created a fresh local Regent config." : "Reused the existing local Regent config.",
    `${tone("backend", CLI_PALETTE.secondary)} ${config.services.techtree.baseUrl}`,
    `${tone("wallet env", CLI_PALETTE.secondary)} ${config.wallet.privateKeyEnv}`,
  ]));

  const runtimeReport = await startWizardDeps.runScopedDoctor({ scope: "runtime" }, { configPath: resolvedConfigPath });
  const runtimeBlocking = runtimeReport.checks.find((check) => check.id === "runtime.wallet.source" && check.status === "fail");
  if (runtimeBlocking) {
    startWizardDeps.printText(renderProgressPanel(["config"], "runtime"));
    startWizardDeps.printText(blockerPanel("wallet", runtimeBlocking.message, [
      `Fix now: set ${config.wallet.privateKeyEnv} before rerunning the guided start.`,
      `If you need a throwaway wallet file first, run \`regents create wallet --write-env\`.`,
      `Rerun: ${configRerunCommand(resolvedConfigPath)}`,
    ]));
    startWizardDeps.printText(doctorFailures(runtimeReport));
    return {
      ready: false,
      createdConfig,
      daemonStarted: false,
      configPath: resolvedConfigPath,
      baseUrl: config.services.techtree.baseUrl,
      walletEnvName: config.wallet.privateKeyEnv,
      selectedIdentity: null,
    };
  }

  let daemonStarted = false;
  try {
    await startWizardDeps.callJsonRpc(config.runtime.socketPath, "runtime.ping");
  } catch {
    await startWizardDeps.spawnDetachedRuntime(resolvedConfigPath);
    daemonStarted = await waitForRuntimeSocket(config);
    if (!daemonStarted) {
      const refreshedRuntimeReport = await startWizardDeps.runScopedDoctor(
        { scope: "runtime" },
        { configPath: resolvedConfigPath },
      );
      startWizardDeps.printText(blockerPanel("runtime", "The local Regent runtime did not come up in time.", [
        "Fix now: start the runtime manually with the command below, or rerun the guided start.",
        "The guided start tried to start it automatically, but the runtime socket never became reachable.",
        `Try this manually: regents run --config ${resolvedConfigPath}`,
      ]));
      startWizardDeps.printText(doctorFailures(refreshedRuntimeReport));
      return {
        ready: false,
        createdConfig,
        daemonStarted: false,
        configPath: resolvedConfigPath,
        baseUrl: config.services.techtree.baseUrl,
        walletEnvName: config.wallet.privateKeyEnv,
        selectedIdentity: null,
      };
    }
  }

  startWizardDeps.printText(renderProgressPanel(["config", "runtime"], "wallet"));
  startWizardDeps.printText(stepPanel("◆ RUNTIME READY", [
    daemonStarted ? "Started the local Regent runtime in the background." : "Local Regent runtime already reachable.",
    `${tone("socket", CLI_PALETTE.secondary)} ${config.runtime.socketPath}`,
  ]));

  const identity = await ensureIdentity(args, resolvedConfigPath);
  if (!identity) {
    startWizardDeps.printText(renderProgressPanel(["config", "runtime"], "identity"));
    return {
      ready: false,
      createdConfig,
      daemonStarted,
      configPath: resolvedConfigPath,
      baseUrl: config.services.techtree.baseUrl,
      walletEnvName: config.wallet.privateKeyEnv,
      selectedIdentity: null,
    };
  }

  const authStatus = await startWizardDeps.authStatus(resolvedConfigPath);
  const alreadyBound =
    authStatus.protectedRoutesReady &&
    authStatus.agentIdentity?.registryAddress === identity.registryAddress &&
    authStatus.agentIdentity?.tokenId === identity.tokenId;

  if (!alreadyBound) {
    try {
      await startWizardDeps.authLogin(
        {
          registryAddress: identity.registryAddress as `0x${string}`,
          tokenId: identity.tokenId,
        },
        resolvedConfigPath,
      );
    } catch (error) {
      const authReport = await startWizardDeps.runScopedDoctor({ scope: "auth" }, { configPath: resolvedConfigPath });
      startWizardDeps.printText(renderProgressPanel(["config", "runtime", "wallet", "identity"], "auth"));
      startWizardDeps.printText(blockerPanel("auth", "Techtree sign-in did not complete.", [
        "Fix now: complete Techtree sign-in, then rerun the guided start.",
        error instanceof Error ? error.message : String(error),
        "",
        "The doctor panel below shows what is still blocking the guided start.",
      ]));
      startWizardDeps.printText(doctorFailures(authReport));
      return {
        ready: false,
        createdConfig,
        daemonStarted,
        configPath: resolvedConfigPath,
        baseUrl: config.services.techtree.baseUrl,
        walletEnvName: config.wallet.privateKeyEnv,
        selectedIdentity: identity,
      };
    }
  }

  const techtreeReport = await startWizardDeps.runScopedDoctor({ scope: "techtree" }, { configPath: resolvedConfigPath });
  if (techtreeReport.summary.fail > 0) {
    startWizardDeps.printText(renderProgressPanel(["config", "runtime", "wallet", "identity", "auth"], "techtree"));
    startWizardDeps.printText(blockerPanel("techtree", "Techtree is not fully reachable with the current session.", [
      "Fix now: repair Techtree access, then rerun the guided start.",
      "The local wallet and identity are ready, but Techtree access still has a blocker.",
    ]));
    startWizardDeps.printText(doctorFailures(techtreeReport));
    return {
      ready: false,
      createdConfig,
      daemonStarted,
      configPath: resolvedConfigPath,
      baseUrl: config.services.techtree.baseUrl,
      walletEnvName: config.wallet.privateKeyEnv,
      selectedIdentity: identity,
    };
  }

  try {
    startWizardDeps.printText(renderProgressPanel(["config", "runtime", "wallet", "identity", "auth", "techtree"], "bbh"));
    await startWizardDeps.bbhProbe(resolvedConfigPath);
  } catch (error) {
    startWizardDeps.printText(blockerPanel("bbh", "Techtree access is ready, but the BBH path is not responding cleanly yet.", [
      "Fix now: repair the BBH backend path, then rerun the guided start.",
      error instanceof Error ? error.message : String(error),
    ]));
    return {
      ready: false,
      createdConfig,
      daemonStarted,
      configPath: resolvedConfigPath,
      baseUrl: config.services.techtree.baseUrl,
      walletEnvName: config.wallet.privateKeyEnv,
      selectedIdentity: identity,
    };
  }

  startWizardDeps.printText(renderProgressPanel(["config", "runtime", "wallet", "identity", "auth", "techtree", "bbh"], "bbh"));
  startWizardDeps.printText(stepPanel("◆ GUIDED START COMPLETE", [
    "Local config, runtime, wallet, identity, Techtree access, and BBH public reads are all ready.",
    `${tone("bound identity", CLI_PALETTE.secondary)} ${identity.registryAddress} · token ${identity.tokenId}`,
  ]));
  startWizardDeps.printText(nextCommandPanel("◆ NEXT STEPS", [
    `regents techtree bbh run exec --config ${resolvedConfigPath} --lane climb ~/regent-bbh/climb-run`,
    `regents techtree bbh leaderboard --config ${resolvedConfigPath} --lane benchmark`,
    `regents chatbox tail --config ${resolvedConfigPath} --webapp`,
  ]));

  return {
    ready: true,
    createdConfig,
    daemonStarted,
    configPath: resolvedConfigPath,
    baseUrl: config.services.techtree.baseUrl,
    walletEnvName: config.wallet.privateKeyEnv,
    selectedIdentity: identity,
  };
}
