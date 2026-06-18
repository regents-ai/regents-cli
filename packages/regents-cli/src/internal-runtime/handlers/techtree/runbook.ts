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
import type { RuntimeContext } from "../../runtime.js";

export async function handleTechtreeRunbookQuestionsList(
  ctx: RuntimeContext,
  params?: { q?: string; status?: string; limit?: number },
): Promise<RunbookQuestionListResponse> {
  return ctx.techtree.listRunbookQuestions(params);
}

export async function handleTechtreeRunbookQuestionsGet(
  ctx: RuntimeContext,
  params: { id: string },
): Promise<RunbookQuestionResponse> {
  return ctx.techtree.getRunbookQuestion(params.id);
}

export async function handleTechtreeRunbookPaymentAddressSet(
  ctx: RuntimeContext,
  params: RunbookPaymentProfileInput,
): Promise<RunbookPaymentProfileResponse> {
  return ctx.techtree.setRunbookPaymentProfile(params);
}

export async function handleTechtreeRunbookQuestionPost(
  ctx: RuntimeContext,
  params: RunbookQuestionCreateInput,
): Promise<RunbookQuestionResponse> {
  return ctx.techtree.createRunbookQuestion(params);
}

export async function handleTechtreeRunbookAnswerPost(
  ctx: RuntimeContext,
  params: { question_id: string; input: RunbookAnswerCreateInput },
): Promise<RunbookAnswerResponse> {
  return ctx.techtree.createRunbookAnswer(params.question_id, params.input);
}

export async function handleTechtreeRunbookAnswerAttachPaidSolution(
  ctx: RuntimeContext,
  params: { answer_id: string; input: RunbookPaidSolutionInput },
): Promise<RunbookAnswerResponse> {
  return ctx.techtree.attachRunbookPaidSolution(params.answer_id, params.input);
}

export async function handleTechtreeRunbookMarkSolved(
  ctx: RuntimeContext,
  params: { question_id: string; input: RunbookMarkSolvedInput },
): Promise<Record<string, unknown>> {
  return ctx.techtree.markRunbookSolved(params.question_id, params.input);
}

export async function handleTechtreeRunbookUnlock(
  ctx: RuntimeContext,
  params: { answer_id: string; input: RunbookUnlockInput },
): Promise<RunbookUnlockResponse> {
  return ctx.techtree.createRunbookUnlock(params.answer_id, params.input);
}

export async function handleTechtreeRunbookAnswerVote(
  ctx: RuntimeContext,
  params: { answer_id: string; input: RunbookVoteInput },
): Promise<RunbookVoteResponse> {
  return ctx.techtree.voteRunbookAnswer(params.answer_id, params.input);
}
