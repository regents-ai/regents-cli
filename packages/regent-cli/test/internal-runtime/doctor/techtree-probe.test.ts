import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TechtreeApiError } from "../../../src/internal-runtime/errors.js";
import { techtreeChecks } from "../../../src/internal-runtime/doctor/checks/techtreeChecks.js";
import { runChecksSequentially } from "../../../src/internal-runtime/doctor/checkRunner.js";
import type { DoctorCheckContext } from "../../../src/internal-runtime/doctor/types.js";
import { SessionStore } from "../../../src/internal-runtime/store/session-store.js";
import { StateStore } from "../../../src/internal-runtime/store/state-store.js";

const TEST_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const TEST_REGISTRY = "0x2222222222222222222222222222222222222222" as const;

describe("techtree authenticated probe", () => {
  it("normalizes backend and sidecar denial details", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-doctor-probe-"));
    const stateStore = new StateStore(path.join(tempDir, "runtime-state.json"));
    stateStore.write({
      agent: {
        walletAddress: TEST_WALLET,
        chainId: 11155111,
        registryAddress: TEST_REGISTRY,
        tokenId: "99",
      },
      siwa: {
        walletAddress: TEST_WALLET,
        chainId: 11155111,
        nonce: "doctor-nonce",
        keyId: TEST_WALLET.toLowerCase(),
        receipt: "doctor-receipt",
        receiptExpiresAt: "2999-01-01T00:00:00.000Z",
        audience: "techtree",
        registryAddress: TEST_REGISTRY,
        tokenId: "99",
      },
    });

    const ctx: DoctorCheckContext = {
      mode: "scoped",
      configPath: path.join(tempDir, "regent.config.json"),
      runtimeContext: null,
      config: null,
      configLoadError: null,
      stateStore,
      sessionStore: new SessionStore(stateStore),
      walletSecretSource: null,
      techtree: {
        getOpportunities: async () => {
          throw new TechtreeApiError("sidecar denied envelope", {
            code: "auth_denied",
            status: 401,
            payload: {
              error: {
                code: "auth_denied",
                message: "sidecar denied envelope",
                details: {
                  sidecar: {
                    code: "receipt_binding_mismatch",
                    message: "x-key-id does not match SIWA receipt",
                  },
                },
              },
            },
          });
        },
      } as DoctorCheckContext["techtree"],
      fix: false,
      verbose: false,
      cleanupCommentBodyPrefix: "regent-doctor-comment",
      fullState: {},
      refreshConfig: () => undefined,
    };

    const [result] = await runChecksSequentially(
      techtreeChecks().filter((check) => check.id === "techtree.authenticated.probe"),
      ctx,
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: "techtree.authenticated.probe",
        status: "fail",
        details: expect.objectContaining({
          route: "/v1/agent/opportunities",
          code: "auth_denied",
          status: 401,
          backend: expect.objectContaining({
            code: "auth_denied",
            message: "sidecar denied envelope",
          }),
          sidecar: expect.objectContaining({
            code: "receipt_binding_mismatch",
          }),
        }),
      }),
    );
  });
});
