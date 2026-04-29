import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { signPersonalMessage } from "../../src/internal-runtime/agent/wallet.js";
import { loadConfig, writeInitialConfig } from "../../src/internal-runtime/config.js";
import { SessionStore } from "../../src/internal-runtime/store/session-store.js";
import { StateStore } from "../../src/internal-runtime/store/state-store.js";
import { TechtreeClient } from "../../src/internal-runtime/techtree/client.js";
import { buildAuthenticatedFetchInit } from "../../src/internal-runtime/siwa/request-builder.js";
import { buildSiwaMessage } from "../../src/internal-runtime/siwa/siwa.js";
import { writeFakeCdp } from "../support/fake-cdp.js";
import { TechtreeContractServer } from "../../../../test-support/techtree-contract-server.js";
import { describeNetwork } from "../../../../test-support/integration.js";

const TEST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TEST_WALLET = "0x1111111111111111111111111111111111111111";
const TEST_REGISTRY = "0x2222222222222222222222222222222222222222";

class StaticWalletSecretSource {
  async getPrivateKeyHex(): Promise<`0x${string}`> {
    return TEST_PRIVATE_KEY;
  }
}

interface ClientHarness {
  client: TechtreeClient;
  stateStore: StateStore;
  sessionStore: SessionStore;
}

const buildConfig = (baseUrl: string, tempDir: string) => {
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
  return loadConfig(configPath);
};

const createHarness = (baseUrl: string): ClientHarness => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regents-client-"));
  const stateStore = new StateStore(path.join(tempDir, "runtime-state.json"));
  const sessionStore = new SessionStore(stateStore);
  const client = new TechtreeClient({
    config: buildConfig(baseUrl, tempDir),
    baseUrl,
    requestTimeoutMs: 1_000,
    sessionStore,
    walletSecretSource: new StaticWalletSecretSource(),
    stateStore,
  });

  return {
    client,
    stateStore,
    sessionStore,
  };
};

const authenticate = async ({ client, stateStore, sessionStore }: ClientHarness): Promise<void> => {
  const nonce = await client.siwaNonce({
    wallet_address: TEST_WALLET,
    chain_id: 84532,
    registry_address: TEST_REGISTRY,
    token_id: "99",
    audience: "techtree",
  });

  const message = buildSiwaMessage({
    domain: "regent.cx",
    uri: "https://regent.cx/login",
    walletAddress: TEST_WALLET,
    chainId: 84532,
    registryAddress: TEST_REGISTRY,
    tokenId: "99",
    nonce: nonce.data.nonce,
    issuedAt: "2026-03-10T00:00:00.000Z",
    statement: "Sign in to Regents CLI.",
  });

  const signature = await signPersonalMessage(TEST_PRIVATE_KEY, message);
  const verify = await client.siwaVerify({
    wallet_address: TEST_WALLET,
    chain_id: 84532,
    registry_address: TEST_REGISTRY,
    token_id: "99",
    audience: "techtree",
    nonce: nonce.data.nonce,
    message,
    signature,
  });

  sessionStore.setSiwaSession({
    walletAddress: verify.data.walletAddress,
    chainId: verify.data.chainId,
    nonce: verify.data.nonce,
    keyId: verify.data.keyId,
    receipt: verify.data.receipt,
    receiptExpiresAt: verify.data.receiptExpiresAt,
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
};

describeNetwork("TechtreeClient functional coverage", () => {
  let server: TechtreeContractServer;
  let originalHome: string | undefined;
  let originalPath: string | undefined;
  let originalKeyId: string | undefined;
  let originalKeySecret: string | undefined;
  let originalWalletSecret: string | undefined;
  let testHome = "";

  beforeEach(async () => {
    server = new TechtreeContractServer();
    await server.start();
    originalHome = process.env.HOME;
    originalPath = process.env.PATH;
    originalKeyId = process.env.CDP_KEY_ID;
    originalKeySecret = process.env.CDP_KEY_SECRET;
    originalWalletSecret = process.env.CDP_WALLET_SECRET;
    testHome = fs.mkdtempSync(path.join(os.tmpdir(), "regents-client-home-"));
    process.env.HOME = testHome;
    process.env.PATH = `${writeFakeCdp(testHome, {
      accounts: [{ name: "main", address: TEST_WALLET }],
    })}:${originalPath ?? ""}`;
    process.env.CDP_KEY_ID = "test-key";
    process.env.CDP_KEY_SECRET = "test-secret";
    process.env.CDP_WALLET_SECRET = "test-wallet-secret";
  });

  afterEach(async () => {
    await server.stop();
    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    process.env.CDP_KEY_ID = originalKeyId;
    process.env.CDP_KEY_SECRET = originalKeySecret;
    process.env.CDP_WALLET_SECRET = originalWalletSecret;
    fs.rmSync(testHome, { recursive: true, force: true });
  });

  it("covers public read flows", async () => {
    const harness = createHarness(server.baseUrl);

    await expect(harness.client.health()).resolves.toEqual({
      ok: true,
      service: "techtree-contract-server",
    });

    const nodes = await harness.client.listNodes({ limit: 5, seed: "ml" });
    expect(nodes.data.length).toBeGreaterThan(0);

    await expect(harness.client.getNode(1)).resolves.toMatchObject({
      data: {
        id: 1,
        seed: "ml",
      },
    });

    await expect(harness.client.getChildren(1, { limit: 5 })).resolves.toEqual({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          parent_id: 1,
        }),
      ]),
    });

    await expect(harness.client.getComments(1, { limit: 5 })).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 10,
          node_id: 1,
        }),
      ],
    });

    await expect(harness.client.listActivity({ limit: 2 })).resolves.toEqual({
      data: [
        expect.objectContaining({
          event_type: "node_created",
          subject_node_id: 1,
        }),
        expect.objectContaining({
          event_type: "comment_added",
          subject_node_id: 1,
        }),
      ],
    });

    await expect(harness.client.search({ q: "root", limit: 2 })).resolves.toEqual({
      data: {
        nodes: [
          expect.objectContaining({
            id: 1,
            title: "Root node",
          }),
        ],
        comments: [],
      },
    });
  });

  it("covers science-task read and write flows", async () => {
    const harness = createHarness(server.baseUrl);

    await expect(
      harness.client.listScienceTasks({
        limit: 1,
        stage: "submitted",
        science_domain: "life-sciences",
        science_field: "biology",
      }),
    ).resolves.toEqual({
      data: [
        expect.objectContaining({
          node_id: 301,
          task_slug: "cell-atlas-benchmark",
          workflow_state: "submitted",
        }),
      ],
    });

    await expect(harness.client.getScienceTask(301)).resolves.toMatchObject({
      data: {
        node_id: 301,
        task_slug: "cell-atlas-benchmark",
        harbor_pr_url: "https://harbor.example/pr/301",
      },
    });

    const listRequest = server.requests.find(
      (request) =>
        request.method === "GET" &&
        request.pathname === "/v1/science-tasks" &&
        request.search.includes("stage=submitted"),
    );
    expect(listRequest?.search).toContain("science_domain=life-sciences");
    expect(listRequest?.search).toContain("science_field=biology");

    await authenticate(harness);

    const baseInput = {
      title: "Protein folding benchmark",
      summary: "Benchmark a protein folding review task.",
      science_domain: "life-sciences",
      science_field: "biology",
      task_slug: "protein-folding-benchmark",
      structured_output_shape: { answer: "string" },
      claimed_expert_time: "3 hours",
      threshold_rationale: "The task expects a fully justified result.",
      anti_cheat_notes: "The answer key stays outside the packet.",
      reproducibility_notes: "Pin the environment before each rerun.",
      dependency_pinning_status: "Pinned",
      canary_status: "Present",
      failure_analysis: "Frontier models miss one structured output requirement.",
      packet_files: {
        "instruction.md": {
          encoding: "utf8" as const,
          content: "# Protein folding benchmark\n",
        },
        "tests/test_task.py": {
          encoding: "utf8" as const,
          content: "def test_task():\n    assert True\n",
        },
      },
    };

    const created = await harness.client.createScienceTask(baseInput);
    expect(created.data.workflow_state).toBe("authoring");

    const checklist = await harness.client.updateScienceTaskChecklist(created.data.node_id, {
      ...baseInput,
      checklist: {
        instruction_and_tests_match: {
          status: "pass",
          note: "Checked in the functional test",
        },
      },
    });
    expect(checklist.data.workflow_state).toBe("evidence_ready");

    const evidence = await harness.client.updateScienceTaskEvidence(created.data.node_id, {
      ...baseInput,
      oracle_run: {
        command: "uv run oracle",
        summary: "Oracle passes",
      },
      frontier_run: {
        command: "uv run frontier",
        summary: "Frontier misses a required field",
      },
    });
    expect(evidence.data.workflow_state).toBe("evidence_ready");

    const submitted = await harness.client.submitScienceTask(created.data.node_id, {
      ...baseInput,
      harbor_pr_url: "https://harbor.example/pr/999",
      latest_review_follow_up_note: "Ready for Harbor review",
    });
    expect(submitted.data.workflow_state).toBe("submitted");

    const reviewUpdated = await harness.client.reviewUpdateScienceTask(created.data.node_id, {
      ...baseInput,
      harbor_pr_url: "https://harbor.example/pr/999",
      latest_review_follow_up_note: "All reviewer comments answered",
      open_reviewer_concerns_count: 0,
      any_concern_unanswered: false,
      latest_rerun_after_latest_fix: true,
      latest_fix_at: "2026-04-20T12:00:00.000Z",
      last_rerun_at: "2026-04-20T13:00:00.000Z",
    });
    expect(reviewUpdated.data.workflow_state).toBe("merge_ready");

    await expect(harness.client.getScienceTask(created.data.node_id)).resolves.toMatchObject({
      data: {
        node_id: created.data.node_id,
        task_slug: "protein-folding-benchmark",
        workflow_state: "merge_ready",
        harbor_pr_url: "https://harbor.example/pr/999",
        open_reviewer_concerns_count: 0,
        any_concern_unanswered: false,
        latest_rerun_after_latest_fix: true,
      },
    });
  });

  it("covers authenticated publish, comment, watch, star, inbox, opportunities, and idempotency", async () => {
    const harness = createHarness(server.baseUrl);
    await authenticate(harness);

    const firstPublish = await harness.client.createNode({
      seed: "ml",
      kind: "hypothesis",
      title: "Functional publish",
      parent_id: 1,
      notebook_source: "print('functional')",
      idempotency_key: "node-key-fixed",
    });
    const secondPublish = await harness.client.createNode({
      seed: "ml",
      kind: "hypothesis",
      title: "Functional publish",
      parent_id: 1,
      notebook_source: "print('functional')",
      idempotency_key: "node-key-fixed",
    });

    expect(firstPublish).toEqual(secondPublish);
    expect(firstPublish.data.anchor_status).toBe("pending");
    expect(harness.stateStore.read().lastUsedNodeIdempotencyKey).toBe("node-key-fixed");

    const comment = await harness.client.createComment({
      node_id: firstPublish.data.node_id,
      body_markdown: "Functional comment",
      idempotency_key: "comment-key-fixed",
    });
    const repeatedComment = await harness.client.createComment({
      node_id: firstPublish.data.node_id,
      body_markdown: "Functional comment",
      idempotency_key: "comment-key-fixed",
    });

    expect(comment).toEqual(repeatedComment);
    expect(harness.stateStore.read().lastUsedCommentIdempotencyKey).toBe("comment-key-fixed");

    await expect(harness.client.getWorkPacket(1)).resolves.toMatchObject({
      data: {
        node: expect.objectContaining({
          id: 1,
        }),
      },
    });

    await expect(harness.client.watchNode(1)).resolves.toMatchObject({
      data: {
        node_id: 1,
        watcher_type: "agent",
      },
    });

    await expect(harness.client.listWatches()).resolves.toEqual({
      data: [
        {
          id: 800,
          node_id: 1,
          watcher_type: "agent",
          watcher_ref: 1,
          inserted_at: "2026-03-10T00:00:00.000Z",
        },
      ],
    });

    await expect(harness.client.unwatchNode(1)).resolves.toEqual({ ok: true });

    await expect(harness.client.starNode(1)).resolves.toEqual({
      data: {
        id: 900,
        node_id: 1,
        actor_type: "agent",
        actor_ref: 1,
        inserted_at: "2026-03-10T00:00:00.000Z",
      },
    });

    await expect(harness.client.unstarNode(1)).resolves.toEqual({ ok: true });

    await expect(harness.client.getInbox({ cursor: 7, limit: 3, seed: "ml", kind: ["comment"] })).resolves.toEqual({
      events: [
        {
          id: 2001,
          subject_node_id: 1,
          actor_type: "agent",
          actor_ref: 1,
          event_type: "comment_added",
          stream: "agent_inbox",
          payload: {
            seed: "ml",
            kind_filters: ["comment"],
          },
          inserted_at: "2026-03-10T00:00:00.000Z",
        },
        {
          id: 2002,
          subject_node_id: firstPublish.data.node_id,
          actor_type: "agent",
          actor_ref: 1,
          event_type: "node.comment_created",
          stream: "agent_inbox",
          payload: {
            comment_id: comment.data.comment_id,
            seed: "ml",
            kind_filters: ["comment"],
          },
          inserted_at: "2026-03-10T00:00:00.000Z",
        },
        {
          id: 2003,
          subject_node_id: 1,
          actor_type: "agent",
          actor_ref: 1,
          event_type: "node.starred",
          stream: "agent_inbox",
          payload: {
            seed: "ml",
            kind_filters: ["comment"],
          },
          inserted_at: "2026-03-10T00:00:00.000Z",
        },
      ],
      next_cursor: 2003,
    });

    await expect(harness.client.getOpportunities({ limit: 2, kind: ["review"] })).resolves.toEqual({
      opportunities: [
        {
          node_id: 1,
          title: "Root node",
          seed: "ml",
          kind: "hypothesis",
          opportunity_type: "review",
          activity_score: "1.0",
        },
      ],
    });

    const protectedRequest = server.requests.find((request) => request.pathname === "/v1/tree/nodes");
    expect(protectedRequest?.headers["signature-input"]).toContain('"x-agent-token-id"');
    expect(protectedRequest?.headers["x-agent-wallet-address"]).toBe(TEST_WALLET);
  });

  it("fails protected writes when auth is missing", async () => {
    const harness = createHarness(server.baseUrl);

    await expect(
      harness.client.createNode({
        seed: "ml",
        kind: "hypothesis",
        title: "No auth",
        parent_id: 1,
        notebook_source: "print('no auth')",
      }),
    ).rejects.toMatchObject({
      code: "siwa_session_missing",
    });
  });

  it("fails protected writes when the SIWA session exists but the agent identity is missing", async () => {
    const harness = createHarness(server.baseUrl);
    const nonce = await harness.client.siwaNonce({
      wallet_address: TEST_WALLET,
      chain_id: 84532,
      registry_address: TEST_REGISTRY,
      token_id: "99",
      audience: "techtree",
    });
    const message = buildSiwaMessage({
      domain: "regent.cx",
      uri: "https://regent.cx/login",
      walletAddress: TEST_WALLET,
      chainId: 84532,
      registryAddress: TEST_REGISTRY,
      tokenId: "99",
      nonce: nonce.data.nonce,
      issuedAt: "2026-03-10T00:00:00.000Z",
      statement: "Sign in to Regents CLI.",
    });
    const signature = await signPersonalMessage(TEST_PRIVATE_KEY, message);
    const verify = await harness.client.siwaVerify({
      wallet_address: TEST_WALLET,
      chain_id: 84532,
      registry_address: TEST_REGISTRY,
      token_id: "99",
      audience: "techtree",
      nonce: nonce.data.nonce,
      message,
      signature,
    });

    harness.sessionStore.setSiwaSession({
      walletAddress: verify.data.walletAddress,
      chainId: verify.data.chainId,
      nonce: verify.data.nonce,
      keyId: verify.data.keyId,
      receipt: verify.data.receipt,
      receiptExpiresAt: verify.data.receiptExpiresAt,
      audience: "techtree",
    });

    await expect(
      harness.client.createNode({
        seed: "ml",
        kind: "hypothesis",
        title: "Identity missing",
        parent_id: 1,
        notebook_source: "print('identity missing')",
      }),
    ).rejects.toMatchObject({
      code: "agent_identity_missing",
    });
  });

  it("surfaces server-side auth failures cleanly", async () => {
    const harness = createHarness(server.baseUrl);
    await authenticate(harness);

    harness.sessionStore.setSiwaSession({
      ...(harness.sessionStore.getSiwaSession() as NonNullable<ReturnType<SessionStore["getSiwaSession"]>>),
      receipt: "receipt-invalid",
    });

    await expect(
      harness.client.createComment({
        node_id: 1,
        body_markdown: "Bad receipt",
      }),
    ).rejects.toMatchObject({
      code: "http_envelope_invalid",
      status: 401,
    });
  });

  it("rejects deliberately invalid SIWA verify probes without minting a session", async () => {
    const harness = createHarness(server.baseUrl);

    await expect(
      harness.client.siwaVerify({
        wallet_address: TEST_WALLET,
        chain_id: 84532,
        registry_address: TEST_REGISTRY,
        token_id: "99",
        audience: "techtree",
        nonce: "doctor-invalid-nonce",
        message: buildSiwaMessage({
          domain: "regent.cx",
          uri: "https://regent.cx/login",
          walletAddress: TEST_WALLET,
          chainId: 84532,
          registryAddress: TEST_REGISTRY,
          tokenId: "99",
          nonce: "doctor-invalid-nonce",
          issuedAt: "2026-03-10T00:00:00.000Z",
          statement: "Sign in to Regents CLI.",
        }),
        signature: `0x${"00".repeat(65)}`,
      }),
    ).rejects.toMatchObject({
      code: "siwa_verify_invalid",
      status: 422,
    });
  });

  it("fails protected route requests when signature-input is omitted", async () => {
    const harness = createHarness(server.baseUrl);
    await authenticate(harness);

    const session = harness.sessionStore.getSiwaSession();
    const identity = harness.stateStore.read().agent;
    if (!session || !identity) {
      throw new Error("expected authenticated session and agent identity");
    }

    const request = await buildAuthenticatedFetchInit({
      method: "POST",
      path: "/v1/tree/comments",
      body: {
        node_id: 1,
        body_markdown: "Missing signature-input",
        idempotency_key: "missing-signature-input",
      },
      session,
      agentIdentity: identity,
      privateKey: TEST_PRIVATE_KEY,
    });
    const headers = {
      ...(request.init.headers as Record<string, string>),
    };

    delete headers["signature-input"];

    const response = await fetch(`${server.baseUrl}${request.urlPath}`, {
      ...request.init,
      headers,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "http_envelope_invalid",
        message: "missing required header: signature-input",
      },
    });
  });

  it("rejects replayed authenticated envelopes", async () => {
    const harness = createHarness(server.baseUrl);
    await authenticate(harness);

    const session = harness.sessionStore.getSiwaSession();
    const identity = harness.stateStore.read().agent;
    if (!session || !identity) {
      throw new Error("expected authenticated session and agent identity");
    }

    const request = await buildAuthenticatedFetchInit({
      method: "POST",
      path: "/v1/tree/comments",
      body: {
        node_id: 1,
        body_markdown: "Replay attempt",
        idempotency_key: "replay-envelope",
      },
      session,
      agentIdentity: identity,
      privateKey: TEST_PRIVATE_KEY,
    });

    const firstResponse = await fetch(`${server.baseUrl}${request.urlPath}`, request.init);
    expect(firstResponse.status).toBe(201);

    const secondResponse = await fetch(`${server.baseUrl}${request.urlPath}`, request.init);
    expect(secondResponse.status).toBe(401);
    await expect(secondResponse.json()).resolves.toEqual({
      error: {
        code: "http_envelope_invalid",
        message: "signature replay detected",
      },
    });
  });

});
