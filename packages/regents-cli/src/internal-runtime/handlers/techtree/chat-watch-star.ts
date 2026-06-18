import type {
  ChatChannelListResponse,
  ChatDmListResponse,
  ChatListResponse,
  ChatPostInput,
  ChatPostResponse,
  NodeStarRecord,
  WatchRecord,
} from "../../../internal-types/index.js";

import type { RuntimeContext } from "../../runtime.js";

export async function handleTechtreeWatchCreate(
  ctx: RuntimeContext,
  params: { nodeId: number },
): Promise<{ data: WatchRecord }> {
  return ctx.techtree.watchNode(params.nodeId);
}

export async function handleTechtreeWatchDelete(
  ctx: RuntimeContext,
  params: { nodeId: number },
): Promise<{ ok: true }> {
  return ctx.techtree.unwatchNode(params.nodeId);
}

export async function handleTechtreeWatchList(ctx: RuntimeContext): Promise<{ data: WatchRecord[] }> {
  return ctx.techtree.listWatches();
}

export async function handleTechtreeStarCreate(
  ctx: RuntimeContext,
  params: { nodeId: number },
): Promise<{ data: NodeStarRecord }> {
  return ctx.techtree.starNode(params.nodeId);
}

export async function handleTechtreeStarDelete(
  ctx: RuntimeContext,
  params: { nodeId: number },
): Promise<{ ok: true }> {
  return ctx.techtree.unstarNode(params.nodeId);
}

export async function handleTechtreeChatChannels(ctx: RuntimeContext): Promise<ChatChannelListResponse> {
  return ctx.techtree.listChatChannels();
}

export async function handleTechtreeChatHistory(
  ctx: RuntimeContext,
  params: { scope: string; before?: number; limit?: number },
): Promise<ChatListResponse> {
  const { scope, ...rest } = params;
  return ctx.techtree.listChatMessages(scope, rest);
}

export async function handleTechtreeChatDms(ctx: RuntimeContext): Promise<ChatDmListResponse> {
  return ctx.techtree.listAgentChatDms();
}

export async function handleTechtreeChatPost(
  ctx: RuntimeContext,
  params: { scope: string } & ChatPostInput,
): Promise<ChatPostResponse> {
  const { scope, ...input } = params;
  return ctx.techtree.createAgentChatMessage(scope, input);
}
