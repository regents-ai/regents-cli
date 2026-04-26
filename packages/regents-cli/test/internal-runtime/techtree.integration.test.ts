import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { generateWallet, signPersonalMessage } from "../../src/internal-runtime/agent/wallet.js";
import { loadConfig, writeInitialConfig } from "../../src/internal-runtime/config.js";
import { StateStore } from "../../src/internal-runtime/store/state-store.js";
import { SessionStore } from "../../src/internal-runtime/store/session-store.js";
import { TechtreeClient } from "../../src/internal-runtime/techtree/client.js";
import { buildSiwaMessage } from "../../src/internal-runtime/siwa/siwa.js";

class StaticWalletSecretSource {
  readonly privateKey: `0x${string}`;

  constructor(privateKey: `0x${string}`) {
    this.privateKey = privateKey;
  }

  async getPrivateKeyHex(): Promise<`0x${string}`> {
    return this.privateKey;
  }
}

const integrationEnabled = process.env.REGENT_INTEGRATION === "1";
const baseUrl = process.env.REGENT_TEST_TECHTREE_URL ?? "http://127.0.0.1:4001";

describe.skipIf(!integrationEnabled)("techtree integration", () => {
  it("reaches public and authenticated routes against a live server", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-integration-"));
    const stateStore = new StateStore(path.join(tempDir, "state.json"));
    const sessionStore = new SessionStore(stateStore);
    const wallet = await generateWallet();
    const configPath = path.join(tempDir, "regent.config.json");
    writeInitialConfig(configPath, {
      runtime: {
        socketPath: path.join(tempDir, "runtime", "regent.sock"),
        stateDir: path.join(tempDir, "state"),
        logLevel: "debug",
      },
      auth: {
        baseUrl,
        audience: "techtree",
        defaultChainId: 84532,
        requestTimeoutMs: 10_000,
      },
      techtree: {
        baseUrl,
        requestTimeoutMs: 10_000,
      },
      wallet: {
        privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
        keystorePath: path.join(tempDir, "keys", "agent-wallet.json"),
      },
    });
    const config = loadConfig(configPath);
    const client = new TechtreeClient({
      config,
      baseUrl,
      requestTimeoutMs: 10_000,
      sessionStore,
      walletSecretSource: new StaticWalletSecretSource(wallet.privateKey),
      stateStore,
    });

    const health = await client.health();
    expect(health).toEqual(expect.objectContaining({ ok: true }));

    const nodes = await client.listNodes({ limit: 5 });
    expect(Array.isArray(nodes.data)).toBe(true);
    expect(nodes.data.length).toBeGreaterThan(0);

    const parent = nodes.data[0];
    expect(parent?.id).toBeGreaterThan(0);
    expect(parent?.seed).toBeTruthy();

    const fetchedParent = await client.getNode(parent!.id);
    expect(fetchedParent.data.id).toBe(parent!.id);

    const initialChildren = await client.getChildren(parent!.id, { limit: 5 });
    expect(Array.isArray(initialChildren.data)).toBe(true);

    const initialComments = await client.getComments(parent!.id, { limit: 5 });
    expect(Array.isArray(initialComments.data)).toBe(true);

    const activity = await client.listActivity({ limit: 5 });
    expect(Array.isArray(activity.data)).toBe(true);

    const search = await client.search({ q: parent!.title, limit: 5 });
    expect(Array.isArray(search.data.nodes)).toBe(true);
    expect(Array.isArray(search.data.comments)).toBe(true);

    const registryAddress = "0x2222222222222222222222222222222222222222" as const;
    const tokenId = String(Date.now());

    const nonceResponse = await client.siwaNonce({
      wallet_address: wallet.address,
      chain_id: 84532,
      registry_address: registryAddress,
      token_id: tokenId,
      audience: "techtree",
    });

    const message = buildSiwaMessage({
      domain: "regent.cx",
      uri: "https://regent.cx/login",
      walletAddress: wallet.address,
      chainId: 84532,
      registryAddress,
      tokenId,
      nonce: nonceResponse.data.nonce,
      statement: "Sign in to Regents CLI.",
    });
    const signature = await signPersonalMessage(wallet.privateKey, message);

    const verifyResponse = await client.siwaVerify({
      wallet_address: wallet.address,
      chain_id: 84532,
      audience: "techtree",
      nonce: nonceResponse.data.nonce,
      message,
      signature,
      registry_address: registryAddress,
      token_id: tokenId,
    });

    sessionStore.setSiwaSession({
      walletAddress: verifyResponse.data.walletAddress,
      chainId: verifyResponse.data.chainId,
      nonce: verifyResponse.data.nonce,
      keyId: verifyResponse.data.keyId,
      receipt: verifyResponse.data.receipt,
      receiptExpiresAt: verifyResponse.data.receiptExpiresAt,
      audience: "techtree",
      registryAddress,
      tokenId,
    });
    stateStore.patch({
      agent: {
        walletAddress: wallet.address,
        chainId: 84532,
        registryAddress,
        tokenId,
      },
    });

    const nodeIdempotencyKey = `node:${parent!.seed.toLowerCase()}:integration:${Date.now()}`;
    const createNode = await client.createNode({
      seed: parent.seed,
      kind: "hypothesis",
      title: `regent integration ${Date.now()}`,
      parent_id: parent.id,
      notebook_source: "print('integration')",
      idempotency_key: nodeIdempotencyKey,
    });

    expect(createNode.data.node_id).toBeGreaterThan(0);
    expect(createNode.data.anchor_status).toBe("pending");

    const duplicateCreateNode = await client.createNode({
      seed: parent.seed,
      kind: "hypothesis",
      title: `regent integration ${Date.now()}`,
      parent_id: parent.id,
      notebook_source: "print('integration')",
      idempotency_key: nodeIdempotencyKey,
    });

    expect(duplicateCreateNode).toEqual(createNode);

    const workPacket = await client.getWorkPacket(createNode.data.node_id);
    expect(workPacket.data.node.id).toBe(createNode.data.node_id);
    expect(Array.isArray(workPacket.data.comments)).toBe(true);
    expect(Array.isArray(workPacket.data.activity_events)).toBe(true);

    const watch = await client.watchNode(parent!.id);
    expect(watch.data.node_id).toBe(parent!.id);

    const unwatch = await client.unwatchNode(parent!.id);
    expect(unwatch).toEqual({ ok: true });

    const inbox = await client.getInbox({ limit: 5 });
    expect(Array.isArray(inbox.events)).toBe(true);

    const opportunities = await client.getOpportunities({ limit: 5 });
    expect(Array.isArray(opportunities.opportunities)).toBe(true);

    const commentIdempotencyKey = `comment:node-${createNode.data.node_id}:integration:${Date.now()}`;
    const createComment = await client.createComment({
      node_id: createNode.data.node_id,
      body_markdown: "integration comment",
      idempotency_key: commentIdempotencyKey,
    });

    expect(createComment.data.comment_id).toBeGreaterThan(0);

    const duplicateCreateComment = await client.createComment({
      node_id: createNode.data.node_id,
      body_markdown: "integration comment",
      idempotency_key: commentIdempotencyKey,
    });

    expect(duplicateCreateComment).toEqual(createComment);
  });
});
