import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { captureOutput } from "../../../test-support/test-helpers.js";
import { setupCliEntrypointHarness } from "./helpers/cli-entrypoint-support.js";

const harness = setupCliEntrypointHarness();

describe("CLI config flows", () => {
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
        harness.runCliEntrypoint(["init", "--config", initPath]),
      );
    } finally {
      process.env.HOME = originalHome;
    }

    expect(output).toBeDefined();

    if (!output) {
      throw new Error("expected init output");
    }

    expect(output.result).toBe(0);

    const payload = JSON.parse(output.stdout) as {
      config_path: string;
      config_created: boolean;
      directories: {
        state: string;
        socket: string;
        wallet: string;
        gossipsub: string;
      };
    };

    const writtenConfig = JSON.parse(fs.readFileSync(initPath, "utf8")) as {
      runtime: { socketPath: string; stateDir: string };
      services: {
        platform: { baseUrl: string };
        techtree: { baseUrl: string };
        autolaunch: { baseUrl: string };
      };
      wallet: { keystorePath: string };
      gossipsub: { peerIdPath: string };
    };

    expect(fs.existsSync(payload.config_path)).toBe(true);
    expect(payload.config_created).toBe(true);
    expect(fs.existsSync(payload.directories.state)).toBe(true);
    expect(writtenConfig.runtime.stateDir).toBe(path.join(harness.tempDir, "nested", "state"));
    expect(writtenConfig.runtime.socketPath).toBe(path.join(harness.tempDir, "nested", "run", "regent.sock"));
    expect(writtenConfig.wallet.keystorePath).toBe(path.join(harness.tempDir, "nested", "keys", "agent-wallet.json"));
    expect(writtenConfig.gossipsub.peerIdPath).toBe(path.join(harness.tempDir, "nested", "p2p", "peer-id.json"));
    expect(writtenConfig.services.platform.baseUrl).toBe("https://regents.sh");
    expect(writtenConfig.services.techtree.baseUrl).toBe("https://regents.sh");
    expect(writtenConfig.services.autolaunch.baseUrl).toBe("https://regents.sh");
    expect(payload.directories.socket).toBe(path.dirname(writtenConfig.runtime.socketPath));
    expect(payload.directories.wallet).toBe(path.dirname(writtenConfig.wallet.keystorePath));
    expect(payload.directories.gossipsub).toBe(path.dirname(writtenConfig.gossipsub.peerIdPath));
    expect(fs.existsSync(payload.directories.socket)).toBe(true);
    expect(fs.existsSync(payload.directories.wallet)).toBe(true);
    expect(fs.existsSync(payload.directories.gossipsub)).toBe(true);
  });

  it("does not overwrite an existing config file during init", async () => {
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
          audience: "techtree",
          defaultChainId: 8453,
        },
        services: {
          siwa: {
            baseUrl: "http://127.0.0.1:4999",
            requestTimeoutMs: 2500,
          },
          platform: {
            baseUrl: "http://127.0.0.1:4999",
            requestTimeoutMs: 2500,
          },
          autolaunch: {
            baseUrl: "http://127.0.0.1:4010",
            requestTimeoutMs: 2500,
          },
          techtree: {
            baseUrl: "http://127.0.0.1:5555",
            requestTimeoutMs: 2500,
          },
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
      }),
      "utf8",
    );

    const originalContents = fs.readFileSync(initPath, "utf8");
    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["init", "--config", initPath]),
    );

    expect(output.result).toBe(0);
    expect(JSON.parse(output.stdout)).toMatchObject({
      ok: true,
      command: "init",
      status: "waiting",
      config_path: initPath,
      config_created: false,
      directories: {
        state: path.join(harness.tempDir, "custom-state"),
        socket: path.join(harness.tempDir, "custom-runtime"),
        wallet: path.join(harness.tempDir, "custom-keys"),
        gossipsub: path.join(harness.tempDir, "custom-p2p"),
      },
      plugin: { selected_runtime: "auto", installed_now: [] },
      daemon: { running: true, started_now: false },
      doctor: { ok: true, fail: 0 },
      next_actions: ["regents identity ensure"],
    });
    expect(fs.readFileSync(initPath, "utf8")).toBe(originalContents);
  });

  it("reads the normalized effective config", async () => {
    fs.writeFileSync(
      harness.configPath,
      JSON.stringify({
        services: { techtree: { baseUrl: "http://127.0.0.1:4100" } },
        runtime: { logLevel: "debug" },
      }),
      "utf8",
    );

    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["config", "get", "--config", harness.configPath]),
    );

    expect(output.result).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual({
      runtime: {
        socketPath: path.join(harness.tempDir, "run", "regent.sock"),
        stateDir: path.join(harness.tempDir, "state"),
        logLevel: "debug",
      },
      auth: {
        audience: "techtree",
        defaultChainId: 8453,
      },
      services: {
        siwa: {
          baseUrl: "https://siwa-server.fly.dev",
          requestTimeoutMs: 10_000,
        },
        platform: {
          baseUrl: "https://regents.sh",
          requestTimeoutMs: 10_000,
        },
        autolaunch: {
          baseUrl: "https://regents.sh",
          requestTimeoutMs: 10_000,
        },
        techtree: {
          baseUrl: "http://127.0.0.1:4100",
          requestTimeoutMs: 10_000,
        },
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
          codex: {
            enabled: false,
            entrypoint: "codex",
            workspaceRoot: path.join(harness.tempDir, "workspaces", "codex"),
            profiles: ["owner", "public", "group", "bbh", "science"],
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
        science: {
          workspaceRoot: path.join(harness.tempDir, "workspaces", "science"),
          taskRepoRoot: path.join(harness.tempDir, "workspaces", "science", "repos"),
          defaultAgent: "codex",
          defaultModel: "openai/gpt-5.4",
          defaultEnvironment: "docker",
          defaultTaskRef: "main",
          publishVisibility: "public",
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
          audience: "techtree",
          defaultChainId: 8453,
        },
        services: {
          siwa: {
            baseUrl: "http://127.0.0.1:4999",
            requestTimeoutMs: 2500,
          },
          platform: {
            baseUrl: "http://127.0.0.1:4999",
            requestTimeoutMs: 2500,
          },
          autolaunch: {
            baseUrl: "http://127.0.0.1:4010",
            requestTimeoutMs: 2500,
          },
          techtree: {
            baseUrl: "http://127.0.0.1:4455",
            requestTimeoutMs: 2500,
          },
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
            codex: {
              enabled: false,
              entrypoint: "codex",
              workspaceRoot: path.join(harness.tempDir, "workspaces", "codex"),
              profiles: ["owner", "public", "group", "bbh", "science"],
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
          science: {
            workspaceRoot: path.join(harness.tempDir, "workspaces", "science"),
            taskRepoRoot: path.join(harness.tempDir, "workspaces", "science", "repos"),
            defaultAgent: "codex",
            defaultModel: "openai/gpt-5.4",
            defaultEnvironment: "docker",
            defaultTaskRef: "main",
            publishVisibility: "public",
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
          audience: "techtree",
          defaultChainId: 8453,
        },
        services: {
          siwa: {
            baseUrl: "http://127.0.0.1:4999",
            requestTimeoutMs: 2500,
          },
          platform: {
            baseUrl: "http://127.0.0.1:4999",
            requestTimeoutMs: 2500,
          },
          autolaunch: {
            baseUrl: "http://127.0.0.1:4010",
            requestTimeoutMs: 2500,
          },
          techtree: {
            baseUrl: "http://127.0.0.1:4455",
            requestTimeoutMs: 2500,
          },
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
            codex: {
              enabled: false,
              entrypoint: "codex",
              workspaceRoot: path.join(harness.tempDir, "workspaces", "codex"),
              profiles: ["owner", "public", "group", "bbh", "science"],
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
          science: {
            workspaceRoot: path.join(harness.tempDir, "workspaces", "science"),
            taskRepoRoot: path.join(harness.tempDir, "workspaces", "science", "repos"),
            defaultAgent: "codex",
            defaultModel: "openai/gpt-5.4",
            defaultEnvironment: "docker",
            defaultTaskRef: "main",
            publishVisibility: "public",
          },
        },
      },
    });
    expect(JSON.parse(fs.readFileSync(harness.configPath, "utf8"))).toEqual(payload.config);
  });

  it("returns a JSON error when init cannot create the config parent directory", async () => {
    const blockingFile = path.join(harness.tempDir, "blocked-parent");
    fs.writeFileSync(blockingFile, "not-a-directory\n", "utf8");

    const output = await captureOutput(async () =>
      harness.runCliEntrypoint(["init", "--config", path.join(blockingFile, "regent.config.json")]),
    );

    expect(output.result).toBe(1);
    expect(output.stdout).toBe("");
    expect(JSON.parse(output.stderr)).toEqual({
      error: {
        code: "command_failed",
        message: expect.stringMatching(/EEXIST|ENOTDIR/),
        next_steps: ["regents status"],
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
        code: "command_failed",
        message: "--input must use @/absolute/or/relative/path.json syntax",
      },
    });
  });
});
