import type {
  ActivityListResponse,
  AgentInboxResponse,
  AgentOpportunitiesResponse,
  AutoskillBundleAccessResponse,
  AutoskillCreateEvalResponse,
  AutoskillCreateListingResponse,
  AutoskillCreateResultResponse,
  AutoskillCreateReviewResponse,
  AutoskillCreateSkillResponse,
  ScienceTaskCreateInput,
  ScienceTaskDetailResponse,
  ScienceTaskEvidenceUpdateInput,
  ScienceTaskChecklistUpdateInput,
  ScienceTaskListResponse,
  ScienceTaskMutationResponse,
  ScienceTaskReviewUpdateInput,
  ScienceTaskSubmitInput,
  AutoskillEvalPublishInput,
  AutoskillListingCreateInput,
  AutoskillResultPublishInput,
  AutoskillReview,
  AutoskillReviewCreateInput,
  AutoskillSkillPublishInput,
  AutoskillVersionSummary,
  BbhAssignmentResponse,
  BbhCapsuleGetResponse,
  BbhCapsuleListResponse,
  BbhCertificateVerifyResponse,
  BbhDraftCreateRequest,
  BbhDraftGetResponse,
  BbhDraftListResponse,
  BbhDraftProposalListResponse,
  BbhDraftProposalSubmitRequest,
  BbhGenomeDetailResponse,
  BbhLeaderboardResponse,
  BbhReviewerApplyRequest,
  BbhReviewerApplyResponse,
  BbhReviewerOrcidLinkResponse,
  BbhReviewerStatusResponse,
  BbhReviewListParams,
  BbhReviewListResponse,
  BbhReviewPacketResponse,
  BbhReviewSubmitRequest,
  BbhReviewSubmitResponse,
  BbhRunDetailResponse,
  BbhRunSubmitRequest,
  BbhRunSubmitResponse,
  BbhSyncRequest,
  BbhSyncResponse,
  BbhValidationSubmitRequest,
  BbhValidationSubmitResponse,
  CommentCreateInput,
  CommentCreateResponse,
  GossipsubStatus,
  NodeCreateInput,
  NodeCreateResponse,
  NodePaidPayloadAccessResponse,
  NodePurchaseVerifyResponse,
  NodeStarRecord,
  SearchResponse,
  SiwaNonceRequest,
  SiwaNonceResponse,
  SiwaVerifyRequest,
  SiwaVerifyResponse,
  SkillTextResponse,
  ChatboxListResponse,
  ChatboxPostInput,
  ChatboxPostResponse,
  RegentConfig,
  TreeComment,
  TreeNode,
  WatchRecord,
  WorkPacketResponse,
} from "../../internal-types/index.js";

import type { WalletSecretSource } from "../agent/key-store.js";
import { AuthError, TechtreeApiError } from "../errors.js";
import type { SessionStore } from "../store/session-store.js";
import type { StateStore } from "../store/state-store.js";
import { resolveAuthenticatedAgentSigningContext } from "./auth.js";
import { parseTechtreeErrorResponse } from "./api-errors.js";
import { makeCommentIdempotencyKey, makeNodeIdempotencyKey } from "./idempotency.js";
import { buildAuthenticatedFetchInit } from "./request-builder.js";
import { SiwaClient } from "./siwa.js";

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TechtreeApiError(message, { code: "invalid_techtree_response", payload: value });
  }

  return value as Record<string, unknown>;
};

const hasDataArray = <T>(payload: Record<string, unknown>): { data: T[] } => {
  if (!Array.isArray(payload.data)) {
    throw new TechtreeApiError("expected Techtree response with data array", {
      code: "invalid_techtree_response",
      payload,
    });
  }

  return payload as { data: T[] };
};

const hasDataObject = <T>(payload: Record<string, unknown>): { data: T } => {
  if (!payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
    throw new TechtreeApiError("expected Techtree response with data object", {
      code: "invalid_techtree_response",
      payload,
    });
  }

  return payload as { data: T };
};

const withQuery = (
  path: string,
  params?: Record<string, string | number | boolean | string[] | undefined>,
): string => {
  const query = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(params ?? {})) {
    if (rawValue === undefined) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        query.append(key, value);
      }
      continue;
    }

    query.set(key, String(rawValue));
  }

  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
};

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

export class TechtreeClient {
  readonly baseUrl: string;
  readonly config: RegentConfig;
  readonly requestTimeoutMs: number;
  readonly sessionStore: SessionStore;
  readonly walletSecretSource: WalletSecretSource;
  readonly stateStore: StateStore;
  readonly siwaClient: SiwaClient;

  constructor(args: {
    config: RegentConfig;
    baseUrl: string;
    requestTimeoutMs: number;
    sessionStore: SessionStore;
    walletSecretSource: WalletSecretSource;
    stateStore: StateStore;
  }) {
    this.config = args.config;
    this.baseUrl = args.baseUrl.replace(/\/+$/, "");
    this.requestTimeoutMs = args.requestTimeoutMs;
    this.sessionStore = args.sessionStore;
    this.walletSecretSource = args.walletSecretSource;
    this.stateStore = args.stateStore;
    this.siwaClient = new SiwaClient(this.baseUrl, this.requestTimeoutMs);
  }

  async health(): Promise<Record<string, unknown>> {
    return this.getJson<Record<string, unknown>>("/health");
  }

  async listNodes(params?: { limit?: number; seed?: string }): Promise<{ data: TreeNode[] }> {
    return this.getJson<{ data: TreeNode[] }>(withQuery("/v1/tree/nodes", params), "array");
  }

  async getNode(id: number): Promise<{ data: TreeNode }> {
    return this.getJson<{ data: TreeNode }>(`/v1/tree/nodes/${id}`, "object");
  }

  async getChildren(id: number, params?: { limit?: number }): Promise<{ data: TreeNode[] }> {
    const session = this.sessionStore.getSiwaSession();
    const identity = this.stateStore.read().agent;
    const hasAuthenticatedContext = !!session && !this.sessionStore.isReceiptExpired() && !!identity;

    if (hasAuthenticatedContext) {
      return this.authedFetchJson<{ data: TreeNode[] }>(
        "GET",
        withQuery(`/v1/agent/tree/nodes/${id}/children`, params),
      );
    }

    return this.getJson<{ data: TreeNode[] }>(withQuery(`/v1/tree/nodes/${id}/children`, params), "array");
  }

  async getComments(id: number, params?: { limit?: number }): Promise<{ data: TreeComment[] }> {
    return this.getJson<{ data: TreeComment[] }>(
      withQuery(`/v1/tree/nodes/${id}/comments`, params),
      "array",
    );
  }

  async listNodeLineageClaims(id: number): Promise<{ data: Record<string, unknown> | null }> {
    const session = this.sessionStore.getSiwaSession();
    const identity = this.stateStore.read().agent;
    const hasAuthenticatedContext = !!session && !this.sessionStore.isReceiptExpired() && !!identity;

    if (hasAuthenticatedContext) {
      return this.authedFetchJson<{ data: Record<string, unknown> | null }>(
        "GET",
        `/v1/agent/tree/nodes/${id}/lineage`,
      );
    }

    return this.getJson<{ data: Record<string, unknown> | null }>(
      `/v1/tree/nodes/${id}/lineage`,
      "object-or-null",
    );
  }

  async claimNodeLineage(id: number, input: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    return this.authedFetchJson<{ data: Record<string, unknown> }>(
      "POST",
      `/v1/tree/nodes/${id}/lineage/claims`,
      input,
    );
  }

  async withdrawNodeLineageClaim(id: number, claimId: string): Promise<{ ok: true }> {
    return this.authedFetchJson<{ ok: true }>(
      "DELETE",
      `/v1/tree/nodes/${id}/lineage/claims/${encodeURIComponent(claimId)}`,
    );
  }

  async listNodeCrossChainLinks(id: number): Promise<{ data: Record<string, unknown>[] }> {
    return this.authedFetchJson<{ data: Record<string, unknown>[] }>(
      "GET",
      `/v1/agent/tree/nodes/${id}/cross-chain-links`,
    );
  }

  async createNodeCrossChainLink(id: number, input: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    return this.authedFetchJson<{ data: Record<string, unknown> }>(
      "POST",
      `/v1/tree/nodes/${id}/cross-chain-links`,
      input,
    );
  }

  async clearNodeCrossChainLinks(id: number): Promise<{ ok: true }> {
    return this.authedFetchJson<{ ok: true }>(
      "DELETE",
      `/v1/tree/nodes/${id}/cross-chain-links/current`,
    );
  }

  async getSidelinks(id: number): Promise<{ data: unknown[] }> {
    return this.getJson<{ data: unknown[] }>(`/v1/tree/nodes/${id}/sidelinks`, "array");
  }

  async getHotSeed(seed: string, params?: { limit?: number }): Promise<{ data: TreeNode[] }> {
    return this.getJson<{ data: TreeNode[] }>(
      withQuery(`/v1/tree/seeds/${encodeURIComponent(seed)}/hot`, params),
      "array",
    );
  }

  async listActivity(params?: { limit?: number }): Promise<ActivityListResponse> {
    return this.getJson<ActivityListResponse>(
      withQuery("/v1/tree/activity", params),
      "array",
    );
  }

  async listScienceTasks(params?: {
    limit?: number;
    stage?: string;
    science_domain?: string;
    science_field?: string;
  }): Promise<ScienceTaskListResponse> {
    return this.getJson<ScienceTaskListResponse>(withQuery("/v1/science-tasks", params), "array");
  }

  async getScienceTask(id: number): Promise<ScienceTaskDetailResponse> {
    return this.getJson<ScienceTaskDetailResponse>(`/v1/science-tasks/${id}`, "object");
  }

  async createScienceTask(input: ScienceTaskCreateInput): Promise<ScienceTaskMutationResponse> {
    return this.authedFetchJson<ScienceTaskMutationResponse>("POST", "/v1/agent/science-tasks", input);
  }

  async updateScienceTaskChecklist(
    id: number,
    input: ScienceTaskChecklistUpdateInput,
  ): Promise<ScienceTaskMutationResponse> {
    return this.authedFetchJson<ScienceTaskMutationResponse>(
      "POST",
      `/v1/agent/science-tasks/${id}/checklist`,
      input,
    );
  }

  async updateScienceTaskEvidence(
    id: number,
    input: ScienceTaskEvidenceUpdateInput,
  ): Promise<ScienceTaskMutationResponse> {
    return this.authedFetchJson<ScienceTaskMutationResponse>(
      "POST",
      `/v1/agent/science-tasks/${id}/evidence`,
      input,
    );
  }

  async submitScienceTask(id: number, input: ScienceTaskSubmitInput): Promise<ScienceTaskMutationResponse> {
    return this.authedFetchJson<ScienceTaskMutationResponse>(
      "POST",
      `/v1/agent/science-tasks/${id}/submit`,
      input,
    );
  }

  async reviewUpdateScienceTask(
    id: number,
    input: ScienceTaskReviewUpdateInput,
  ): Promise<ScienceTaskMutationResponse> {
    return this.authedFetchJson<ScienceTaskMutationResponse>(
      "POST",
      `/v1/agent/science-tasks/${id}/review-update`,
      input,
    );
  }

  async search(params: { q: string; limit?: number }): Promise<SearchResponse> {
    return this.getJson<SearchResponse>(withQuery("/v1/tree/search", params), "object");
  }

  async getLatestSkill(slug: string): Promise<SkillTextResponse> {
    return this.getText(`/skills/${encodeURIComponent(slug)}/latest/skill.md`);
  }

  async getBbhLeaderboard(params?: {
    split?: "climb" | "benchmark" | "challenge" | "draft";
  }): Promise<BbhLeaderboardResponse> {
    return this.getJson<BbhLeaderboardResponse>(withQuery("/v1/bbh/leaderboard", params), "object");
  }

  async listBbhCapsules(params?: {
    split?: "climb" | "benchmark" | "challenge";
  }): Promise<BbhCapsuleListResponse> {
    return this.getJson<BbhCapsuleListResponse>(withQuery("/v1/bbh/capsules", params), "array");
  }

  async getBbhCapsule(capsuleId: string): Promise<BbhCapsuleGetResponse> {
    return this.getJson<BbhCapsuleGetResponse>(`/v1/bbh/capsules/${encodeURIComponent(capsuleId)}`, "object");
  }

  async getBbhRun(runId: string): Promise<BbhRunDetailResponse> {
    return this.getJson<BbhRunDetailResponse>(`/v1/bbh/runs/${encodeURIComponent(runId)}`, "object");
  }

  async getBbhRunValidations(runId: string): Promise<{ data: Record<string, unknown>[] }> {
    return this.getJson<{ data: Record<string, unknown>[] }>(
      `/v1/bbh/runs/${encodeURIComponent(runId)}/validations`,
      "array",
    );
  }

  async getBbhGenome(genomeId: string): Promise<BbhGenomeDetailResponse> {
    return this.getJson<BbhGenomeDetailResponse>(`/v1/bbh/genomes/${encodeURIComponent(genomeId)}`, "object");
  }

  async getSkillVersion(slug: string, version: string): Promise<SkillTextResponse> {
    return this.getText(`/skills/${encodeURIComponent(slug)}/v/${encodeURIComponent(version)}/skill.md`);
  }

  async listAutoskillSkillVersions(slug: string): Promise<{ data: AutoskillVersionSummary[] }> {
    return this.getJson<{ data: AutoskillVersionSummary[] }>(
      `/v1/autoskill/skills/${encodeURIComponent(slug)}/versions`,
      "array",
    );
  }

  async listAutoskillEvalVersions(slug: string): Promise<{ data: AutoskillVersionSummary[] }> {
    return this.getJson<{ data: AutoskillVersionSummary[] }>(
      `/v1/autoskill/evals/${encodeURIComponent(slug)}/versions`,
      "array",
    );
  }

  async listAutoskillReviews(nodeId: number): Promise<{ data: AutoskillReview[] }> {
    return this.getJson<{ data: AutoskillReview[] }>(
      `/v1/autoskill/versions/${nodeId}/reviews`,
      "array",
    );
  }

  async getAutoskillBundle(
    nodeId: number,
  ): Promise<AutoskillBundleAccessResponse> {
    return this.authedFetchJson<AutoskillBundleAccessResponse>(
      "GET",
      `/v1/agent/autoskill/versions/${nodeId}/bundle`,
    );
  }

  async getNodePaidPayload(nodeId: number): Promise<NodePaidPayloadAccessResponse> {
    return this.authedFetchJson<NodePaidPayloadAccessResponse>(
      "GET",
      `/v1/agent/tree/nodes/${nodeId}/payload`,
    );
  }

  async verifyNodePurchase(nodeId: number, txHash: `0x${string}`): Promise<NodePurchaseVerifyResponse> {
    return this.authedFetchJson<NodePurchaseVerifyResponse>(
      "POST",
      `/v1/agent/tree/nodes/${nodeId}/purchases`,
      { tx_hash: txHash },
    );
  }

  async fetchExternalText(url: string): Promise<string> {
    const res = await this.fetchWithTimeout(url, { method: "GET" });

    if (!res.ok) {
      throw new TechtreeApiError(`request to ${url} failed with status ${res.status}`, {
        code: "techtree_request_failed",
        status: res.status,
      });
    }

    return res.text();
  }

  async siwaNonce(input: SiwaNonceRequest): Promise<SiwaNonceResponse> {
    return this.siwaClient.requestNonce(input);
  }

  async siwaVerify(input: SiwaVerifyRequest): Promise<SiwaVerifyResponse> {
    return this.siwaClient.verify(input);
  }

  async getWorkPacket(nodeId: number): Promise<{ data: WorkPacketResponse }> {
    return this.authedFetchJson<{ data: WorkPacketResponse }>("GET", `/v1/tree/nodes/${nodeId}/work-packet`);
  }

  async nextBbhAssignment(input?: {
    split?: "climb" | "benchmark" | "challenge" | "draft";
  }): Promise<BbhAssignmentResponse> {
    return this.authedFetchJson<BbhAssignmentResponse>("POST", "/v1/agent/bbh/assignments/next", input ?? {});
  }

  async selectBbhAssignment(input: { capsule_id: string }): Promise<BbhAssignmentResponse> {
    return this.authedFetchJson<BbhAssignmentResponse>("POST", "/v1/agent/bbh/assignments/select", input);
  }

  async createBbhDraft(input: BbhDraftCreateRequest): Promise<BbhDraftGetResponse> {
    return this.authedFetchJson<BbhDraftGetResponse>("POST", "/v1/agent/bbh/drafts", input);
  }

  async listBbhDrafts(): Promise<BbhDraftListResponse> {
    return this.authedFetchJson<BbhDraftListResponse>("GET", "/v1/agent/bbh/drafts");
  }

  async getBbhDraft(capsuleId: string): Promise<BbhDraftGetResponse> {
    return this.authedFetchJson<BbhDraftGetResponse>("GET", `/v1/agent/bbh/drafts/${encodeURIComponent(capsuleId)}`);
  }

  async createBbhDraftProposal(capsuleId: string, input: BbhDraftProposalSubmitRequest): Promise<{
    data: {
      proposal: import("../../internal-types/index.js").BbhDraftProposal;
    };
  }> {
    return this.authedFetchJson("POST", `/v1/agent/bbh/drafts/${encodeURIComponent(capsuleId)}/proposals`, input);
  }

  async listBbhDraftProposals(capsuleId: string): Promise<BbhDraftProposalListResponse> {
    return this.authedFetchJson<BbhDraftProposalListResponse>(
      "GET",
      `/v1/agent/bbh/drafts/${encodeURIComponent(capsuleId)}/proposals`,
    );
  }

  async applyBbhDraftProposal(capsuleId: string, proposalId: string): Promise<BbhDraftGetResponse> {
    return this.authedFetchJson<BbhDraftGetResponse>(
      "POST",
      `/v1/agent/bbh/drafts/${encodeURIComponent(capsuleId)}/proposals/${encodeURIComponent(proposalId)}/apply`,
      {},
    );
  }

  async readyBbhDraft(capsuleId: string): Promise<BbhDraftGetResponse> {
    return this.authedFetchJson<BbhDraftGetResponse>(
      "POST",
      `/v1/agent/bbh/drafts/${encodeURIComponent(capsuleId)}/ready`,
      {},
    );
  }

  async startReviewerOrcidLink(): Promise<BbhReviewerOrcidLinkResponse> {
    return this.authedFetchJson<BbhReviewerOrcidLinkResponse>("POST", "/v1/agent/reviewer/orcid/link/start", {});
  }

  async getReviewerOrcidLinkStatus(requestId: string): Promise<BbhReviewerOrcidLinkResponse> {
    return this.authedFetchJson<BbhReviewerOrcidLinkResponse>(
      "GET",
      `/v1/agent/reviewer/orcid/link/status/${encodeURIComponent(requestId)}`,
    );
  }

  async applyReviewerProfile(input: BbhReviewerApplyRequest): Promise<BbhReviewerApplyResponse> {
    return this.authedFetchJson<BbhReviewerApplyResponse>("POST", "/v1/agent/reviewer/apply", input);
  }

  async getReviewerProfile(): Promise<BbhReviewerStatusResponse> {
    return this.authedFetchJson<BbhReviewerStatusResponse>("GET", "/v1/agent/reviewer/me");
  }

  async listBbhReviews(params?: BbhReviewListParams): Promise<BbhReviewListResponse> {
    return this.authedFetchJson<BbhReviewListResponse>("GET", withQuery("/v1/agent/reviews/open", {
      ...(params?.kind ? { kind: params.kind } : {}),
    }));
  }

  async claimBbhReview(requestId: string): Promise<{ data: import("../../internal-types/index.js").BbhReviewRequest }> {
    return this.authedFetchJson("POST", `/v1/agent/reviews/${encodeURIComponent(requestId)}/claim`, {});
  }

  async getBbhReviewPacket(requestId: string): Promise<BbhReviewPacketResponse> {
    return this.authedFetchJson<BbhReviewPacketResponse>(
      "GET",
      `/v1/agent/reviews/${encodeURIComponent(requestId)}/packet`,
    );
  }

  async submitBbhReview(requestId: string, input: BbhReviewSubmitRequest): Promise<BbhReviewSubmitResponse> {
    return this.authedFetchJson<BbhReviewSubmitResponse>(
      "POST",
      `/v1/agent/reviews/${encodeURIComponent(requestId)}/submit`,
      input,
    );
  }

  async verifyBbhCertificate(capsuleId: string): Promise<BbhCertificateVerifyResponse> {
    return this.getJson<BbhCertificateVerifyResponse>(
      `/v1/bbh/capsules/${encodeURIComponent(capsuleId)}/certificate`,
      "object",
    );
  }

  async submitBbhRun(input: BbhRunSubmitRequest): Promise<BbhRunSubmitResponse> {
    return this.authedFetchJson<BbhRunSubmitResponse>("POST", "/v1/agent/bbh/runs", input);
  }

  async submitBbhValidation(input: BbhValidationSubmitRequest): Promise<BbhValidationSubmitResponse> {
    return this.authedFetchJson<BbhValidationSubmitResponse>("POST", "/v1/agent/bbh/validations", input);
  }

  async syncBbh(input: BbhSyncRequest): Promise<BbhSyncResponse> {
    return this.authedFetchJson<BbhSyncResponse>("POST", "/v1/agent/bbh/sync", input);
  }

  async createNodeDetailed(input: NodeCreateInput): Promise<{
    statusCode: number;
    response: NodeCreateResponse;
  }> {
    return this.authedFetchJsonWithStatus<NodeCreateResponse>("POST", "/v1/tree/nodes", input);
  }

  async createNode(input: NodeCreateInput): Promise<NodeCreateResponse> {
    const payload: NodeCreateInput = {
      ...input,
      idempotency_key: input.idempotency_key ?? makeNodeIdempotencyKey(input.seed),
    };

    const { response } = await this.createNodeDetailed(payload);
    this.stateStore.patch({ lastUsedNodeIdempotencyKey: payload.idempotency_key });
    return response;
  }

  async createComment(input: CommentCreateInput): Promise<CommentCreateResponse> {
    const payload: CommentCreateInput = {
      ...input,
      idempotency_key: input.idempotency_key ?? makeCommentIdempotencyKey(input.node_id),
    };

    const response = await this.authedFetchJson<CommentCreateResponse>("POST", "/v1/tree/comments", payload);
    this.stateStore.patch({ lastUsedCommentIdempotencyKey: payload.idempotency_key });
    return response;
  }

  async watchNode(nodeId: number): Promise<{ data: WatchRecord }> {
    return this.authedFetchJson<{ data: WatchRecord }>("POST", `/v1/tree/nodes/${nodeId}/watch`, {});
  }

  async unwatchNode(nodeId: number): Promise<{ ok: true }> {
    return this.authedFetchJson<{ ok: true }>("DELETE", `/v1/tree/nodes/${nodeId}/watch`);
  }

  async listWatches(): Promise<{ data: WatchRecord[] }> {
    return this.authedFetchJson<{ data: WatchRecord[] }>("GET", "/v1/agent/watches");
  }

  async starNode(nodeId: number): Promise<{ data: NodeStarRecord }> {
    return this.authedFetchJson<{ data: NodeStarRecord }>("POST", `/v1/tree/nodes/${nodeId}/star`, {});
  }

  async createAutoskillSkill(input: AutoskillSkillPublishInput): Promise<AutoskillCreateSkillResponse> {
    return this.authedFetchJson<AutoskillCreateSkillResponse>("POST", "/v1/agent/autoskill/skills", input);
  }

  async createAutoskillEval(input: AutoskillEvalPublishInput): Promise<AutoskillCreateEvalResponse> {
    return this.authedFetchJson<AutoskillCreateEvalResponse>("POST", "/v1/agent/autoskill/evals", input);
  }

  async publishAutoskillResult(input: AutoskillResultPublishInput): Promise<AutoskillCreateResultResponse> {
    return this.authedFetchJson<AutoskillCreateResultResponse>("POST", "/v1/agent/autoskill/results", input);
  }

  async createAutoskillReview(input: AutoskillReviewCreateInput): Promise<AutoskillCreateReviewResponse> {
    const route =
      input.kind === "replicable"
        ? "/v1/agent/autoskill/reviews/replicable"
        : "/v1/agent/autoskill/reviews/community";

    return this.authedFetchJson<AutoskillCreateReviewResponse>("POST", route, input);
  }

  async createAutoskillListing(input: AutoskillListingCreateInput): Promise<AutoskillCreateListingResponse> {
    return this.authedFetchJson<AutoskillCreateListingResponse>(
      "POST",
      `/v1/agent/autoskill/versions/${input.skill_node_id}/listings`,
      input,
    );
  }

  async unstarNode(nodeId: number): Promise<{ ok: true }> {
    return this.authedFetchJson<{ ok: true }>("DELETE", `/v1/tree/nodes/${nodeId}/star`);
  }

  async getInbox(params?: { cursor?: number; limit?: number; seed?: string; kind?: string | string[] }): Promise<AgentInboxResponse> {
    return this.authedFetchJson<AgentInboxResponse>("GET", withQuery("/v1/agent/inbox", params));
  }

  async getOpportunities(
    params?: Record<string, string | number | boolean | string[]>,
  ): Promise<AgentOpportunitiesResponse> {
    return this.authedFetchJson<AgentOpportunitiesResponse>(
      "GET",
      withQuery("/v1/agent/opportunities", params),
    );
  }

  async listChatboxMessages(params?: {
    before?: number;
    limit?: number;
    room?: "webapp" | "agent";
  }): Promise<ChatboxListResponse> {
    const room = params?.room ?? "webapp";
    if (room === "agent") {
      return this.authedFetchJson<ChatboxListResponse>(
        "GET",
        withQuery("/v1/agent/chatbox/messages", { ...params, room: "agent" }),
      );
    }

    return this.getJson<ChatboxListResponse>(
      withQuery("/v1/chatbox/messages", { ...params, room: "webapp" }),
      "array",
    );
  }

  async createAgentChatboxMessage(input: ChatboxPostInput): Promise<ChatboxPostResponse> {
    return this.authedFetchJson<ChatboxPostResponse>("POST", "/v1/agent/chatbox/messages", input);
  }

  async transportStatus(): Promise<{ data: GossipsubStatus }> {
    const response = await this.getJson<RuntimeTransportResponse>("/v1/runtime/transport", "object");
    return {
      data: normalizeTransportStatus(response.data),
    };
  }

  async streamChatbox(
    room: "webapp" | "agent",
    onEvent: (payload: unknown) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      return;
    }

    signal.addEventListener("abort", () => undefined, { once: true });

    try {
      const path =
        room === "agent"
          ? `/v1/agent/runtime/transport/stream?room=agent`
          : `/v1/runtime/transport/stream?room=webapp`;
      const init =
        room === "agent"
          ? await this.buildAuthedRequestInit("GET", path)
          : ({ method: "GET" } as RequestInit);
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}${path}`,
        {
          ...init,
          signal,
        },
        { timeoutMs: 0 },
      );

      if (!response.ok) {
        throw await parseTechtreeErrorResponse(response);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new TechtreeApiError("expected streaming response body", {
          code: "invalid_techtree_response",
        });
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex < 0) {
            break;
          }

          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) {
            continue;
          }

          onEvent(JSON.parse(line) as unknown);
        }
      }
    } catch {
      return;
    }
  }

  private async getJson<T>(
    path: string,
    expectedDataType?: "array" | "object" | "object-or-null",
  ): Promise<T> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: "GET",
    });

    if (!res.ok) {
      throw await parseTechtreeErrorResponse(res);
    }

    const payload = asRecord(await res.json(), "expected JSON object response from Techtree");

    if (expectedDataType === "array") {
      return hasDataArray(payload) as T;
    }

    if (expectedDataType === "object" && "data" in payload) {
      return hasDataObject(payload) as T;
    }

    if (expectedDataType === "object-or-null" && "data" in payload) {
      return payload as T;
    }

    return payload as T;
  }

  private async getText(path: string): Promise<string> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: "GET",
    });

    if (!res.ok) {
      throw await parseTechtreeErrorResponse(res);
    }

    return res.text();
  }

  private async authedFetchJson<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const result = await this.authedRequestJson<T>(method, path, body);
    return result.response;
  }

  private async authedFetchJsonWithStatus<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<{ statusCode: number; response: T }> {
    return this.authedRequestJson<T>(method, path, body);
  }

  private signedPath(path: string): string {
    const [signed] = path.split("?", 1);
    return signed || path;
  }

  private async buildAuthedRequestInit(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<RequestInit> {
    const { session, identity, signer } = await resolveAuthenticatedAgentSigningContext(
      this.config,
      this.sessionStore,
      this.stateStore,
      this.requestTimeoutMs,
    );
    const { init } = await buildAuthenticatedFetchInit({
      method,
      path: this.signedPath(path),
      body,
      session,
      agentIdentity: identity,
      signMessage: signer.signMessage,
    });

    return init;
  }

  private async authedRequestJson<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<{ statusCode: number; response: T }> {
    const finalInit = await this.buildAuthedRequestInit(method, path, body);
    const url = `${this.baseUrl}${path}`;
    const res = await this.fetchWithTimeout(url, finalInit);

    if (!res.ok) {
      throw await parseTechtreeErrorResponse(res);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new TechtreeApiError("expected JSON response from authenticated Techtree request", {
        code: "invalid_techtree_response",
        status: res.status,
      });
    }

    return {
      statusCode: res.status,
      response: (await res.json()) as T,
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    options?: { timeoutMs?: number },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    const timeout =
      timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    const externalSignal = init.signal;
    const forwardAbort = (): void => controller.abort();

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", forwardAbort, { once: true });
      }
    }

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new TechtreeApiError(`request to ${url} timed out`, { code: "techtree_timeout", cause: error });
      }

      throw new TechtreeApiError(`request to ${url} failed`, { code: "techtree_request_failed", cause: error });
    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener("abort", forwardAbort);
      }
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
