import type {
  AutoskillBundleAccessResponse,
  AutoskillCreateEvalResponse,
  AutoskillCreateListingResponse,
  AutoskillCreateResultResponse,
  AutoskillCreateReviewResponse,
  AutoskillCreateSkillResponse,
  AutoskillEvalPublishInput,
  AutoskillListingCreateInput,
  AutoskillResultPublishInput,
  AutoskillReview,
  AutoskillReviewCreateInput,
  AutoskillSkillPublishInput,
  AutoskillVersionSummary,
} from "../../../internal-types/index.js";
import type { TechtreeRequestClient } from "./request.js";

export class AutoskillResource {
  constructor(private readonly request: TechtreeRequestClient) {}

  async listAutoskillSkillVersions(slug: string): Promise<{ data: AutoskillVersionSummary[] }> {
    return this.request.getJson<{ data: AutoskillVersionSummary[] }>(
      `/api/techtree/v1/autoskill/skills/${encodeURIComponent(slug)}/versions`,
      "array",
    );
  }

  async listAutoskillEvalVersions(slug: string): Promise<{ data: AutoskillVersionSummary[] }> {
    return this.request.getJson<{ data: AutoskillVersionSummary[] }>(
      `/api/techtree/v1/autoskill/evals/${encodeURIComponent(slug)}/versions`,
      "array",
    );
  }

  async listAutoskillReviews(nodeId: number): Promise<{ data: AutoskillReview[] }> {
    return this.request.getJson<{ data: AutoskillReview[] }>(
      `/api/techtree/v1/autoskill/versions/${nodeId}/reviews`,
      "array",
    );
  }

  async getAutoskillBundle(
    nodeId: number,
  ): Promise<AutoskillBundleAccessResponse> {
    return this.request.authedFetchJson<AutoskillBundleAccessResponse>(
      "GET",
      `/api/techtree/v1/agent/autoskill/versions/${nodeId}/bundle`,
    );
  }

  async createAutoskillSkill(input: AutoskillSkillPublishInput): Promise<AutoskillCreateSkillResponse> {
    return this.request.authedFetchJson<AutoskillCreateSkillResponse>("POST", "/api/techtree/v1/agent/autoskill/skills", input);
  }

  async createAutoskillEval(input: AutoskillEvalPublishInput): Promise<AutoskillCreateEvalResponse> {
    return this.request.authedFetchJson<AutoskillCreateEvalResponse>("POST", "/api/techtree/v1/agent/autoskill/evals", input);
  }

  async publishAutoskillResult(input: AutoskillResultPublishInput): Promise<AutoskillCreateResultResponse> {
    return this.request.authedFetchJson<AutoskillCreateResultResponse>("POST", "/api/techtree/v1/agent/autoskill/results", input);
  }

  async createAutoskillReview(input: AutoskillReviewCreateInput): Promise<AutoskillCreateReviewResponse> {
    const route =
      input.kind === "replicable"
        ? "/api/techtree/v1/agent/autoskill/reviews/replicable"
        : "/api/techtree/v1/agent/autoskill/reviews/community";

    return this.request.authedFetchJson<AutoskillCreateReviewResponse>("POST", route, input);
  }

  async createAutoskillListing(input: AutoskillListingCreateInput): Promise<AutoskillCreateListingResponse> {
    return this.request.authedFetchJson<AutoskillCreateListingResponse>(
      "POST",
      `/api/techtree/v1/agent/autoskill/versions/${input.skill_node_id}/listings`,
      input,
    );
  }
}
