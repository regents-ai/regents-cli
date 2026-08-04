import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCliEntrypoint } from "../../src/index.js";
import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import { RegentRuntime } from "../../src/internal-runtime/runtime.js";
import type { TechtreeVerifyRunResult } from "../../src/internal-types/index.js";
import { captureOutput } from "../../../../test-support/test-helpers.js";

describe("techtree verify offline CLI e2e", () => {
  let runtime: RegentRuntime | undefined;
  let tempDir = "";
  const originalPath = process.env.PATH;

  afterEach(async () => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await runtime?.stop();
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("locks, resolves, runs matched pairs, and shows two receipts within two minutes", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-verify-cli-e2e-"));
    const configPath = path.join(tempDir, "regent.config.json");
    writeInitialConfig(configPath, {
      runtime: {
        socketPath: path.join(tempDir, "runtime", "regent.sock"),
        stateDir: path.join(tempDir, "state"),
        logLevel: "error",
      },
    });
    runtime = new RegentRuntime(configPath);
    await runtime.start();

    const started = performance.now();
    const runOutput = await captureOutput(() => runCliEntrypoint([
      "techtree", "verify", "run", "--builtin", "--fixture", "--json", "--config", configPath,
    ]));
    expect(runOutput.result).toBe(0);
    const run = JSON.parse(runOutput.stdout) as TechtreeVerifyRunResult;
    expect(run).toMatchObject({ status: "completed", summary: { comparison_result: "positive", task_count: 2 } });
    expect(run.receipts).toHaveLength(2);

    const statusOutput = await captureOutput(() => runCliEntrypoint([
      "techtree", "verify", "status", "--comparison-id", run.comparison_id, "--json", "--config", configPath,
    ]));
    expect(JSON.parse(statusOutput.stdout)).toEqual(run);

    for (const pointer of run.receipts) {
      const receiptOutput = await captureOutput(() => runCliEntrypoint([
        "techtree", "verify", "receipt", "show", "--digest", pointer.digest, "--json", "--config", configPath,
      ]));
      expect(JSON.parse(receiptOutput.stdout)).toMatchObject({
        digest: pointer.digest,
        verified: true,
        receipt: { capsules: { baseline: {}, candidate: {} }, runs: { baseline: {}, candidate: {} } },
      });
    }
    expect(performance.now() - started).toBeLessThanOrEqual(120_000);
  });

  it("prints actionable JSON envelopes for every Verify command failure boundary", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-verify-cli-errors-"));
    const configPath = path.join(tempDir, "regent.config.json");
    writeInitialConfig(configPath, {
      runtime: {
        socketPath: path.join(tempDir, "runtime", "regent.sock"),
        stateDir: path.join(tempDir, "state"),
        logLevel: "error",
      },
    });
    runtime = new RegentRuntime(configPath);
    await runtime.start();

    const missingConfig = await captureOutput(() => runCliEntrypoint([
      "techtree", "verify", "run", "--builtin", "--json", "--config", configPath,
    ]));
    expect(JSON.parse(missingConfig.stderr)).toMatchObject({
      error: { code: "missing_verify_executor_configuration", next_steps: [expect.stringContaining("--fixture")] },
    });

    const missingReceipt = await captureOutput(() => runCliEntrypoint([
      "techtree", "verify", "receipt", "show", "--digest", "a".repeat(64), "--json", "--config", configPath,
    ]));
    expect(JSON.parse(missingReceipt.stderr)).toMatchObject({
      error: { code: "verify_record_not_found", next_steps: [expect.stringContaining("verify run")] },
    });

    const malformedBin = path.join(tempDir, "malformed-bin");
    fs.mkdirSync(malformedBin);
    const malformedPython = path.join(malformedBin, "python3");
    fs.writeFileSync(malformedPython, "#!/bin/sh\nif [ \"$1\" = \"-c\" ]; then echo 3.12; else echo malformed; fi\n");
    fs.chmodSync(malformedPython, 0o755);
    process.env.PATH = malformedBin;
    const malformedResult = await captureOutput(() => runCliEntrypoint([
      "techtree", "verify", "status", "--comparison-id", "comparison-missing", "--json", "--config", configPath,
    ]));
    expect(JSON.parse(malformedResult.stderr)).toMatchObject({
      error: { code: "verify_runtime_invalid_json", next_steps: [expect.stringContaining("verify run")] },
    });

    const unavailableBin = path.join(tempDir, "unavailable-bin");
    fs.mkdirSync(unavailableBin);
    process.env.PATH = unavailableBin;
    const unavailableRuntime = await captureOutput(() => runCliEntrypoint([
      "techtree", "verify", "status", "--comparison-id", "comparison-missing", "--json", "--config", configPath,
    ]));
    expect(JSON.parse(unavailableRuntime.stderr)).toMatchObject({
      error: { code: "verify_runtime_unavailable", next_steps: [expect.stringContaining("verify run")] },
    });
  });
});
