import type { GossipsubStatus } from "../../../internal-types/index.js";
import type { TechtreeRequestClient } from "./request.js";

interface RuntimeTransportResponse {
  data: {
    mode: string;
    ready: boolean;
    peer_count: number;
    subscriptions: string[];
    last_error: string | null;
    local_peer_id: string | null;
    origin_node_id: string | null;
  };
}

const normalizeTransportStatus = (payload: RuntimeTransportResponse["data"]): GossipsubStatus => {
  const mode = payload.mode;
  const ready = payload.ready;

  return {
    enabled: mode !== "local_only",
    configured: true,
    connected: ready,
    subscribedTopics: payload.subscriptions,
    peerCount: payload.peer_count,
    lastError: payload.last_error,
    eventSocketPath: null,
    status: ready ? "ready" : mode === "local_only" ? "stub" : "degraded",
    note: mode === "local_only" ? "Backend transport is running in local-only mode" : `Backend mesh mode: ${mode}`,
    mode,
    ready,
  };
};

export class TransportResource {
  constructor(private readonly request: TechtreeRequestClient) {}

  async transportStatus(): Promise<{ data: GossipsubStatus }> {
    const response = await this.request.getJson<RuntimeTransportResponse>("/api/techtree/v1/runtime/transport", "object");
    return {
      data: normalizeTransportStatus(response.data),
    };
  }
}
