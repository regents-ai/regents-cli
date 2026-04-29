import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig, writeInitialConfig } from "../../src/internal-runtime/config.js";
import { SessionStore } from "../../src/internal-runtime/store/session-store.js";
import { StateStore } from "../../src/internal-runtime/store/state-store.js";
import { TechtreeClient } from "../../src/internal-runtime/techtree/client.js";
import { writeFakeCdp } from "../support/fake-cdp.js";
import {
  handleTechtreeNodeCrossChainLinksClear,
  handleTechtreeNodeLineageWithdraw,
} from "../../src/internal-runtime/handlers/techtree.js";
import type { RuntimeContext } from "../../src/internal-runtime/runtime.js";

const TEST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TEST_WALLET = "0x1111111111111111111111111111111111111111";
const TEST_REGISTRY = "0x2222222222222222222222222222222222222222";

class StaticWalletSecretSource {
  async getPrivateKeyHex(): Promise<`0x${string}`> {
    return TEST_PRIVATE_KEY;
  }
}

const createClient = (baseUrl: string): { client: TechtreeClient; stateStore: StateStore; sessionStore: SessionStore } => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-lineage-"));
  const configPath = path.join(tempDir, "regent.config.json");
  writeInitialConfig(configPath, {
    runtime: {
      socketPath: path.join(tempDir, "runtime", "regent.sock"),
      stateDir: path.join(tempDir, "state"),
      logLevel: "debug",
    },
    auth: {
      audience: "techtree",
      defaultChainId: 84532,
    },
    services: {
      siwa: { baseUrl, requestTimeoutMs: 1_000 },
      platform: { baseUrl, requestTimeoutMs: 1_000 },
      autolaunch: { baseUrl: "http://127.0.0.1:4010", requestTimeoutMs: 1_000 },
      techtree: { baseUrl, requestTimeoutMs: 1_000 },
    },
    wallet: {
      privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
      keystorePath: path.join(tempDir, "keys", "agent-wallet.json"),
    },
  });
  const config = loadConfig(configPath);
  const stateStore = new StateStore(path.join(tempDir, "runtime-state.json"));
  const sessionStore = new SessionStore(stateStore);
  const client = new TechtreeClient({
    config,
    baseUrl,
    requestTimeoutMs: 1_000,
    sessionStore,
    walletSecretSource: new StaticWalletSecretSource(),
    stateStore,
  });

  sessionStore.setSiwaSession({
    walletAddress: TEST_WALLET,
    chainId: 84532,
    nonce: "nonce-test",
    keyId: "key-test",
    receipt: "receipt-test",
    receiptExpiresAt: "2026-04-30T00:00:00.000Z",
    audience: "techtree",
    registryAddress: TEST_REGISTRY,
    tokenId: "99",
  });
  stateStore.patch({
    agent: {
      walletAddress: TEST_WALLET,
      chainId: 84532,
      registryAddress: TEST_REGISTRY,
      tokenId: "99",
    },
  });

  return { client, stateStore, sessionStore };
};

describe("techtree lineage and cross-chain link wiring", () => {
  const fetchMock = vi.fn<typeof fetch>();
  let originalPath: string | undefined;
  let originalKeyId: string | undefined;
  let originalKeySecret: string | undefined;
  let originalWalletSecret: string | undefined;
  let tempHome = "";

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    originalPath = process.env.PATH;
    originalKeyId = process.env.CDP_KEY_ID;
    originalKeySecret = process.env.CDP_KEY_SECRET;
    originalWalletSecret = process.env.CDP_WALLET_SECRET;
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "regent-lineage-home-"));
    process.env.PATH = `${writeFakeCdp(tempHome, {
      accounts: [{ name: "main", address: TEST_WALLET }],
    })}:${originalPath ?? ""}`;
    process.env.CDP_KEY_ID = "test-key";
    process.env.CDP_KEY_SECRET = "test-secret";
    process.env.CDP_WALLET_SECRET = "test-wallet-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.PATH = originalPath;
    process.env.CDP_KEY_ID = originalKeyId;
    process.env.CDP_KEY_SECRET = originalKeySecret;
    process.env.CDP_WALLET_SECRET = originalWalletSecret;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("targets the expected lineage and cross-chain routes", async () => {
    const { client } = createClient("http://127.0.0.1:4001");

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const method = String(init?.method ?? "GET");

      if (url.endsWith("/v1/agent/tree/nodes/42/lineage") && method === "GET") {
        return new Response(JSON.stringify({ data: { status: "author_claimed", claims: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.endsWith("/v1/tree/nodes/42/lineage/claims") && method === "POST") {
        return new Response(JSON.stringify({ data: { claim_id: "claim_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.endsWith("/v1/tree/nodes/42/lineage/claims/claim_1") && method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.endsWith("/v1/agent/tree/nodes/42/cross-chain-links") && method === "GET") {
        return new Response(JSON.stringify({ data: [{ link_id: "link_1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.endsWith("/v1/tree/nodes/42/cross-chain-links") && method === "POST") {
        return new Response(JSON.stringify({ data: { link_id: "link_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.endsWith("/v1/tree/nodes/42/cross-chain-links/current") && method === "DELETE") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.endsWith("/v1/tree/nodes") && method === "POST") {
        return new Response(JSON.stringify({ data: { node_id: 7, manifest_cid: "bafy", status: "pinned", anchor_status: "pending" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`unexpected request: ${method} ${url}`);
    });

    await expect(client.listNodeLineageClaims(42)).resolves.toEqual({
      data: { status: "author_claimed", claims: [] },
    });
    await expect(
      client.claimNodeLineage(42, {
        relation: "copy_of",
        target_chain_id: 1,
        target_node_ref: "eth:source-node",
        note: "descends from base",
      }),
    ).resolves.toEqual({
      data: { claim_id: "claim_1" },
    });
    await expect(client.withdrawNodeLineageClaim(42, "claim_1")).resolves.toEqual({
      ok: true,
    });

    await expect(client.listNodeCrossChainLinks(42)).resolves.toEqual({
      data: [{ link_id: "link_1" }],
    });
    await expect(
      client.createNodeCrossChainLink(42, {
        relation: "reproduces",
        target_chain_id: 1,
        target_node_ref: "eth:source-node",
      }),
    ).resolves.toEqual({ data: { link_id: "link_1" } });
    await expect(client.clearNodeCrossChainLinks(42)).resolves.toEqual({ ok: true });

    await expect(
      client.createNode({
        seed: "ml",
        kind: "hypothesis",
        title: "Cross-chain node",
        notebook_source: "print('hello')",
        cross_chain_link: {
          relation: "reproduces",
          target_chain_id: 8453,
          target_node_ref: "base:experiment-node",
        },
      }),
    ).resolves.toEqual({
      data: {
        node_id: 7,
        manifest_cid: "bafy",
        status: "pinned",
        anchor_status: "pending",
      },
    });

    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/v1/agent/tree/nodes/42/lineage") && String(init?.method ?? "GET") === "GET")).toBe(true);
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/v1/tree/nodes/42/lineage/claims/claim_1") && String(init?.method ?? "GET") === "DELETE")).toBe(true);
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/v1/tree/nodes/42/cross-chain-links/current") && String(init?.method ?? "GET") === "DELETE")).toBe(true);

    const createCall = fetchMock.mock.calls.find(([input, init]) =>
      String(input).endsWith("/v1/tree/nodes") && String(init?.method ?? "GET") === "POST",
    );
    expect(createCall).toBeTruthy();
    const body = JSON.parse(String((createCall?.[1] as RequestInit | undefined)?.body ?? "{}")) as Record<string, unknown>;
    expect(body).toMatchObject({
      seed: "ml",
      kind: "hypothesis",
      title: "Cross-chain node",
      cross_chain_link: {
        relation: "reproduces",
        target_chain_id: 8453,
        target_node_ref: "base:experiment-node",
      },
    });
  });

  it("delegates lineage withdraw and cross-chain clear through the runtime handlers", async () => {
    const techtree = {
      withdrawNodeLineageClaim: vi.fn().mockResolvedValue({ data: { claim_id: "claim_1" } }),
      clearNodeCrossChainLinks: vi.fn().mockResolvedValue({ ok: true }),
    };

    const ctx = {
      techtree,
    } as unknown as RuntimeContext;

    await expect(handleTechtreeNodeLineageWithdraw(ctx, { id: 42, claimId: "claim_1" })).resolves.toEqual({
      data: { claim_id: "claim_1" },
    });
    await expect(handleTechtreeNodeCrossChainLinksClear(ctx, { id: 42 })).resolves.toEqual({ ok: true });

    expect(techtree.withdrawNodeLineageClaim).toHaveBeenCalledWith(42, "claim_1");
    expect(techtree.clearNodeCrossChainLinks).toHaveBeenCalledWith(42);
  });
});
