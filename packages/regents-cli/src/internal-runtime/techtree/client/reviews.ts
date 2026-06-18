import type {
  BbhReviewerApplyRequest,
  BbhReviewerApplyResponse,
  BbhReviewerOrcidLinkResponse,
  BbhReviewerStatusResponse,
  BbhReviewListParams,
  BbhReviewListResponse,
  BbhReviewPacketResponse,
  BbhReviewRequest,
  BbhReviewSubmitRequest,
  BbhReviewSubmitResponse,
} from "../../../internal-types/index.js";
import type { TechtreeRequestClient } from "./request.js";
import { withQuery } from "./request.js";

export class ReviewsResource {
  constructor(private readonly request: TechtreeRequestClient) {}

  async startReviewerOrcidLink(): Promise<BbhReviewerOrcidLinkResponse> {
    return this.request.authedFetchJson<BbhReviewerOrcidLinkResponse>("POST", "/api/techtree/v1/agent/reviewer/orcid/link/start", {});
  }

  async getReviewerOrcidLinkStatus(requestId: string): Promise<BbhReviewerOrcidLinkResponse> {
    return this.request.authedFetchJson<BbhReviewerOrcidLinkResponse>(
      "GET",
      `/api/techtree/v1/agent/reviewer/orcid/link/status/${encodeURIComponent(requestId)}`,
    );
  }

  async applyReviewerProfile(input: BbhReviewerApplyRequest): Promise<BbhReviewerApplyResponse> {
    return this.request.authedFetchJson<BbhReviewerApplyResponse>("POST", "/api/techtree/v1/agent/reviewer/apply", input);
  }

  async getReviewerProfile(): Promise<BbhReviewerStatusResponse> {
    return this.request.authedFetchJson<BbhReviewerStatusResponse>("GET", "/api/techtree/v1/agent/reviewer/me");
  }

  async listBbhReviews(params?: BbhReviewListParams): Promise<BbhReviewListResponse> {
    return this.request.authedFetchJson<BbhReviewListResponse>("GET", withQuery("/api/techtree/v1/agent/reviews/open", {
      ...(params?.kind ? { kind: params.kind } : {}),
    }));
  }

  async claimBbhReview(requestId: string): Promise<{ data: BbhReviewRequest }> {
    return this.request.authedFetchJson("POST", `/api/techtree/v1/agent/reviews/${encodeURIComponent(requestId)}/claim`, {});
  }

  async getBbhReviewPacket(requestId: string): Promise<BbhReviewPacketResponse> {
    return this.request.authedFetchJson<BbhReviewPacketResponse>(
      "GET",
      `/api/techtree/v1/agent/reviews/${encodeURIComponent(requestId)}/packet`,
    );
  }

  async submitBbhReview(requestId: string, input: BbhReviewSubmitRequest): Promise<BbhReviewSubmitResponse> {
    return this.request.authedFetchJson<BbhReviewSubmitResponse>(
      "POST",
      `/api/techtree/v1/agent/reviews/${encodeURIComponent(requestId)}/submit`,
      input,
    );
  }
}
