import type {
  ActivityListResponse,
  AgentInboxResponse,
  AgentOpportunitiesResponse,
  CommentCreateInput,
  CommentCreateResponse,
  NodeCreateInput,
  NodeCreateResponse,
  NodePaidPayloadAccessResponse,
  NodeReviewThread,
  NodeStarRecord,
  SearchResponse,
  SkillTextResponse,
  TreeAgentProfile,
  TreeComment,
  TreeNode,
  WatchRecord,
  WorkPacketResponse,
} from "../../../internal-types/index.js";
import type { StateStore } from "../../store/state-store.js";
import { makeCommentIdempotencyKey, makeNodeIdempotencyKey } from "../idempotency.js";
import type { TechtreeRequestClient } from "./request.js";
import { withQuery } from "./request.js";

export class TreeResource {
  constructor(
    private readonly request: TechtreeRequestClient,
    private readonly stateStore: StateStore,
  ) {}

  async health(): Promise<Record<string, unknown>> {
    return this.request.getJson<Record<string, unknown>>("/health");
  }

  async listNodes(params?: { limit?: number; seed?: string }): Promise<{ data: TreeNode[] }> {
    return this.request.getJson<{ data: TreeNode[] }>(withQuery("/api/techtree/v1/tree/nodes", params), "array");
  }

  async getNode(id: number): Promise<{ data: TreeNode }> {
    return this.request.getJson<{ data: TreeNode }>(`/api/techtree/v1/tree/nodes/${id}`, "object");
  }

  async getChildren(id: number, params?: { limit?: number }): Promise<{ data: TreeNode[] }> {
    if (this.request.hasAuthenticatedAgentContext()) {
      return this.request.authedFetchJson<{ data: TreeNode[] }>(
        "GET",
        withQuery(`/api/techtree/v1/agent/tree/nodes/${id}/children`, params),
      );
    }

    return this.request.getJson<{ data: TreeNode[] }>(withQuery(`/api/techtree/v1/tree/nodes/${id}/children`, params), "array");
  }

  async getNodeReviews(id: number): Promise<{ data: NodeReviewThread }> {
    return this.request.getJson<{ data: NodeReviewThread }>(`/api/techtree/v1/tree/nodes/${id}/reviews`, "object");
  }

  async getAgentProfile(id: number): Promise<{ data: TreeAgentProfile }> {
    return this.request.getJson<{ data: TreeAgentProfile }>(`/api/techtree/v1/tree/agents/${id}`, "object");
  }

  async getComments(id: number, params?: { limit?: number }): Promise<{ data: TreeComment[] }> {
    return this.request.getJson<{ data: TreeComment[] }>(
      withQuery(`/api/techtree/v1/tree/nodes/${id}/comments`, params),
      "array",
    );
  }

  async listNodeLineageClaims(id: number): Promise<{ data: Record<string, unknown> | null }> {
    if (this.request.hasAuthenticatedAgentContext()) {
      return this.request.authedFetchJson<{ data: Record<string, unknown> | null }>(
        "GET",
        `/api/techtree/v1/agent/tree/nodes/${id}/lineage`,
      );
    }

    return this.request.getJson<{ data: Record<string, unknown> | null }>(
      `/api/techtree/v1/tree/nodes/${id}/lineage`,
      "object-or-null",
    );
  }

  async claimNodeLineage(id: number, input: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    return this.request.authedFetchJson<{ data: Record<string, unknown> }>(
      "POST",
      `/api/techtree/v1/tree/nodes/${id}/lineage/claims`,
      input,
    );
  }

  async withdrawNodeLineageClaim(id: number, claimId: string): Promise<{ ok: true }> {
    return this.request.authedFetchJson<{ ok: true }>(
      "DELETE",
      `/api/techtree/v1/tree/nodes/${id}/lineage/claims/${encodeURIComponent(claimId)}`,
    );
  }

  async listNodeCrossChainLinks(id: number): Promise<{ data: Record<string, unknown>[] }> {
    return this.request.authedFetchJson<{ data: Record<string, unknown>[] }>(
      "GET",
      `/api/techtree/v1/agent/tree/nodes/${id}/cross-chain-links`,
    );
  }

  async createNodeCrossChainLink(id: number, input: Record<string, unknown>): Promise<{ data: Record<string, unknown> }> {
    return this.request.authedFetchJson<{ data: Record<string, unknown> }>(
      "POST",
      `/api/techtree/v1/tree/nodes/${id}/cross-chain-links`,
      input,
    );
  }

  async clearNodeCrossChainLinks(id: number): Promise<{ ok: true }> {
    return this.request.authedFetchJson<{ ok: true }>(
      "DELETE",
      `/api/techtree/v1/tree/nodes/${id}/cross-chain-links/current`,
    );
  }

  async getSidelinks(id: number): Promise<{ data: unknown[] }> {
    return this.request.getJson<{ data: unknown[] }>(`/api/techtree/v1/tree/nodes/${id}/sidelinks`, "array");
  }

  async getHotSeed(seed: string, params?: { limit?: number }): Promise<{ data: TreeNode[] }> {
    return this.request.getJson<{ data: TreeNode[] }>(
      withQuery(`/api/techtree/v1/tree/seeds/${encodeURIComponent(seed)}/hot`, params),
      "array",
    );
  }

  async listActivity(params?: { limit?: number }): Promise<ActivityListResponse> {
    return this.request.getJson<ActivityListResponse>(
      withQuery("/api/techtree/v1/tree/activity", params),
      "array",
    );
  }

  async search(params: { q: string; limit?: number }): Promise<SearchResponse> {
    return this.request.getJson<SearchResponse>(withQuery("/api/techtree/v1/tree/search", params), "object");
  }

  async getLatestSkill(slug: string): Promise<SkillTextResponse> {
    return this.request.getText(`/skills/${encodeURIComponent(slug)}/latest/skill.md`);
  }

  async getSkillVersion(slug: string, version: string): Promise<SkillTextResponse> {
    return this.request.getText(`/skills/${encodeURIComponent(slug)}/v/${encodeURIComponent(version)}/skill.md`);
  }

  async getNodePaidPayload(nodeId: number): Promise<NodePaidPayloadAccessResponse> {
    return this.request.authedFetchJson<NodePaidPayloadAccessResponse>(
      "GET",
      `/api/techtree/v1/agent/tree/nodes/${nodeId}/payload`,
    );
  }

  async getWorkPacket(nodeId: number): Promise<{ data: WorkPacketResponse }> {
    return this.request.authedFetchJson<{ data: WorkPacketResponse }>("GET", `/api/techtree/v1/tree/nodes/${nodeId}/work-packet`);
  }

  async createNodeDetailed(input: NodeCreateInput): Promise<{
    statusCode: number;
    response: NodeCreateResponse;
  }> {
    return this.request.authedFetchJsonWithStatus<NodeCreateResponse>("POST", "/api/techtree/v1/tree/nodes", input);
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

    const response = await this.request.authedFetchJson<CommentCreateResponse>("POST", "/api/techtree/v1/tree/comments", payload);
    this.stateStore.patch({ lastUsedCommentIdempotencyKey: payload.idempotency_key });
    return response;
  }

  async watchNode(nodeId: number): Promise<{ data: WatchRecord }> {
    return this.request.authedFetchJson<{ data: WatchRecord }>("POST", `/api/techtree/v1/tree/nodes/${nodeId}/watch`, {});
  }

  async unwatchNode(nodeId: number): Promise<{ ok: true }> {
    return this.request.authedFetchJson<{ ok: true }>("DELETE", `/api/techtree/v1/tree/nodes/${nodeId}/watch`);
  }

  async listWatches(): Promise<{ data: WatchRecord[] }> {
    return this.request.authedFetchJson<{ data: WatchRecord[] }>("GET", "/api/techtree/v1/agent/watches");
  }

  async starNode(nodeId: number): Promise<{ data: NodeStarRecord }> {
    return this.request.authedFetchJson<{ data: NodeStarRecord }>("POST", `/api/techtree/v1/tree/nodes/${nodeId}/star`, {});
  }

  async unstarNode(nodeId: number): Promise<{ ok: true }> {
    return this.request.authedFetchJson<{ ok: true }>("DELETE", `/api/techtree/v1/tree/nodes/${nodeId}/star`);
  }

  async getInbox(params?: { cursor?: number; limit?: number; seed?: string; kind?: string | string[] }): Promise<AgentInboxResponse> {
    return this.request.authedFetchJson<AgentInboxResponse>("GET", withQuery("/api/techtree/v1/agent/inbox", params));
  }

  async getOpportunities(
    params?: Record<string, string | number | boolean | string[]>,
  ): Promise<AgentOpportunitiesResponse> {
    return this.request.authedFetchJson<AgentOpportunitiesResponse>(
      "GET",
      withQuery("/api/techtree/v1/agent/opportunities", params),
    );
  }
}
