import type { GossipsubStatus, RegentConfig, ChatboxLiveEvent } from "../../internal-types/index.js";

import { RegentError, errorMessage } from "../errors.js";
import type { TechtreeClient } from "../techtree/client.js";
import type { TransportAdapter } from "./transport-adapter.js";

type ChatboxListener = (event: ChatboxLiveEvent) => void;
type ChatboxRoom = "webapp" | "agent";

export interface GossipsubAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<GossipsubStatus>;
  subscribeChatbox(listener: ChatboxListener, room?: ChatboxRoom): Promise<() => void>;
}

const baseDisabledStatus = (eventSocketPath: string | null): GossipsubStatus => ({
  enabled: false,
  configured: false,
  connected: false,
  subscribedTopics: [],
  peerCount: 0,
  lastError: null,
  eventSocketPath,
  status: "disabled",
  note: "Chatbox transport disabled",
});

export class PublicChatboxRelayAdapter implements GossipsubAdapter, TransportAdapter {
  private readonly config: RegentConfig["gossipsub"];
  private readonly techtree: TechtreeClient;
  private readonly eventSocketPath: string;
  private currentStatus: GossipsubStatus;
  private readonly activeStreams = new Set<AbortController>();

  constructor(config: RegentConfig["gossipsub"], techtree: TechtreeClient, eventSocketPath: string) {
    this.config = config;
    this.techtree = techtree;
    this.eventSocketPath = eventSocketPath;
    this.currentStatus = this.baseStatus();
  }

  async start(): Promise<void> {
    this.currentStatus = this.baseStatus();
  }

  async stop(): Promise<void> {
    for (const controller of this.activeStreams) {
      controller.abort();
    }
    this.activeStreams.clear();
    this.currentStatus = this.baseStatus();
  }

  async status(): Promise<GossipsubStatus> {
    if (!this.config.enabled) {
      this.currentStatus = this.baseStatus();
      return this.currentStatus;
    }

    try {
      const payload = (await this.techtree.transportStatus()).data;
      this.currentStatus = {
        ...this.baseStatus(),
        ...payload,
        eventSocketPath: this.eventSocketPath,
      };
      return this.currentStatus;
    } catch (error) {
      this.currentStatus = {
        ...this.baseStatus(),
        enabled: true,
        configured: true,
        connected: false,
        status: "degraded",
        eventSocketPath: this.eventSocketPath,
        lastError: errorMessage(error),
        note: "Chatbox transport status could not be refreshed",
      };
      return this.currentStatus;
    }
  }

  async subscribeChatbox(listener: ChatboxListener, room: ChatboxRoom = "webapp"): Promise<() => void> {
    if (!this.config.enabled) {
      throw new RegentError("chatbox_relay_disabled", "chatbox transport is disabled in config");
    }

    const controller = new AbortController();
    this.activeStreams.add(controller);

    void (async () => {
      while (!controller.signal.aborted) {
        try {
          await this.techtree.streamChatbox(
            room,
            (payload: unknown) => {
              if (controller.signal.aborted) {
                return;
              }

              this.currentStatus = {
                ...this.currentStatus,
                connected: true,
                status: "ready",
                lastError: null,
                note: `Chatbox relay subscribed to ${room}`,
              };
              listener(payload as ChatboxLiveEvent);
            },
            controller.signal,
          );

          if (!controller.signal.aborted) {
            this.currentStatus = {
              ...this.currentStatus,
              connected: false,
              status: "degraded",
              note: "Chatbox relay stream ended; reconnecting",
            };
          }
        } catch (error: unknown) {
          if (!controller.signal.aborted) {
            this.currentStatus = {
              ...this.currentStatus,
              connected: false,
              status: "degraded",
              lastError: errorMessage(error),
              note: "Chatbox relay subscription failed; reconnecting",
            };
          }
        }

        if (!controller.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    })();

    return () => {
      controller.abort();
      this.activeStreams.delete(controller);
    };
  }

  private baseStatus(): GossipsubStatus {
    if (!this.config.enabled) {
      return baseDisabledStatus(null);
    }

    return {
      enabled: true,
      configured: true,
      connected: false,
      subscribedTopics: [],
      peerCount: 0,
      lastError: null,
      eventSocketPath: this.eventSocketPath,
      status: "starting",
      note: "Chatbox transport initialized",
    };
  }
}

export class StubGossipsubAdapter implements GossipsubAdapter {
  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async status(): Promise<GossipsubStatus> {
    return baseDisabledStatus(null);
  }

  async subscribeChatbox(): Promise<() => void> {
    throw new RegentError("chatbox_relay_disabled", "chatbox transport is disabled in config");
  }
}
