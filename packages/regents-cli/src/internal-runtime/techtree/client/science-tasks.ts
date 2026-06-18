import type {
  ScienceTaskChecklistUpdateInput,
  ScienceTaskCreateInput,
  ScienceTaskDetailResponse,
  ScienceTaskEvidenceUpdateInput,
  ScienceTaskListResponse,
  ScienceTaskMutationResponse,
  ScienceTaskReviewUpdateInput,
  ScienceTaskSubmitInput,
} from "../../../internal-types/index.js";
import type { TechtreeRequestClient } from "./request.js";
import { withQuery } from "./request.js";

export class ScienceTasksResource {
  constructor(private readonly request: TechtreeRequestClient) {}

  async listScienceTasks(params?: {
    limit?: number;
    stage?: string;
    science_domain?: string;
    science_field?: string;
  }): Promise<ScienceTaskListResponse> {
    return this.request.getJson<ScienceTaskListResponse>(withQuery("/api/techtree/v1/science-tasks", params), "array");
  }

  async getScienceTask(id: number): Promise<ScienceTaskDetailResponse> {
    return this.request.getJson<ScienceTaskDetailResponse>(`/api/techtree/v1/science-tasks/${id}`, "object");
  }

  async createScienceTask(input: ScienceTaskCreateInput): Promise<ScienceTaskMutationResponse> {
    return this.request.authedFetchJson<ScienceTaskMutationResponse>("POST", "/api/techtree/v1/agent/science-tasks", input);
  }

  async updateScienceTaskChecklist(
    id: number,
    input: ScienceTaskChecklistUpdateInput,
  ): Promise<ScienceTaskMutationResponse> {
    return this.request.authedFetchJson<ScienceTaskMutationResponse>(
      "POST",
      `/api/techtree/v1/agent/science-tasks/${id}/checklist`,
      input,
    );
  }

  async updateScienceTaskEvidence(
    id: number,
    input: ScienceTaskEvidenceUpdateInput,
  ): Promise<ScienceTaskMutationResponse> {
    return this.request.authedFetchJson<ScienceTaskMutationResponse>(
      "POST",
      `/api/techtree/v1/agent/science-tasks/${id}/evidence`,
      input,
    );
  }

  async submitScienceTask(id: number, input: ScienceTaskSubmitInput): Promise<ScienceTaskMutationResponse> {
    return this.request.authedFetchJson<ScienceTaskMutationResponse>(
      "POST",
      `/api/techtree/v1/agent/science-tasks/${id}/submit`,
      input,
    );
  }

  async reviewUpdateScienceTask(
    id: number,
    input: ScienceTaskReviewUpdateInput,
  ): Promise<ScienceTaskMutationResponse> {
    return this.request.authedFetchJson<ScienceTaskMutationResponse>(
      "POST",
      `/api/techtree/v1/agent/science-tasks/${id}/review-update`,
      input,
    );
  }
}
