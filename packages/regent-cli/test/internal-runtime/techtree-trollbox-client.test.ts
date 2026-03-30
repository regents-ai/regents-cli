import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionStore } from "../../src/internal-runtime/store/session-store.js";
import { StateStore } from "../../src/internal-runtime/store/state-store.js";
import { TechtreeClient } from "../../src/internal-runtime/techtree/client.js";
import type { ContractRequestRecord } from "../../../../test-support/techtree-contract-server.js";

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
  requests: ContractRequestRecord[];
  stop: () => Promise<void>;
}

const normalizeHeaders = (headers: http.IncomingHttpHeaders): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) => {
      if (value === undefined) {
        return [];
      }

      return [[key.toLowerCase(), Array.isArray(value) ? value.join(", ") : value]];
    }),
  );

const readBody = async (req: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw === "" ? undefined : JSON.parse(raw);
};

const createHarness = async (): Promise<ClientHarness> => {
  const requests: ContractRequestRecord[] = [];

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const headers = normalizeHeaders(req.headers);
    const body = await readBody(req);

    requests.push({
      method: req.method ?? "GET",
      pathname: requestUrl.pathname,
      search: requestUrl.search,
      headers,
      body,
    });

    const requireAgentHeaders = () => {
      const required = [
        "x-siwa-receipt",
        "x-key-id",
        "x-timestamp",
        "signature-input",
        "signature",
        "x-agent-wallet-address",
        "x-agent-chain-id",
        "x-agent-registry-address",
        "x-agent-token-id",
      ];

      const missing = required.filter((name) => !headers[name]);
      if (missing.length > 0) {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(
          `${JSON.stringify({
            error: {
              code: "http_envelope_invalid",
              message: `missing required header: ${missing[0]}`,
            },
          })}\n`,
        );
        return false;
      }

      return true;
    };

    if (req.method === "GET" && requestUrl.pathname === "/v1/trollbox/messages") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        `${JSON.stringify({
          data: [
            {
              id: 10,
              room_id: "global",
              transport_msg_id: "transport-10",
              transport_topic: "techtree.webapp",
              origin_peer_id: null,
              origin_node_id: null,
              author_kind: "human",
              author_human_id: 1,
              author_agent_id: null,
              author_display_name: "Public operator",
              author_label: "Public operator",
              author_wallet_address: null,
              author_transport_id: null,
              body: "Existing public trollbox message",
              client_message_id: null,
              reply_to_message_id: null,
              reply_to_transport_msg_id: null,
              reactions: {},
              moderation_state: "visible",
              sent_at: "2026-03-10T00:00:00.000Z",
              inserted_at: "2026-03-10T00:00:00.000Z",
              updated_at: "2026-03-10T00:00:00.000Z",
            },
          ],
          next_cursor: null,
        })}\n`,
      );
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/v1/agent/trollbox/messages") {
      if (!requireAgentHeaders()) {
        return;
      }

      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        `${JSON.stringify({
          data: [
            {
              id: 1,
              room_id: "agent:1",
              transport_msg_id: "transport-1",
              transport_topic: "techtree.agent.1",
              origin_peer_id: null,
              origin_node_id: null,
              author_kind: "agent",
              author_human_id: null,
              author_agent_id: 1,
              author_display_name: null,
              author_label: "Contract test agent",
              author_wallet_address: TEST_WALLET,
              author_transport_id: null,
              body: "Existing trollbox message",
              client_message_id: null,
              reply_to_message_id: null,
              reply_to_transport_msg_id: null,
              reactions: {},
              moderation_state: "visible",
              sent_at: "2026-03-10T00:00:00.000Z",
              inserted_at: "2026-03-10T00:00:00.000Z",
              updated_at: "2026-03-10T00:00:00.000Z",
            },
          ],
          next_cursor: null,
        })}\n`,
      );
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/v1/agent/trollbox/messages") {
      if (!requireAgentHeaders()) {
        return;
      }

      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end(
        `${JSON.stringify({
          data: {
            id: 2,
            room_id: "agent:1",
            transport_msg_id: "transport-2",
            transport_topic: "techtree.agent.1",
            origin_peer_id: null,
            origin_node_id: null,
            author_kind: "agent",
            author_human_id: null,
            author_agent_id: 1,
            author_display_name: null,
            author_label: "Contract test agent",
            author_wallet_address: TEST_WALLET,
            author_transport_id: null,
            body: body && typeof body === "object" ? (body as { body?: string }).body ?? "" : "",
            client_message_id: body && typeof body === "object" ? (body as { client_message_id?: string }).client_message_id ?? null : null,
            reply_to_message_id: null,
            reply_to_transport_msg_id: null,
            reactions: {},
            moderation_state: "visible",
            sent_at: "2026-03-10T00:00:00.000Z",
            inserted_at: "2026-03-10T00:00:00.000Z",
            updated_at: "2026-03-10T00:00:00.000Z",
          },
        })}\n`,
      );
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/v1/runtime/transport/stream") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/x-ndjson");
      res.write(
        `${JSON.stringify({
          event: "message.created",
          message: {
            id: 11,
            room_id: "global",
            transport_msg_id: "transport-11",
            transport_topic: "techtree.webapp",
            origin_peer_id: null,
            origin_node_id: null,
            author_kind: "human",
            author_human_id: 1,
            author_agent_id: null,
            author_display_name: "Public operator",
            author_label: "Public operator",
            author_wallet_address: null,
            author_transport_id: null,
            body: "Streaming public trollbox event",
            client_message_id: null,
            reply_to_message_id: null,
            reply_to_transport_msg_id: null,
            reactions: {},
            moderation_state: "visible",
            sent_at: "2026-03-10T00:00:00.000Z",
            inserted_at: "2026-03-10T00:00:00.000Z",
            updated_at: "2026-03-10T00:00:00.000Z",
          },
        })}\n`,
      );

      const timer = setTimeout(() => {
        if (!res.writableEnded) {
          res.end(`${JSON.stringify({ event: "heartbeat", room_id: "global" })}\n`);
        }
      }, 50);

      req.on("close", () => clearTimeout(timer));
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/v1/runtime/transport") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        `${JSON.stringify({
          data: {
            mode: "libp2p",
            ready: true,
            peer_count: 2,
            subscriptions: ["public-trollbox"],
            last_error: null,
            local_peer_id: "peer-local",
            origin_node_id: "node-1",
          },
        })}\n`,
      );
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/v1/agent/runtime/transport/stream") {
      if (!requireAgentHeaders()) {
        return;
      }

      res.statusCode = 200;
      res.setHeader("content-type", "application/x-ndjson");
      res.end(
        `${JSON.stringify({
          event: "message.created",
          message: {
            id: 3,
            room_id: "agent:1",
            transport_msg_id: "transport-3",
            transport_topic: "techtree.agent.1",
            origin_peer_id: null,
            origin_node_id: null,
            author_kind: "agent",
            author_human_id: null,
            author_agent_id: 1,
            author_display_name: null,
            author_label: "Contract test agent",
            author_wallet_address: TEST_WALLET,
            author_transport_id: null,
            body: "Streamed trollbox event",
            client_message_id: null,
            reply_to_message_id: null,
            reply_to_transport_msg_id: null,
            reactions: {},
            moderation_state: "visible",
            sent_at: "2026-03-10T00:00:00.000Z",
            inserted_at: "2026-03-10T00:00:00.000Z",
            updated_at: "2026-03-10T00:00:00.000Z",
          },
        })}\n${JSON.stringify({ event: "heartbeat", room_id: "agent:1" })}\n`,
      );
      return;
    }

    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(`${JSON.stringify({ error: { code: "route_not_found" } })}\n`);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-trollbox-client-"));
  const stateStore = new StateStore(path.join(tempDir, "runtime-state.json"));
  const sessionStore = new SessionStore(stateStore);
  sessionStore.setSiwaSession({
    walletAddress: TEST_WALLET,
    chainId: 11155111,
    nonce: "nonce",
    keyId: TEST_WALLET.toLowerCase(),
    receipt: "receipt-valid.test",
    receiptExpiresAt: "2999-01-01T00:00:00.000Z",
    audience: "techtree",
    registryAddress: TEST_REGISTRY,
    tokenId: "99",
  });
  stateStore.patch({
    agent: {
      walletAddress: TEST_WALLET,
      chainId: 11155111,
      registryAddress: TEST_REGISTRY,
      tokenId: "99",
    },
  });

  const address = server.address() as AddressInfo;
  const client = new TechtreeClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    requestTimeoutMs: 1_000,
    sessionStore,
    walletSecretSource: new StaticWalletSecretSource(),
    stateStore,
  });

  return {
    client,
    requests,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
};

describe("Techtree trollbox client routes", () => {
  let harness: ClientHarness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.stop();
  });

  it("uses the public webapp trollbox contract and emits stream events before the response closes", async () => {
    await expect(harness.client.listTrollboxMessages({ room: "webapp", limit: 1 })).resolves.toMatchObject({
      data: [expect.objectContaining({ body: "Existing public trollbox message" })],
      next_cursor: null,
    });

    const streamed: unknown[] = [];
    const controller = new AbortController();
    let streamFinished = false;

    const streamPromise = harness.client
      .streamTrollbox("webapp", (payload) => streamed.push(payload), controller.signal)
      .then(() => {
        streamFinished = true;
      });

    await expect
      .poll(() => streamed.length)
      .toBeGreaterThanOrEqual(1);

    expect(streamed[0]).toEqual(
      expect.objectContaining({
        event: "message.created",
        message: expect.objectContaining({ body: "Streaming public trollbox event" }),
      }),
    );
    expect(streamFinished).toBe(false);

    controller.abort();
    await streamPromise;

    const requestPaths = harness.requests.map((request) => `${request.method} ${request.pathname}${request.search}`);
    expect(requestPaths).toEqual([
      "GET /v1/trollbox/messages?room=webapp&limit=1",
      "GET /v1/runtime/transport/stream?room=webapp",
    ]);

    const publicRequests = harness.requests.filter((request) => request.pathname.startsWith("/v1/") && !request.pathname.startsWith("/v1/agent/"));
    for (const request of publicRequests) {
      expect(request.headers["x-siwa-receipt"]).toBeUndefined();
      expect(request.headers["signature-input"]).toBeUndefined();
      expect(request.headers["signature"]).toBeUndefined();
    }
  });

  it("uses the authenticated agent trollbox and transport contracts", async () => {
    await expect(harness.client.listTrollboxMessages({ room: "agent", limit: 1 })).resolves.toMatchObject({
      data: [expect.objectContaining({ body: "Existing trollbox message" })],
      next_cursor: null,
    });

    await expect(
      harness.client.createAgentTrollboxMessage({
        body: "Posted from Regent",
        room: "agent",
        client_message_id: "client-1",
      }),
    ).resolves.toMatchObject({
      data: expect.objectContaining({ body: "Posted from Regent" }),
    });

    await expect(harness.client.transportStatus()).resolves.toEqual({
      data: {
        enabled: true,
        configured: true,
        connected: true,
        subscribedTopics: ["public-trollbox"],
        peerCount: 2,
        lastError: null,
        eventSocketPath: null,
        status: "ready",
        note: "Backend mesh mode: libp2p",
        mode: "libp2p",
        ready: true,
      },
    });

    const streamed: unknown[] = [];
    await harness.client.streamTrollbox("agent", (payload) => streamed.push(payload), new AbortController().signal);

    expect(streamed).toEqual([
      expect.objectContaining({
        event: "message.created",
        message: expect.objectContaining({ body: "Streamed trollbox event" }),
      }),
      expect.objectContaining({
        event: "heartbeat",
      }),
    ]);

    const requestPaths = harness.requests.map((request) => `${request.method} ${request.pathname}${request.search}`);
    expect(requestPaths).toEqual([
      "GET /v1/agent/trollbox/messages?room=agent&limit=1",
      "POST /v1/agent/trollbox/messages",
      "GET /v1/runtime/transport",
      "GET /v1/agent/runtime/transport/stream?room=agent",
    ]);

    const protectedRequests = harness.requests.filter((request) => request.pathname.startsWith("/v1/agent/"));
    for (const request of protectedRequests) {
      expect(request.headers["x-siwa-receipt"]).toBeTruthy();
      expect(request.headers["signature-input"]).toBeTruthy();
      expect(request.headers["signature"]).toBeTruthy();
      expect(request.headers["x-agent-wallet-address"]).toBe(TEST_WALLET);
      expect(request.headers["x-agent-chain-id"]).toBe("11155111");
      expect(request.headers["x-agent-registry-address"]).toBe(TEST_REGISTRY);
      expect(request.headers["x-agent-token-id"]).toBe("99");
    }
  });
});
