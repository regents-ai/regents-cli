import type {
  HeartbeatScheduleResponse,
  HeartbeatWakeupCompleteInput,
  HeartbeatWakeupListResponse,
  HeartbeatWakeupResponse,
  HeartbeatWakeupStartInput,
} from "../../../internal-types/index.js";
import type { TechtreeRequestClient } from "./request.js";
import { withQuery } from "./request.js";

export class HeartbeatsResource {
  constructor(private readonly request: TechtreeRequestClient) {}

  schedule(): Promise<HeartbeatScheduleResponse> {
    return this.request.authedFetchJson<HeartbeatScheduleResponse>(
      "GET",
      "/api/techtree/v1/agent/heartbeats/schedule",
    );
  }

  listWakeups(params?: { cursor?: number; limit?: number }): Promise<HeartbeatWakeupListResponse> {
    return this.request.authedFetchJson<HeartbeatWakeupListResponse>(
      "GET",
      withQuery("/api/techtree/v1/agent/heartbeats/wakeups", params),
    );
  }

  startWakeup(input: HeartbeatWakeupStartInput): Promise<HeartbeatWakeupResponse> {
    return this.request.authedFetchJson<HeartbeatWakeupResponse>(
      "POST",
      "/api/techtree/v1/agent/heartbeats/wakeups",
      input,
    );
  }

  completeWakeup(
    id: number,
    input: HeartbeatWakeupCompleteInput,
  ): Promise<HeartbeatWakeupResponse> {
    return this.request.authedFetchJson<HeartbeatWakeupResponse>(
      "PATCH",
      `/api/techtree/v1/agent/heartbeats/wakeups/${id}/complete`,
      input,
    );
  }
}
