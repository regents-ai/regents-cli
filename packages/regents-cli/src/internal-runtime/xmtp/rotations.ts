import fs from "node:fs";

import type {
  RegentConfig,
  XmtpInstallationRevokeResult,
  XmtpRotationResult,
} from "../../internal-types/index.js";

import { runConnectedXmtpCliJson, runXmtpCli } from "./cli-adapter.js";
import { parseXmtpInitOutput, writeXmtpSecretFile } from "./material.js";
import { defaultXmtpMetrics, updateXmtpRuntimeState } from "./state.js";

const deleteDatabaseArtifacts = (dbPath: string): boolean => {
  let removed = false;
  for (const candidate of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    fs.rmSync(candidate, { force: true, recursive: false });
    removed = true;
  }

  return removed;
};

export const revokeAllOtherXmtpInstallations = async (
  config: RegentConfig["xmtp"],
): Promise<XmtpInstallationRevokeResult> => {
  const payload = await runConnectedXmtpCliJson<XmtpInstallationRevokeResult>(config, [
    "client",
    "revoke-all-other-installations",
    "--force",
  ]);

  updateXmtpRuntimeState(config, (current) => ({
    ...current,
    metrics: {
      ...current.metrics,
      installationsRevoked: current.metrics.installationsRevoked + 1,
    },
  }));

  return payload;
};

export const rotateXmtpDbKey = async (config: RegentConfig["xmtp"]): Promise<XmtpRotationResult> => {
  const stdout = await runXmtpCli(["init", "--stdout", "--env", config.env]);
  const nextKeys = parseXmtpInitOutput(stdout, config.env);
  const removedDatabase = deleteDatabaseArtifacts(config.dbPath);

  writeXmtpSecretFile(config.dbEncryptionKeyPath, nextKeys.dbEncryptionKey);
  updateXmtpRuntimeState(config, (current) => ({
    connected: false,
    recentErrors: current.recentErrors,
    recentConversations: [],
    lastSeenByConversation: {},
    metrics: {
      ...defaultXmtpMetrics(),
      dbKeyRotations: current.metrics.dbKeyRotations + 1,
      stoppedAt: new Date().toISOString(),
    },
  }));

  return {
    ok: true,
    kind: "db-key",
    dbPath: config.dbPath,
    walletKeyPath: config.walletKeyPath,
    dbEncryptionKeyPath: config.dbEncryptionKeyPath,
    removedDatabase,
  };
};

export const rotateXmtpWallet = async (config: RegentConfig["xmtp"]): Promise<XmtpRotationResult> => {
  const stdout = await runXmtpCli(["init", "--stdout", "--env", config.env]);
  const nextKeys = parseXmtpInitOutput(stdout, config.env);
  const removedDatabase = deleteDatabaseArtifacts(config.dbPath);

  writeXmtpSecretFile(config.walletKeyPath, nextKeys.walletKey);
  writeXmtpSecretFile(config.dbEncryptionKeyPath, nextKeys.dbEncryptionKey);
  updateXmtpRuntimeState(config, (current) => ({
    connected: false,
    recentErrors: current.recentErrors,
    recentConversations: [],
    lastSeenByConversation: {},
    metrics: {
      ...defaultXmtpMetrics(),
      walletRotations: current.metrics.walletRotations + 1,
      stoppedAt: new Date().toISOString(),
    },
  }));

  return {
    ok: true,
    kind: "wallet",
    dbPath: config.dbPath,
    walletKeyPath: config.walletKeyPath,
    dbEncryptionKeyPath: config.dbEncryptionKeyPath,
    removedDatabase,
  };
};
