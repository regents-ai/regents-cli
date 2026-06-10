import type { AuthStatusResponse } from "../internal-types/index.js";

import { spawnDetachedRuntime } from "../runtime-spawn.js";

import {
  callJsonRpc,
  loadConfig,
  runDoctor,
  runScopedDoctor,
  writeInitialConfigIfMissing,
} from "../internal-runtime/index.js";
import { type ParsedCliArgs } from "../parse.js";
import { printText } from "../printer.js";
import { renderDoctorReport } from "../printers/doctorPrinter.js";
import {
  listTechtreeIdentities,
  mintTechtreeIdentity,
} from "./techtree-identities.js";
import { createPromptBoundary, type PromptBoundary } from "../terminal/prompts.js";
import { runTechtreeStart } from "./techtree-start-wizard.js";

export interface StartWizardResult {
  readonly ready: boolean;
  readonly createdConfig: boolean;
  readonly daemonStarted: boolean;
  readonly configPath: string;
  readonly baseUrl: string;
  readonly walletEnvName: string;
  readonly selectedIdentity: { registryAddress: string; tokenId: string } | null;
}

export interface StartWizardDeps {
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
  readonly promptBoundary: (args: ParsedCliArgs) => PromptBoundary;
  readonly wait: (ms: number) => Promise<void>;
  readonly spawnDetachedRuntime: (configPath?: string) => Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  promptBoundary: createPromptBoundary,
  wait: sleep,
  spawnDetachedRuntime,
};

// The guided-start step orchestration lives in techtree-start-wizard.ts. It
// reads the dependency surface from startWizardDeps at call time, so tests can
// inject doubles by mutating that object before calling runTechtreeStart.
export { runTechtreeStart };

// Route-facing entrypoint that owns the guided-start exit-code decision so the
// handler registry can reference a plain Promise<number> handler instead of
// embedding `result.ready ? 0 : 1` in a route adapter.
export async function runTechtreeStartCommand(args: ParsedCliArgs, configPath?: string): Promise<number> {
  const result = await runTechtreeStart(args, configPath);
  return result.ready ? 0 : 1;
}
