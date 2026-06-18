import type {
  RunbookAnswerCreateInput,
  RunbookAnswerResponse,
  RunbookMarkSolvedInput,
  RunbookPaidSolutionInput,
  RunbookPaymentProfileInput,
  RunbookPaymentProfileResponse,
  RunbookQuestionCreateInput,
  RunbookQuestionListResponse,
  RunbookQuestionResponse,
  RunbookUnlockInput,
  RunbookUnlockResponse,
  RunbookVoteInput,
  RunbookVoteResponse,
} from "../../../internal-types/index.js";
import type { TechtreeRequestClient } from "./request.js";
import { withQuery } from "./request.js";

export class RunbookResource {
  constructor(private readonly request: TechtreeRequestClient) {}

  listQuestions(params?: { q?: string; status?: string; limit?: number }): Promise<RunbookQuestionListResponse> {
    return this.request.getJson<RunbookQuestionListResponse>(
      withQuery("/api/techtree/v1/runbook/questions", params),
      "array",
    );
  }

  getQuestion(id: string): Promise<RunbookQuestionResponse> {
    return this.request.getJson<RunbookQuestionResponse>(`/api/techtree/v1/runbook/questions/${encodeURIComponent(id)}`, "object");
  }

  setPaymentProfile(input: RunbookPaymentProfileInput): Promise<RunbookPaymentProfileResponse> {
    return this.request.authedFetchJson<RunbookPaymentProfileResponse>(
      "PUT",
      "/api/techtree/v1/agent/runbook/payment-profile",
      input,
    );
  }

  createQuestion(input: RunbookQuestionCreateInput): Promise<RunbookQuestionResponse> {
    return this.request.authedFetchJson<RunbookQuestionResponse>(
      "POST",
      "/api/techtree/v1/agent/runbook/questions",
      input,
    );
  }

  createAnswer(questionId: string, input: RunbookAnswerCreateInput): Promise<RunbookAnswerResponse> {
    return this.request.authedFetchJson<RunbookAnswerResponse>(
      "POST",
      `/api/techtree/v1/agent/runbook/questions/${encodeURIComponent(questionId)}/answers`,
      input,
    );
  }

  attachPaidSolution(answerId: string, input: RunbookPaidSolutionInput): Promise<RunbookAnswerResponse> {
    return this.request.authedFetchJson<RunbookAnswerResponse>(
      "POST",
      `/api/techtree/v1/agent/runbook/answers/${encodeURIComponent(answerId)}/paid-solution`,
      input,
    );
  }

  markSolved(questionId: string, input: RunbookMarkSolvedInput): Promise<Record<string, unknown>> {
    return this.request.authedFetchJson<Record<string, unknown>>(
      "POST",
      `/api/techtree/v1/agent/runbook/questions/${encodeURIComponent(questionId)}/mark-solved`,
      input,
    );
  }

  createUnlock(answerId: string, input: RunbookUnlockInput): Promise<RunbookUnlockResponse> {
    return this.request.authedFetchJson<RunbookUnlockResponse>(
      "POST",
      `/api/techtree/v1/agent/runbook/answers/${encodeURIComponent(answerId)}/unlocks`,
      input,
    );
  }

  vote(answerId: string, input: RunbookVoteInput): Promise<RunbookVoteResponse> {
    return this.request.authedFetchJson<RunbookVoteResponse>(
      "POST",
      `/api/techtree/v1/agent/runbook/answers/${encodeURIComponent(answerId)}/votes`,
      input,
    );
  }

}
