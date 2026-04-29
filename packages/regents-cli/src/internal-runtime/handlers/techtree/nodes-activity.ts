import type {
  ActivityListResponse,
  AgentInboxResponse,
  AgentOpportunitiesResponse,
  CommentCreateInput,
  CommentCreateResponse,
  NodeCreateInput,
  NodeCreateResponse,
  TreeComment,
  TreeNode,
  WorkPacketResponse,
} from "../../../internal-types/index.js";

import type { RuntimeContext } from "../../runtime.js";

export async function handleTechtreeStatus(ctx: RuntimeContext): Promise<{
  config: typeof ctx.config.services.techtree;
  health: Record<string, unknown>;
}> {
  return {
    config: ctx.config.services.techtree,
    health: await ctx.techtree.health(),
  };
}

export async function handleTechtreeNodesList(
  ctx: RuntimeContext,
  params?: { limit?: number; seed?: string },
): Promise<{ data: TreeNode[] }> {
  return ctx.techtree.listNodes(params);
}

export async function handleTechtreeActivityList(
  ctx: RuntimeContext,
  params?: { limit?: number },
): Promise<ActivityListResponse> {
  return ctx.techtree.listActivity(params);
}

export async function handleTechtreeSearchQuery(
  ctx: RuntimeContext,
  params: { q: string; limit?: number },
): Promise<{
  data: {
    nodes: TreeNode[];
    comments: TreeComment[];
  };
}> {
  return ctx.techtree.search(params);
}

export async function handleTechtreeNodeGet(
  ctx: RuntimeContext,
  params: { id: number },
): Promise<{ data: TreeNode }> {
  return ctx.techtree.getNode(params.id);
}

export async function handleTechtreeNodeChildren(
  ctx: RuntimeContext,
  params: { id: number; limit?: number },
): Promise<{ data: TreeNode[] }> {
  return ctx.techtree.getChildren(params.id, { limit: params.limit });
}

export async function handleTechtreeNodeComments(
  ctx: RuntimeContext,
  params: { id: number; limit?: number },
): Promise<{ data: TreeComment[] }> {
  return ctx.techtree.getComments(params.id, { limit: params.limit });
}

export async function handleTechtreeNodeLineageList(
  ctx: RuntimeContext,
  params: { id: number },
): Promise<{ data: Record<string, unknown> | null }> {
  return ctx.techtree.listNodeLineageClaims(params.id);
}

export async function handleTechtreeNodeLineageClaim(
  ctx: RuntimeContext,
  params: { id: number; input: Record<string, unknown> },
): Promise<{ data: Record<string, unknown> }> {
  return ctx.techtree.claimNodeLineage(params.id, params.input);
}

export async function handleTechtreeNodeLineageWithdraw(
  ctx: RuntimeContext,
  params: { id: number; claimId: string },
): Promise<{ ok: true }> {
  return ctx.techtree.withdrawNodeLineageClaim(params.id, params.claimId);
}

export async function handleTechtreeNodeCrossChainLinksList(
  ctx: RuntimeContext,
  params: { id: number },
): Promise<{ data: Record<string, unknown>[] }> {
  return ctx.techtree.listNodeCrossChainLinks(params.id);
}

export async function handleTechtreeNodeCrossChainLinksCreate(
  ctx: RuntimeContext,
  params: { id: number; input: Record<string, unknown> },
): Promise<{ data: Record<string, unknown> }> {
  return ctx.techtree.createNodeCrossChainLink(params.id, params.input);
}

export async function handleTechtreeNodeCrossChainLinksClear(
  ctx: RuntimeContext,
  params: { id: number },
): Promise<{ ok: true }> {
  return ctx.techtree.clearNodeCrossChainLinks(params.id);
}

export async function handleTechtreeNodeWorkPacket(
  ctx: RuntimeContext,
  params: { id: number },
): Promise<{ data: WorkPacketResponse }> {
  return ctx.techtree.getWorkPacket(params.id);
}

export async function handleTechtreeNodeCreate(
  ctx: RuntimeContext,
  params: NodeCreateInput,
): Promise<NodeCreateResponse> {
  return ctx.techtree.createNode(params);
}

export async function handleTechtreeCommentCreate(
  ctx: RuntimeContext,
  params: CommentCreateInput,
): Promise<CommentCreateResponse> {
  return ctx.techtree.createComment(params);
}

export async function handleTechtreeInboxGet(
  ctx: RuntimeContext,
  params?: { cursor?: number; limit?: number; seed?: string; kind?: string | string[] },
): Promise<AgentInboxResponse> {
  return ctx.techtree.getInbox(params);
}

export async function handleTechtreeOpportunitiesList(
  ctx: RuntimeContext,
  params?: Record<string, string | number | boolean | string[]>,
): Promise<AgentOpportunitiesResponse> {
  return ctx.techtree.getOpportunities(params);
}
