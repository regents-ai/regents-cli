import type {
  TerminalScienceAgentKey,
  TerminalScienceRunResponse,
  TerminalScienceSetGoalResponse,
} from "../../../internal-types/index.js";
import { writeConfigReplacement } from "../../config.js";
import { defaultConfigPath } from "../../paths.js";
import type { RuntimeContext } from "../../runtime.js";
import {
  buildAndRunTerminalScience,
  type TerminalScienceRunParams,
  type TerminalScienceSetGoalParams,
} from "../../workloads/terminal-science.js";

const scienceAgents = ["codex", "openclaw", "hermes", "custom"] as const;

export interface TerminalScienceAgentSetParams {
  agent: string;
}

export async function handleTechtreeScienceSetGoal(
  ctx: RuntimeContext,
  params: TerminalScienceSetGoalParams,
): Promise<TerminalScienceSetGoalResponse> {
  const response = await ctx.techtree.createScienceGoal({
    task: params.task,
    agent: params.agent ?? ctx.config.workloads.science.defaultAgent,
    model: params.model ?? ctx.config.workloads.science.defaultModel,
    env: params.env ?? ctx.config.workloads.science.defaultEnvironment,
  });
  const goal = response.data;
  ctx.stateStore.patch({ techtreeScienceGoal: goal });
  return { ok: true, goal };
}

export async function handleTechtreeScienceAgentSet(
  ctx: RuntimeContext,
  params: TerminalScienceAgentSetParams,
): Promise<{ ok: true; agent: TerminalScienceAgentKey; config_path: string }> {
  const agent = normalizeScienceAgent(params.agent);
  const configPath = ctx.runtime.configPath ?? defaultConfigPath();
  const nextConfig = {
    ...ctx.config,
    workloads: {
      ...ctx.config.workloads,
      science: {
        ...ctx.config.workloads.science,
        defaultAgent: agent,
      },
    },
  };

  writeConfigReplacement(configPath, nextConfig);
  ctx.config.workloads.science.defaultAgent = agent;
  return { ok: true, agent, config_path: configPath };
}

export async function handleTechtreeScienceRun(
  ctx: RuntimeContext,
  params: TerminalScienceRunParams,
): Promise<TerminalScienceRunResponse> {
  const state = ctx.stateStore.read();
  const publishRun = params.publish_run === true;
  const activeGoal = await resolveGoal(ctx, params, publishRun, state.techtreeScienceGoal);
  const run = await buildAndRunTerminalScience(
    ctx.config,
    params,
    activeGoal,
    state.agent,
  );

  ctx.stateStore.patch({ techtreeScienceGoal: run.goal });

  if (!publishRun) {
    return run;
  }

  const visibility = ctx.config.workloads.science.publishVisibility;
  const artifactEnvelope = publishableEnvelope(run.artifact_envelope, visibility);
  const created = await ctx.techtree.createScienceRun({
    goal_id: run.goal.goal_id,
    artifact_envelope: artifactEnvelope,
  });
  const uploaded = await ctx.techtree.uploadScienceRunArtifacts(run.run_id, {
    artifacts: artifactEnvelope.artifacts,
  });
  const published = await ctx.techtree.publishScienceRun(run.run_id, { visibility });

  return {
    ...run,
    artifact_envelope: artifactEnvelope,
    techtree_run: uploaded.data ?? created.data,
    publication: published.data.publication,
  };
}

async function resolveGoal(
  ctx: RuntimeContext,
  params: TerminalScienceRunParams,
  publishRun: boolean,
  cachedGoal: TerminalScienceRunResponse["goal"] | undefined,
): Promise<TerminalScienceRunResponse["goal"] | undefined> {
  if (params.task && publishRun) {
    const response = await ctx.techtree.createScienceGoal({
      task: params.task,
      agent: params.agent ?? ctx.config.workloads.science.defaultAgent,
      model: params.model ?? ctx.config.workloads.science.defaultModel,
      env: params.env ?? ctx.config.workloads.science.defaultEnvironment,
    });
    ctx.stateStore.patch({ techtreeScienceGoal: response.data });
    return response.data;
  }

  if (!cachedGoal && publishRun) {
    const response = await ctx.techtree.getActiveScienceGoal();
    ctx.stateStore.patch({ techtreeScienceGoal: response.data });
    return response.data;
  }

  return cachedGoal;
}

function publishableEnvelope(
  envelope: Record<string, unknown>,
  visibility: string,
): Record<string, unknown> & { artifacts: unknown } {
  const next = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown> & {
    artifacts?: unknown;
    publish?: Record<string, unknown>;
  };

  next.publish = {
    ...(next.publish ?? {}),
    publish_run: true,
    visibility,
  };

  if (!next.artifacts) {
    throw new Error("Terminal Science Bench run is missing artifacts.");
  }

  return next as Record<string, unknown> & { artifacts: unknown };
}

function normalizeScienceAgent(value: string): TerminalScienceAgentKey {
  if ((scienceAgents as readonly string[]).includes(value)) {
    return value as TerminalScienceAgentKey;
  }

  throw new Error("science agent must be codex, openclaw, hermes, or custom");
}
