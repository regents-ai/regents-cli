import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runScopedDoctor, writeInitialConfig } from "../../../src/internal-runtime/index.js";

describe("runtime-scoped doctor", () => {
  it("applies safe local fixes for missing runtime dirs and stale socket files", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-doctor-runtime-"));
    const configPath = path.join(tempDir, "regent.config.json");
    const socketPath = path.join(tempDir, "runtime", "regent.sock");
    const stateDir = path.join(tempDir, "state");
    const keystorePath = path.join(tempDir, "keys", "agent-wallet.json");
    const gossipsubDir = path.join(tempDir, "p2p");

    writeInitialConfig(configPath, {
      runtime: {
        socketPath,
        stateDir,
        logLevel: "info",
      },
      wallet: {
        privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
        keystorePath,
      },
    });

    fs.mkdirSync(path.dirname(socketPath), { recursive: true });
    fs.writeFileSync(socketPath, "stale socket", "utf8");
    fs.mkdirSync(path.dirname(keystorePath), { recursive: true });
    fs.writeFileSync(
      keystorePath,
      `${JSON.stringify({
        privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      })}\n`,
      "utf8",
    );

    const report = await runScopedDoctor(
      {
        scope: "runtime",
        fix: true,
      },
      {
        configPath,
      },
    );

    expect(report.mode).toBe("scoped");
    expect(report.scope).toBe("runtime");
    expect(report.summary.fail).toBe(0);
    expect(fs.existsSync(stateDir)).toBe(true);
    expect(fs.existsSync(socketPath)).toBe(false);
    expect(fs.existsSync(gossipsubDir)).toBe(true);

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "runtime.paths.ensure",
          status: "ok",
        }),
        expect.objectContaining({
          id: "runtime.socket.reachable",
          status: "warn",
          fixApplied: true,
        }),
      ]),
    );
  });
});
