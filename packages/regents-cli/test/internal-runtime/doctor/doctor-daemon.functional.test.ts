import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callJsonRpc, RegentRuntime, writeInitialConfig } from "../../../src/internal-runtime/index.js";
import { TechtreeContractServer } from "../../../../../test-support/techtree-contract-server.js";
import { describeNetwork } from "../../../../../test-support/integration.js";
import { writeFakeCdp } from "../../support/fake-cdp.js";

const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describeNetwork.sequential("doctor JSON-RPC methods", () => {
  let server: TechtreeContractServer;
  let runtime: RegentRuntime | null = null;
  let tempDir = "";
  let configPath = "";
  let socketPath = "";
  let originalHome: string | undefined;
  let originalPath: string | undefined;
  let originalKeyId: string | undefined;
  let originalKeySecret: string | undefined;
  let originalWalletSecret: string | undefined;
  let originalPrivateKey: string | undefined;

  const seedTechtreeAuthSession = async (): Promise<void> => {
    await callJsonRpc(socketPath, "auth.siwa.login", {
      chainId: 8453,
      audience: "techtree",
    });
  };

  beforeEach(async () => {
    server = new TechtreeContractServer();
    await server.start();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-doctor-daemon-"));
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
        defaultChainId: 8453,
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

  it("returns structured default, scoped, and full doctor reports over JSON-RPC", async () => {
    const initial = await callJsonRpc(socketPath, "doctor.run");
    expect(initial.mode).toBe("default");
    expect(initial.summary.fail).toBe(0);
    expect(initial.summary.warn).toBeGreaterThan(0);
    expect(initial.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "auth.siwa.nonce.endpoint",
          status: "skip",
        }),
        expect.objectContaining({
          id: "auth.identity.headers",
          status: "warn",
        }),
        expect.objectContaining({
          id: "auth.session.present",
          status: "warn",
        }),
        expect.objectContaining({
          id: "auth.http-envelope.build",
          status: "skip",
        }),
      ]),
    );

    await seedTechtreeAuthSession();

    const scoped = await callJsonRpc(socketPath, "doctor.runScoped", {
      scope: "techtree",
    });
    expect(scoped.mode).toBe("scoped");
    expect(scoped.scope).toBe("techtree");
    expect(scoped.summary.fail).toBe(0);
    expect(scoped.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "techtree.authenticated.probe",
          status: "ok",
        }),
      ]),
    );

    const full = await callJsonRpc(socketPath, "doctor.runFull", {
      knownParentId: 1,
    });
    expect(full.mode).toBe("full");
    expect(full.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "full.node.create",
          status: "ok",
          details: expect.objectContaining({
            statusCode: 201,
          }),
        }),
        expect.objectContaining({
          id: "full.comment.add",
          status: "ok",
        }),
        expect.objectContaining({
          id: "full.comment.readback",
          status: "ok",
        }),
      ]),
    );
  }, 15_000);

  it("preserves backend denial metadata on authenticated probe failures", async () => {
    await seedTechtreeAuthSession();

    runtime!.sessionStore.setSiwaSession({
      ...(runtime!.sessionStore.getSiwaSession() as NonNullable<ReturnType<typeof runtime!.sessionStore.getSiwaSession>>),
      receipt: "receipt-invalid",
    });

    const report = await callJsonRpc(socketPath, "doctor.runScoped", {
      scope: "techtree",
    });
    const probe = report.checks.find((check) => check.id === "techtree.authenticated.probe");

    expect(probe).toMatchObject({
      status: "fail",
      details: {
        route: "/v1/agent/opportunities",
        status: 401,
        backend: {
          code: "http_envelope_invalid",
          message: "invalid SIWA receipt",
        },
      },
    });
  }, 15_000);
});
