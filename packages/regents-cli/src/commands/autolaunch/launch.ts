import fs from "node:fs";
import path from "node:path";

import type { paths as AutolaunchPaths } from "../../generated/autolaunch-openapi.js";
import { CliUsageError } from "../../cli-usage-error.js";
import { loadConfig } from "../../internal-runtime/config.js";
import {
  getBooleanFlag,
  getFlag,
  requireArg,
  type ParsedCliArgs,
} from "../../parse.js";
import {
  CLI_PALETTE,
  isHumanTerminal,
  printJson,
  printJsonLine,
  printText,
  renderKeyValuePanel,
  renderPanel,
  tone,
} from "../../printer.js";
import type {
  JsonRequestBodyFor,
  JsonSuccessResponseFor,
} from "../../contracts/openapi-helpers.js";
import {
  appendQuery,
  parsePollingIntervalSeconds,
  requestJson,
  requestTypedJson,
  requireLaunchIdentity,
  requirePositional,
} from "./shared.js";

type LaunchPreviewBody = JsonRequestBodyFor<
  AutolaunchPaths,
  "/api/autolaunch/v1/agent/launch/preview",
  "post"
>;
type LaunchPreviewResponse = JsonSuccessResponseFor<
  AutolaunchPaths,
  "/api/autolaunch/v1/agent/launch/preview",
  "post"
>;
type LaunchCreationStateResponse = JsonSuccessResponseFor<
  AutolaunchPaths,
  "/api/autolaunch/v1/agent/launch/creation-state",
  "get"
>;

interface LocalPlanRecord {
  readonly plan_id: string;
  readonly saved_at: string;
  readonly remote_plan: Record<string, unknown>;
}

interface LaunchCreationStateEnvelope {
  readonly ok?: boolean;
  readonly creation_state?: LaunchCreationState;
}

interface LaunchCreationState {
  readonly selected?: Record<string, unknown>;
  readonly access_reason?: string;
  readonly tiers?: Record<string, unknown>;
}

interface TaskColumn {
  readonly key?: string;
  readonly label?: string;
  readonly tasks?: readonly TaskRow[];
}

interface TaskRow {
  readonly label?: string;
  readonly status?: string;
  readonly message?: string;
  readonly action_url?: string | null;
  readonly cli_command?: string | null;
  readonly blocking?: boolean;
}

const AGENT_LAUNCH_TOTAL_SUPPLY = "100000000000000000000000000000";
const PRELAUNCH_DIR = "autolaunch-plans";

const displayValue = (value: unknown): string | null => {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};

const renderLaunchJobTimeline = (payload: Record<string, unknown>, jobId: string): string => {
  const job = typeof payload.job === "object" && payload.job !== null
    ? payload.job as Record<string, unknown>
    : {};
  const steps = Array.isArray(payload.events)
    ? payload.events.filter((event): event is Record<string, unknown> => (
        !!event && typeof event === "object" && !Array.isArray(event)
      ))
    : [];

  return [
    renderKeyValuePanel("◆ LAUNCH JOB", [
      { label: "job id", value: displayValue(job.id) ?? jobId, valueColor: CLI_PALETTE.emphasis },
      { label: "status", value: displayValue(job.status) ?? displayValue(payload.status) ?? "unknown", valueColor: CLI_PALETTE.emphasis },
      ...(displayValue(job.chain_id) ? [{ label: "chain", value: String(job.chain_id) }] : []),
      ...(displayValue(job.updated_at) ? [{ label: "updated", value: String(job.updated_at) }] : []),
    ]),
    ...(steps.length > 0
      ? [
          renderKeyValuePanel("◆ LATEST STEP", [
            { label: "step", value: displayValue(steps.at(-1)?.kind) ?? displayValue(steps.at(-1)?.status) ?? "update" },
            ...(displayValue(steps.at(-1)?.occurred_at) ? [{ label: "time", value: String(steps.at(-1)?.occurred_at) }] : []),
          ]),
        ]
      : []),
  ].join("\n\n");
};

const printLaunchJobWatchPayload = (
  args: ParsedCliArgs,
  payload: Record<string, unknown>,
  jobId: string,
): void => {
  if (isHumanTerminal() && !getBooleanFlag(args, "json")) {
    printText(renderLaunchJobTimeline(payload, jobId));
    return;
  }

  printJsonLine(payload);
};

const stateDir = (configPath?: string): string =>
  loadConfig(configPath).runtime.stateDir;

const latestLocalPlan = (configPath?: string): LocalPlanRecord | null => {
  const dir = path.join(stateDir(configPath), PRELAUNCH_DIR);
  if (!fs.existsSync(dir)) {
    return null;
  }

  const files = fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dir, entry))
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);

  if (files.length === 0) {
    return null;
  }

  return JSON.parse(fs.readFileSync(files[0]!.filePath, "utf8")) as LocalPlanRecord;
};

const selectedTaskStateQuery = (
  args: ParsedCliArgs,
  configPath?: string,
): Record<string, string | undefined> => {
  const selectors = [
    ["plan_id", getFlag(args, "plan")],
    ["job_id", getFlag(args, "job")],
    ["auction_id", getFlag(args, "auction")],
  ] as const;
  const selected = selectors.filter(([, value]) => !!value);

  if (selected.length > 1) {
    throw new CliUsageError({
      code: "invalid_flags",
      message: "Use only one of --plan, --job, or --auction.",
    });
  }

  if (selected.length === 1) {
    const [key, value] = selected[0]!;
    return { [key]: value };
  }

  const localPlan = latestLocalPlan(configPath);
  return localPlan ? { plan_id: localPlan.plan_id } : {};
};

const statusLabel = (status: string | undefined): string => {
  switch (status) {
    case "ready":
      return "ready";
    case "needs_action":
      return "needs action";
    case "later":
      return "later";
    case "optional":
      return "optional";
    default:
      return "unknown";
  }
};

const statusColor = (status: string | undefined): string => {
  switch (status) {
    case "ready":
      return CLI_PALETTE.accent;
    case "needs_action":
      return CLI_PALETTE.error;
    case "later":
    case "optional":
      return CLI_PALETTE.secondary;
    default:
      return CLI_PALETTE.secondary;
  }
};

const objectValue = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
};

const taskColumns = (value: unknown): readonly TaskColumn[] =>
  Array.isArray(value)
    ? value.filter((item): item is TaskColumn => !!item && typeof item === "object" && !Array.isArray(item))
    : [];

const taskRows = (value: unknown): readonly TaskRow[] =>
  Array.isArray(value)
    ? value.filter((item): item is TaskRow => !!item && typeof item === "object" && !Array.isArray(item))
    : [];

const renderTaskRow = (task: TaskRow): string => {
  const status = statusLabel(task.status);
  const label = displayValue(task.label) ?? "Task";
  const message = displayValue(task.message);
  const command = displayValue(task.cli_command ?? undefined);
  const actionUrl = displayValue(task.action_url ?? undefined);
  const head = `${tone(status, statusColor(task.status), task.status === "ready")} ${label}`;
  const details = [
    message ? `- ${message}` : undefined,
    command ? `- ${command}` : undefined,
    actionUrl && !command ? `- ${actionUrl}` : undefined,
  ].filter(Boolean);

  return [head, ...details].join(" ");
};

const renderTierPanel = (
  title: string,
  columns: readonly TaskColumn[],
): string => {
  const lines = columns.flatMap((column) => {
    const label = displayValue(column.label) ?? "Tasks";
    const tasks = taskRows(column.tasks);
    return [
      tone(label, CLI_PALETTE.accent, true),
      ...(tasks.length > 0 ? tasks.map(renderTaskRow) : ["No tasks yet."].map((line) => tone(line, CLI_PALETTE.secondary))),
      "",
    ];
  });

  return renderPanel(title, lines.slice(0, -1));
};

export const renderLaunchCreationState = (
  payload: LaunchCreationStateEnvelope,
): string => {
  const state = payload.creation_state ?? {};
  const selected = state.selected ?? {};
  const tiers = objectValue(state.tiers) ?? {};

  const summary = renderKeyValuePanel("◆ PRIVATE LAUNCH STATE", [
    { label: "plan", value: displayValue(selected.plan_id) ?? "latest accessible" },
    ...(displayValue(selected.job_id) ? [{ label: "job", value: String(selected.job_id) }] : []),
    ...(displayValue(selected.auction_id) ? [{ label: "auction", value: String(selected.auction_id) }] : []),
    ...(displayValue(selected.agent_name) ? [{ label: "agent", value: String(selected.agent_name) }] : []),
    ...(displayValue(selected.token_symbol) ? [{ label: "token", value: String(selected.token_symbol) }] : []),
    { label: "access", value: displayValue(state.access_reason) ?? "private" },
  ]);

  return [
    summary,
    renderTierPanel("◆ REQUIRED BEFORE LAUNCH", taskColumns(tiers.required)),
    renderTierPanel("◆ RECOMMENDED TRUST SIGNALS", taskColumns(tiers.recommended)),
    renderTierPanel("◆ EXTRA PUBLIC SIGNALS", taskColumns(tiers.extra)),
  ].join("\n\n");
};

const printLaunchCreationState = (
  args: ParsedCliArgs,
  payload: LaunchCreationStateEnvelope,
): void => {
  if (isHumanTerminal() && !getBooleanFlag(args, "json")) {
    printText(renderLaunchCreationState(payload));
    return;
  }

  printJson(payload);
};

export async function runAutolaunchLaunchPreview(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const required = requireLaunchIdentity(args);
  const body: LaunchPreviewBody = {
    agent_id: required.agent,
    chain_id: Number(required.chainId) as 8453,
    token_name: required.name,
    token_symbol: required.symbol,
    agent_safe_address: required.agentSafeAddress,
    minimum_raise_quote: requireArg(
      getFlag(args, "minimum-raise-quote"),
      "minimum-raise-quote",
    ),
    total_supply: AGENT_LAUNCH_TOTAL_SUPPLY,
    launch_notes: getFlag(args, "launch-notes"),
  };

  printJson(
    await requestTypedJson<LaunchPreviewResponse>(
      "POST",
      "/api/autolaunch/v1/agent/launch/preview",
      {
        body,
        requireAgentAuth: true,
        configPath,
        chainId: body.chain_id,
      },
    ),
  );
}

export async function runAutolaunchLaunchState(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const payload = await requestTypedJson<LaunchCreationStateResponse>(
    "GET",
    appendQuery(
      "/api/autolaunch/v1/agent/launch/creation-state",
      selectedTaskStateQuery(args, configPath),
    ),
    { requireAgentAuth: true, configPath },
  );

  printLaunchCreationState(args, payload);
}

export async function runAutolaunchJobsWatch(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const jobId = requirePositional(args, 3, "job-id");
  const intervalSeconds = parsePollingIntervalSeconds(args);
  const shouldWatch = getBooleanFlag(args, "watch");

  for (;;) {
    const payload = await requestJson(
      "GET",
      `/api/autolaunch/v1/agent/launch/jobs/${encodeURIComponent(jobId)}`,
      { requireAgentAuth: true, configPath },
    );
    printLaunchJobWatchPayload(args, payload, jobId);

    const status =
      typeof payload.job === "object" && payload.job
        ? (payload.job as Record<string, unknown>).status
        : undefined;
    if (
      !shouldWatch ||
      status === "ready" ||
      status === "failed" ||
      status === "blocked"
    ) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}
