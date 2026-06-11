import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig, writeInitialConfig } from "../../src/internal-runtime/config.js";
import { SessionStore } from "../../src/internal-runtime/store/session-store.js";
import { StateStore } from "../../src/internal-runtime/store/state-store.js";
import { TechtreeClient } from "../../src/internal-runtime/techtree/client.js";
import { writeFakeCdp } from "../support/fake-cdp.js";
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
  failPublicStream: () => void;
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
  let shouldFailPublicStream = false;

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

    if (req.method === "GET" && requestUrl.pathname === "/v1/chat/channels") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        `${JSON.stringify({
          data: [
            {
              scope: "system",
              kind: "channel",
              name: "System",
              status: "active",
              xmtp_group_id: null,
              last_message_at: "2026-03-10T00:00:00.000Z",
            },
            {
              scope: "node:42",
              kind: "node_room",
              name: "Node 42",
              status: "active",
              xmtp_group_id: "xmtp-group-42",
              last_message_at: null,
            },
          ],
        })}\n`,
      );
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/v1/chat/system/messages") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        `${JSON.stringify({
          data: [
            {
              id: 10,
              scope: "system",
              body: "Existing public chat message",
            },
          ],
          pagination: { limit: 1, next_cursor: null },
        })}\n`,
      );
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/v1/chat/topic%3Aprotein-folding/messages") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        `${JSON.stringify({
          data: [
            {
              id: 11,
              scope: "topic:protein-folding",
              body: "Existing topic chat message",
            },
          ],
          pagination: { limit: 1, next_cursor: null },
        })}\n`,
      );
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/v1/agent/chat/system/messages") {
      if (!requireAgentHeaders()) {
        return;
      }

      res.statusCode = 201;
      res.setHeader("content-type", "application/json");
      res.end(
        `${JSON.stringify({
          data: {
            id: 2,
            scope: "system",
            body: body && typeof body === "object" ? (body as { body?: string }).body ?? "" : "",
            client_message_id:
              body && typeof body === "object" ? (body as { client_message_id?: string }).client_message_id ?? null : null,
          },
        })}\n`,
      );
      return;
    }

    if (req.method === "POST" && requestUrl.pathname === "/v1/agent/chat/node/42/membership") {
      if (!requireAgentHeaders()) {
        return;
      }

      res.statusCode = 202;
      res.setHeader("content-type", "application/json");
      res.end(
        `${JSON.stringify({
          data: {
            scope: "node:42",
            status: "pending",
            xmtp_group_id: "xmtp-group-42",
          },
        })}\n`,
      );
      return;
    }

    if (req.method === "GET" && requestUrl.pathname === "/v1/chat/stream") {
      if (shouldFailPublicStream) {
        res.statusCode = 503;
        res.setHeader("content-type", "application/json");
        res.end(`${JSON.stringify({ error: { code: "stream_unavailable", message: "stream unavailable" } })}\n`);
        return;
      }

      res.statusCode = 200;
      res.setHeader("content-type", "application/x-ndjson");
      res.write(
        `${JSON.stringify({
          event: "message.created",
          message: {
            id: 11,
            scope: requestUrl.searchParams.get("scope") ?? "system",
            body: "Streaming public chat event",
          },
        })}\n`,
      );

      const timer = setTimeout(() => {
        if (!res.writableEnded) {
          res.end(`${JSON.stringify({ event: "heartbeat", scope: requestUrl.searchParams.get("scope") ?? "system" })}\n`);
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
            subscriptions: ["public-chat"],
            last_error: null,
            local_peer_id: "peer-local",
            origin_node_id: "node-1",
          },
        })}\n`,
      );
      return;
    }

    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(`${JSON.stringify({ error: { code: "route_not_found" } })}\n`);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-chat-client-"));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const configPath = path.join(tempDir, "regent.config.json");
  writeInitialConfig(configPath, {
    runtime: {
      socketPath: path.join(tempDir, "runtime", "regent.sock"),
      stateDir: path.join(tempDir, "state"),
      logLevel: "debug",
    },
    auth: {
      audience: "techtree",
      defaultChainId: 8453,
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
  sessionStore.setSiwaSession({
    walletAddress: TEST_WALLET,
    chainId: 8453,
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
      chainId: 8453,
      registryAddress: TEST_REGISTRY,
      tokenId: "99",
    },
  });

  const client = new TechtreeClient({
    config,
    baseUrl,
    requestTimeoutMs: 1_000,
    sessionStore,
    walletSecretSource: new StaticWalletSecretSource(),
    stateStore,
  });

  return {
    client,
    requests,
    failPublicStream: () => {
      shouldFailPublicStream = true;
    },
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

describe("Techtree chat client routes", () => {
  let harness: ClientHarness;
  let originalPath: string | undefined;
  let originalKeyId: string | undefined;
  let originalKeySecret: string | undefined;
  let originalWalletSecret: string | undefined;
  let tempHome = "";

  beforeEach(async () => {
    originalPath = process.env.PATH;
    originalKeyId = process.env.CDP_KEY_ID;
    originalKeySecret = process.env.CDP_KEY_SECRET;
    originalWalletSecret = process.env.CDP_WALLET_SECRET;
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "regent-chat-home-"));
    process.env.PATH = `${writeFakeCdp(tempHome, {
      accounts: [{ name: "main", address: TEST_WALLET }],
    })}:${originalPath ?? ""}`;
    process.env.CDP_KEY_ID = "test-key";
    process.env.CDP_KEY_SECRET = "test-secret";
    process.env.CDP_WALLET_SECRET = "test-wallet-secret";
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.stop();
    process.env.PATH = originalPath;
    process.env.CDP_KEY_ID = originalKeyId;
    process.env.CDP_KEY_SECRET = originalKeySecret;
    process.env.CDP_WALLET_SECRET = originalWalletSecret;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("uses the public chat contract and emits stream events before the response closes", async () => {
    await expect(harness.client.listChatChannels()).resolves.toMatchObject({
      data: [
        expect.objectContaining({ scope: "system", kind: "channel" }),
        expect.objectContaining({ scope: "node:42", kind: "node_room", xmtp_group_id: "xmtp-group-42" }),
      ],
    });

    await expect(harness.client.listChatMessages("system", { limit: 1 })).resolves.toMatchObject({
      data: [expect.objectContaining({ body: "Existing public chat message" })],
      pagination: { limit: 1, next_cursor: null },
    });

    const streamed: unknown[] = [];
    const controller = new AbortController();
    let streamFinished = false;

    const streamPromise = harness.client
      .streamChat("system", (payload) => streamed.push(payload), controller.signal)
      .then(() => {
        streamFinished = true;
      });

    await expect
      .poll(() => streamed.length)
      .toBeGreaterThanOrEqual(1);

    expect(streamed[0]).toEqual(
      expect.objectContaining({
        event: "message.created",
        message: expect.objectContaining({ body: "Streaming public chat event" }),
      }),
    );
    expect(streamFinished).toBe(false);

    controller.abort();
    await streamPromise;

    const requestPaths = harness.requests.map((request) => `${request.method} ${request.pathname}${request.search}`);
    expect(requestPaths).toEqual([
      "GET /v1/chat/channels",
      "GET /v1/chat/system/messages?limit=1",
      "GET /v1/chat/stream?scope=system",
    ]);

    for (const request of harness.requests) {
      expect(request.headers["x-siwa-receipt"]).toBeUndefined();
      expect(request.headers["signature-input"]).toBeUndefined();
      expect(request.headers["signature"]).toBeUndefined();
    }
  });

  it("url-encodes scope path segments for public reads", async () => {
    await expect(harness.client.listChatMessages("topic:protein-folding", { limit: 1 })).resolves.toMatchObject({
      data: [expect.objectContaining({ body: "Existing topic chat message" })],
    });

    expect(harness.requests.map((request) => `${request.method} ${request.pathname}`)).toEqual([
      "GET /v1/chat/topic%3Aprotein-folding/messages",
    ]);
  });

  it("uses the authenticated agent chat and membership contracts", async () => {
    await expect(
      harness.client.createAgentChatMessage("system", {
        body: "Posted from Regent",
        client_message_id: "client-1",
      }),
    ).resolves.toMatchObject({
      data: expect.objectContaining({ body: "Posted from Regent" }),
    });

    await expect(harness.client.requestNodeRoomMembership(42, { xmtp_inbox_id: "inbox-1" })).resolves.toEqual({
      data: {
        scope: "node:42",
        status: "pending",
        xmtp_group_id: "xmtp-group-42",
      },
    });

    await expect(harness.client.transportStatus()).resolves.toEqual({
      data: {
        enabled: true,
        configured: true,
        connected: true,
        subscribedTopics: ["public-chat"],
        peerCount: 2,
        lastError: null,
        eventSocketPath: null,
        status: "ready",
        note: "Backend mesh mode: libp2p",
        mode: "libp2p",
        ready: true,
      },
    });

    const requestPaths = harness.requests.map((request) => `${request.method} ${request.pathname}${request.search}`);
    expect(requestPaths).toEqual([
      "POST /v1/agent/chat/system/messages",
      "POST /v1/agent/chat/node/42/membership",
      "GET /v1/runtime/transport",
    ]);

    const membershipRequest = harness.requests[1];
    expect(membershipRequest?.body).toEqual({ xmtp_inbox_id: "inbox-1" });

    const protectedRequests = harness.requests.filter((request) => request.pathname.startsWith("/v1/agent/"));
    for (const request of protectedRequests) {
      expect(request.headers["x-siwa-receipt"]).toBeTruthy();
      expect(request.headers["signature-input"]).toBeTruthy();
      expect(request.headers["signature"]).toBeTruthy();
      expect(request.headers["x-agent-wallet-address"]).toBe(TEST_WALLET);
      expect(request.headers["x-agent-chain-id"]).toBe("8453");
      expect(request.headers["x-agent-registry-address"]).toBe(TEST_REGISTRY);
      expect(request.headers["x-agent-token-id"]).toBe("99");
    }
  });

  it("reports public stream failures", async () => {
    harness.failPublicStream();

    await expect(
      harness.client.streamChat("system", () => undefined, new AbortController().signal),
    ).rejects.toThrow("stream unavailable");
  });
});
