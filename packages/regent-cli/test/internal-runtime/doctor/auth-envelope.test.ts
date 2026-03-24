import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { authChecks } from "../../../src/internal-runtime/doctor/checks/authChecks.js";
import { runChecksSequentially } from "../../../src/internal-runtime/doctor/checkRunner.js";
import type { DoctorCheckContext } from "../../../src/internal-runtime/doctor/types.js";
import { SessionStore } from "../../../src/internal-runtime/store/session-store.js";
import { StateStore } from "../../../src/internal-runtime/store/state-store.js";

const TEST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TEST_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const TEST_REGISTRY = "0x2222222222222222222222222222222222222222" as const;

describe("auth envelope doctor check", () => {
  it("accepts a receipt-bound session keyId even when casing differs from the built x-key-id header", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-doctor-auth-envelope-"));
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
        keyId: TEST_WALLET,
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
      walletSecretSource: {
        getPrivateKeyHex: async () => TEST_PRIVATE_KEY,
      },
      techtree: null,
      fix: false,
      verbose: false,
      cleanupCommentBodyPrefix: "regent-doctor-comment",
      fullState: {},
      refreshConfig: () => undefined,
    };

    const [result] = await runChecksSequentially(
      authChecks().filter((check) => check.id === "auth.http-envelope.build"),
      ctx,
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: "auth.http-envelope.build",
        status: "ok",
        message: "Authenticated HTTP envelope builds locally",
      }),
    );
  });
});
