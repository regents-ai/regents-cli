import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { TrollboxLiveEvent } from "../../src/internal-types/index.js";

import { RegentError } from "../../src/internal-runtime/errors.js";
import { PublicTrollboxRelayAdapter } from "../../src/internal-runtime/transports/gossipsub-adapter.js";
import {
  resolveTrollboxRelaySocketPath,
  TrollboxRelaySocketServer,
} from "../../src/internal-runtime/transports/trollbox-relay-socket.js";
import { resolveWatchedNodeRelaySocketPath } from "../../src/internal-runtime/transports/watched-node-relay-socket.js";

const TEST_EVENT: TrollboxLiveEvent = {
  event: "message.created",
  message: {
    id: 77,
    room_id: "public-trollbox",
    transport_msg_id: "transport-77",
    transport_topic: "global",
    origin_peer_id: "peer-1",
    origin_node_id: null,
    author_kind: "agent",
    author_human_id: null,
    author_agent_id: 1,
    author_display_name: null,
    author_label: "Relay agent",
    author_wallet_address: "0x1111111111111111111111111111111111111111",
    author_transport_id: "peer-1",
    body: "relay hello",
    client_message_id: null,
    reply_to_message_id: null,
    reply_to_transport_msg_id: null,
    reactions: {},
    moderation_state: "visible",
    sent_at: "2026-03-10T00:00:00.000Z",
    inserted_at: "2026-03-10T00:00:00.000Z",
    updated_at: "2026-03-10T00:00:00.000Z",
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
    const adapter = new PublicTrollboxRelayAdapter(
      {
        enabled: false,
        listenAddrs: [],
        bootstrap: [],
        peerIdPath: "/tmp/regent-disabled-peer-id.json",
      },
      {
        transportStatus: vi.fn(),
        streamTrollbox: vi.fn(),
      } as never,
      "/tmp/regent-disabled.trollbox.sock",
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
      note: "Trollbox transport disabled",
    });

    await expect(adapter.subscribeTrollbox(() => undefined)).rejects.toMatchObject(
      new RegentError("trollbox_relay_disabled", "trollbox transport is disabled in config"),
    );
  });

  it("refreshes transport status and streams relay events to subscribers", async () => {
    const transportStatus = vi.fn(async () => ({
      data: {
        enabled: true,
        configured: true,
        connected: true,
        subscribedTopics: ["public-trollbox"],
        peerCount: 2,
        lastError: null,
        status: "ready" as const,
        note: "Backend mesh mode: libp2p",
        mode: "libp2p" as const,
        ready: true,
      },
    }));
    const streamTrollbox = vi.fn(
      async (_room: "webapp" | "agent", onEvent: (payload: unknown) => void, signal: AbortSignal) => {
        onEvent(TEST_EVENT);
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
    const adapter = new PublicTrollboxRelayAdapter(
      {
        enabled: true,
        listenAddrs: [],
        bootstrap: [],
        peerIdPath: "/tmp/regent-enabled-peer-id.json",
      },
      {
        transportStatus,
        streamTrollbox,
      } as never,
      "/tmp/regent-enabled.trollbox.sock",
    );

    await adapter.start();

    await expect(adapter.status()).resolves.toMatchObject({
      enabled: true,
      configured: true,
      connected: true,
      subscribedTopics: ["public-trollbox"],
      peerCount: 2,
      eventSocketPath: "/tmp/regent-enabled.trollbox.sock",
      status: "ready",
      note: "Backend mesh mode: libp2p",
      mode: "libp2p",
      ready: true,
    });

    const receivedEvents: TrollboxLiveEvent[] = [];
    const dispose = await adapter.subscribeTrollbox((event) => receivedEvents.push(event));

    await vi.waitFor(() => {
      expect(receivedEvents).toEqual([TEST_EVENT]);
    });

    expect(streamTrollbox).toHaveBeenCalledWith("webapp", expect.any(Function), expect.any(AbortSignal));

    await dispose();
    await expect(adapter.status()).resolves.toMatchObject({
      status: "ready",
      connected: true,
    });
  });

  it("writes relay events to the trollbox event socket", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-gossipsub-socket-"));
    tempArtifacts.push(tempDir);

    let listener: ((event: TrollboxLiveEvent) => void) | null = null;
    const unsubscribe = vi.fn(async () => undefined);
    const adapter = {
      subscribeTrollbox: vi.fn(async (nextListener: (event: TrollboxLiveEvent) => void) => {
        listener = nextListener;
        return unsubscribe;
      }),
    };

    const server = new TrollboxRelaySocketServer(path.join(tempDir, "regent.sock"), adapter as never);
    await server.start();

    const received = await new Promise<TrollboxLiveEvent>((resolve, reject) => {
      const socket = net.createConnection(server.socketPath);
      let buffer = "";

      socket.setEncoding("utf8");
      socket.on("connect", () => {
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
        resolve(JSON.parse(line) as TrollboxLiveEvent);
      });
      socket.on("error", reject);
    });

    expect(received).toEqual(TEST_EVENT);
    await vi.waitFor(() => {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    await server.stop();
  });

  it("falls back to short /tmp relay socket paths when runtime path is too long", () => {
    const veryLongRuntimeSocketPath = `/tmp/${"regent-long-runtime-path-".repeat(8)}.sock`;
    const trollboxPath = resolveTrollboxRelaySocketPath(veryLongRuntimeSocketPath);
    const watchPath = resolveWatchedNodeRelaySocketPath(veryLongRuntimeSocketPath);

    expect(trollboxPath.startsWith("/tmp/regent-")).toBe(true);
    expect(trollboxPath.endsWith(".trollbox.sock")).toBe(true);
    expect(Buffer.byteLength(trollboxPath, "utf8")).toBeLessThanOrEqual(100);

    expect(watchPath.startsWith("/tmp/regent-")).toBe(true);
    expect(watchPath.endsWith(".watch.sock")).toBe(true);
    expect(Buffer.byteLength(watchPath, "utf8")).toBeLessThanOrEqual(100);
  });
});
