import type {
  HeartbeatScheduleResponse,
  HeartbeatWakeupCompleteInput,
  HeartbeatWakeupListResponse,
  HeartbeatWakeupResponse,
  HeartbeatWakeupStartInput,
} from "../../../internal-types/index.js";
import type { RuntimeContext } from "../../runtime.js";

export async function handleTechtreeHeartbeatSchedule(
  ctx: RuntimeContext,
): Promise<HeartbeatScheduleResponse> {
  return ctx.techtree.heartbeatSchedule();
}

export async function handleTechtreeHeartbeatList(
  ctx: RuntimeContext,
  params?: { cursor?: number; limit?: number },
): Promise<HeartbeatWakeupListResponse> {
  return ctx.techtree.listHeartbeatWakeups(params);
}

export async function handleTechtreeHeartbeatStart(
  ctx: RuntimeContext,
  params: HeartbeatWakeupStartInput,
): Promise<HeartbeatWakeupResponse> {
  return ctx.techtree.startHeartbeatWakeup(params);
}

export async function handleTechtreeHeartbeatComplete(
  ctx: RuntimeContext,
  params: { wakeup_id: number } & HeartbeatWakeupCompleteInput,
): Promise<HeartbeatWakeupResponse> {
  const { wakeup_id: wakeupId, ...input } = params;
  return ctx.techtree.completeHeartbeatWakeup(wakeupId, input);
}
