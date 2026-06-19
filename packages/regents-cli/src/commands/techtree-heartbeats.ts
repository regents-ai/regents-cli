import fs from "node:fs";

import { CliUsageError } from "../cli-usage-error.js";
import { withNextSteps } from "../command-payload.js";
import { daemonCall } from "../daemon-client.js";
import type {
  HeartbeatScheduleEntry,
  HeartbeatScheduleResponse,
  HeartbeatWakeupCompleteInput,
  HeartbeatWakeupListResponse,
  HeartbeatWakeupStartInput,
} from "../internal-types/index.js";
import {
  getBooleanFlag,
  getFlag,
  parsePositiveInteger,
  requireArg,
  requirePositional,
  type ParsedCliArgs,
} from "../parse.js";
import { isHumanTerminal, printJson, printText } from "../printer.js";
import { renderTablePanel } from "../terminal/table.js";

const COMPLETION_STATUSES = new Set(["completed", "failed", "no_work"]);

const readJsonObjectValue = (value: string, name: string): Record<string, unknown> => {
  const raw = value.startsWith("@") ? fs.readFileSync(value.slice(1), "utf8") : value;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`invalid ${name}`);
  }
};

const parseNonNegativeInteger = (value: string | undefined, name: string): number => {
  const raw = requireArg(value, name);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== raw) {
    throw new CliUsageError({
      code: "invalid_flag_value",
      message: `invalid integer for ${name}`,
    });
  }

  return parsed;
};

const parseOptionalPositiveInteger = (value: string | undefined, name: string): number | undefined =>
  value === undefined ? undefined : parsePositiveInteger(value, `invalid integer for ${name}`);

const parseCompletionStatus = (value: string | undefined): HeartbeatWakeupCompleteInput["status"] => {
  if (value === undefined) {
    return undefined;
  }

  if (!COMPLETION_STATUSES.has(value)) {
    throw new Error("invalid --status");
  }

  return value as HeartbeatWakeupCompleteInput["status"];
};

const maybeJsonObject = (args: ParsedCliArgs, flagName: string): Record<string, unknown> | undefined => {
  const value = getFlag(args, flagName);
  return value ? readJsonObjectValue(value, `--${flagName}`) : undefined;
};

const formatInterval = (seconds: number): string => {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3_600) {
    return `${Math.floor(seconds / 60)}m`;
  }

  return `${Math.floor(seconds / 3_600)}h`;
};

const formatTokenBudget = (value: number | null): string => (value === null ? "open" : String(value));

const renderSchedule = (entries: readonly HeartbeatScheduleEntry[]): string =>
  renderTablePanel(
    "HEARTBEATS",
    [
      { header: "name" },
      { header: "every" },
      { header: "tokens", align: "right" },
      { header: "purpose" },
    ],
    entries.map((entry) => ({
      cells: [
        entry.name,
        formatInterval(entry.interval_seconds),
        formatTokenBudget(entry.token_budget),
        entry.purpose,
      ],
    })),
  );

export async function runTechtreeHeartbeatSchedule(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const response = (await daemonCall(
    "techtree.heartbeats.schedule",
    undefined,
    configPath,
  )) as HeartbeatScheduleResponse;

  if (isHumanTerminal() && !getBooleanFlag(args, "json")) {
    printText(renderSchedule(response.data));
    return;
  }

  printJson(withNextSteps(response, ["regents techtree heartbeats start --heartbeat work_pickup --json"]));
}

export async function runTechtreeHeartbeatList(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.heartbeats.list",
      {
        cursor: parseOptionalPositiveInteger(getFlag(args, "cursor"), "--cursor"),
        limit: parseOptionalPositiveInteger(getFlag(args, "limit"), "--limit"),
      },
      configPath,
    ) as HeartbeatWakeupListResponse,
  );
}

export async function runTechtreeHeartbeatStart(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const payload: HeartbeatWakeupStartInput = {
    heartbeat_name: requireArg(getFlag(args, "heartbeat"), "--heartbeat"),
    runtime: getFlag(args, "runtime"),
    planned_at: getFlag(args, "planned-at"),
    techtree_refs: maybeJsonObject(args, "refs"),
    metadata: maybeJsonObject(args, "metadata"),
  };

  printJson(
    withNextSteps(await daemonCall("techtree.heartbeats.start", payload, configPath), [
      "regents techtree heartbeats complete <wakeup_id> --input-tokens 0 --output-tokens 0 --total-tokens 0 --summary \"Checked for work\" --json",
    ]),
  );
}

export async function runTechtreeHeartbeatComplete(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const payload: { wakeup_id: number } & HeartbeatWakeupCompleteInput = {
    wakeup_id: parsePositiveInteger(requirePositional(args, 3, "wakeup id"), "invalid wakeup id"),
    status: parseCompletionStatus(getFlag(args, "status")),
    input_tokens: parseNonNegativeInteger(getFlag(args, "input-tokens"), "--input-tokens"),
    output_tokens: parseNonNegativeInteger(getFlag(args, "output-tokens"), "--output-tokens"),
    total_tokens: parseNonNegativeInteger(getFlag(args, "total-tokens"), "--total-tokens"),
    summary: requireArg(getFlag(args, "summary"), "--summary"),
    techtree_refs: maybeJsonObject(args, "refs"),
    metadata: maybeJsonObject(args, "metadata"),
  };

  printJson(
    withNextSteps(await daemonCall("techtree.heartbeats.complete", payload, configPath), [
      "Open the Techtree heartbeat link to review the tracked work.",
    ]),
  );
}
