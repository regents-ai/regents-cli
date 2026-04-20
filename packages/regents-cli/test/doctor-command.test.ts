import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callJsonRpc, RegentRuntime, writeInitialConfig } from "../src/internal-runtime/index.js";
import { runCliEntrypoint } from "../src/index.js";
import { TechtreeContractServer } from "../../../test-support/techtree-contract-server.js";
import { describeNetwork } from "../../../test-support/integration.js";
import { captureOutput } from "../../../test-support/test-helpers.js";
import { writeFakeCdp } from "./support/fake-cdp.js";

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describeNetwork.sequential("CLI doctor command", () => {
  let server: TechtreeContractServer;
  let runtime: RegentRuntime | null = null;
  let tempDir = "";
  let configPath = "";
  let originalHome: string | undefined;
  let originalPath: string | undefined;
  let originalKeyId: string | undefined;
  let originalKeySecret: string | undefined;
  let originalWalletSecret: string | undefined;
  let originalPrivateKey: string | undefined;
  let socketPath = "";

  beforeEach(async () => {
    server = new TechtreeContractServer();
    await server.start();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regents-cli-doctor-"));
    configPath = path.join(tempDir, "regent.config.json");
    socketPath = path.join(tempDir, "runtime", "regent.sock");
    originalHome = process.env.HOME;
    originalPath = process.env.PATH;
    originalKeyId = process.env.CDP_KEY_ID;
    originalKeySecret = process.env.CDP_KEY_SECRET;
    originalWalletSecret = process.env.CDP_WALLET_SECRET;
    originalPrivateKey = process.env.REGENT_WALLET_PRIVATE_KEY;

    process.env.HOME = tempDir;
    process.env.PATH = `${writeFakeCdp(tempDir)}:${originalPath ?? ""}`;
    process.env.CDP_KEY_ID = "test-key";
    process.env.CDP_KEY_SECRET = "test-secret";
    process.env.CDP_WALLET_SECRET = "test-wallet-secret";
    process.env.REGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY;

    writeInitialConfig(configPath, {
      runtime: {
        socketPath,
        stateDir: path.join(tempDir, "state"),
        logLevel: "debug",
      },
      auth: {
        baseUrl: server.baseUrl,
        audience: "techtree",
        defaultChainId: 84532,
        requestTimeoutMs: 1_000,
      },
      techtree: {
        baseUrl: server.baseUrl,
        requestTimeoutMs: 1_000,
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
    process.env.REGENT_WALLET_PRIVATE_KEY = originalPrivateKey;
  });

  it("renders a human-readable report when auth is not yet established", async () => {
    fs.mkdirSync(path.join(path.dirname(configPath), "runtime"), { recursive: true });

    const output = await captureOutput(async () =>
      runCliEntrypoint(["doctor", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(output.stdout).toContain("R E G E N T   D O C T O R");
    expect(output.stdout).toContain("SIWA session");
    expect(output.stdout).toContain("NEXT MOVES");
    expect(output.stdout).toContain("Run `regents identity ensure`");
  });

  it("renders JSON output with a successful authenticated probe", async () => {
    await captureOutput(async () =>
      runCliEntrypoint(["wallet", "setup", "--json", "--config", configPath]),
    );
    await expect(
      callJsonRpc(socketPath, "auth.siwa.login", {
        chainId: 84532,
        audience: "techtree",
      }),
    ).resolves.toMatchObject({
      code: "siwa_verified",
    });

    const output = await captureOutput(async () =>
      runCliEntrypoint(["doctor", "--json", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    const report = JSON.parse(output.stdout);
    expect(report).toEqual(
      expect.objectContaining({
        mode: "default",
        checks: expect.arrayContaining([
          expect.objectContaining({
            id: "techtree.authenticated.probe",
            status: "ok",
          }),
        ]),
      }),
    );
  });
});
