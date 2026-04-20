import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runConfigRead, runConfigWrite } from "../../src/commands/config.js";
import { parseCliArgs } from "../../src/parse.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

describe("config commands", () => {
  it("prints the normalized effective config", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regents-cli-config-read-"));
    const configPath = path.join(tempDir, "config.json");

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        techtree: {
          baseUrl: "http://127.0.0.1:4100",
        },
      }),
      "utf8",
    );

    const { stdout } = await captureOutput(() => runConfigRead(parseCliArgs(["--config", configPath])));
    const printed = parsePrintedJson<{
      runtime: { socketPath: string; stateDir: string; logLevel: string };
      auth: { baseUrl: string; audience: string; defaultChainId: number; requestTimeoutMs: number };
      techtree: { baseUrl: string; requestTimeoutMs: number };
      xmtp: { dbPath: string; publicPolicyPath: string; env: string };
      agents: { defaultHarness: string; harnesses: { hermes: { workspaceRoot: string } } };
      workloads: { bbh: { workspaceRoot: string; defaultHarness: string; defaultProfile: string } };
    }>(stdout);

    expect(printed.runtime.socketPath).toBe(path.join(tempDir, "run", "regent.sock"));
    expect(printed.runtime.stateDir).toBe(path.join(tempDir, "state"));
    expect(printed.runtime.logLevel).toBe("info");
    expect(printed.auth).toEqual({
      baseUrl: "http://127.0.0.1:4000",
      audience: "techtree",
      defaultChainId: 84532,
      requestTimeoutMs: 10_000,
    });
    expect(printed.techtree).toEqual({
      baseUrl: "http://127.0.0.1:4100",
      requestTimeoutMs: 10_000,
    });
    expect(printed.xmtp).toEqual({
      enabled: false,
      dbPath: path.join(tempDir, "xmtp", "production", "client.db"),
      dbEncryptionKeyPath: path.join(tempDir, "xmtp", "production", "db.key"),
      walletKeyPath: path.join(tempDir, "xmtp", "production", "wallet.key"),
      ownerInboxIds: [],
      trustedInboxIds: [],
      publicPolicyPath: path.join(tempDir, "policies", "xmtp-public.md"),
      env: "production",
      profiles: {
        owner: "full",
        public: "messaging",
        group: "messaging",
      },
    });
    expect(printed.agents.defaultHarness).toBe("hermes");
    expect(printed.agents.harnesses.hermes.workspaceRoot).toBe(path.join(tempDir, "workspaces", "hermes"));
    expect(printed.workloads.bbh).toEqual({
      workspaceRoot: path.join(tempDir, "workspaces", "bbh"),
      defaultHarness: "hermes",
      defaultProfile: "bbh",
    });
  });

  it("writes a full validated replacement config from @file input", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regents-cli-config-write-"));
    const configPath = path.join(tempDir, "config.json");
    const inputPath = path.join(tempDir, "replacement.json");

    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        runtime: {
          socketPath: path.join(tempDir, "alt", "regent.sock"),
          stateDir: path.join(tempDir, "alt-state"),
          logLevel: "error",
        },
        auth: {
          baseUrl: "http://127.0.0.1:4000",
          audience: "techtree",
          defaultChainId: 8453,
          requestTimeoutMs: 3500,
        },
        techtree: {
          baseUrl: "http://127.0.0.1:4300",
          requestTimeoutMs: 3500,
        },
        wallet: {
          privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
          keystorePath: path.join(tempDir, "keys", "agent-wallet.json"),
        },
        gossipsub: {
          enabled: false,
          listenAddrs: [],
          bootstrap: [],
          peerIdPath: path.join(tempDir, "p2p", "peer-id.json"),
        },
        xmtp: {
          enabled: false,
          env: "production",
          dbPath: path.join(tempDir, "xmtp", "production", "client.db"),
          dbEncryptionKeyPath: path.join(tempDir, "xmtp", "production", "db.key"),
          walletKeyPath: path.join(tempDir, "xmtp", "production", "wallet.key"),
          ownerInboxIds: [],
          trustedInboxIds: [],
          publicPolicyPath: path.join(tempDir, "policies", "xmtp-public.md"),
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
              workspaceRoot: path.join(tempDir, "workspaces", "openclaw"),
              profiles: ["owner", "public", "group", "bbh"],
            },
            hermes: {
              enabled: true,
              entrypoint: "hermes",
              workspaceRoot: path.join(tempDir, "workspaces", "hermes"),
              profiles: ["owner", "public", "group", "bbh"],
            },
            claude_code: {
              enabled: false,
              entrypoint: "claude",
              workspaceRoot: path.join(tempDir, "workspaces", "claude-code"),
              profiles: ["owner", "public", "group", "bbh"],
            },
            custom: {
              enabled: false,
              entrypoint: "custom-harness",
              workspaceRoot: path.join(tempDir, "workspaces", "custom"),
              profiles: ["custom"],
            },
          },
        },
        workloads: {
          bbh: {
            workspaceRoot: path.join(tempDir, "workspaces", "bbh"),
            defaultHarness: "hermes",
            defaultProfile: "bbh",
          },
        },
      }),
      "utf8",
    );

    const { stdout } = await captureOutput(() =>
      runConfigWrite(parseCliArgs(["--config", configPath, "--input", `@${inputPath}`])),
    );
    const printed = parsePrintedJson<{
      ok: boolean;
      configPath: string;
      config: {
        auth: { baseUrl: string; audience: string; defaultChainId: number; requestTimeoutMs: number };
        techtree: { baseUrl: string; requestTimeoutMs: number };
        runtime: { logLevel: string };
        agents: { defaultHarness: string };
        workloads: { bbh: { defaultProfile: string } };
      };
    }>(stdout);

    expect(printed.ok).toBe(true);
    expect(printed.configPath).toBe(configPath);
    expect(printed.config.runtime.logLevel).toBe("error");
    expect(printed.config.agents.defaultHarness).toBe("hermes");
    expect(printed.config.workloads.bbh.defaultProfile).toBe("bbh");
    expect(printed.config.auth).toEqual({
      baseUrl: "http://127.0.0.1:4000",
      audience: "techtree",
      defaultChainId: 8453,
      requestTimeoutMs: 3500,
    });
    expect(printed.config.techtree).toEqual({
      baseUrl: "http://127.0.0.1:4300",
      requestTimeoutMs: 3500,
    });
    expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual(printed.config);
  });
});
