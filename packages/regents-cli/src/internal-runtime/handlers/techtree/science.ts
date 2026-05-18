import type {
  TerminalScienceRunResponse,
  TerminalScienceSetGoalResponse,
} from "../../../internal-types/index.js";
import type { RuntimeContext } from "../../runtime.js";
import {
  buildAndRunTerminalScience,
  buildTerminalScienceGoal,
  type TerminalScienceRunParams,
  type TerminalScienceSetGoalParams,
} from "../../workloads/terminal-science.js";

export async function handleTechtreeScienceSetGoal(
  ctx: RuntimeContext,
  params: TerminalScienceSetGoalParams,
): Promise<TerminalScienceSetGoalResponse> {
  const goal = buildTerminalScienceGoal(ctx.config, params);
  ctx.stateStore.patch({ techtreeScienceGoal: goal });
  return { ok: true, goal };
}

export async function handleTechtreeScienceRun(
  ctx: RuntimeContext,
  params: TerminalScienceRunParams,
): Promise<TerminalScienceRunResponse> {
  const state = ctx.stateStore.read();
  const run = await buildAndRunTerminalScience(
    ctx.config,
    params,
    state.techtreeScienceGoal,
    state.agent,
  );

  ctx.stateStore.patch({ techtreeScienceGoal: run.goal });
  return run;
}
