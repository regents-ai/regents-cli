import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { RegentConfig } from "../internal-types/index.js";

import { ConfigError } from "./errors.js";
import {
  defaultConfigPath as deriveDefaultConfigPath,
  ensureParentDir,
  expandHome,
} from "./paths.js";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const xmtpEnvSchema = z.enum(["local", "dev", "production"]);
const siwaAudienceSchema = z.enum(["platform", "autolaunch", "techtree", "regent-services"]);

const configSchema = z.object({
  runtime: z.object({
    socketPath: z.string().min(1),
    stateDir: z.string().min(1),
    logLevel: logLevelSchema,
  }),
  auth: z.object({
    baseUrl: z.string().url(),
    audience: siwaAudienceSchema,
    defaultChainId: z.number().int().positive(),
    requestTimeoutMs: z.number().int().positive(),
  }),
  techtree: z.object({
    baseUrl: z.string().url(),
    requestTimeoutMs: z.number().int().positive(),
  }),
  wallet: z.object({
    privateKeyEnv: z.string().min(1),
    keystorePath: z.string().min(1),
  }),
  gossipsub: z.object({
    enabled: z.boolean(),
    listenAddrs: z.array(z.string()),
    bootstrap: z.array(z.string()),
    peerIdPath: z.string().min(1),
  }),
  xmtp: z.object({
    enabled: z.boolean(),
    env: xmtpEnvSchema,
    dbPath: z.string().min(1),
    dbEncryptionKeyPath: z.string().min(1),
    walletKeyPath: z.string().min(1),
    ownerInboxIds: z.array(z.string().min(1)),
    trustedInboxIds: z.array(z.string().min(1)),
    publicPolicyPath: z.string().min(1),
    profiles: z.object({
      owner: z.string().min(1),
      public: z.string().min(1),
      group: z.string().min(1),
    }),
  }),
  agents: z.object({
    defaultHarness: z.enum(["openclaw", "hermes", "claude_code", "custom"]),
    harnesses: z.record(
      z.string().min(1),
      z.object({
        enabled: z.boolean(),
        entrypoint: z.string().min(1),
        workspaceRoot: z.string().min(1),
        profiles: z.array(z.string().min(1)),
      }),
    ),
  }),
  workloads: z.object({
    bbh: z.object({
      workspaceRoot: z.string().min(1),
      defaultHarness: z.enum(["openclaw", "hermes", "claude_code", "custom"]),
      defaultProfile: z.string().min(1),
    }),
  }),
});

const configOverrideSchema = z.object({
  runtime: configSchema.shape.runtime.partial().optional(),
  auth: configSchema.shape.auth.partial().optional(),
  techtree: configSchema.shape.techtree.partial().optional(),
  wallet: configSchema.shape.wallet.partial().optional(),
  gossipsub: configSchema.shape.gossipsub.partial().optional(),
  xmtp: configSchema.shape.xmtp
    .extend({
      profiles: configSchema.shape.xmtp.shape.profiles.partial().optional(),
    })
    .partial()
    .optional(),
  agents: configSchema.shape.agents
    .extend({
      harnesses: z.record(
        z.string().min(1),
        configSchema.shape.agents.shape.harnesses.valueType.partial(),
      ).optional(),
    })
    .partial()
    .optional(),
  workloads: configSchema.shape.workloads
    .extend({
      bbh: configSchema.shape.workloads.shape.bbh.partial().optional(),
    })
    .partial()
    .optional(),
});

const normalizePath = (input: string, rootDir?: string): string => {
  const expanded = expandHome(input);
  return path.isAbsolute(expanded)
    ? path.normalize(expanded)
    : path.resolve(rootDir ?? process.cwd(), expanded);
};

const resolveConfigPath = (configPath?: string): string => {
  return configPath ? normalizePath(configPath) : deriveDefaultConfigPath();
};

const resolveConfigRootDir = (configPath?: string): string => {
  return path.dirname(resolveConfigPath(configPath));
};

const deepMerge = <T>(base: T, override: Partial<T>): T => {
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    const current = result[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      result[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }

    result[key] = value;
  }

  return result as T;
};

const normalizeConfig = (config: RegentConfig, configPath?: string): RegentConfig => {
  const resolvedConfigRootDir = configPath ? path.dirname(normalizePath(configPath)) : undefined;

  return {
    ...config,
    runtime: {
      ...config.runtime,
      socketPath: normalizePath(config.runtime.socketPath, resolvedConfigRootDir),
      stateDir: normalizePath(config.runtime.stateDir, resolvedConfigRootDir),
    },
    auth: {
      ...config.auth,
    },
    techtree: {
      ...config.techtree,
    },
    wallet: {
      ...config.wallet,
      keystorePath: normalizePath(config.wallet.keystorePath, resolvedConfigRootDir),
    },
    gossipsub: {
      ...config.gossipsub,
      peerIdPath: normalizePath(config.gossipsub.peerIdPath, resolvedConfigRootDir),
    },
    xmtp: {
      ...config.xmtp,
      dbPath: normalizePath(config.xmtp.dbPath, resolvedConfigRootDir),
      dbEncryptionKeyPath: normalizePath(config.xmtp.dbEncryptionKeyPath, resolvedConfigRootDir),
      walletKeyPath: normalizePath(config.xmtp.walletKeyPath, resolvedConfigRootDir),
      publicPolicyPath: normalizePath(config.xmtp.publicPolicyPath, resolvedConfigRootDir),
    },
    agents: {
      ...config.agents,
      harnesses: Object.fromEntries(
        Object.entries(config.agents.harnesses).map(([name, harness]) => [
          name,
          {
            ...harness,
            workspaceRoot: normalizePath(harness.workspaceRoot, resolvedConfigRootDir),
          },
        ]),
      ),
    },
    workloads: {
      ...config.workloads,
      bbh: {
        ...config.workloads.bbh,
        workspaceRoot: normalizePath(config.workloads.bbh.workspaceRoot, resolvedConfigRootDir),
      },
    },
  };
};

export const xmtpDefaultsForRoot = (rootDir: string, env: RegentConfig["xmtp"]["env"]): RegentConfig["xmtp"] => ({
  enabled: false,
  env,
  dbPath: path.join(rootDir, "xmtp", env, "client.db"),
  dbEncryptionKeyPath: path.join(rootDir, "xmtp", env, "db.key"),
  walletKeyPath: path.join(rootDir, "xmtp", env, "wallet.key"),
  ownerInboxIds: [],
  trustedInboxIds: [],
  publicPolicyPath: path.join(rootDir, "policies", "xmtp-public.md"),
  profiles: {
    owner: "full",
    public: "messaging",
    group: "messaging",
  },
});

export const agentDefaultsForRoot = (rootDir: string): RegentConfig["agents"] => ({
  defaultHarness: "hermes",
  harnesses: {
    openclaw: {
      enabled: false,
      entrypoint: "openclaw",
      workspaceRoot: path.join(rootDir, "workspaces", "openclaw"),
      profiles: ["owner", "public", "group", "bbh"],
    },
    hermes: {
      enabled: true,
      entrypoint: "hermes",
      workspaceRoot: path.join(rootDir, "workspaces", "hermes"),
      profiles: ["owner", "public", "group", "bbh"],
    },
    claude_code: {
      enabled: false,
      entrypoint: "claude",
      workspaceRoot: path.join(rootDir, "workspaces", "claude-code"),
      profiles: ["owner", "public", "group", "bbh"],
    },
    custom: {
      enabled: false,
      entrypoint: "custom-harness",
      workspaceRoot: path.join(rootDir, "workspaces", "custom"),
      profiles: ["custom"],
    },
  },
});

export const workloadDefaultsForRoot = (rootDir: string): RegentConfig["workloads"] => ({
  bbh: {
    workspaceRoot: path.join(rootDir, "workspaces", "bbh"),
    defaultHarness: "hermes",
    defaultProfile: "bbh",
  },
});

const ensureConfigDirectories = (config: RegentConfig): void => {
  fs.mkdirSync(config.runtime.stateDir, { recursive: true });
  fs.mkdirSync(path.dirname(config.runtime.socketPath), { recursive: true });
  fs.mkdirSync(path.dirname(config.wallet.keystorePath), { recursive: true });
  fs.mkdirSync(path.dirname(config.gossipsub.peerIdPath), { recursive: true });
  fs.mkdirSync(path.dirname(config.xmtp.dbPath), { recursive: true });
  fs.mkdirSync(path.dirname(config.xmtp.dbEncryptionKeyPath), { recursive: true });
  fs.mkdirSync(path.dirname(config.xmtp.walletKeyPath), { recursive: true });
  fs.mkdirSync(path.dirname(config.xmtp.publicPolicyPath), { recursive: true });
  for (const harness of Object.values(config.agents.harnesses)) {
    fs.mkdirSync(harness.workspaceRoot, { recursive: true });
  }
  fs.mkdirSync(config.workloads.bbh.workspaceRoot, { recursive: true });
};

export function defaultConfig(configPath?: string): RegentConfig {
  const rootDir = resolveConfigRootDir(configPath);

  return {
    runtime: {
      socketPath: path.join(rootDir, "run", "regent.sock"),
      stateDir: path.join(rootDir, "state"),
      logLevel: "info",
    },
    auth: {
      baseUrl: "http://127.0.0.1:4000",
      audience: "techtree",
      defaultChainId: 84532,
      requestTimeoutMs: 10_000,
    },
    techtree: {
      baseUrl: "http://127.0.0.1:4001",
      requestTimeoutMs: 10_000,
    },
    wallet: {
      privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
      keystorePath: path.join(rootDir, "keys", "agent-wallet.json"),
    },
    gossipsub: {
      enabled: false,
      listenAddrs: [],
      bootstrap: [],
      peerIdPath: path.join(rootDir, "p2p", "peer-id.json"),
    },
    xmtp: xmtpDefaultsForRoot(rootDir, "production"),
    agents: agentDefaultsForRoot(rootDir),
    workloads: workloadDefaultsForRoot(rootDir),
  };
}

export function loadConfig(configPath?: string): RegentConfig {
  const resolvedConfigPath = resolveConfigPath(configPath);
  const fallback = defaultConfig(resolvedConfigPath);

  if (!fs.existsSync(resolvedConfigPath)) {
    return fallback;
  }

  let rawContent = "";
  try {
    rawContent = fs.readFileSync(resolvedConfigPath, "utf8");
  } catch (error) {
    throw new ConfigError(`unable to read config file at ${resolvedConfigPath}`, error);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch (error) {
    throw new ConfigError(`invalid JSON in config file at ${resolvedConfigPath}`, error);
  }

  const validatedOverride = configOverrideSchema.safeParse(parsedJson);
  if (!validatedOverride.success) {
    throw new ConfigError(`config file failed validation: ${validatedOverride.error.message}`);
  }

  const merged = deepMerge(fallback, validatedOverride.data as Partial<RegentConfig>);
  const normalized = normalizeConfig(merged, resolvedConfigPath);
  const validated = configSchema.safeParse(normalized);

  if (!validated.success) {
    throw new ConfigError(`normalized config failed validation: ${validated.error.message}`);
  }

  return validated.data;
}

export function writeConfigReplacement(configPath: string, nextConfig: unknown): RegentConfig {
  const resolvedConfigPath = normalizePath(configPath);
  const validatedInput = configSchema.safeParse(nextConfig);

  if (!validatedInput.success) {
    throw new ConfigError(`replacement config failed validation: ${validatedInput.error.message}`);
  }

  const normalized = normalizeConfig(validatedInput.data, resolvedConfigPath);
  const validatedNormalized = configSchema.safeParse(normalized);

  if (!validatedNormalized.success) {
    throw new ConfigError(`normalized replacement config failed validation: ${validatedNormalized.error.message}`);
  }

  ensureParentDir(resolvedConfigPath);
  ensureConfigDirectories(validatedNormalized.data);
  fs.writeFileSync(resolvedConfigPath, `${JSON.stringify(validatedNormalized.data, null, 2)}\n`, "utf8");
  return validatedNormalized.data;
}

export function writeInitialConfig(configPath: string, overrides?: Partial<RegentConfig>): void {
  const resolvedConfigPath = normalizePath(configPath);
  const merged = deepMerge(defaultConfig(resolvedConfigPath), overrides ?? {});
  const normalized = normalizeConfig(merged, resolvedConfigPath);
  const validated = configSchema.safeParse(normalized);

  if (!validated.success) {
    throw new ConfigError(`initial config failed validation: ${validated.error.message}`);
  }

  ensureParentDir(resolvedConfigPath);
  ensureConfigDirectories(validated.data);
  fs.writeFileSync(resolvedConfigPath, `${JSON.stringify(validated.data, null, 2)}\n`, "utf8");
}

export function writeInitialConfigIfMissing(configPath: string, overrides?: Partial<RegentConfig>): boolean {
  const resolvedConfigPath = normalizePath(configPath);
  if (fs.existsSync(resolvedConfigPath)) {
    return false;
  }

  writeInitialConfig(configPath, overrides);
  return true;
}
