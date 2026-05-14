import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RegentX402Client } from "../../src/internal-runtime/x402/client.js";
import type { WalletSecretSource } from "../../src/internal-runtime/agent/key-store.js";

const PRIVATE_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913";
const PAY_TO = "0x1111111111111111111111111111111111111111";

const encodeHeader = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64");

const createWalletSource = (): WalletSecretSource => ({
  getPrivateKeyHex: async () => PRIVATE_KEY,
});

const createExactRequirement = (amount: string) => ({
  scheme: "exact",
  network: "eip155:8453",
  asset: USDC_BASE,
  amount,
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
  extra: {
    name: "USDC",
    version: "2",
  },
});

const createBatchRequirement = (amount: string) => ({
  scheme: "batch-settlement",
  network: "eip155:8453",
  asset: USDC_BASE,
  amount,
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
  extra: {
    receiverAuthorizer: PAY_TO,
    withdrawDelay: 86400,
    name: "USDC",
    version: "2",
  },
});

const createPaymentRequired = (
  url: string,
  amount: string,
  accepts = [createExactRequirement(amount)],
) => ({
  x402Version: 2,
  resource: {
    url,
    description: "Paid Regent test resource",
    mimeType: "application/json",
  },
  accepts,
});

describe("Regent x402 wrapper", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-x402-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const startPaidServer = async () => {
    let amount = "1000";
    let resourceUrl = "";
    let paymentAttempts = 0;

    const server = http.createServer((request, response) => {
      if (request.url !== "/paid") {
        response.writeHead(404);
        response.end();
        return;
      }

      const paymentSignature = request.headers["payment-signature"];
      if (!paymentSignature) {
        response.writeHead(402, {
          "payment-required": encodeHeader(createPaymentRequired(resourceUrl, amount)),
        });
        response.end();
        return;
      }

      paymentAttempts += 1;
      response.writeHead(200, {
        "content-type": "application/json",
        "payment-response": encodeHeader({
          success: true,
          transaction: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          network: "eip155:8453",
        }),
      });
      response.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not bind to a TCP port");
    }

    resourceUrl = `http://127.0.0.1:${address.port}/paid`;

    return {
      url: resourceUrl,
      setAmount: (next: string) => {
        amount = next;
      },
      paymentAttempts: () => paymentAttempts,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  };

  it("quotes, prepares, pays only after approval, and stores a receipt", async () => {
    const paidServer = await startPaidServer();
    const client = new RegentX402Client({
      stateDir: tempDir,
      walletSecretSource: createWalletSource(),
    });

    try {
      const quote = await client.quote({ url: paidServer.url, max_amount: "1000" });
      expect(quote.selected.amount).toBe("1000");
      expect(paidServer.paymentAttempts()).toBe(0);

      const prepared = await client.prepare({ url: paidServer.url, approve: true });
      expect(prepared.intent.approval_status).toBe("approved");

      const fetched = await client.fetchApproved({
        intent_id: prepared.intent.intent_id,
        url: paidServer.url,
      });

      expect(fetched.ok).toBe(true);
      expect(fetched.body_text).toBe(JSON.stringify({ ok: true }));
      expect(fetched.receipt?.settlement).toEqual(
        expect.objectContaining({
          success: true,
          network: "eip155:8453",
        }),
      );
      expect(paidServer.paymentAttempts()).toBe(1);

      const receipt = client.receiptGet({ id: fetched.receipt?.receipt_id ?? "" });
      expect(receipt.receipt?.intent_id).toBe(prepared.intent.intent_id);
    } finally {
      await paidServer.close();
    }
  });

  it("selects batch settlement only when an operator deposit cap is present", async () => {
    const url = "https://example.test/paid";
    const client = new RegentX402Client({
      stateDir: tempDir,
      walletSecretSource: createWalletSource(),
      fetch: async () =>
        new Response("{}", {
          status: 402,
          headers: {
            "payment-required": encodeHeader(
              createPaymentRequired(url, "1000", [
                createExactRequirement("1000"),
                createBatchRequirement("1000"),
              ]),
            ),
          },
        }),
    });

    await expect(client.quote({ url, max_amount: "1000" })).rejects.toMatchObject({
      code: "x402_deposit_limit_required",
    });

    const quote = await client.quote({
      url,
      max_amount: "1000",
      max_deposit_amount: "5000",
    });
    expect(quote.selected.scheme).toBe("batch-settlement");

    const prepared = await client.prepare({
      url,
      approve: true,
      max_deposit_amount: "5000",
    });
    expect(prepared.intent.selected.scheme).toBe("batch-settlement");
    expect(prepared.intent.max_deposit_amount).toBe("5000");
  });

  it("requires an explicit RPC URL before a batch-settlement payment", async () => {
    const originalRpcEnv = {
      X402_BASE_MAINNET_RPC_URL: process.env.X402_BASE_MAINNET_RPC_URL,
      BASE_MAINNET_RPC_URL: process.env.BASE_MAINNET_RPC_URL,
      BASE_RPC_URL: process.env.BASE_RPC_URL,
    };
    delete process.env.X402_BASE_MAINNET_RPC_URL;
    delete process.env.BASE_MAINNET_RPC_URL;
    delete process.env.BASE_RPC_URL;

    const url = "https://example.test/paid";
    const client = new RegentX402Client({
      stateDir: tempDir,
      walletSecretSource: createWalletSource(),
      fetch: async () =>
        new Response("{}", {
          status: 402,
          headers: {
            "payment-required": encodeHeader(createPaymentRequired(url, "1000", [createBatchRequirement("1000")])),
          },
        }),
    });

    try {
      const prepared = await client.prepare({
        url,
        approve: true,
        max_deposit_amount: "5000",
      });

      await expect(
        client.fetchApproved({
          intent_id: prepared.intent.intent_id,
          url,
        }),
      ).rejects.toMatchObject({
        code: "x402_rpc_url_required",
      });
    } finally {
      for (const [key, value] of Object.entries(originalRpcEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("does not pay when the prepared intent has not been approved", async () => {
    const paidServer = await startPaidServer();
    const client = new RegentX402Client({
      stateDir: tempDir,
      walletSecretSource: createWalletSource(),
    });

    try {
      const prepared = await client.prepare({ url: paidServer.url });

      await expect(
        client.fetchApproved({
          intent_id: prepared.intent.intent_id,
          url: paidServer.url,
        }),
      ).rejects.toMatchObject({
        code: "x402_intent_not_approved",
      });
      expect(paidServer.paymentAttempts()).toBe(0);
    } finally {
      await paidServer.close();
    }
  });

  it("refuses to pay if the payment terms changed after approval", async () => {
    const paidServer = await startPaidServer();
    const client = new RegentX402Client({
      stateDir: tempDir,
      walletSecretSource: createWalletSource(),
    });

    try {
      const prepared = await client.prepare({ url: paidServer.url, approve: true });
      paidServer.setAmount("2000");

      await expect(
        client.fetchApproved({
          intent_id: prepared.intent.intent_id,
          url: paidServer.url,
        }),
      ).rejects.toMatchObject({
        code: "x402_payment_requirements_changed",
      });
      expect(paidServer.paymentAttempts()).toBe(0);
    } finally {
      await paidServer.close();
    }
  });
});
