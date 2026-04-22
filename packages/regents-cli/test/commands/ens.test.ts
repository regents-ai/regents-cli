import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCliEntrypoint } from "../../src/index.js";
import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const { buildAgentAuthHeadersMock } = vi.hoisted(() => ({
  buildAgentAuthHeadersMock: vi.fn(),
}));

const { sendTransactionMock, waitForReceiptMock } = vi.hoisted(() => ({
  sendTransactionMock: vi.fn(),
  waitForReceiptMock: vi.fn(),
}));

vi.mock("../../src/commands/agent-auth.js", () => ({
  buildAgentAuthHeaders: buildAgentAuthHeadersMock,
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: () => ({
    address: "0x00000000000000000000000000000000000000aa",
    signMessage: async () => "0xsigned",
  }),
}));

vi.mock("viem/chains", () => ({
  mainnet: { id: 1, name: "Ethereum" },
  base: { id: 8453, name: "Base" },
  baseSepolia: { id: 84532, name: "Base Sepolia" },
}));

vi.mock("viem", () => ({
  http: (url: string) => ({ url }),
  isAddress: (value: string) => /^0x[0-9a-fA-F]{40}$/u.test(value),
  isHex: (value: string) => /^0x[0-9a-fA-F]*$/u.test(value),
  createWalletClient: () => ({
    sendTransaction: sendTransactionMock,
  }),
  createPublicClient: () => ({
    waitForTransactionReceipt: waitForReceiptMock,
  }),
}));

describe("ENS CLI command group", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const originalEnv = { ...process.env };
  let tempDir = "";
  let configPath = "";

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env = { ...originalEnv };
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regents-ens-cli-"));
    configPath = path.join(tempDir, "regent.config.json");

    writeInitialConfig(configPath, {
      auth: {
        baseUrl: "https://regent.example",
        audience: "platform",
        defaultChainId: 8453,
        requestTimeoutMs: 1_000,
      },
      techtree: {
        baseUrl: "https://regent.example",
        requestTimeoutMs: 1_000,
      },
      wallet: {
        privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
        keystorePath: path.join(tempDir, "keys", "agent-wallet.json"),
      },
    });

    process.env.REGENT_WALLET_PRIVATE_KEY =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.ETH_MAINNET_RPC_URL = "https://ethereum.example.invalid";

    fetchMock.mockReset();
    buildAgentAuthHeadersMock.mockReset();
    sendTransactionMock.mockReset();
    waitForReceiptMock.mockReset();

    buildAgentAuthHeadersMock.mockResolvedValue({
      "x-siwa-receipt": "receipt_123",
      "x-key-id": "0x00000000000000000000000000000000000000aa",
      "x-agent-wallet-address": "0x00000000000000000000000000000000000000aa",
      "x-agent-chain-id": "8453",
      signature: "sig1=:ZmFrZQ==:",
      "signature-input": "sig1=(\"@method\" \"@path\")",
    });

    sendTransactionMock.mockResolvedValue(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    waitForReceiptMock.mockResolvedValue({ status: "success" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("requests the prepared mainnet reverse-name transaction and submits it", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          prepared: {
            resource: "tempo.regent.eth",
            action: "set_primary_name",
            chain_id: 1,
            ens_name: "tempo.regent.eth",
            caller_wallet_address: "0x00000000000000000000000000000000000000aa",
            tx_request: {
              chain_id: 1,
              to: "0xa58e81fe9b61b5c3fe2afd33cf304c454abfc7cb",
              value: "0",
              data: "0x1234",
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const output = await captureOutput(async () =>
      runCliEntrypoint([
        "ens",
        "set-primary",
        "--ens",
        "tempo.regent.eth",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(0);
    expect(buildAgentAuthHeadersMock).toHaveBeenCalledWith({
      method: "POST",
      path: "/api/agent-platform/ens/prepare-primary",
      configPath,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://regent.example/api/agent-platform/ens/prepare-primary",
      expect.objectContaining({
        method: "POST",
      }),
    );

    const [, requestInit] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(requestInit?.body))).toEqual({ ens_name: "tempo.regent.eth" });

    expect(sendTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0xa58e81fe9b61b5c3fe2afd33cf304c454abfc7cb",
        data: "0x1234",
        value: 0n,
      }),
    );
    expect(waitForReceiptMock).toHaveBeenCalledWith({
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(parsePrintedJson(output.stdout)).toMatchObject({
      ok: true,
      submitted: true,
      tx_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });
});
