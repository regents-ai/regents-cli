import type { SiwaAudience } from "./auth.js";
import type { RegentExecutorHarnessKind } from "./agent.js";

export type RegentLogLevel = "debug" | "info" | "warn" | "error";

export interface RegentRuntimeConfig {
  socketPath: string;
  stateDir: string;
  logLevel: RegentLogLevel;
}

export interface RegentServiceConfig {
  baseUrl: string;
  requestTimeoutMs: number;
}

export interface RegentServicesConfig {
  siwa: RegentServiceConfig;
  platform: RegentServiceConfig;
  autolaunch: RegentServiceConfig;
  techtree: RegentServiceConfig;
}

export interface RegentAuthConfig {
  audience: SiwaAudience;
  defaultChainId: number;
}

export interface RegentWalletConfig {
  privateKeyEnv: string;
  keystorePath: string;
}

export interface RegentXmtpConfig {
  enabled: boolean;
  env: "production" | "dev" | "local";
  dbPath: string;
  dbEncryptionKeyPath: string;
  walletKeyPath: string;
  ownerInboxIds: string[];
  trustedInboxIds: string[];
  publicPolicyPath: string;
  profiles: {
    owner: string;
    public: string;
    group: string;
  };
  dbEncryptionKeyEnv?: string;
}

export interface RegentGossipsubConfig {
  enabled: boolean;
  listenAddrs: string[];
  bootstrap: string[];
  peerIdPath: string;
}

export interface RegentHarnessConfig {
  enabled: boolean;
  entrypoint: string;
  workspaceRoot: string;
  profiles: string[];
}

export interface RegentAgentsConfig {
  defaultHarness: RegentExecutorHarnessKind;
  harnesses: Record<string, RegentHarnessConfig>;
}

export interface RegentBbhWorkloadConfig {
  workspaceRoot: string;
  defaultHarness: RegentExecutorHarnessKind;
  defaultProfile: string;
}

export interface RegentWorkloadsConfig {
  bbh: RegentBbhWorkloadConfig;
}

export interface RegentConfig {
  runtime: RegentRuntimeConfig;
  auth: RegentAuthConfig;
  services: RegentServicesConfig;
  wallet: RegentWalletConfig;
  xmtp: RegentXmtpConfig;
  gossipsub: RegentGossipsubConfig;
  agents: RegentAgentsConfig;
  workloads: RegentWorkloadsConfig;
}
