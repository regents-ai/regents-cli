import type {
  RegentAgentHarnessSummary,
  RegentAgentProfileSummary,
  RegentAgentStatus,
} from "../../internal-types/index.js";

import type { RuntimeContext } from "../runtime.js";

export async function handleAgentInit(ctx: RuntimeContext): Promise<RegentAgentStatus> {
  return ctx.agentRouter.init();
}

export async function handleAgentStatus(ctx: RuntimeContext): Promise<RegentAgentStatus> {
  return ctx.agentRouter.status();
}

export async function handleAgentProfileList(
  ctx: RuntimeContext,
): Promise<{ data: RegentAgentProfileSummary[] }> {
  return {
    data: await ctx.agentRouter.listProfiles(),
  };
}

export async function handleAgentProfileShow(
  ctx: RuntimeContext,
  params?: { profile?: string },
): Promise<{ data: RegentAgentProfileSummary }> {
  return {
    data: await ctx.agentRouter.showProfile(params?.profile),
  };
}

export async function handleAgentHarnessList(
  ctx: RuntimeContext,
): Promise<{ data: RegentAgentHarnessSummary[] }> {
  return {
    data: await ctx.agentRouter.listHarnesses(),
  };
}
