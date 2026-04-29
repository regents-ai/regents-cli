import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { transportChecks } from "../../../src/internal-runtime/doctor/checks/transportChecks.js";
import type { DoctorCheckContext } from "../../../src/internal-runtime/doctor/types.js";
import type { RegentConfig } from "../../../src/internal-types/config.js";

const testConfig = (root: string): RegentConfig => ({
  runtime: {
    socketPath: path.join(root, "run", "regent.sock"),
    stateDir: path.join(root, "state"),
    logLevel: "info",
  },
  auth: {
    audience: "techtree",
    defaultChainId: 84532,
  },
  services: {
    siwa: { baseUrl: "http://127.0.0.1:4000", requestTimeoutMs: 1_000 },
    platform: { baseUrl: "http://127.0.0.1:4000", requestTimeoutMs: 1_000 },
    autolaunch: { baseUrl: "http://127.0.0.1:4010", requestTimeoutMs: 1_000 },
    techtree: { baseUrl: "http://127.0.0.1:4100", requestTimeoutMs: 1_000 },
  },
  wallet: {
    privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
    keystorePath: path.join(root, "keys", "agent-wallet.json"),
  },
  gossipsub: {
    enabled: false,
    listenAddrs: [],
    bootstrap: [],
    peerIdPath: path.join(root, "p2p", "peer-id.json"),
  },
  xmtp: {
    enabled: true,
    env: "production",
    dbPath: path.join(root, "xmtp", "client.db"),
    dbEncryptionKeyPath: path.join(root, "xmtp", "db.key"),
    walletKeyPath: path.join(root, "xmtp", "wallet.key"),
    ownerInboxIds: ["inbox-owner"],
    trustedInboxIds: [],
    publicPolicyPath: path.join(root, "policies", "xmtp-public.md"),
    profiles: {
      owner: "full",
      public: "messaging",
      group: "messaging",
    },
  },
  agents: {
    defaultHarness: "hermes",
    harnesses: {},
  },
  workloads: {
    bbh: {
      workspaceRoot: path.join(root, "workspaces", "bbh"),
      defaultHarness: "hermes",
      defaultProfile: "bbh",
    },
  },
});

describe("transport doctor checks", () => {
  it("reports the current chat room authority and transport boundaries", async () => {
    const root = path.join(os.tmpdir(), "regent-room-contract");
    const check = transportChecks().find((candidate) => candidate.id === "xmtp.room.contract");

    expect(check).toBeDefined();

    const result = await check!.run({
      mode: "default",
      configPath: path.join(root, "config.json"),
      runtimeContext: null,
      config: testConfig(root),
      configLoadError: null,
      stateStore: null,
      sessionStore: null,
      walletSecretSource: null,
      techtree: null,
      fix: false,
      verbose: false,
      cleanupCommentBodyPrefix: "regent-doctor-comment",
      fullState: {},
      refreshConfig: () => undefined,
    } satisfies DoctorCheckContext);

    expect(result).toEqual(
      expect.objectContaining({
        status: "ok",
        details: expect.objectContaining({
          appRoomId: "room_key",
          threadId: "xmtp_group_id",
          techtreeChatboxSelectors: ["webapp", "agent"],
          productRoomOwners: ["platform", "autolaunch", "techtree"],
          cliBoundaries: {
            chatbox: "techtree product routes or local runtime transport",
            xmtpGroup: "local XMTP conversation id",
            iosTalk: "Platform RWR records, not XMTP rooms",
          },
        }),
      }),
    );
  });
});
