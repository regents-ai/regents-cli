import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  defaultConfig,
  loadConfig,
  writeConfigReplacement,
  writeInitialConfig,
  writeInitialConfigIfMissing,
} from "../../src/internal-runtime/config.js";

describe("config loading", () => {
  it("returns config-relative defaults when a custom config file is missing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-missing-config-"));
    const configPath = path.join(tempDir, "regent.config.json");
    const config = loadConfig(configPath);

    expect(config.techtree.defaultChainId).toBe(1);
    expect(config.techtree.audience).toBe("techtree");
    expect(config.runtime.stateDir).toBe(path.join(tempDir, "state"));
    expect(config.runtime.socketPath).toBe(path.join(tempDir, "run", "regent.sock"));
    expect(config.wallet.keystorePath).toBe(path.join(tempDir, "keys", "agent-wallet.json"));
    expect(config.gossipsub.peerIdPath).toBe(path.join(tempDir, "p2p", "peer-id.json"));
    expect(config.xmtp.dbPath).toBe(path.join(tempDir, "xmtp", "production", "client.db"));
    expect(config.xmtp.walletKeyPath).toBe(path.join(tempDir, "xmtp", "production", "wallet.key"));
    expect(config.xmtp.dbEncryptionKeyPath).toBe(path.join(tempDir, "xmtp", "production", "db.key"));
    expect(config.xmtp.publicPolicyPath).toBe(path.join(tempDir, "policies", "xmtp-public.md"));
  });

  it("merges partial config with defaults and normalizes paths", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-config-"));
    const configPath = path.join(tempDir, "config.json");

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        techtree: {
          baseUrl: "http://127.0.0.1:4100",
        },
        runtime: {
          logLevel: "debug",
        },
      }),
      "utf8",
    );

    const config = loadConfig(configPath);

    expect(config.techtree.baseUrl).toBe("http://127.0.0.1:4100");
    expect(config.runtime.logLevel).toBe("debug");
    expect(path.isAbsolute(config.runtime.socketPath)).toBe(true);
    expect(config.wallet.privateKeyEnv).toBe(defaultConfig().wallet.privateKeyEnv);
  });

  it("writes an initial config file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-config-write-"));
    const configPath = path.join(tempDir, "config.json");

    writeInitialConfig(configPath, {
      techtree: {
        ...defaultConfig().techtree,
        baseUrl: "http://127.0.0.1:4200",
      },
    });

    const written = JSON.parse(fs.readFileSync(configPath, "utf8")) as ReturnType<typeof defaultConfig>;
    expect(written.techtree.baseUrl).toBe("http://127.0.0.1:4200");
    expect(written.runtime.stateDir).toBe(path.join(tempDir, "state"));
    expect(written.runtime.socketPath).toBe(path.join(tempDir, "run", "regent.sock"));
    expect(written.wallet.keystorePath).toBe(path.join(tempDir, "keys", "agent-wallet.json"));
    expect(fs.existsSync(written.runtime.stateDir)).toBe(true);
    expect(fs.existsSync(path.dirname(written.runtime.socketPath))).toBe(true);
    expect(fs.existsSync(path.dirname(written.wallet.keystorePath))).toBe(true);
    expect(fs.existsSync(path.dirname(written.gossipsub.peerIdPath))).toBe(true);
    expect(fs.existsSync(path.dirname(written.xmtp.dbPath))).toBe(true);
    expect(fs.existsSync(path.dirname(written.xmtp.publicPolicyPath))).toBe(true);
  });

  it("writes a validated replacement config and normalizes relative paths", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-config-replacement-"));
    const configPath = path.join(tempDir, "config.json");

    const written = writeConfigReplacement(configPath, {
      runtime: {
        socketPath: "./run/custom.sock",
        stateDir: "./state-dir",
        logLevel: "warn",
      },
      techtree: {
        baseUrl: "http://127.0.0.1:4300",
        audience: "techtree",
        defaultChainId: 8453,
        requestTimeoutMs: 2_500,
      },
      wallet: {
        privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
        keystorePath: "./keys/custom-wallet.json",
      },
      gossipsub: {
        enabled: true,
        listenAddrs: ["/ip4/127.0.0.1/tcp/0"],
        bootstrap: [],
        peerIdPath: "./p2p/custom-peer-id.json",
      },
      xmtp: {
        enabled: true,
        env: "dev",
        dbPath: "./xmtp/dev/client.db",
        dbEncryptionKeyPath: "./xmtp/dev/db.key",
        walletKeyPath: "./xmtp/dev/wallet.key",
        ownerInboxIds: ["owner-inbox"],
        trustedInboxIds: ["trusted-inbox"],
        publicPolicyPath: "./policies/public-xmtp.md",
        profiles: {
          owner: "full",
          public: "messaging",
          group: "messaging",
        },
      },
      agents: {
        defaultHarness: "hermes",
        harnesses: {
          openclaw: {
            enabled: false,
            entrypoint: "openclaw",
            workspaceRoot: "./workspaces/openclaw",
            profiles: ["owner", "public", "group", "bbh"],
          },
          hermes: {
            enabled: true,
            entrypoint: "hermes",
            workspaceRoot: "./workspaces/hermes",
            profiles: ["owner", "public", "group", "bbh"],
          },
          claude_code: {
            enabled: false,
            entrypoint: "claude",
            workspaceRoot: "./workspaces/claude-code",
            profiles: ["owner", "public", "group", "bbh"],
          },
          custom: {
            enabled: false,
            entrypoint: "custom-harness",
            workspaceRoot: "./workspaces/custom",
            profiles: ["custom"],
          },
        },
      },
      workloads: {
        bbh: {
          workspaceRoot: "./workspaces/bbh",
          defaultHarness: "hermes",
          defaultProfile: "bbh",
        },
      },
    });

    expect(written.runtime.socketPath).toBe(path.join(tempDir, "run", "custom.sock"));
    expect(written.runtime.stateDir).toBe(path.join(tempDir, "state-dir"));
    expect(written.wallet.keystorePath).toBe(path.join(tempDir, "keys", "custom-wallet.json"));
    expect(written.gossipsub.peerIdPath).toBe(path.join(tempDir, "p2p", "custom-peer-id.json"));
    expect(written.xmtp.dbPath).toBe(path.join(tempDir, "xmtp", "dev", "client.db"));
    expect(written.xmtp.publicPolicyPath).toBe(path.join(tempDir, "policies", "public-xmtp.md"));
    expect(written.agents.harnesses.hermes.workspaceRoot).toBe(path.join(tempDir, "workspaces", "hermes"));
    expect(written.workloads.bbh.workspaceRoot).toBe(path.join(tempDir, "workspaces", "bbh"));
    expect(fs.existsSync(path.dirname(written.runtime.socketPath))).toBe(true);
    expect(fs.existsSync(written.runtime.stateDir)).toBe(true);
    expect(fs.existsSync(path.dirname(written.wallet.keystorePath))).toBe(true);
    expect(fs.existsSync(path.dirname(written.gossipsub.peerIdPath))).toBe(true);
    expect(fs.existsSync(path.dirname(written.xmtp.dbPath))).toBe(true);
    expect(fs.existsSync(path.dirname(written.xmtp.publicPolicyPath))).toBe(true);
    expect(fs.existsSync(written.agents.harnesses.hermes.workspaceRoot)).toBe(true);
    expect(fs.existsSync(written.workloads.bbh.workspaceRoot)).toBe(true);
  });

  it("only writes the initial config file when it is missing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-config-write-if-missing-"));
    const configPath = path.join(tempDir, "config.json");

    writeInitialConfig(configPath, {
      techtree: {
        ...defaultConfig().techtree,
        baseUrl: "http://127.0.0.1:4200",
      },
    });

    const created = writeInitialConfigIfMissing(configPath, {
      techtree: {
        ...defaultConfig().techtree,
        baseUrl: "http://127.0.0.1:4300",
      },
    });

    expect(created).toBe(false);
    const written = JSON.parse(fs.readFileSync(configPath, "utf8")) as ReturnType<typeof defaultConfig>;
    expect(written.techtree.baseUrl).toBe("http://127.0.0.1:4200");
  });

  it("writes the initial config file when it is missing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-config-create-if-missing-"));
    const configPath = path.join(tempDir, "config.json");

    const created = writeInitialConfigIfMissing(configPath, {
      techtree: {
        ...defaultConfig().techtree,
        baseUrl: "http://127.0.0.1:4400",
      },
    });

    expect(created).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(configPath, "utf8")) as ReturnType<typeof defaultConfig>;
    expect(written.techtree.baseUrl).toBe("http://127.0.0.1:4400");
  });

  it("fails fast on invalid JSON", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-config-invalid-json-"));
    const configPath = path.join(tempDir, "config.json");

    fs.writeFileSync(configPath, "{not-json", "utf8");

    expect(() => loadConfig(configPath)).toThrow(/invalid JSON/);
  });

  it("fails validation when override shape is invalid", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-config-invalid-shape-"));
    const configPath = path.join(tempDir, "config.json");

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        techtree: {
          requestTimeoutMs: 0,
        },
      }),
      "utf8",
    );

    expect(() => loadConfig(configPath)).toThrow(/config file failed validation/);
  });

  it("fails fast instead of silently restoring an empty audience", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-config-empty-audience-"));
    const configPath = path.join(tempDir, "config.json");

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        techtree: {
          audience: "",
        },
      }),
      "utf8",
    );

    expect(() => loadConfig(configPath)).toThrow(/config file failed validation/);
  });

  it("fails replacement writes when the input is not a full valid config", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-config-invalid-replacement-"));
    const configPath = path.join(tempDir, "config.json");

    expect(() =>
      writeConfigReplacement(configPath, {
        techtree: {
          baseUrl: "http://127.0.0.1:4300",
        },
      }),
    ).toThrow(/replacement config failed validation/);
  });
});
