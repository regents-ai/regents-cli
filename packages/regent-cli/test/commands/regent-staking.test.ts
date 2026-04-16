import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCliEntrypoint } from "../../src/index.js";
import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

describe("regent-staking CLI command group", () => {
  const expectedBaseUrl = "http://127.0.0.1:4010";
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn<typeof fetch>();
  let homeDir = "";
  let configPath = "";

  const writeAgentAuthState = () => {
    writeInitialConfig(configPath);
    const statePath = path.join(homeDir, "state", "runtime-state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          agent: {
            walletAddress: "0x1111111111111111111111111111111111111111",
            chainId: 11155111,
          },
          siwa: {
            walletAddress: "0x1111111111111111111111111111111111111111",
            chainId: 11155111,
            nonce: "staking-nonce",
            keyId: "0x1111111111111111111111111111111111111111",
            receipt: "staking-receipt",
            receiptExpiresAt: "2999-01-01T00:00:00.000Z",
            audience: "regent-cli",
          },
        },
        null,
        2,
      ),
    );
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-staking-home-"));
    configPath = path.join(homeDir, "regent.config.json");
    process.env = { ...originalEnv };
    process.env.REGENT_WALLET_PRIVATE_KEY =
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("shows the regent staking overview", async () => {
    writeAgentAuthState();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, chain_id: 8453, treasury_residual_usdc: "150" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint(["regent-staking", "show", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/v1/agent/regent/staking`);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("x-siwa-receipt")).toBe("staking-receipt");
    expect(parsePrintedJson<{ chain_id: number }>(output.stdout)).toMatchObject({ chain_id: 8453 });
  });

  it("shows a specific account", async () => {
    writeAgentAuthState();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, wallet_address: "0xabc", wallet_claimable_usdc: "12" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint(["regent-staking", "account", "0xabc", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/v1/agent/regent/staking/account/0xabc`);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("x-siwa-receipt")).toBe("staking-receipt");
    expect(parsePrintedJson<{ wallet_address: string }>(output.stdout)).toMatchObject({
      wallet_address: "0xabc",
    });
  });

  it("requires a session for direct stake calls", async () => {
    const output = await captureOutput(() =>
      runCliEntrypoint(["regent-staking", "stake", "--amount", "1.5", "--config", configPath]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain("Run `regent auth siwa login` before using this command.");
  });

  it("builds the direct stake request when shared sign-in is present", async () => {
    writeAgentAuthState();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, tx_request: { data: "0x7acb7757" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint(["regent-staking", "stake", "--amount", "1.5", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/v1/agent/regent/staking/stake`);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("x-siwa-receipt")).toBe("staking-receipt");
    expect(parsePrintedJson<{ tx_request: { data: string } }>(output.stdout)).toMatchObject({
      tx_request: { data: "0x7acb7757" },
    });
  });

  it("claims USDC through the shared sign-in flow", async () => {
    writeAgentAuthState();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, tx_request: { data: "0x42852610" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint(["regent-staking", "claim-usdc", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/v1/agent/regent/staking/claim-usdc`);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("x-siwa-receipt")).toBe("staking-receipt");
    expect(parsePrintedJson<{ tx_request: { data: string } }>(output.stdout)).toMatchObject({
      tx_request: { data: "0x42852610" },
    });
  });
});
