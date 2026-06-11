import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatLiveEvent } from "../../src/internal-types/index.js";

import { RegentError } from "../../src/internal-runtime/errors.js";
import { PublicChatRelayAdapter } from "../../src/internal-runtime/transports/gossipsub-adapter.js";
import {
  resolveChatRelaySocketPath,
  ChatRelaySocketServer,
} from "../../src/internal-runtime/transports/chat-relay-socket.js";
import { resolveWatchedNodeRelaySocketPath } from "../../src/internal-runtime/transports/watched-node-relay-socket.js";

const TEST_EVENT: ChatLiveEvent = {
  event: "message.created",
  message: {
    id: 77,
    scope: "system",
    body: "relay hello",
  },
};

describe("gossipsub relay adapter", () => {
  const tempArtifacts: string[] = [];

  afterEach(() => {
    for (const artifact of tempArtifacts.splice(0)) {
      fs.rmSync(artifact, { recursive: true, force: true });
    }
  });

  it("returns disabled status and rejects subscriptions when the relay is off", async () => {
    const adapter = new PublicChatRelayAdapter(
      {
        enabled: false,
        listenAddrs: [],
        bootstrap: [],
        peerIdPath: "/tmp/regent-disabled-peer-id.json",
      },
      {
        transportStatus: vi.fn(),
        streamChat: vi.fn(),
      } as never,
      "/tmp/regent-disabled.chat.sock",
    );

    await adapter.start();
    await expect(adapter.status()).resolves.toEqual({
      enabled: false,
      configured: false,
      connected: false,
      subscribedTopics: [],
      peerCount: 0,
      lastError: null,
      eventSocketPath: null,
      status: "disabled",
      note: "Chat transport disabled",
    });

    await expect(adapter.subscribeChat(() => undefined)).rejects.toMatchObject(
      new RegentError("chat_relay_disabled", "chat transport is disabled in config"),
    );
  });

  it("refreshes transport status and streams relay events to subscribers", async () => {
    const transportStatus = vi.fn(async () => ({
      data: {
        enabled: true,
        configured: true,
        connected: true,
        subscribedTopics: ["public-chat"],
        peerCount: 2,
        lastError: null,
        status: "ready" as const,
        note: "Backend mesh mode: libp2p",
        mode: "libp2p" as const,
        ready: true,
      },
    }));
    const streamChat = vi.fn(
      async (_scopes: readonly string[], onEvent: (payload: unknown) => void, signal: AbortSignal) => {
        onEvent(TEST_EVENT);
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
    const adapter = new PublicChatRelayAdapter(
      {
        enabled: true,
        listenAddrs: [],
        bootstrap: [],
        peerIdPath: "/tmp/regent-enabled-peer-id.json",
      },
      {
        transportStatus,
        streamChat,
      } as never,
      "/tmp/regent-enabled.chat.sock",
    );

    await adapter.start();

    await expect(adapter.status()).resolves.toMatchObject({
      enabled: true,
      configured: true,
      connected: true,
      subscribedTopics: ["public-chat"],
      peerCount: 2,
      eventSocketPath: "/tmp/regent-enabled.chat.sock",
      status: "ready",
      note: "Backend mesh mode: libp2p",
      mode: "libp2p",
      ready: true,
    });

    const receivedEvents: ChatLiveEvent[] = [];
    const dispose = await adapter.subscribeChat((event) => receivedEvents.push(event));

    await vi.waitFor(() => {
      expect(receivedEvents).toEqual([TEST_EVENT]);
    });

    expect(streamChat).toHaveBeenCalledWith(["system"], expect.any(Function), expect.any(AbortSignal));

    await dispose();
    await expect(adapter.status()).resolves.toMatchObject({
      status: "ready",
      connected: true,
    });
  });

  it("subscribes with explicit scopes", async () => {
    const streamChat = vi.fn(
      async (_scopes: readonly string[], _onEvent: (payload: unknown) => void, signal: AbortSignal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
    const adapter = new PublicChatRelayAdapter(
      {
        enabled: true,
        listenAddrs: [],
        bootstrap: [],
        peerIdPath: "/tmp/regent-scoped-peer-id.json",
      },
      {
        transportStatus: vi.fn(),
        streamChat,
      } as never,
      "/tmp/regent-scoped.chat.sock",
    );

    const dispose = await adapter.subscribeChat(() => undefined, ["node:42", "topic:protein-folding"]);
    await vi.waitFor(() => {
      expect(streamChat).toHaveBeenCalledWith(
        ["node:42", "topic:protein-folding"],
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });
    await dispose();
  });

  it("writes relay events to the chat event socket", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-gossipsub-socket-"));
    tempArtifacts.push(tempDir);

    let listener: ((event: ChatLiveEvent) => void) | null = null;
    const unsubscribe = vi.fn(async () => undefined);
    const adapter = {
      subscribeChat: vi.fn(async (nextListener: (event: ChatLiveEvent) => void) => {
        listener = nextListener;
        return unsubscribe;
      }),
    };

    const server = new ChatRelaySocketServer(path.join(tempDir, "regent.sock"), adapter as never);
    await server.start();

    const received = await new Promise<ChatLiveEvent>((resolve, reject) => {
      const socket = net.createConnection(server.socketPath);
      let buffer = "";

      socket.setEncoding("utf8");
      socket.on("connect", () => {
        socket.write(`${JSON.stringify({ scopes: ["system"] })}\n`);
        setTimeout(() => {
          if (!listener) {
            reject(new Error("listener was not registered"));
            return;
          }

          listener(TEST_EVENT);
        }, 100);
      });
      socket.on("data", (chunk) => {
        buffer += chunk;
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        socket.end();
        resolve(JSON.parse(line) as ChatLiveEvent);
      });
      socket.on("error", reject);
    });

    expect(received).toEqual(TEST_EVENT);
    await vi.waitFor(() => {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    await server.stop();
  });

  it("forwards the requested scopes from the socket subscription line", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-gossipsub-scope-"));
    tempArtifacts.push(tempDir);

    const unsubscribe = vi.fn(async () => undefined);
    const subscribeChat = vi.fn(async () => unsubscribe);
    const server = new ChatRelaySocketServer(
      path.join(tempDir, "regent.sock"),
      { subscribeChat } as never,
    );
    await server.start();

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(server.socketPath);
      socket.setEncoding("utf8");
      socket.on("connect", () => {
        socket.write(`${JSON.stringify({ scopes: ["topic:protein-folding", "node:42"] })}\n`);
        setTimeout(() => {
          socket.end();
          resolve();
        }, 50);
      });
      socket.on("error", reject);
    });

    await vi.waitFor(() => {
      expect(subscribeChat).toHaveBeenCalledWith(expect.any(Function), ["topic:protein-folding", "node:42"]);
    });

    await server.stop();
  });

  it("falls back to short /tmp relay socket paths when runtime path is too long", () => {
    const veryLongRuntimeSocketPath = `/tmp/${"regent-long-runtime-path-".repeat(8)}.sock`;
    const chatPath = resolveChatRelaySocketPath(veryLongRuntimeSocketPath);
    const watchPath = resolveWatchedNodeRelaySocketPath(veryLongRuntimeSocketPath);

    expect(chatPath.startsWith("/tmp/regent-")).toBe(true);
    expect(chatPath.endsWith(".chat.sock")).toBe(true);
    expect(Buffer.byteLength(chatPath, "utf8")).toBeLessThanOrEqual(100);

    expect(watchPath.startsWith("/tmp/regent-")).toBe(true);
    expect(watchPath.endsWith(".watch.sock")).toBe(true);
    expect(Buffer.byteLength(watchPath, "utf8")).toBeLessThanOrEqual(100);
  });
});
