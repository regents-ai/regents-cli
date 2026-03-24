import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callJsonRpc } from "../../src/internal-runtime/jsonrpc/client.js";
import { RegentRuntime } from "../../src/internal-runtime/runtime.js";
import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import { resolveWatchedNodeRelaySocketPath } from "../../src/internal-runtime/transports/watched-node-relay-socket.js";
import { TechtreeContractServer } from "../../../../test-support/techtree-contract-server.js";
import { describeNetwork } from "../../../../test-support/integration.js";
import { waitForFileRemoval } from "../../../../test-support/test-helpers.js";

const TEST_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const TEST_WALLET = "0x1111111111111111111111111111111111111111";
const TEST_REGISTRY = "0x2222222222222222222222222222222222222222";

const readWatchedNodeEvent = async (
  eventSocketPath: string,
  trigger: () => Promise<void>,
): Promise<{ event: { event_type: string; subject_node_id: number | null }; data: { node: { id: number } } }> => {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(eventSocketPath);
    let buffer = "";
    let triggerStarted = false;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for watched-node relay event"));
    }, 6_000);

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.end();
      socket.destroy();
    };

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      setTimeout(() => {
        if (triggerStarted) {
          return;
        }

        triggerStarted = true;
        void trigger().catch((error) => {
          cleanup();
          reject(error);
        });
      }, 250);
    });

    socket.on("data", (chunk) => {
      buffer += chunk;

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) {
          continue;
        }

        const parsed = JSON.parse(line) as {
          event?: { event_type?: string; subject_node_id?: number | null };
          data?: { node?: { id?: number } };
          error?: string;
        };

        if (parsed.error) {
          cleanup();
          reject(new Error(parsed.error));
          return;
        }

        if (parsed.event?.event_type && parsed.data?.node?.id) {
          cleanup();
          resolve(parsed as { event: { event_type: string; subject_node_id: number | null }; data: { node: { id: number } } });
          return;
        }
      }
    });

    socket.on("error", (error) => {
      cleanup();
      reject(error);
    });
  });
};

describeNetwork.sequential("RegentRuntime daemon functional coverage", () => {
  let server: TechtreeContractServer;
  let tempDir = "";
  let configPath = "";
  let socketPath = "";
  let originalPrivateKey: string | undefined;

  beforeEach(async () => {
    server = new TechtreeContractServer();
    await server.start();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-daemon-"));
    configPath = path.join(tempDir, "regent.config.json");
    socketPath = path.join(tempDir, "runtime", "regent.sock");
    originalPrivateKey = process.env.REGENT_WALLET_PRIVATE_KEY;
    process.env.REGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY;

    writeInitialConfig(configPath, {
      runtime: {
        socketPath,
        stateDir: path.join(tempDir, "state"),
        logLevel: "debug",
      },
      techtree: {
        baseUrl: server.baseUrl,
        audience: "techtree",
        defaultChainId: 11155111,
        requestTimeoutMs: 1_000,
      },
      wallet: {
        privateKeyEnv: "REGENT_WALLET_PRIVATE_KEY",
        keystorePath: path.join(tempDir, "keys", "agent-wallet.json"),
      },
    });
  });

  afterEach(async () => {
    process.env.REGENT_WALLET_PRIVATE_KEY = originalPrivateKey;
    await server.stop();
  });

  it("serves JSON-RPC ping/status, auth, reads, writes, watch relay, stars, and shutdown", async () => {
    const runtime = new RegentRuntime(configPath);
    await runtime.start();

    expect(await callJsonRpc(socketPath, "runtime.ping")).toEqual({ ok: true });

    const status = await callJsonRpc(socketPath, "runtime.status");
    expect(status.running).toBe(true);
    expect(status.authenticated).toBe(false);

    const login = await callJsonRpc(socketPath, "auth.siwa.login", {
      walletAddress: TEST_WALLET,
      chainId: 11155111,
      registryAddress: TEST_REGISTRY,
      tokenId: "99",
      audience: "techtree",
    });
    expect(login.data.receipt.startsWith("receipt-valid.")).toBe(true);

    await expect(callJsonRpc(socketPath, "auth.siwa.status")).resolves.toMatchObject({
      authenticated: true,
      protectedRoutesReady: true,
      missingIdentityFields: [],
      agentIdentity: {
        walletAddress: TEST_WALLET,
        chainId: 11155111,
        registryAddress: TEST_REGISTRY,
        tokenId: "99",
      },
    });

    await expect(callJsonRpc(socketPath, "agent.init")).resolves.toMatchObject({
      initialized: true,
      currentProfile: expect.objectContaining({
        name: "bbh",
        executor_harness_profile: "bbh",
      }),
      currentHarness: expect.objectContaining({
        kind: "hermes",
      }),
      resolvedMetadata: expect.objectContaining({
        executor_harness: expect.objectContaining({
          kind: "hermes",
          profile: "bbh",
        }),
        origin: expect.objectContaining({
          kind: "local",
          transport: "api",
        }),
        executor_harness_kind: "hermes",
        executor_harness_profile: "bbh",
      }),
    });

    await expect(callJsonRpc(socketPath, "agent.status")).resolves.toMatchObject({
      initialized: true,
      profiles: expect.arrayContaining([
        expect.objectContaining({ name: "owner" }),
        expect.objectContaining({ name: "public" }),
        expect.objectContaining({ name: "group" }),
        expect.objectContaining({ name: "custom" }),
      ]),
      harnesses: expect.arrayContaining([
        expect.objectContaining({ name: "openclaw" }),
        expect.objectContaining({ name: "hermes" }),
        expect.objectContaining({ name: "claude_code" }),
        expect.objectContaining({ name: "custom" }),
      ]),
    });

    const runWorkspace = path.join(tempDir, "run-workspace");
    await expect(
      callJsonRpc(socketPath, "techtree.v1.run.init", {
        tree: "main",
        workspace_path: runWorkspace,
        artifact_id: "0x1234000000000000000000000000000000000000000000000000000000000000",
        metadata: {
          executor_harness: {
            kind: "hermes",
            profile: "researcher",
            entrypoint: "analysis.py",
          },
          origin: {
            kind: "api",
            transport: "api",
            session_id: "session-123",
            trigger_ref: "trigger-9",
          },
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      tree: "main",
      workspace_path: runWorkspace,
      resolved_metadata: expect.objectContaining({
        executor_harness: expect.objectContaining({
          kind: "hermes",
          profile: "researcher",
          entrypoint: "analysis.py",
        }),
        origin: expect.objectContaining({
          kind: "api",
          transport: "api",
          session_id: "session-123",
          trigger_ref: "trigger-9",
        }),
        executor_harness_kind: "hermes",
        executor_harness_profile: "researcher",
        origin_session_id: "session-123",
      }),
    });

    await expect(callJsonRpc(socketPath, "techtree.nodes.get", { id: 1 })).resolves.toMatchObject({
      data: {
        id: 1,
      },
    });

    await expect(
      callJsonRpc(socketPath, "techtree.nodes.children", { id: 1, limit: 5 }),
    ).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          parent_id: 1,
        }),
      ],
    });

    await expect(
      callJsonRpc(socketPath, "techtree.nodes.comments", { id: 1, limit: 5 }),
    ).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          node_id: 1,
        }),
      ],
    });

    await expect(callJsonRpc(socketPath, "techtree.activity.list", { limit: 2 })).resolves.toEqual({
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

    await expect(callJsonRpc(socketPath, "techtree.search.query", { q: "root", limit: 2 })).resolves.toEqual({
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

    const published = await callJsonRpc(socketPath, "techtree.nodes.create", {
      seed: "ml",
      kind: "hypothesis",
      title: "Daemon publish",
      parent_id: 1,
      notebook_source: "print('daemon')",
      idempotency_key: "daemon-node-key",
    });
    const publishedAgain = await callJsonRpc(socketPath, "techtree.nodes.create", {
      seed: "ml",
      kind: "hypothesis",
      title: "Daemon publish",
      parent_id: 1,
      notebook_source: "print('daemon')",
      idempotency_key: "daemon-node-key",
    });

    expect(published).toEqual(publishedAgain);
    expect(published.data.anchor_status).toBe("pending");

    await expect(
      callJsonRpc(socketPath, "techtree.comments.create", {
        node_id: published.data.node_id,
        body_markdown: "Daemon comment",
        idempotency_key: "daemon-comment-key",
      }),
    ).resolves.toMatchObject({
      data: {
        node_id: published.data.node_id,
      },
    });

    await expect(callJsonRpc(socketPath, "techtree.watch.create", { nodeId: 1 })).resolves.toMatchObject({
      data: {
        node_id: 1,
        watcher_type: "agent",
      },
    });
    await expect(callJsonRpc(socketPath, "techtree.watch.list")).resolves.toEqual({
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

    const watchedNodeEvent = await readWatchedNodeEvent(
      resolveWatchedNodeRelaySocketPath(socketPath),
      async () => {
        await callJsonRpc(socketPath, "techtree.comments.create", {
          node_id: 1,
          body_markdown: "Watched relay comment",
          idempotency_key: "daemon-watch-comment-key",
        });
      },
    );

    expect(watchedNodeEvent).toMatchObject({
      event: {
        event_type: "node.comment_created",
        subject_node_id: 1,
      },
      data: {
        node: {
          id: 1,
        },
      },
    });

    await expect(callJsonRpc(socketPath, "techtree.stars.create", { nodeId: 1 })).resolves.toEqual({
      data: {
        id: 900,
        node_id: 1,
        actor_type: "agent",
        actor_ref: 1,
        inserted_at: "2026-03-10T00:00:00.000Z",
      },
    });
    await expect(callJsonRpc(socketPath, "techtree.stars.delete", { nodeId: 1 })).resolves.toEqual({ ok: true });
    await expect(callJsonRpc(socketPath, "techtree.watch.delete", { nodeId: 1 })).resolves.toEqual({ ok: true });

    await expect(callJsonRpc(socketPath, "techtree.inbox.get", { limit: 1, seed: "ml" })).resolves.toEqual({
      events: [
        expect.objectContaining({
          subject_node_id: 1,
          actor_type: "agent",
          actor_ref: 1,
          stream: "agent_inbox",
          payload: expect.objectContaining({
            seed: "ml",
            kind_filters: [],
          }),
          inserted_at: "2026-03-10T00:00:00.000Z",
        }),
      ],
      next_cursor: expect.any(Number),
    });
    await expect(
      callJsonRpc(socketPath, "techtree.opportunities.list", { kind: ["review"] }),
    ).resolves.toEqual({
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

    expect(runtime.stateStore.read().lastUsedNodeIdempotencyKey).toBe("daemon-node-key");
    expect(runtime.stateStore.read().lastUsedCommentIdempotencyKey).toBe("daemon-watch-comment-key");

    await expect(callJsonRpc(socketPath, "runtime.shutdown")).resolves.toEqual({ ok: true });
    await waitForFileRemoval(socketPath);
  }, 15_000);

  it("preserves auth session and idempotency state across restart", async () => {
    const firstRuntime = new RegentRuntime(configPath);
    await firstRuntime.start();

    await callJsonRpc(socketPath, "auth.siwa.login", {
      walletAddress: TEST_WALLET,
      chainId: 11155111,
      registryAddress: TEST_REGISTRY,
      tokenId: "99",
      audience: "techtree",
    });

    await callJsonRpc(socketPath, "techtree.nodes.create", {
      seed: "ml",
      kind: "hypothesis",
      title: "Restart publish",
      parent_id: 1,
      notebook_source: "print('restart')",
      idempotency_key: "restart-node-key",
    });
    await callJsonRpc(socketPath, "techtree.comments.create", {
      node_id: 1,
      body_markdown: "Restart comment",
      idempotency_key: "restart-comment-key",
    });

    await firstRuntime.stop();

    const secondRuntime = new RegentRuntime(configPath);
    await secondRuntime.start();

    await expect(callJsonRpc(socketPath, "auth.siwa.status")).resolves.toMatchObject({
      authenticated: true,
    });
    await expect(callJsonRpc(socketPath, "runtime.status")).resolves.toMatchObject({
      authenticated: true,
      session: {
        walletAddress: TEST_WALLET,
      },
    });
    await expect(
      callJsonRpc(socketPath, "techtree.comments.create", {
        node_id: 1,
        body_markdown: "Still authenticated",
        idempotency_key: "restart-comment-key-2",
      }),
    ).resolves.toMatchObject({
      data: {
        node_id: 1,
      },
    });

    expect(secondRuntime.stateStore.read().lastUsedNodeIdempotencyKey).toBe("restart-node-key");
    expect(secondRuntime.stateStore.read().lastUsedCommentIdempotencyKey).toBe("restart-comment-key-2");

    await secondRuntime.stop();
  }, 15_000);

  it("refuses protected writes when auth is missing", async () => {
    const runtime = new RegentRuntime(configPath);
    await runtime.start();

    await expect(
      callJsonRpc(socketPath, "techtree.nodes.create", {
        seed: "ml",
        kind: "hypothesis",
        title: "No auth publish",
        notebook_source: "print('no auth')",
      }),
    ).rejects.toMatchObject({
      code: "siwa_session_missing",
    });

    await runtime.stop();
  }, 10_000);

  it("reports when a SIWA session exists but protected-route identity is still missing", async () => {
    const runtime = new RegentRuntime(configPath);
    await runtime.start();

    await callJsonRpc(socketPath, "auth.siwa.login", {
      walletAddress: TEST_WALLET,
      chainId: 11155111,
      audience: "techtree",
    });

    await expect(callJsonRpc(socketPath, "auth.siwa.status")).resolves.toEqual({
      authenticated: true,
      session: expect.objectContaining({
        walletAddress: TEST_WALLET,
      }),
      agentIdentity: null,
      protectedRoutesReady: false,
      missingIdentityFields: ["walletAddress", "chainId", "registryAddress", "tokenId"],
    });

    await expect(callJsonRpc(socketPath, "techtree.nodes.workPacket", { id: 1 })).rejects.toMatchObject({
      code: "agent_identity_missing",
    });

    await runtime.stop();
  }, 10_000);

  it("rejects partial protected-route identity params during login", async () => {
    const runtime = new RegentRuntime(configPath);
    await runtime.start();

    await expect(
      callJsonRpc(socketPath, "auth.siwa.login", {
        walletAddress: TEST_WALLET,
        chainId: 11155111,
        registryAddress: TEST_REGISTRY,
      }),
    ).rejects.toMatchObject({
      code: "invalid_agent_identity",
    });

    await runtime.stop();
  }, 10_000);

  it("surfaces authenticated server failures over JSON-RPC", async () => {
    const runtime = new RegentRuntime(configPath);
    await runtime.start();

    await callJsonRpc(socketPath, "auth.siwa.login", {
      walletAddress: TEST_WALLET,
      chainId: 11155111,
      registryAddress: TEST_REGISTRY,
      tokenId: "99",
      audience: "techtree",
    });

    const session = runtime.sessionStore.getSiwaSession();
    if (!session) {
      throw new Error("expected a persisted SIWA session");
    }

    runtime.sessionStore.setSiwaSession({
      ...session,
      receipt: "receipt-invalid",
    });

    await expect(
      callJsonRpc(socketPath, "techtree.comments.create", {
        node_id: 1,
        body_markdown: "Server auth failure",
      }),
    ).rejects.toMatchObject({
      code: "http_envelope_invalid",
    });

    await runtime.stop();
  }, 10_000);
});
