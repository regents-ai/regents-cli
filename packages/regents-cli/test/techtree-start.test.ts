import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeInitialConfig } from "../src/internal-runtime/index.js";
import { parseCliArgs } from "../src/parse.js";
import { runTechtreeStart, startWizardDeps } from "../src/commands/techtree-start.js";
import { captureOutput } from "../../../test-support/test-helpers.js";

const TEST_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const readyDoctorReport = (scope: "runtime" | "techtree") => ({
  ok: true,
  mode: "scoped" as const,
  scope,
  summary: { ok: 2, warn: 0, fail: 0, skip: 0 },
  checks: [],
  nextSteps: [],
  generatedAt: "2026-03-23T00:00:00.000Z",
});

const walletFailDoctorReport = {
  ok: false,
  mode: "scoped" as const,
  scope: "runtime" as const,
  summary: { ok: 1, warn: 0, fail: 1, skip: 0 },
  checks: [
    {
      id: "runtime.wallet.source",
      scope: "runtime" as const,
      status: "fail" as const,
      title: "wallet available",
      message: "Wallet secret source could not be loaded",
      remediation: "Set REGENT_WALLET_PRIVATE_KEY",
      startedAt: "2026-03-23T00:00:00.000Z",
      finishedAt: "2026-03-23T00:00:00.100Z",
      durationMs: 100,
    },
  ],
  nextSteps: ["Set REGENT_WALLET_PRIVATE_KEY"],
  generatedAt: "2026-03-23T00:00:00.000Z",
};

describe("techtree start wizard", () => {
  let configPath: string;
  const originalDeps = { ...startWizardDeps };

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-start-"));
    configPath = path.join(tempDir, "regent.config.json");

    writeInitialConfig(configPath, {
      runtime: {
        socketPath: path.join(tempDir, "runtime", "regent.sock"),
        stateDir: path.join(tempDir, "state"),
        logLevel: "info",
      },
      auth: {
        audience: "techtree",
        defaultChainId: 84532,
      },
      services: {
        techtree: {
          baseUrl: "http://127.0.0.1:4001",
          requestTimeoutMs: 1_000,
        },
      },
      wallet: {
        privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
        keystorePath: path.join(tempDir, "keys", "agent-wallet.json"),
      },
    });

    startWizardDeps.callJsonRpc = vi.fn().mockRejectedValue(new Error("socket missing"));
    startWizardDeps.runScopedDoctor = vi.fn(async ({ scope }) => {
      if (scope === "runtime") {
        return readyDoctorReport("runtime");
      }
      return readyDoctorReport("techtree");
    });
    startWizardDeps.listIdentities = vi.fn().mockResolvedValue({
      ok: true,
      chain_id: 84532,
      owner_address: "0xabc",
      registry_address: TEST_REGISTRY,
      launchable: [],
      owned: [],
      operated: [],
      wallet_bound: [],
    });
    startWizardDeps.mintIdentity = vi.fn().mockResolvedValue({
      ok: true,
      chain_id: 84532,
      owner_address: "0xabc",
      registry_address: TEST_REGISTRY,
      tx_hash: "0xfeed",
      block_number: "12",
      agent_id: "84532:2236",
      agent_uri: null,
    });
    startWizardDeps.authStatus = vi.fn().mockResolvedValue({
      authenticated: false,
      session: null,
      agentIdentity: null,
      protectedRoutesReady: false,
      missingIdentityFields: ["walletAddress", "chainId", "registryAddress", "tokenId"],
    });
    startWizardDeps.authLogin = vi.fn().mockResolvedValue({ ok: true });
    startWizardDeps.bbhProbe = vi.fn().mockResolvedValue({ ok: true });
    startWizardDeps.spawnDetachedRuntime = vi.fn().mockResolvedValue(undefined);
    startWizardDeps.wait = vi.fn().mockResolvedValue(undefined);
    startWizardDeps.isHumanTerminal = vi.fn().mockReturnValue(false);
    startWizardDeps.promptConfirm = vi.fn().mockResolvedValue(true);
    startWizardDeps.promptChoice = vi.fn().mockResolvedValue(0);
    startWizardDeps.renderDoctorReport = vi.fn().mockReturnValue("doctor surface");
  });

  afterEach(() => {
    Object.assign(startWizardDeps, originalDeps);
    delete process.env.BASE_SEPOLIA_RPC_URL;
  });

  it("stops clearly when the wallet is missing", async () => {
    startWizardDeps.runScopedDoctor = vi.fn().mockResolvedValue(walletFailDoctorReport);

    const output = await captureOutput(() =>
      runTechtreeStart(parseCliArgs(["techtree", "start"]), configPath),
    );

    expect(output.result).toEqual(
      expect.objectContaining({
        ready: false,
        selectedIdentity: null,
      }),
    );
    expect(output.stdout).toContain("START BLOCKED");
    expect(output.stdout).toContain("Wallet secret source could not be loaded");
    expect(output.stdout).toContain("doctor surface");
  });

  it("stops and asks for Base Sepolia RPC before minting a missing identity", async () => {
    startWizardDeps.callJsonRpc = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket missing"))
      .mockResolvedValueOnce({ ok: true });

    const output = await captureOutput(() =>
      runTechtreeStart(parseCliArgs(["techtree", "start"]), configPath),
    );

    expect(output.result).toEqual(
      expect.objectContaining({
        ready: false,
        selectedIdentity: null,
      }),
    );
    expect(output.stdout).toContain("No Techtree agent identity was found");
    expect(output.stdout).toContain("BASE_SEPOLIA_RPC_URL");
    expect(startWizardDeps.mintIdentity).not.toHaveBeenCalled();
  });

  it("mints, logs in, and prints the BBH next step when the path is ready", async () => {
    process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.sepolia.example";
    startWizardDeps.callJsonRpc = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket missing"))
      .mockResolvedValueOnce({ ok: true });

    const output = await captureOutput(() =>
      runTechtreeStart(parseCliArgs(["techtree", "start", "--mint"]), configPath),
    );

    expect(output.result).toEqual(
      expect.objectContaining({
        ready: true,
        daemonStarted: true,
        selectedIdentity: {
          registryAddress: TEST_REGISTRY,
          tokenId: "2236",
        },
      }),
    );
    expect(output.stdout).toContain("IDENTITY MINTED");
    expect(output.stdout).toContain("GUIDED START COMPLETE");
    expect(output.stdout).toContain("regents techtree bbh run exec");
    expect(output.stdout).toContain("NEXT STEPS");
    expect(output.stdout).toContain("regents chatbox tail");
    expect(startWizardDeps.authLogin).toHaveBeenCalledWith(
      {
        registryAddress: TEST_REGISTRY,
        tokenId: "2236",
      },
      configPath,
    );
  });

  it("reuses an already authenticated identity without logging in again", async () => {
    startWizardDeps.callJsonRpc = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket missing"))
      .mockResolvedValueOnce({ ok: true });
    startWizardDeps.listIdentities = vi.fn().mockResolvedValue({
      ok: true,
      chain_id: 84532,
      owner_address: "0xabc",
      registry_address: TEST_REGISTRY,
      launchable: [
        {
          agent_id: "84532:2236",
          chain_id: 84532,
          token_id: "2236",
          owner_address: "0xabc",
          operator_addresses: [],
          agent_wallet: null,
          access_mode: "owner",
          name: "Test Agent",
          description: null,
          image_url: null,
          ens: null,
          web_endpoint: null,
          active: true,
          registry_address: TEST_REGISTRY,
        },
      ],
      owned: [],
      operated: [],
      wallet_bound: [],
    });
    startWizardDeps.authStatus = vi.fn().mockResolvedValue({
      authenticated: true,
      session: { walletAddress: "0xabc", chainId: 84532, nonce: "1", keyId: "k", receipt: "r", receiptExpiresAt: "2099-01-01T00:00:00.000Z", audience: "techtree" },
      agentIdentity: {
        walletAddress: "0xabc",
        chainId: 84532,
        registryAddress: TEST_REGISTRY,
        tokenId: "2236",
      },
      protectedRoutesReady: true,
      missingIdentityFields: [],
    });

    const output = await captureOutput(() =>
      runTechtreeStart(parseCliArgs(["techtree", "start"]), configPath),
    );

    expect(output.result).toEqual(expect.objectContaining({ ready: true }));
    expect(startWizardDeps.authLogin).not.toHaveBeenCalled();
    expect(output.stdout).toContain("IDENTITY READY");
    expect(output.stdout).toContain("GUIDED START COMPLETE");
  });
});
