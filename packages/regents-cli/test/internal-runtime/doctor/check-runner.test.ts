import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig, writeInitialConfig } from "../../../src/internal-runtime/config.js";
import { runChecksSequentially, runDoctorInvocation } from "../../../src/internal-runtime/doctor/checkRunner.js";
import { TechtreeApiError } from "../../../src/internal-runtime/errors.js";
import { SessionStore } from "../../../src/internal-runtime/store/session-store.js";
import { StateStore } from "../../../src/internal-runtime/store/state-store.js";
import type { DoctorCheckContext, DoctorCheckDefinition } from "../../../src/internal-runtime/doctor/types.js";
import type { RuntimeContext } from "../../../src/internal-runtime/runtime.js";

const TEST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TEST_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const TEST_REGISTRY = "0x2222222222222222222222222222222222222222";

describe("doctor check runner", () => {
  it("normalizes thrown check errors into internal doctor failures", async () => {
    const check: DoctorCheckDefinition = {
      id: "runtime.crash.example",
      scope: "runtime",
      title: "crashing check",
      run: async () => {
        throw new Error("doctor check exploded");
      },
    };

    const ctx: DoctorCheckContext = {
      mode: "default",
      configPath: "/tmp/regent-doctor-config.json",
      runtimeContext: null,
      config: null,
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
    };

    const [result] = await runChecksSequentially([check], ctx);

    expect(result).toEqual(
      expect.objectContaining({
        id: "runtime.crash.example",
        scope: "runtime",
        status: "fail",
        message: "Doctor check crashed before it could return a result",
        details: expect.objectContaining({
          internal: true,
          code: "doctor_check_crashed",
          error: "doctor check exploded",
        }),
      }),
    );
  });

  it("gates full mode behind default check preconditions and skips full proof writes when blocked", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-doctor-full-preconditions-"));
    const configPath = path.join(tempDir, "regent.config.json");
    const statePath = path.join(tempDir, "state", "runtime-state.json");

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
        techtree: {
          baseUrl: "http://127.0.0.1:4999",
          requestTimeoutMs: 250,
        },
      },
      wallet: {
        privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
        keystorePath: path.join(tempDir, "keys", "agent-wallet.json"),
      },
    });

    const stateStore = new StateStore(statePath);
    stateStore.write({
      agent: {
        walletAddress: TEST_WALLET,
        chainId: 84532,
        registryAddress: TEST_REGISTRY,
        tokenId: "99",
      },
    });
    const sessionStore = new SessionStore(stateStore);
    const config = loadConfig(configPath);

    const runtimeContext = {
      runtime: {
        configPath,
      },
      config,
      stateStore,
      sessionStore,
      walletSecretSource: {
        getPrivateKeyHex: async () => TEST_PRIVATE_KEY,
      },
      techtree: {
        health: async () => ({ ok: true }),
        listNodes: async () => ({ data: [] }),
        siwaNonce: async () => ({
          code: "siwa_nonce_ok",
          data: {
            walletAddress: TEST_WALLET,
            chainId: 84532,
            nonce: "doctor-nonce",
            issuedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2999-01-01T00:00:00.000Z",
          },
        }),
        siwaVerify: async () => {
          throw new TechtreeApiError("invalid test probe", {
            code: "receipt_invalid",
            status: 401,
            payload: {
              error: {
                code: "receipt_invalid",
                message: "invalid test probe",
              },
            },
          });
        },
      },
    } as unknown as RuntimeContext;

    const report = await runDoctorInvocation({
      mode: "full",
      params: {
        knownParentId: 1,
      },
      runtimeContext,
    });

    expect(report.mode).toBe("full");
    expect(report.checks.some((check) => check.id === "full.node.create")).toBe(false);
    expect(report.checks.some((check) => check.id === "full.comment.add")).toBe(false);
    expect(report.checks.some((check) => check.id === "full.comment.readback")).toBe(false);

    const preconditions = report.checks.find((check) => check.id === "full.preconditions");
    expect(preconditions).toEqual(
      expect.objectContaining({
        status: "fail",
        details: expect.objectContaining({
          blockingChecks: expect.arrayContaining([
            expect.objectContaining({
              id: "auth.session.present",
              status: "warn",
            }),
          ]),
        }),
      }),
    );
  });
});
