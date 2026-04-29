import type { paths as AutolaunchPaths } from "../../generated/autolaunch-openapi.js";
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
} from "../../printer.js";
import type {
  JsonRequestBodyFor,
  JsonSuccessResponseFor,
} from "../../contracts/openapi-helpers.js";
import {
  parsePollingIntervalSeconds,
  requestJson,
  requestTypedJson,
  requireLaunchIdentity,
  requirePositional,
} from "./shared.js";

type LaunchPreviewBody = JsonRequestBodyFor<
  AutolaunchPaths,
  "/v1/agent/launch/preview",
  "post"
>;
type LaunchPreviewResponse = JsonSuccessResponseFor<
  AutolaunchPaths,
  "/v1/agent/launch/preview",
  "post"
>;
type LaunchCreateBody = JsonRequestBodyFor<
  AutolaunchPaths,
  "/v1/agent/launch/jobs",
  "post"
>;
type LaunchCreateResponse = JsonSuccessResponseFor<
  AutolaunchPaths,
  "/v1/agent/launch/jobs",
  "post"
>;

const AGENT_LAUNCH_TOTAL_SUPPLY = "100000000000000000000000000000";

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

export async function runAutolaunchLaunchPreview(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const required = requireLaunchIdentity(args);
  const body: LaunchPreviewBody = {
    agent_id: required.agent,
    chain_id: Number(required.chainId) as 84532 | 8453,
    token_name: required.name,
    token_symbol: required.symbol,
    agent_safe_address: required.agentSafeAddress,
    minimum_raise_usdc: requireArg(
      getFlag(args, "minimum-raise-usdc"),
      "minimum-raise-usdc",
    ),
    total_supply: AGENT_LAUNCH_TOTAL_SUPPLY,
    launch_notes: getFlag(args, "launch-notes"),
  };

  printJson(
    await requestTypedJson<LaunchPreviewResponse>(
      "POST",
      "/v1/agent/launch/preview",
      {
        body,
        requireAgentAuth: true,
        configPath,
        chainId: body.chain_id,
      },
    ),
  );
}

export async function runAutolaunchLaunchCreate(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const required = requireLaunchIdentity(args);

  const body: LaunchCreateBody = {
    agent_id: required.agent,
    chain_id: Number(required.chainId) as 84532 | 8453,
    token_name: required.name,
    token_symbol: required.symbol,
    agent_safe_address: required.agentSafeAddress,
    minimum_raise_usdc: requireArg(
      getFlag(args, "minimum-raise-usdc"),
      "minimum-raise-usdc",
    ),
    total_supply: AGENT_LAUNCH_TOTAL_SUPPLY,
    launch_notes: getFlag(args, "launch-notes"),
    wallet_address: requireArg(
      getFlag(args, "wallet-address"),
      "wallet-address",
    ),
    registry_address: requireArg(
      getFlag(args, "registry-address"),
      "registry-address",
    ),
    token_id: requireArg(getFlag(args, "token-id"), "token-id"),
    nonce: requireArg(getFlag(args, "nonce"), "nonce"),
    message: requireArg(getFlag(args, "message"), "message"),
    signature: requireArg(getFlag(args, "signature"), "signature"),
    issued_at: requireArg(getFlag(args, "issued-at"), "issued-at"),
  };

  printJson(
    await requestTypedJson<LaunchCreateResponse>("POST", "/v1/agent/launch/jobs", {
      body,
      requireAgentAuth: true,
      configPath,
      chainId: body.chain_id,
    }),
  );
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
      `/v1/agent/launch/jobs/${encodeURIComponent(jobId)}`,
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
