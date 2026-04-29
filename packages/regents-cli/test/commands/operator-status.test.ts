import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCliEntrypoint } from "../../src/index.js";
import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import type { RegentIdentityReceipt } from "../../src/internal-types/index.js";
import { writeFakeCdp } from "../support/fake-cdp.js";
import { captureOutput } from "../../../../test-support/test-helpers.js";

const TEST_WALLET = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as const;

const writeReceipt = (homeDir: string, receipt: RegentIdentityReceipt): void => {
  const receiptPath = path.join(homeDir, ".regent", "identity", "receipt-v1.json");
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
};

describe("top-level operator status commands", () => {
  let tempDir = "";
  let configPath = "";
  let originalHome: string | undefined;
  let originalPath: string | undefined;
  let originalKeyId: string | undefined;
  let originalKeySecret: string | undefined;
  let originalWalletSecret: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regents-operator-status-"));
    configPath = path.join(tempDir, "regent.config.json");
    originalHome = process.env.HOME;
    originalPath = process.env.PATH;
    originalKeyId = process.env.CDP_KEY_ID;
    originalKeySecret = process.env.CDP_KEY_SECRET;
    originalWalletSecret = process.env.CDP_WALLET_SECRET;

    process.env.HOME = tempDir;
    process.env.PATH = `${writeFakeCdp(tempDir)}:${originalPath ?? ""}`;
    process.env.CDP_KEY_ID = "test-key";
    process.env.CDP_KEY_SECRET = "test-secret";
    process.env.CDP_WALLET_SECRET = "test-wallet-secret";

    writeInitialConfig(configPath, {
      runtime: {
        socketPath: path.join(tempDir, "runtime", "regent.sock"),
        stateDir: path.join(tempDir, "state"),
        logLevel: "debug",
      },
      auth: {
        audience: "techtree",
        defaultChainId: 84532,
      },
      services: {
        siwa: {
          baseUrl: "https://regent.example",
          requestTimeoutMs: 1_000,
        },
        platform: {
          baseUrl: "https://regent.example",
          requestTimeoutMs: 1_000,
        },
        autolaunch: {
          baseUrl: "http://127.0.0.1:4010",
          requestTimeoutMs: 1_000,
        },
        techtree: {
          baseUrl: "https://regent.example",
          requestTimeoutMs: 1_000,
        },
      },
      wallet: {
        privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
        keystorePath: path.join(tempDir, "keys", "agent-wallet.json"),
      },
    });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    process.env.CDP_KEY_ID = originalKeyId;
    process.env.CDP_KEY_SECRET = originalKeySecret;
    process.env.CDP_WALLET_SECRET = originalWalletSecret;
  });

  it("does not mark identity ready in status when the saved receipt belongs to a different network", async () => {
    writeReceipt(tempDir, {
      version: 1,
      regent_base_url: "https://regent.example",
      network: "base",
      provider: "coinbase-cdp",
      address: TEST_WALLET,
      agent_id: 99,
      agent_registry: "0x2222222222222222222222222222222222222222",
      signer_type: "evm_personal_sign",
      verified: "onchain",
      receipt: "receipt-valid",
      receipt_issued_at: "2026-04-17T00:00:00.000Z",
      receipt_expires_at: "2999-01-01T00:00:00.000Z",
      cached_at: "2026-04-17T00:00:00.000Z",
      wallet_hint: "main",
    });

    const output = await captureOutput(async () =>
      runCliEntrypoint(["status", "--config", configPath]),
    );

    expect(output.stderr).toBe("");
    expect(output).toMatchObject({ result: 0 });
    expect(output.stderr).toBe("");
    expect(JSON.parse(output.stdout)).toMatchObject({
      ok: true,
      command: "status",
      status: "waiting",
      components: expect.arrayContaining([
        expect.objectContaining({
          name: "identity",
          status: "waiting",
          detail: "Run regents identity ensure",
        }),
      ]),
    });
  });

  it("does not show a stale identity in whoami when the saved receipt belongs to a different network", async () => {
    writeReceipt(tempDir, {
      version: 1,
      regent_base_url: "https://regent.example",
      network: "base",
      provider: "coinbase-cdp",
      address: TEST_WALLET,
      agent_id: 99,
      agent_registry: "0x2222222222222222222222222222222222222222",
      signer_type: "evm_personal_sign",
      verified: "onchain",
      receipt: "receipt-valid",
      receipt_issued_at: "2026-04-17T00:00:00.000Z",
      receipt_expires_at: "2999-01-01T00:00:00.000Z",
      cached_at: "2026-04-17T00:00:00.000Z",
      wallet_hint: "main",
    });

    const output = await captureOutput(async () =>
      runCliEntrypoint(["whoami", "--config", configPath]),
    );

    expect(output).toMatchObject({ result: 0 });
    expect(output.stderr).toBe("");
    expect(JSON.parse(output.stdout)).toMatchObject({
      ok: true,
      command: "whoami",
      wallet: {
        name: "main",
        address: TEST_WALLET,
      },
      identity: null,
      chain_id: 84532,
    });
  });

  it("includes the Platform projection in whoami --full", async () => {
    writeReceipt(tempDir, {
      version: 1,
      regent_base_url: "https://regent.example",
      network: "base-sepolia",
      provider: "coinbase-cdp",
      address: TEST_WALLET,
      agent_id: 99,
      agent_registry: "0x2222222222222222222222222222222222222222",
      signer_type: "evm_personal_sign",
      verified: "onchain",
      receipt: "receipt-valid",
      receipt_issued_at: "2026-04-17T00:00:00.000Z",
      receipt_expires_at: "2999-01-01T00:00:00.000Z",
      cached_at: "2026-04-17T00:00:00.000Z",
      wallet_hint: "main",
    });
    const sessionFile = path.join(tempDir, ".regent", "platform", "session.json");
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    const seenPaths: string[] = [];
    const server = http.createServer((request, response) => {
      seenPaths.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, agent_id: 99, companies: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Platform test server did not start.");
    }
    const origin = `http://127.0.0.1:${address.port}`;
    fs.writeFileSync(
      sessionFile,
      `${JSON.stringify({
        version: 1,
        origin,
        cookie: "_platform_phx_key=session-cookie",
        csrfToken: "csrf-token",
        savedAt: "2026-04-01T00:00:00.000Z",
      })}\n`,
      "utf8",
    );

    const output = await captureOutput(async () =>
      runCliEntrypoint(["whoami", "--full", "--config", configPath, "--session-file", sessionFile]),
    );
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

    expect(output).toMatchObject({ result: 0 });
    expect(seenPaths).toEqual(["/api/agent-platform/projection"]);
    expect(JSON.parse(output.stdout)).toMatchObject({
      ok: true,
      command: "whoami",
      identity_graph: {
        agent_id: 99,
        platform_projection: {
          agent_id: 99,
        },
      },
    });
  });
});
