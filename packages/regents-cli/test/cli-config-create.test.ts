import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { captureOutput } from "../../../test-support/test-helpers.js";
import { setupCliEntrypointHarness } from "./helpers/cli-entrypoint-support.js";

const harness = setupCliEntrypointHarness();

describe("CLI config and create flows", () => {
  it("writes initial config and directories without exposing overwrite semantics", async () => {
    const initPath = path.join(harness.tempDir, "nested", "regent.config.json");
    const originalHome = process.env.HOME;
    process.env.HOME = harness.tempDir;

    let output:
      | {
          stdout: string;
          stderr: string;
          result: number;
        }
      | undefined;

    try {
      output = await captureOutput(async () =>
        harness.runCliEntrypoint(["create", "init", "--config", initPath]),
      );
    } finally {
      process.env.HOME = originalHome;
    }

    expect(output).toBeDefined();

    if (!output) {
      throw new Error("expected create init output");
    }

    expect(output.result).toBe(0);

    const payload = JSON.parse(output.stdout) as {
      configPath: string;
      configCreated: boolean;
      stateDir: string;
      socketDir: string;
      keystoreDir: string;
      gossipsubDir: string;
      xmtpDir: string;
      xmtpPolicyDir: string;
    };

    const writtenConfig = JSON.parse(fs.readFileSync(initPath, "utf8")) as {
      runtime: { socketPath: string; stateDir: string };
      wallet: { keystorePath: string };
      gossipsub: { peerIdPath: string };
      xmtp: { dbPath: string; publicPolicyPath: string };
    };

    expect(fs.existsSync(payload.configPath)).toBe(true);
    expect(payload.configCreated).toBe(true);
    expect(fs.existsSync(payload.stateDir)).toBe(true);
    expect(writtenConfig.runtime.stateDir).toBe(path.join(harness.tempDir, "nested", "state"));
    expect(writtenConfig.runtime.socketPath).toBe(path.join(harness.tempDir, "nested", "run", "regent.sock"));
    expect(writtenConfig.wallet.keystorePath).toBe(path.join(harness.tempDir, "nested", "keys", "agent-wallet.json"));
    expect(writtenConfig.gossipsub.peerIdPath).toBe(path.join(harness.tempDir, "nested", "p2p", "peer-id.json"));
    expect(writtenConfig.xmtp.dbPath).toBe(path.join(harness.tempDir, "nested", "xmtp", "production", "client.db"));
    expect(writtenConfig.xmtp.publicPolicyPath).toBe(path.join(harness.tempDir, "nested", "policies", "xmtp-public.md"));
    expect(payload.socketDir).toBe(path.dirname(writtenConfig.runtime.socketPath));
    expect(payload.keystoreDir).toBe(path.dirname(writtenConfig.wallet.keystorePath));
    expect(payload.gossipsubDir).toBe(path.dirname(writtenConfig.gossipsub.peerIdPath));
    expect(payload.xmtpDir).toBe(path.dirname(writtenConfig.xmtp.dbPath));
    expect(payload.xmtpPolicyDir).toBe(path.dirname(writtenConfig.xmtp.publicPolicyPath));
    expect(fs.existsSync(payload.socketDir)).toBe(true);
    expect(fs.existsSync(payload.keystoreDir)).toBe(true);
    expect(fs.existsSync(payload.gossipsubDir)).toBe(true);
    expect(fs.existsSync(payload.xmtpDir)).toBe(true);
    expect(fs.existsSync(payload.xmtpPolicyDir)).toBe(true);
  });

  it("does not overwrite an existing config file during create init", async () => {
    const initPath = path.join(harness.tempDir, "existing", "regent.config.json");
    fs.mkdirSync(path.dirname(initPath), { recursive: true });
    fs.writeFileSync(
      initPath,
      JSON.stringify({
        runtime: {
          socketPath: path.join(harness.tempDir, "custom-runtime", "socket.sock"),
          stateDir: path.join(harness.tempDir, "custom-state"),
          logLevel: "debug",
        },
        auth: {
          baseUrl: "http://127.0.0.1:4999",
          audience: "techtree",
          defaultChainId: 84532,
          requestTimeoutMs: 2500,
        },
        techtree: {
          baseUrl: "http://127.0.0.1:5555",
          requestTimeoutMs: 2500,
        },
        wallet: {
          privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
          keystorePath: path.join(harness.tempDir, "custom-keys", "wallet.json"),
        },
        gossipsub: {
          enabled: false,
          listenAddrs: [],
          bootstrap: [],
          peerIdPath: path.join(harness.tempDir, "custom-p2p", "peer-id.json"),
        },
        xmtp: {
          enabled: true,
          env: "production",
          dbPath: path.join(harness.tempDir, "custom-xmtp", "client.db"),
          dbEncryptionKeyPath: path.join(harness.tempDir, "custom-xmtp", "db.key"),
          walletKeyPath: path.join(harness.tempDir, "custom-xmtp", "wallet.key"),
          ownerInboxIds: ["owner-inbox"],
          trustedInboxIds: [],
          publicPolicyPath: path.join(harness.tempDir, "custom-policies", "xmtp-public.md"),
          profiles: {
            owner: "full",
            public: "messaging",
            group: "messaging",
          },
        },
      }),
      "utf8",
    );

    const originalContents = fs.readFileSync(initPath, "utf8");
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["create", "init", "--config", initPath]),
    );

    expect(output.result).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual({
      ok: true,
      configPath: initPath,
      configCreated: false,
      stateDir: path.join(harness.tempDir, "custom-state"),
      socketDir: path.join(harness.tempDir, "custom-runtime"),
      keystoreDir: path.join(harness.tempDir, "custom-keys"),
      gossipsubDir: path.join(harness.tempDir, "custom-p2p"),
      xmtpDir: path.join(harness.tempDir, "custom-xmtp"),
      xmtpPolicyDir: path.join(harness.tempDir, "custom-policies"),
    });
    expect(fs.readFileSync(initPath, "utf8")).toBe(originalContents);
  });

  it("reads the normalized effective config", async () => {
    fs.writeFileSync(
      harness.configPath,
      JSON.stringify({
        techtree: { baseUrl: "http://127.0.0.1:4100" },
        runtime: { logLevel: "debug" },
      }),
      "utf8",
    );

    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["config", "read", "--config", harness.configPath]),
    );

    expect(output.result).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual({
      runtime: {
        socketPath: path.join(harness.tempDir, "run", "regent.sock"),
        stateDir: path.join(harness.tempDir, "state"),
        logLevel: "debug",
      },
      auth: {
        baseUrl: "http://127.0.0.1:4000",
        audience: "techtree",
        defaultChainId: 84532,
        requestTimeoutMs: 10_000,
      },
      techtree: {
        baseUrl: "http://127.0.0.1:4100",
        requestTimeoutMs: 10_000,
      },
      wallet: {
        privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
        keystorePath: path.join(harness.tempDir, "keys", "agent-wallet.json"),
      },
      gossipsub: {
        enabled: false,
        listenAddrs: [],
        bootstrap: [],
        peerIdPath: path.join(harness.tempDir, "p2p", "peer-id.json"),
      },
      xmtp: {
        enabled: false,
        env: "production",
        dbPath: path.join(harness.tempDir, "xmtp", "production", "client.db"),
        dbEncryptionKeyPath: path.join(harness.tempDir, "xmtp", "production", "db.key"),
        walletKeyPath: path.join(harness.tempDir, "xmtp", "production", "wallet.key"),
        ownerInboxIds: [],
        trustedInboxIds: [],
        publicPolicyPath: path.join(harness.tempDir, "policies", "xmtp-public.md"),
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
            workspaceRoot: path.join(harness.tempDir, "workspaces", "openclaw"),
            profiles: ["owner", "public", "group", "bbh"],
          },
          hermes: {
            enabled: true,
            entrypoint: "hermes",
            workspaceRoot: path.join(harness.tempDir, "workspaces", "hermes"),
            profiles: ["owner", "public", "group", "bbh"],
          },
          claude_code: {
            enabled: false,
            entrypoint: "claude",
            workspaceRoot: path.join(harness.tempDir, "workspaces", "claude-code"),
            profiles: ["owner", "public", "group", "bbh"],
          },
          custom: {
            enabled: false,
            entrypoint: "custom-harness",
            workspaceRoot: path.join(harness.tempDir, "workspaces", "custom"),
            profiles: ["custom"],
          },
        },
      },
      workloads: {
        bbh: {
          workspaceRoot: path.join(harness.tempDir, "workspaces", "bbh"),
          defaultHarness: "hermes",
          defaultProfile: "bbh",
        },
      },
    });
  });

  it("writes a validated replacement config from --input @file.json", async () => {
    const inputPath = path.join(harness.tempDir, "replacement.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        runtime: {
          socketPath: path.join(harness.tempDir, "alt-run", "regent.sock"),
          stateDir: path.join(harness.tempDir, "alt-state"),
          logLevel: "warn",
        },
        auth: {
          baseUrl: "http://127.0.0.1:4999",
          audience: "techtree",
          defaultChainId: 8453,
          requestTimeoutMs: 2500,
        },
        techtree: {
          baseUrl: "http://127.0.0.1:4455",
          requestTimeoutMs: 2500,
        },
        wallet: {
          privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
          keystorePath: path.join(harness.tempDir, "alt-keys", "agent-wallet.json"),
        },
        gossipsub: {
          enabled: true,
          listenAddrs: ["/ip4/127.0.0.1/tcp/0"],
          bootstrap: [],
          peerIdPath: path.join(harness.tempDir, "alt-p2p", "peer-id.json"),
        },
        xmtp: {
          enabled: true,
          env: "dev",
          dbPath: path.join(harness.tempDir, "alt-xmtp", "client.db"),
          dbEncryptionKeyPath: path.join(harness.tempDir, "alt-xmtp", "db.key"),
          walletKeyPath: path.join(harness.tempDir, "alt-xmtp", "wallet.key"),
          ownerInboxIds: ["owner-inbox"],
          trustedInboxIds: ["trusted-inbox"],
          publicPolicyPath: path.join(harness.tempDir, "alt-policies", "xmtp-public.md"),
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
              workspaceRoot: path.join(harness.tempDir, "workspaces", "openclaw"),
              profiles: ["owner", "public", "group", "bbh"],
            },
            hermes: {
              enabled: true,
              entrypoint: "hermes",
              workspaceRoot: path.join(harness.tempDir, "workspaces", "hermes"),
              profiles: ["owner", "public", "group", "bbh"],
            },
            claude_code: {
              enabled: false,
              entrypoint: "claude",
              workspaceRoot: path.join(harness.tempDir, "workspaces", "claude-code"),
              profiles: ["owner", "public", "group", "bbh"],
            },
            custom: {
              enabled: false,
              entrypoint: "custom-harness",
              workspaceRoot: path.join(harness.tempDir, "workspaces", "custom"),
              profiles: ["custom"],
            },
          },
        },
        workloads: {
          bbh: {
            workspaceRoot: path.join(harness.tempDir, "workspaces", "bbh"),
            defaultHarness: "hermes",
            defaultProfile: "bbh",
          },
        },
      }),
      "utf8",
    );

    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["config", "write", "--config", harness.configPath, "--input", `@${inputPath}`]),
    );

    const payload = JSON.parse(output.stdout) as {
      ok: boolean;
      configPath: string;
      config: Record<string, unknown>;
    };

    expect(output.result).toBe(0);
    expect(payload).toEqual({
      ok: true,
      configPath: harness.configPath,
      config: {
        runtime: {
          socketPath: path.join(harness.tempDir, "alt-run", "regent.sock"),
          stateDir: path.join(harness.tempDir, "alt-state"),
          logLevel: "warn",
        },
        auth: {
          baseUrl: "http://127.0.0.1:4999",
          audience: "techtree",
          defaultChainId: 8453,
          requestTimeoutMs: 2500,
        },
        techtree: {
          baseUrl: "http://127.0.0.1:4455",
          requestTimeoutMs: 2500,
        },
        wallet: {
          privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
          keystorePath: path.join(harness.tempDir, "alt-keys", "agent-wallet.json"),
        },
        gossipsub: {
          enabled: true,
          listenAddrs: ["/ip4/127.0.0.1/tcp/0"],
          bootstrap: [],
          peerIdPath: path.join(harness.tempDir, "alt-p2p", "peer-id.json"),
        },
        xmtp: {
          enabled: true,
          env: "dev",
          dbPath: path.join(harness.tempDir, "alt-xmtp", "client.db"),
          dbEncryptionKeyPath: path.join(harness.tempDir, "alt-xmtp", "db.key"),
          walletKeyPath: path.join(harness.tempDir, "alt-xmtp", "wallet.key"),
          ownerInboxIds: ["owner-inbox"],
          trustedInboxIds: ["trusted-inbox"],
          publicPolicyPath: path.join(harness.tempDir, "alt-policies", "xmtp-public.md"),
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
              workspaceRoot: path.join(harness.tempDir, "workspaces", "openclaw"),
              profiles: ["owner", "public", "group", "bbh"],
            },
            hermes: {
              enabled: true,
              entrypoint: "hermes",
              workspaceRoot: path.join(harness.tempDir, "workspaces", "hermes"),
              profiles: ["owner", "public", "group", "bbh"],
            },
            claude_code: {
              enabled: false,
              entrypoint: "claude",
              workspaceRoot: path.join(harness.tempDir, "workspaces", "claude-code"),
              profiles: ["owner", "public", "group", "bbh"],
            },
            custom: {
              enabled: false,
              entrypoint: "custom-harness",
              workspaceRoot: path.join(harness.tempDir, "workspaces", "custom"),
              profiles: ["custom"],
            },
          },
        },
        workloads: {
          bbh: {
            workspaceRoot: path.join(harness.tempDir, "workspaces", "bbh"),
            defaultHarness: "hermes",
            defaultProfile: "bbh",
          },
        },
      },
    });
    expect(JSON.parse(fs.readFileSync(harness.configPath, "utf8"))).toEqual(payload.config);
  });

  it("returns a JSON error when create init cannot create the config parent directory", async () => {
    const blockingFile = path.join(harness.tempDir, "blocked-parent");
    fs.writeFileSync(blockingFile, "not-a-directory\n", "utf8");

    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["create", "init", "--config", path.join(blockingFile, "regent.config.json")]),
    );

    expect(output.result).toBe(1);
    expect(output.stdout).toBe("");
    expect(JSON.parse(output.stderr)).toEqual({
      error: {
        message: expect.stringMatching(/EEXIST|ENOTDIR/),
      },
    });
  });

  it("creates a wallet and writes a dev file", async () => {
    const devFilePath = path.join(harness.tempDir, "wallet.json");
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["create", "wallet", "--write-env", "--dev-file", devFilePath]),
    );

    expect(output.result).toBe(0);

    const payload = JSON.parse(output.stdout) as {
      address: string;
      export: string;
      devFile: string;
    };

    const written = JSON.parse(fs.readFileSync(devFilePath, "utf8")) as { privateKey: string };

    expect(payload.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect("privateKey" in payload).toBe(false);
    expect(payload.export).toBe(`export REGENT_WALLET_PRIVATE_KEY=${written.privateKey}`);
    expect(payload.devFile).toBe(devFilePath);
    expect(written.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it("returns a JSON error when create wallet cannot write the dev file", async () => {
    const blockingFile = path.join(harness.tempDir, "wallet-parent");
    fs.writeFileSync(blockingFile, "not-a-directory\n", "utf8");

    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["create", "wallet", "--dev-file", path.join(blockingFile, "wallet.json")]),
    );

    expect(output.result).toBe(1);
    expect(output.stdout).toBe("");
    expect(JSON.parse(output.stderr)).toEqual({
      error: {
        message: expect.stringMatching(/EEXIST|ENOTDIR/),
      },
    });
  });

  it("returns JSON errors when config write input is not @file syntax", async () => {
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["config", "write", "--config", harness.configPath, "--input", "replacement.json"]),
    );

    expect(output.result).toBe(1);
    expect(JSON.parse(output.stderr)).toEqual({
      error: {
        message: "--input must use @/absolute/or/relative/path.json syntax",
      },
    });
  });
});
