import type {
  TechtreeWorkKind,
  TechtreeWorkListResponse,
  TechtreeWorkResponse,
} from "../../../internal-types/index.js";
import type { TechtreeRequestClient } from "./request.js";
import { withQuery } from "./request.js";

const pathId = (value: string): string => encodeURIComponent(value);

export class WorkResource {
  constructor(private readonly request: TechtreeRequestClient) {}

  list(params?: { kind?: TechtreeWorkKind; limit?: number }): Promise<TechtreeWorkListResponse> {
    return this.request.getJson<TechtreeWorkListResponse>(withQuery("/api/techtree/v1/work", params), "array");
  }

  next(params?: { kind?: TechtreeWorkKind }): Promise<TechtreeWorkResponse> {
    return this.request.getJson<TechtreeWorkResponse>(withQuery("/api/techtree/v1/work/next", params), "object");
  }

  accept(workUnitId: string): Promise<TechtreeWorkResponse> {
    return this.request.authedFetchJson<TechtreeWorkResponse>("POST", `/api/techtree/v1/agent/work/${pathId(workUnitId)}/accept`, {});
  }
}
