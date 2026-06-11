import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RegentConfig } from "../../src/internal-types/index.js";
import {
  readXmtpRuntimeState,
  writeXmtpRuntimeState,
  xmtpRuntimeStatePath,
} from "../../src/internal-runtime/xmtp/manager.js";

const createXmtpConfig = (tempDir: string): RegentConfig["xmtp"] => ({
  enabled: true,
  env: "dev",
  dbPath: path.join(tempDir, "xmtp", "dev", "client.db"),
  dbEncryptionKeyPath: path.join(tempDir, "xmtp", "dev", "db.key"),
  walletKeyPath: path.join(tempDir, "xmtp", "dev", "wallet.key"),
  ownerInboxIds: [],
  trustedInboxIds: [],
  publicPolicyPath: path.join(tempDir, "policies", "xmtp-public.md"),
  profiles: {
    owner: "owner",
    public: "public",
    group: "group",
  },
});

describe("XMTP runtime state", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("writes runtime state by renaming a complete temp file into place", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-xmtp-state-"));
    tempDirs.push(tempDir);
    const config = createXmtpConfig(tempDir);
    const statePath = xmtpRuntimeStatePath(config);
    const renameSync = vi.spyOn(fs, "renameSync");

    const state: Parameters<typeof writeXmtpRuntimeState>[1] = {
      connected: true,
      metrics: {
        startedAt: "2026-04-23T00:00:00.000Z",
        stoppedAt: null,
        lastSyncAt: null,
        lastMessageAt: null,
        receivedMessages: 1,
        sentMessages: 2,
        sendFailures: 0,
        groupsCreated: 0,
        membersAdded: 0,
        installationsRevoked: 0,
        walletRotations: 0,
        dbKeyRotations: 0,
        restarts: 0,
      },
      recentErrors: [],
      recentConversations: [],
      lastSeenByConversation: { "conversation-1": "2026-04-23T00:00:00.000Z" },
    };

    writeXmtpRuntimeState(config, state);

    expect(renameSync).toHaveBeenCalledTimes(1);
    const [tempPath, finalPath] = renameSync.mock.calls[0] as [string, string];
    expect(tempPath).toMatch(/runtime-state\.json\..+\.tmp$/);
    expect(finalPath).toBe(statePath);
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(readXmtpRuntimeState(config)).toEqual(state);
  });
});
