import type { paths as AutolaunchPaths } from "../../generated/autolaunch-openapi.js";
import {
  getBooleanFlag,
  getFlag,
  requireArg,
  type ParsedCliArgs,
} from "../../parse.js";
import { printJson } from "../../printer.js";
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
    printJson(payload);

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
