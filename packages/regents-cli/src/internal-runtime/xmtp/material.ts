import fs from "node:fs";

import type {
  RegentConfig,
  RegentXmtpEnv,
  XmtpClientInfo,
  XmtpInitResult,
  XmtpMutationResult,
} from "../../internal-types/index.js";

import { generateWallet } from "../agent/wallet.js";
import { RegentError } from "../errors.js";
import { writeFileAtomicSync } from "../paths.js";
import { runConnectedXmtpCliJson, runXmtpCli } from "./cli-adapter.js";
import { ensureXmtpPolicyFile } from "./policy.js";
import { MAX_RECENT_CONVERSATIONS, updateXmtpRuntimeState } from "./state.js";

const SECRET_FILE_MODE = 0o600;

interface XmtpCliInfoPayload {
  properties?: {
    address?: string;
    inboxId?: string;
    installationId?: string;
    isRegistered?: boolean;
    appVersion?: string;
    libxmtpVersion?: string;
  };
}

interface XmtpCliInboxIdPayload {
  inboxId?: string | null;
  found?: boolean;
}

export const trimXmtpAddress = (value: string): `0x${string}` => value.trim().toLowerCase() as `0x${string}`;

export const parseXmtpInitOutput = (
  stdout: string,
  env: RegentXmtpEnv,
): { walletKey: string; dbEncryptionKey: string } => {
  const entries = Object.fromEntries(
    stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key, rest.join("=")];
      }),
  ) as Record<string, string>;

  const walletKey = entries.XMTP_WALLET_KEY;
  const dbEncryptionKey = entries.XMTP_DB_ENCRYPTION_KEY;
  const resolvedEnv = entries.XMTP_ENV;

  if (!walletKey || !dbEncryptionKey || resolvedEnv !== env) {
    throw new RegentError("xmtp_cli_error", "xmtp init did not return the expected key material");
  }

  return {
    walletKey,
    dbEncryptionKey,
  };
};

const writeFileWithMode = (filePath: string, value: string, mode = SECRET_FILE_MODE): void => {
  writeFileAtomicSync(filePath, `${value.trim()}\n`, mode);
};

const readOptionalFile = (filePath: string): string | null => {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, "utf8").trim() || null;
};

const normalizeClientInfo = (payload: XmtpCliInfoPayload): XmtpClientInfo => {
  const address = payload.properties?.address;
  const inboxId = payload.properties?.inboxId;
  const installationId = payload.properties?.installationId;

  if (!address || !inboxId || !installationId) {
    throw new RegentError("xmtp_cli_error", "xmtp client info returned an incomplete payload");
  }

  return {
    address: trimXmtpAddress(address),
    inboxId,
    installationId,
    isRegistered: payload.properties?.isRegistered === true,
    appVersion: payload.properties?.appVersion,
    libxmtpVersion: payload.properties?.libxmtpVersion,
  };
};

export const writeXmtpSecretFile = writeFileWithMode;

export const xmtpMaterialExists = (config: RegentConfig["xmtp"]): boolean => {
  return fs.existsSync(config.walletKeyPath) && fs.existsSync(config.dbEncryptionKeyPath);
};

export const loadXmtpClientInfo = async (config: RegentConfig["xmtp"]): Promise<XmtpClientInfo> => {
  const payload = await runConnectedXmtpCliJson<XmtpCliInfoPayload>(config, ["client", "info"]);
  return normalizeClientInfo(payload);
};

export const resolveXmtpInboxId = async (
  config: RegentConfig["xmtp"],
  identifier: `0x${string}`,
): Promise<string | null> => {
  const payload = await runConnectedXmtpCliJson<XmtpCliInboxIdPayload>(config, ["client", "inbox-id", "-i", identifier]);
  return payload.found === false ? null : (payload.inboxId ?? null);
};

export const resolveXmtpIdentifier = async (config: RegentConfig["xmtp"], identifier: string): Promise<string> => {
  if (!identifier) {
    throw new RegentError("xmtp_identifier_missing", "missing XMTP identifier");
  }

  if (identifier.startsWith("0x")) {
    const inboxId = await resolveXmtpInboxId(config, trimXmtpAddress(identifier));
    if (!inboxId) {
      throw new RegentError("xmtp_inbox_not_found", `no XMTP inbox found for ${identifier}`);
    }

    return inboxId;
  }

  return identifier.trim();
};

export const ensureXmtpMaterial = async (
  config: RegentConfig["xmtp"],
): Promise<{ createdWalletKey: boolean; createdDbEncryptionKey: boolean }> => {
  const walletExists = fs.existsSync(config.walletKeyPath);
  const dbKeyExists = fs.existsSync(config.dbEncryptionKeyPath);

  if (walletExists && dbKeyExists) {
    return {
      createdWalletKey: false,
      createdDbEncryptionKey: false,
    };
  }

  const stdout = await runXmtpCli(["init", "--stdout", "--env", config.env]);
  const initResult = parseXmtpInitOutput(stdout, config.env);

  if (!walletExists) {
    writeFileWithMode(config.walletKeyPath, initResult.walletKey);
  }

  if (!dbKeyExists) {
    writeFileWithMode(config.dbEncryptionKeyPath, initResult.dbEncryptionKey);
  }

  return {
    createdWalletKey: !walletExists,
    createdDbEncryptionKey: !dbKeyExists,
  };
};

export const initializeXmtp = async (
  config: RegentConfig["xmtp"],
  configPath: string,
): Promise<XmtpInitResult> => {
  const { createdWalletKey, createdDbEncryptionKey } = await ensureXmtpMaterial(config);
  const { created: createdPolicyFile } = ensureXmtpPolicyFile(config);
  const client = await loadXmtpClientInfo(config);

  updateXmtpRuntimeState(config, (current) => ({
    ...current,
    recentConversations: [
      {
        id: client.inboxId,
        type: "unknown" as const,
        createdAt: new Date().toISOString(),
        peerInboxId: client.inboxId,
      },
      ...current.recentConversations.filter((item) => item.id !== client.inboxId),
    ].slice(0, MAX_RECENT_CONVERSATIONS),
  }));

  return {
    configPath,
    enabled: config.enabled,
    env: config.env,
    dbPath: config.dbPath,
    dbEncryptionKeyPath: config.dbEncryptionKeyPath,
    walletKeyPath: config.walletKeyPath,
    publicPolicyPath: config.publicPolicyPath,
    ownerInboxIds: [...config.ownerInboxIds],
    trustedInboxIds: [...config.trustedInboxIds],
    profiles: { ...config.profiles },
    createdWalletKey,
    createdDbEncryptionKey,
    createdPolicyFile,
    client,
  };
};

export const listXmtpAllowlist = (
  config: RegentConfig["xmtp"],
  list: "owner" | "trusted",
): { ok: true; items: string[] } => ({
  ok: true,
  items: list === "owner" ? [...config.ownerInboxIds] : [...config.trustedInboxIds],
});

export const updateXmtpAllowlist = (
  current: string[],
  action: "add" | "remove",
  inboxId: string,
): XmtpMutationResult => {
  const normalized = inboxId.trim();
  const next =
    action === "add"
      ? Array.from(new Set([...current, normalized]))
      : current.filter((item) => item !== normalized);

  return {
    ok: true,
    updated: next,
  };
};

export const generateStandaloneXmtpWallet = async (): Promise<`0x${string}`> => {
  const wallet = await generateWallet();
  return wallet.privateKey;
};

export const readXmtpWalletKey = (config: RegentConfig["xmtp"]): string | null => readOptionalFile(config.walletKeyPath);
