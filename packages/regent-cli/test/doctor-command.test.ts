import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RegentRuntime, writeInitialConfig } from "../src/internal-runtime/index.js";

import { runCliEntrypoint } from "../src/index.js";
import { TechtreeContractServer } from "../../../test-support/techtree-contract-server.js";
import { describeNetwork } from "../../../test-support/integration.js";
import { captureOutput } from "../../../test-support/test-helpers.js";

const TEST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TEST_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TEST_REGISTRY = "0x2222222222222222222222222222222222222222";

describeNetwork.sequential("CLI doctor command", () => {
  let server: TechtreeContractServer;
  let runtime: RegentRuntime | null = null;
  let configPath = "";
  let stateFilePath = "";
  let originalPrivateKey: string | undefined;

  beforeEach(async () => {
    server = new TechtreeContractServer();
    await server.start();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-cli-doctor-"));
    configPath = path.join(tempDir, "regent.config.json");
    stateFilePath = path.join(tempDir, "state", "runtime-state.json");
    originalPrivateKey = process.env.REGENT_WALLET_PRIVATE_KEY;
    process.env.REGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY;

    writeInitialConfig(configPath, {
      runtime: {
        socketPath: path.join(tempDir, "runtime", "regent.sock"),
        stateDir: path.join(tempDir, "state"),
        logLevel: "debug",
      },
      techtree: {
        baseUrl: server.baseUrl,
        audience: "techtree",
        defaultChainId: 11155111,
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
    process.env.REGENT_WALLET_PRIVATE_KEY = originalPrivateKey;
  });

  it("renders a human-readable report when auth is not yet established", async () => {
    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(
      stateFilePath,
      `${JSON.stringify({
        agent: {
          walletAddress: TEST_WALLET,
          chainId: 11155111,
          registryAddress: TEST_REGISTRY,
          tokenId: "99",
        },
      }, null, 2)}\n`,
      "utf8",
    );
    fs.mkdirSync(path.join(path.dirname(configPath), "runtime"), { recursive: true });

    const output = await captureOutput(async () =>
      runCliEntrypoint(["doctor", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(output.stdout).toContain("R E G E N T   D O C T O R");
    expect(output.stdout).toContain("SIWA session");
    expect(output.stdout).toContain("NEXT MOVES");
    expect(output.stdout).toContain("Run `regent auth siwa login`");
  });

  it("renders JSON output with a successful authenticated probe", async () => {
    const loginOutput = await captureOutput(async () =>
      runCliEntrypoint([
        "auth",
        "siwa",
        "login",
        "--config",
        configPath,
        "--wallet-address",
        TEST_WALLET,
        "--chain-id",
        "11155111",
        "--registry-address",
        TEST_REGISTRY,
        "--token-id",
        "99",
      ]),
    );
    expect(loginOutput.result).toBe(0);

    const output = await captureOutput(async () =>
      runCliEntrypoint(["doctor", "--json", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(output.stderr).toBe("");
    expect(JSON.parse(output.stdout)).toEqual(
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
