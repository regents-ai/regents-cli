import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCliEntrypoint } from "../../src/index.js";
import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import { writeFakeCdp } from "../support/fake-cdp.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const TEST_WALLET = "0x1111111111111111111111111111111111111111";
const TEST_REGISTRY = "0x2222222222222222222222222222222222222222";
const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("reporting CLI commands", () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn<typeof fetch>();
  let tempDir = "";
  let configPath = "";

  const writeAgentAuthState = () => {
    writeInitialConfig(configPath);
    const receiptPath = path.join(tempDir, ".regent", "identity", "receipt-v1.json");
    const statePath = path.join(tempDir, "state", "runtime-state.json");
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      receiptPath,
      JSON.stringify(
        {
          version: 1,
          regent_base_url: "http://127.0.0.1:4000",
          network: "base-sepolia",
          provider: "coinbase-cdp",
          address: TEST_WALLET,
          agent_id: 99,
          agent_registry: TEST_REGISTRY,
          signer_type: "evm_personal_sign",
          verified: "onchain",
          receipt: "identity-receipt",
          receipt_issued_at: "2026-04-01T00:00:00.000Z",
          receipt_expires_at: "2999-01-01T00:00:00.000Z",
          cached_at: "2026-04-01T00:00:00.000Z",
          wallet_hint: "main",
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          agent: {
            walletAddress: TEST_WALLET,
            chainId: 84532,
            registryAddress: TEST_REGISTRY,
            tokenId: "99",
            label: "Hermes operator",
          },
          siwa: {
            walletAddress: TEST_WALLET,
            chainId: 84532,
            nonce: "report-login-nonce",
            keyId: TEST_WALLET.toLowerCase(),
            receipt: "report-receipt",
            receiptExpiresAt: "2999-01-01T00:00:00.000Z",
            audience: "techtree",
            registryAddress: TEST_REGISTRY,
            tokenId: "99",
          },
        },
        null,
        2,
      ),
    );
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-reports-"));
    configPath = path.join(tempDir, "regent.config.json");
    vi.stubGlobal("fetch", fetchMock);
    process.env = { ...originalEnv };
    process.env.HOME = tempDir;
    process.env.PATH = `${writeFakeCdp(tempDir, {
      accounts: [{ name: "main", address: TEST_WALLET }],
    })}:${originalEnv.PATH ?? ""}`;
    process.env.CDP_KEY_ID = "test-key";
    process.env.CDP_KEY_SECRET = "test-secret";
    process.env.CDP_WALLET_SECRET = "test-wallet-secret";
    delete process.env.PLATFORM_PHX_BASE_URL;
    process.env.REGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY;
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("submits a bug report with the saved local agent identity", async () => {
    writeAgentAuthState();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          message: "Your report was saved. Its status will appear at https://regents.sh/bug-report.",
          public_url: "https://regents.sh/bug-report",
          report: {
            report_id: "bug-1",
            summary: "can't do xyz",
            details: "any more details here",
            status: "pending",
            reporting_agent: {
              wallet_address: TEST_WALLET,
              chain_id: 84532,
              registry_address: TEST_REGISTRY,
              token_id: "99",
              label: "Coinbase wallet",
            },
            created_at: "2026-04-01T18:40:00Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "bug",
        "--summary",
        "can't do xyz",
        "--details",
        "any more details here",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4000/v1/agent/bug-report");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)["x-siwa-receipt"]).toBe(
      "report-receipt",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      summary: "can't do xyz",
      details: "any more details here",
      reporting_agent: {
        wallet_address: TEST_WALLET,
        chain_id: 84532,
        registry_address: TEST_REGISTRY,
        token_id: "99",
        label: "Coinbase wallet",
      },
    });
    expect(parsePrintedJson<{ public_url: string; report: { report_id: string } }>(output.stdout)).toMatchObject({
      public_url: "https://regents.sh/bug-report",
      report: { report_id: "bug-1" },
    });
  });

  it("submits a security report and honors the Platform Phoenix base URL override", async () => {
    writeAgentAuthState();
    process.env.PLATFORM_PHX_BASE_URL = "https://reports.regents.sh/";
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          message: "Your security report was saved. Keep the report id for private follow-up.",
          report: {
            report_id: "sec-1",
            summary: "private vuln",
            details: "steps and impact",
            contact: "@xyz on telegram",
            reporting_agent: {
              wallet_address: TEST_WALLET,
              chain_id: 84532,
              registry_address: TEST_REGISTRY,
              token_id: "99",
              label: "Coinbase wallet",
            },
            created_at: "2026-04-01T18:45:00Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "security-report",
        "--summary",
        "private vuln",
        "--details",
        "steps and impact",
        "--contact",
        "@xyz on telegram",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://reports.regents.sh/v1/agent/security-report");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)["x-siwa-receipt"]).toBe(
      "report-receipt",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      summary: "private vuln",
      details: "steps and impact",
      contact: "@xyz on telegram",
      reporting_agent: {
        wallet_address: TEST_WALLET,
        chain_id: 84532,
        registry_address: TEST_REGISTRY,
        token_id: "99",
        label: "Coinbase wallet",
      },
    });
    expect(parsePrintedJson<{ report: { report_id: string; contact: string } }>(output.stdout)).toMatchObject({
      report: { report_id: "sec-1", contact: "@xyz on telegram" },
    });
  });

  it("explains when the saved local agent identity is missing", async () => {
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "bug",
        "--summary",
        "can't do xyz",
        "--details",
        "any more details here",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain("Run `regents auth login` before using this command.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a helpful error when bug is missing summary text", async () => {
    writeAgentAuthState();
    const output = await captureOutput(() =>
      runCliEntrypoint(["bug", "--details", "any more details here", "--config", configPath]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain("Bug reports need a non-empty --summary");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a helpful error when bug is missing details text", async () => {
    writeAgentAuthState();
    const output = await captureOutput(() =>
      runCliEntrypoint(["bug", "--summary", "can't do xyz", "--config", configPath]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain("Bug reports need a non-empty --details");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only bug input before any network request", async () => {
    writeAgentAuthState();
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "bug",
        "--summary",
        "   ",
        "--details",
        "any more details here",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain("Bug reports need a non-empty --summary");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a helpful error when security-report is missing contact text", async () => {
    writeAgentAuthState();
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "security-report",
        "--summary",
        "private vuln",
        "--details",
        "steps and impact",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain("Security reports need a non-empty --contact");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a helpful error when security-report is missing summary text", async () => {
    writeAgentAuthState();
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "security-report",
        "--details",
        "steps and impact",
        "--contact",
        "@xyz on telegram",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain("Security reports need a non-empty --summary");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a helpful error when security-report is missing details text", async () => {
    writeAgentAuthState();
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "security-report",
        "--summary",
        "private vuln",
        "--contact",
        "@xyz on telegram",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain("Security reports need a non-empty --details");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only contact text for security-report", async () => {
    writeAgentAuthState();
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "security-report",
        "--summary",
        "private vuln",
        "--details",
        "steps and impact",
        "--contact",
        "   ",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain("Security reports need a non-empty --contact");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
