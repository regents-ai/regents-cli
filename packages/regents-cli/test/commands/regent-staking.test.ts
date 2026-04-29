import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCliEntrypoint } from "../../src/index.js";
import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import { writeFakeCdp } from "../support/fake-cdp.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const { sendTransactionMock, waitForReceiptMock, callMock, estimateGasMock } = vi.hoisted(() => ({
  sendTransactionMock: vi.fn(),
  waitForReceiptMock: vi.fn(),
  callMock: vi.fn(),
  estimateGasMock: vi.fn(),
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: () => ({
    address: "0x00000000000000000000000000000000000000aa",
    signMessage: async () => "0xsigned",
  }),
}));

vi.mock("viem/chains", () => ({
  base: { id: 8453, name: "Base" },
  baseSepolia: { id: 84532, name: "Base Sepolia" },
  mainnet: { id: 1, name: "Ethereum" },
}));

vi.mock("viem", () => ({
  http: (url: string) => ({ url }),
  isAddress: (value: string) => /^0x[0-9a-fA-F]{40}$/u.test(value),
  isHex: (value: string) => /^0x[0-9a-fA-F]*$/u.test(value),
  createWalletClient: () => ({
    sendTransaction: sendTransactionMock,
  }),
  createPublicClient: () => ({
    call: callMock,
    estimateGas: estimateGasMock,
    waitForTransactionReceipt: waitForReceiptMock,
  }),
}));

describe("regent-staking CLI command group", () => {
  const expectedBaseUrl = "http://127.0.0.1:4000";
  const testWallet = "0x1111111111111111111111111111111111111111";
  const submitWallet = "0x00000000000000000000000000000000000000aa";
  const testRegistry = "0x2222222222222222222222222222222222222222";
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn<typeof fetch>();
  let homeDir = "";
  let configPath = "";

  const walletAction = (data: string) => ({
    action_id: `staking_${data.slice(2)}`,
    resource: "regent_staking",
    action: "claim",
    chain_id: 84532,
    target: "0x3333333333333333333333333333333333333333",
    calldata: data,
    expected_signer: submitWallet,
    expires_at: "2999-01-01T00:00:00.000Z",
    idempotency_key: `idem_${data.slice(2)}`,
    risk_copy: "Claims available staking rewards.",
    tx_request: {
      chain_id: 84532,
      to: "0x3333333333333333333333333333333333333333",
      value: "0",
      data,
    },
  });

  const writeAgentAuthState = (baseUrl = expectedBaseUrl) => {
    writeInitialConfig(configPath);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      services: { siwa: { baseUrl: string } };
    };
    config.services.siwa.baseUrl = baseUrl;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const receiptPath = path.join(homeDir, ".regent", "identity", "receipt-v1.json");
    const statePath = path.join(homeDir, "state", "runtime-state.json");
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
          address: testWallet,
          agent_id: 99,
          agent_registry: testRegistry,
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
            walletAddress: testWallet,
            chainId: 84532,
            registryAddress: testRegistry,
            tokenId: "99",
          },
          siwa: {
            walletAddress: testWallet,
            chainId: 84532,
            nonce: "staking-nonce",
            keyId: testWallet.toLowerCase(),
            receipt: "staking-receipt",
            receiptExpiresAt: "2999-01-01T00:00:00.000Z",
            audience: "regent-services",
            registryAddress: testRegistry,
            tokenId: "99",
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
    process.env.HOME = homeDir;
    process.env.PATH = `${writeFakeCdp(homeDir, {
      accounts: [{ name: "main", address: testWallet }],
    })}:${originalEnv.PATH ?? ""}`;
    process.env.CDP_KEY_ID = "test-key";
    process.env.CDP_KEY_SECRET = "test-secret";
    process.env.CDP_WALLET_SECRET = "test-wallet-secret";
    process.env.REGENT_WALLET_PRIVATE_KEY =
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    process.env.AUTOLAUNCH_BASE_URL = "http://127.0.0.1:4010";
    process.env.BASE_SEPOLIA_RPC_URL = "https://base-sepolia.example";
    fetchMock.mockReset();
    sendTransactionMock.mockReset();
    waitForReceiptMock.mockReset();
    callMock.mockReset();
    estimateGasMock.mockReset();
    sendTransactionMock.mockResolvedValue("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    waitForReceiptMock.mockResolvedValue({ logs: [] });
    callMock.mockResolvedValue({ data: "0x" });
    estimateGasMock.mockResolvedValue(21_000n);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("shows the regent staking overview", async () => {
    writeAgentAuthState("https://staking.regents.sh/");
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://staking.regents.sh/v1/agent/regent/staking");
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
    expect(output.stderr).toContain("Run `regents auth login --audience regent-services` before using this command.");
  });

  it("builds the direct stake request when shared sign-in is present", async () => {
    writeAgentAuthState();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, staking: {}, prepared: walletAction("0x7acb7757") }), {
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
    expect(parsePrintedJson<{ prepared: { tx_request: { data: string } } }>(output.stdout)).toMatchObject({
      prepared: { tx_request: { data: "0x7acb7757" } },
    });
  });

  it("claims USDC through the shared sign-in flow", async () => {
    writeAgentAuthState();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, staking: {}, prepared: walletAction("0x42852610") }), {
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
    expect(parsePrintedJson<{ prepared: { tx_request: { data: string } } }>(output.stdout)).toMatchObject({
      prepared: { tx_request: { data: "0x42852610" } },
    });
  });

  it("simulates and estimates staking transactions before submit", async () => {
    writeAgentAuthState();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, staking: {}, prepared: walletAction("0x42852610") }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint(["regent-staking", "claim-usdc", "--submit", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(callMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0x3333333333333333333333333333333333333333",
        data: "0x42852610",
        value: 0n,
      }),
    );
    expect(estimateGasMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0x3333333333333333333333333333333333333333",
        data: "0x42852610",
        value: 0n,
      }),
    );
    expect(sendTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0x3333333333333333333333333333333333333333",
        data: "0x42852610",
        value: 0n,
      }),
    );
    expect(parsePrintedJson(output.stdout)).toMatchObject({
      ok: true,
      submitted: true,
      tx_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
  });

  it("does not submit staking transactions prepared for another wallet", async () => {
    writeAgentAuthState();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          staking: {},
          prepared: {
            ...walletAction("0x42852610"),
            expected_signer: testWallet,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint(["regent-staking", "claim-usdc", "--submit", "--config", configPath]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain("This prepared transaction is for a different wallet.");
    expect(callMock).not.toHaveBeenCalled();
    expect(estimateGasMock).not.toHaveBeenCalled();
    expect(sendTransactionMock).not.toHaveBeenCalled();
  });

  it("does not report staking submit success when the prepared transaction is missing", async () => {
    writeAgentAuthState();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, staking: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint(["regent-staking", "claim-usdc", "--submit", "--config", configPath]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain("This staking action did not include a transaction to submit.");
    expect(output.stdout.trim()).toBe("");
    expect(sendTransactionMock).not.toHaveBeenCalled();
  });
});
