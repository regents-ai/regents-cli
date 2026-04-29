import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RegentRuntime, writeInitialConfig } from "../../src/internal-runtime/index.js";
import { runCliEntrypoint } from "../../src/index.js";
import { TechtreeContractServer } from "../../../../test-support/techtree-contract-server.js";
import { describeNetwork } from "../../../../test-support/integration.js";
import { captureOutput } from "../../../../test-support/test-helpers.js";

const TEST_WALLET = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const TEST_REGISTRY = "0x2222222222222222222222222222222222222222";
const TEST_AGENT_REGISTRY = `eip155:8453/erc8004:${TEST_REGISTRY}`;
const TEST_SIGNATURE = `0x${"1".repeat(130)}`;

describeNetwork.sequential("CLI functional flows against the real runtime", () => {
  let server: TechtreeContractServer;
  let runtime: RegentRuntime | null = null;
  let tempDir = "";
  let configPath = "";
  let originalHome: string | undefined;
  let originalPath: string | undefined;
  let originalKeyId: string | undefined;
  let originalKeySecret: string | undefined;
  let originalWalletSecret: string | undefined;

  const receiptPath = (): string => path.join(tempDir, ".regent", "identity", "receipt-v1.json");
  const walletStatePath = (): string => path.join(tempDir, "state", "coinbase-wallet.json");

  const identityRequestCount = (): number =>
    server.requests.filter((request) => request.pathname.startsWith("/v1/identity/")).length;

  const writeFakeCdp = (): void => {
    const binDir = path.join(tempDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    const scriptPath = path.join(binDir, "cdp");
    fs.writeFileSync(
      scriptPath,
      `#!/bin/bash
set -euo pipefail

if [[ "$#" -ge 4 && "$1" == "evm" && "$2" == "accounts" && "$3" == "by-name" && "$4" == "main" ]]; then
  printf '{"name":"main","address":"${TEST_WALLET}"}\\n'
  exit 0
fi

if [[ "$#" -ge 3 && "$1" == "evm" && "$2" == "accounts" && "$3" == "list" ]]; then
  printf '{"accounts":[{"name":"main","address":"${TEST_WALLET}"}]}\\n'
  exit 0
fi

if [[ "$#" -ge 4 && "$1" == "evm" && "$2" == "accounts" && "$3" == "create" ]]; then
  printf '{"name":"main","address":"${TEST_WALLET}"}\\n'
  exit 0
fi

if [[ "$#" -ge 5 && "$1" == "evm" && "$2" == "accounts" && "$3" == "sign" && "$4" == "message" ]]; then
  printf '{"signature":"${TEST_SIGNATURE}"}\\n'
  exit 0
fi

if [[ "$#" -ge 1 && "$1" == "mcp" ]]; then
  printf '{"ok":true}\\n'
  exit 0
fi

echo "unsupported cdp command: $*" >&2
exit 1
`,
      "utf8",
    );
    fs.chmodSync(scriptPath, 0o755);
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
  };

  beforeEach(async () => {
    server = new TechtreeContractServer();
    await server.start();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regents-cli-functional-"));
    configPath = path.join(tempDir, "regent.config.json");
    originalHome = process.env.HOME;
    originalPath = process.env.PATH;
    originalKeyId = process.env.CDP_KEY_ID;
    originalKeySecret = process.env.CDP_KEY_SECRET;
    originalWalletSecret = process.env.CDP_WALLET_SECRET;

    process.env.HOME = tempDir;
    process.env.CDP_KEY_ID = "test-key";
    process.env.CDP_KEY_SECRET = "test-secret";
    process.env.CDP_WALLET_SECRET = "test-wallet-secret";
    writeFakeCdp();

    writeInitialConfig(configPath, {
      runtime: {
        socketPath: path.join(tempDir, "runtime", "regent.sock"),
        stateDir: path.join(tempDir, "state"),
        logLevel: "debug",
      },
      auth: {
        audience: "techtree",
        defaultChainId: 8453,
      },
      services: {
        siwa: {
          baseUrl: server.baseUrl,
          requestTimeoutMs: 1_000,
        },
        platform: {
          baseUrl: server.baseUrl,
          requestTimeoutMs: 1_000,
        },
        autolaunch: {
          baseUrl: "http://127.0.0.1:4010",
          requestTimeoutMs: 1_000,
        },
        techtree: {
          baseUrl: server.baseUrl,
          requestTimeoutMs: 1_000,
        },
      },
      wallet: {
        privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
        keystorePath: path.join(tempDir, "keys", "agent-wallet.json"),
      },
    });

    runtime = new RegentRuntime(configPath);
    await runtime.start();
  });

  afterEach(async () => {
    if (runtime) {
      await runtime.stop();
    }
    await server.stop();
    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    process.env.CDP_KEY_ID = originalKeyId;
    process.env.CDP_KEY_SECRET = originalKeySecret;
    process.env.CDP_WALLET_SECRET = originalWalletSecret;
  });

  it("creates a Coinbase wallet state file, creates a shared identity receipt, and reuses the cache", async () => {
    const walletSetup = await captureOutput(async () =>
      runCliEntrypoint(["wallet", "setup", "--json", "--config", configPath]),
    );
    expect(walletSetup.result).toBe(0);
    expect(JSON.parse(walletSetup.stdout)).toEqual({
      ok: true,
      provider: "coinbase-cdp",
      wallet: {
        name: "main",
        address: TEST_WALLET,
      },
      created: false,
      state_path: walletStatePath(),
    });
    expect(fs.existsSync(walletStatePath())).toBe(true);

    const firstEnsure = await captureOutput(async () =>
      runCliEntrypoint(["identity", "ensure", "--json", "--network", "base", "--config", configPath]),
    );
    expect(firstEnsure.result).toBe(0);
    expect(JSON.parse(firstEnsure.stdout)).toEqual({
      status: "ok",
      provider: "coinbase-cdp",
      network: "base",
      address: TEST_WALLET,
      agent_id: 99,
      agent_registry: TEST_AGENT_REGISTRY,
      verified: "onchain",
      receipt_expires_at: "2999-01-01T00:00:00.000Z",
      cache_path: receiptPath(),
    });

    expect(fs.existsSync(receiptPath())).toBe(true);
    expect(JSON.parse(fs.readFileSync(receiptPath(), "utf8"))).toEqual({
      version: 1,
      regent_base_url: server.baseUrl,
      network: "base",
      provider: "coinbase-cdp",
      address: TEST_WALLET,
      agent_id: 99,
      agent_registry: TEST_AGENT_REGISTRY,
      signer_type: "evm_personal_sign",
      verified: "onchain",
      receipt: expect.stringContaining("receipt-valid."),
      receipt_issued_at: "2026-03-10T00:00:00.000Z",
      receipt_expires_at: "2999-01-01T00:00:00.000Z",
      cached_at: expect.any(String),
      wallet_hint: "main",
    });

    const requestsAfterFirstEnsure = identityRequestCount();
    const secondEnsure = await captureOutput(async () =>
      runCliEntrypoint(["identity", "ensure", "--json", "--network", "base", "--config", configPath]),
    );
    expect(secondEnsure.result).toBe(0);
    expect(identityRequestCount()).toBe(requestsAfterFirstEnsure);

    const refreshedEnsure = await captureOutput(async () =>
      runCliEntrypoint([
        "identity",
        "ensure",
        "--json",
        "--network",
        "base",
        "--force-refresh",
        "--config",
        configPath,
      ]),
    );
    expect(refreshedEnsure.result).toBe(0);
    expect(identityRequestCount()).toBeGreaterThan(requestsAfterFirstEnsure);
  }, 15_000);

  it("reports the Coinbase wallet and identity status through the narrowed CLI surface", async () => {
    await captureOutput(async () => runCliEntrypoint(["wallet", "setup", "--json", "--config", configPath]));
    await captureOutput(async () =>
      runCliEntrypoint(["identity", "ensure", "--json", "--network", "base", "--config", configPath]),
    );

    const status = await captureOutput(async () =>
      runCliEntrypoint(["identity", "status", "--json", "--network", "base", "--config", configPath]),
    );

    expect(status.result).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual(
      expect.objectContaining({
        ok: true,
        provider: "coinbase-cdp",
        network: "base",
        wallet_ready: true,
        identity_ready: true,
        address: TEST_WALLET,
        identity: expect.objectContaining({
          provider: "coinbase-cdp",
          registered: true,
          verified: "onchain",
        }),
      }),
    );
  }, 15_000);

  it("exports the Hermes MCP fragment for Coinbase only", async () => {
    const output = await captureOutput(async () =>
      runCliEntrypoint(["mcp", "export", "hermes", "--json", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual({
      ok: true,
      provider: "coinbase-cdp",
      mcpServers: {
        "coinbase-cdp": {
          transport: "stdio",
          command: "cdp",
          args: ["mcp"],
        },
      },
    });
  });

  it("fails cleanly when the Coinbase command line tool is not available", async () => {
    process.env.PATH = path.join(tempDir, "empty-bin");
    fs.mkdirSync(process.env.PATH, { recursive: true });

    const output = await captureOutput(async () =>
      runCliEntrypoint(["wallet", "status", "--json", "--config", configPath]),
    );

    expect(output.result).toBe(1);
    expect(JSON.parse(output.stdout)).toEqual(
      expect.objectContaining({
        ok: false,
        provider: "coinbase-cdp",
        next_action: expect.objectContaining({
          command: expect.stringContaining("regents wallet setup"),
        }),
      }),
    );
  });
});
