import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  components as AutolaunchComponents,
  paths as AutolaunchPaths,
} from "../../generated/autolaunch-openapi.js";
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
  appendQuery,
  baseUrl,
  extractPreparedTxRequest,
  launchChainId,
  parsePollingIntervalSeconds,
  requestJson,
  requestTypedJson,
  requireLaunchIdentity,
  requirePositional,
  submitPreparedTxRequest,
} from "./shared.js";

const execFileAsync = promisify(execFile);

type AutolaunchAgentsListResponse = JsonSuccessResponseFor<
  AutolaunchPaths,
  "/v1/agent/agents",
  "get"
>;
type AutolaunchAgentResponse = JsonSuccessResponseFor<
  AutolaunchPaths,
  "/v1/agent/agents/{id}",
  "get"
>;
type AutolaunchAgentReadinessResponse = JsonSuccessResponseFor<
  AutolaunchPaths,
  "/v1/agent/agents/{id}/readiness",
  "get"
>;
type AutolaunchAuctionsListResponse = JsonSuccessResponseFor<
  AutolaunchPaths,
  "/v1/agent/auctions",
  "get"
>;
type AutolaunchAuctionResponse = JsonSuccessResponseFor<
  AutolaunchPaths,
  "/v1/agent/auctions/{id}",
  "get"
>;
type XLinkStartBody = {
  agent_id: string;
};
type XLinkStartResponse = {
  ok: true;
  provider: string;
  trust_provider: string;
  agent_id: string;
  redirect_path: string;
  [key: string]: unknown;
};
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

const postBidMutation = async (
  action: "exit" | "claim",
  bidId: string,
  txHash: string,
): Promise<void> => {
  printJson(
    await requestJson(
      "POST",
      `/v1/agent/bids/${encodeURIComponent(bidId)}/${action}`,
      {
        body: { tx_hash: txHash },
        requireAgentAuth: true,
      },
    ),
  );
};

const prepareOrSubmitWrite = async (
  method: "POST",
  path: string,
  body: Record<string, unknown>,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> => {
  const prepared = await requestJson(method, path, {
    body,
    requireAgentAuth: true,
  });

  if (!getBooleanFlag(args, "submit")) {
    printJson(prepared);
    return;
  }

  const txRequest = extractPreparedTxRequest(prepared.tx_request);

  if (!txRequest) {
    printJson(prepared);
    return;
  }

  const txHash = await submitPreparedTxRequest(txRequest, configPath);
  printJson(
    await requestJson(method, path, {
      body: { ...body, tx_hash: txHash },
      requireAgentAuth: true,
    }),
  );
};

const prepareOrSubmitPreparedOnly = async (
  method: "POST",
  path: string,
  body: Record<string, unknown>,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> => {
  const prepared = await requestJson(method, path, {
    body,
    requireAgentAuth: true,
  });

  if (!getBooleanFlag(args, "submit")) {
    printJson(prepared);
    return;
  }

  const txRequest = extractPreparedTxRequest(prepared.tx_request);

  if (!txRequest) {
    printJson(prepared);
    return;
  }

  const txHash = await submitPreparedTxRequest(txRequest, configPath);
  printJson({ ...prepared, submitted: true, tx_hash: txHash });
};

const AGENT_LAUNCH_TOTAL_SUPPLY = "100000000000000000000000000000";

const openBrowser = async (url: string): Promise<boolean> => {
  try {
    if (process.platform === "darwin") {
      await execFileAsync("open", [url]);
      return true;
    }

    if (process.platform === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", url]);
      return true;
    }

    await execFileAsync("xdg-open", [url]);
    return true;
  } catch {
    return false;
  }
};

export async function runAutolaunchAgentsList(
  args: ParsedCliArgs,
): Promise<void> {
  printJson(
    await requestTypedJson<AutolaunchAgentsListResponse>(
      "GET",
      appendQuery("/v1/agent/agents", {
        launchable: getBooleanFlag(args, "launchable"),
      }),
    ),
  );
}

export async function runAutolaunchAgentShow(agentId: string): Promise<void> {
  printJson(
    await requestTypedJson<AutolaunchAgentResponse>(
      "GET",
      `/v1/agent/agents/${encodeURIComponent(agentId)}`,
    ),
  );
}

export async function runAutolaunchAgentReadiness(
  agentId: string,
): Promise<void> {
  printJson(
    await requestTypedJson<AutolaunchAgentReadinessResponse>(
      "GET",
      `/v1/agent/agents/${encodeURIComponent(agentId)}/readiness`,
    ),
  );
}

export async function runAutolaunchTrustXLink(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const body: XLinkStartBody = {
    agent_id: requireArg(getFlag(args, "agent"), "agent"),
  };
  const response = await requestTypedJson<XLinkStartResponse>(
    "POST",
    "/v1/agent/trust/x/start",
    {
      body,
      requireAgentAuth: true,
      configPath,
    },
  );
  const redirectUrl = new URL(
    response.redirect_path,
    `${baseUrl()}/`,
  ).toString();
  const browserOpened = await openBrowser(redirectUrl);

  printJson({
    ...response,
    redirect_url: redirectUrl,
    browser_opened: browserOpened,
    ...(browserOpened
      ? {}
      : {
          fallback: "browser_open_failed",
          manual_open_url: redirectUrl,
          message: `Open this URL manually: ${redirectUrl}`,
        }),
  });
}

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

export async function runAutolaunchAuctionsList(
  args: ParsedCliArgs,
): Promise<void> {
  printJson(
    await requestTypedJson<AutolaunchAuctionsListResponse>(
      "GET",
      appendQuery("/v1/agent/auctions", {
        sort: getFlag(args, "sort") ?? "hottest",
        status: getFlag(args, "status"),
        chain: getFlag(args, "chain"),
        mine_only: getBooleanFlag(args, "mine-only"),
      }),
    ),
  );
}

export async function runAutolaunchAuctionShow(
  auctionId: string,
): Promise<void> {
  printJson(
    await requestTypedJson<AutolaunchAuctionResponse>(
      "GET",
      `/v1/agent/auctions/${encodeURIComponent(auctionId)}`,
    ),
  );
}

export async function runAutolaunchBidsQuote(
  args: ParsedCliArgs,
): Promise<void> {
  const auctionId = requireArg(getFlag(args, "auction"), "auction");
  const body = {
    amount: requireArg(getFlag(args, "amount"), "amount"),
    max_price: requireArg(getFlag(args, "max-price"), "max-price"),
  };

  printJson(
    await requestJson(
      "POST",
      `/v1/agent/auctions/${encodeURIComponent(auctionId)}/bid_quote`,
      {
        body,
      },
    ),
  );
}

export async function runAutolaunchBidsPlace(
  args: ParsedCliArgs,
): Promise<void> {
  const auctionId = requireArg(getFlag(args, "auction"), "auction");
  const body = {
    amount: requireArg(getFlag(args, "amount"), "amount"),
    max_price: requireArg(getFlag(args, "max-price"), "max-price"),
    tx_hash: requireArg(getFlag(args, "tx-hash"), "tx-hash"),
    current_clearing_price: getFlag(args, "current-clearing-price"),
    projected_clearing_price: getFlag(args, "projected-clearing-price"),
    estimated_tokens_if_end_now: getFlag(args, "estimated-tokens-if-end-now"),
    estimated_tokens_if_no_other_bids_change: getFlag(
      args,
      "estimated-tokens-if-no-other-bids-change",
    ),
    inactive_above_price: getFlag(args, "inactive-above-price"),
    status_band: getFlag(args, "status-band"),
  };

  printJson(
    await requestJson(
      "POST",
      `/v1/agent/auctions/${encodeURIComponent(auctionId)}/bids`,
      {
        body,
        requireAgentAuth: true,
      },
    ),
  );
}

export async function runAutolaunchBidsMine(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await requestJson(
      "GET",
      appendQuery("/v1/agent/me/bids", {
        auction: getFlag(args, "auction"),
        status: getFlag(args, "status"),
      }),
      { requireAgentAuth: true, configPath },
    ),
  );
}

export async function runAutolaunchBidsExit(
  args: ParsedCliArgs,
): Promise<void> {
  const bidId = requirePositional(args, 3, "bid-id");
  await postBidMutation(
    "exit",
    bidId,
    requireArg(getFlag(args, "tx-hash"), "tx-hash"),
  );
}

export async function runAutolaunchBidsClaim(
  args: ParsedCliArgs,
): Promise<void> {
  const bidId = requirePositional(args, 3, "bid-id");
  await postBidMutation(
    "claim",
    bidId,
    requireArg(getFlag(args, "tx-hash"), "tx-hash"),
  );
}

const loadTrackedPositions = async (
  args: ParsedCliArgs,
  configPath?: string,
) =>
  requestJson(
    "GET",
    appendQuery("/v1/agent/me/bids", {
      auction: getFlag(args, "auction"),
      status: getFlag(args, "status"),
    }),
    { requireAgentAuth: true, configPath },
  );

const requireTrackedPosition = async (
  bidId: string,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<Record<string, unknown>> => {
  const payload = await loadTrackedPositions(args, configPath);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const position = items.find(
    (item) =>
      typeof item === "object" &&
      item &&
      (item as Record<string, unknown>).bid_id === bidId,
  );
  if (!position || typeof position !== "object") {
    throw new Error(`tracked bid not found: ${bidId}`);
  }

  return position as Record<string, unknown>;
};

const prepareOrSubmitPositionAction = async (
  bidId: string,
  kind: "return-usdc" | "exit" | "claim",
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> => {
  const position = await requireTrackedPosition(bidId, args, configPath);

  const prepared =
    kind === "return-usdc"
      ? (position.return_action as Record<string, unknown> | undefined)
      : ((position.tx_actions as Record<string, unknown> | undefined)?.[
          kind === "claim" ? "claim" : "exit"
        ] as Record<string, unknown> | undefined);

  if (!prepared) {
    printJson({
      ok: false,
      error: `no ${kind} action is currently available`,
      bid_id: bidId,
      position,
    });
    return;
  }

  if (!getBooleanFlag(args, "submit")) {
    printJson({ ok: true, bid_id: bidId, action: kind, prepared });
    return;
  }

  const txRequest = extractPreparedTxRequest(prepared.tx_request);
  if (!txRequest) {
    printJson({
      ok: false,
      error: "prepared action did not include tx_request",
      bid_id: bidId,
    });
    return;
  }

  const txHash = await submitPreparedTxRequest(txRequest, configPath);
  const endpoint =
    kind === "return-usdc"
      ? `/v1/agent/bids/${encodeURIComponent(bidId)}/return-usdc`
      : `/v1/agent/bids/${encodeURIComponent(bidId)}/${kind}`;

  printJson(
    await requestJson("POST", endpoint, {
      body: { tx_hash: txHash },
      requireAgentAuth: true,
      configPath,
    }),
  );
};

export async function runAutolaunchAuctionReturnsList(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await requestJson(
      "GET",
      appendQuery("/v1/agent/auction-returns", {
        limit: getFlag(args, "limit"),
        offset: getFlag(args, "offset"),
      }),
      { requireAgentAuth: true, configPath },
    ),
  );
}

export async function runAutolaunchPositionsList(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(await loadTrackedPositions(args, configPath));
}

export async function runAutolaunchPositionsReturnUsdc(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  await prepareOrSubmitPositionAction(
    requirePositional(args, 3, "bid-id"),
    "return-usdc",
    args,
    configPath,
  );
}

export async function runAutolaunchPositionsExit(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  await prepareOrSubmitPositionAction(
    requirePositional(args, 3, "bid-id"),
    "exit",
    args,
    configPath,
  );
}

export async function runAutolaunchPositionsClaim(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  await prepareOrSubmitPositionAction(
    requirePositional(args, 3, "bid-id"),
    "claim",
    args,
    configPath,
  );
}

const buildEnsLinkBody = (args: ParsedCliArgs): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    ens_name: requireArg(getFlag(args, "ens"), "ens"),
  };

  const identity = getFlag(args, "identity");
  if (identity) {
    body.identity_id = identity;
  }

  const chainId = getFlag(args, "chain-id") ?? launchChainId(args);
  if (chainId) {
    body.chain_id = chainId;
  }

  const agentId = getFlag(args, "agent-id");
  if (agentId) {
    body.agent_id = agentId;
  }

  const signerAddress = getFlag(args, "signer-address");
  if (signerAddress) {
    body.signer_address = signerAddress;
  }

  if (getBooleanFlag(args, "include-reverse")) {
    body.include_reverse = true;
  }

  return body;
};

export async function runAutolaunchEnsPlan(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await requestJson("POST", "/v1/agent/ens/link/plan", {
      body: buildEnsLinkBody(args),
      requireAgentAuth: true,
      configPath,
    }),
  );
}

export async function runAutolaunchEnsPrepareEnsip25(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await requestJson("POST", "/v1/agent/ens/link/prepare-ensip25", {
      body: buildEnsLinkBody(args),
      requireAgentAuth: true,
      configPath,
    }),
  );
}

export async function runAutolaunchEnsPrepareErc8004(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await requestJson("POST", "/v1/agent/ens/link/prepare-erc8004", {
      body: buildEnsLinkBody(args),
      requireAgentAuth: true,
      configPath,
    }),
  );
}

export async function runAutolaunchEnsPrepareBidirectional(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  printJson(
    await requestJson("POST", "/v1/agent/ens/link/prepare-bidirectional", {
      body: buildEnsLinkBody(args),
      requireAgentAuth: true,
      configPath,
    }),
  );
}

const requireJobFlag = (args: ParsedCliArgs): string =>
  requireArg(getFlag(args, "job"), "job");
const requireSubjectFlag = (args: ParsedCliArgs): string =>
  requireArg(getFlag(args, "subject"), "subject");

const postPrepareJobAction = async (
  args: ParsedCliArgs,
  resource: string,
  action: string,
  body: Record<string, unknown> = {},
  configPath?: string,
): Promise<void> => {
  const jobId = requireJobFlag(args);

  printJson(
    await requestJson(
      "POST",
      `/v1/agent/contracts/jobs/${encodeURIComponent(jobId)}/${resource}/${action}/prepare`,
      { body, requireAgentAuth: true, configPath },
    ),
  );
};

const postPrepareSubjectAction = async (
  args: ParsedCliArgs,
  resource: string,
  action: string,
  body: Record<string, unknown> = {},
  configPath?: string,
): Promise<void> => {
  const subjectId = requireSubjectFlag(args);

  printJson(
    await requestJson(
      "POST",
      `/v1/agent/contracts/subjects/${encodeURIComponent(subjectId)}/${resource}/${action}/prepare`,
      { body, requireAgentAuth: true, configPath },
    ),
  );
};

const postPrepareAdminAction = async (
  resource: string,
  action: string,
  body: Record<string, unknown> = {},
  configPath?: string,
): Promise<void> => {
  printJson(
    await requestJson(
      "POST",
      `/v1/agent/contracts/admin/${resource}/${action}/prepare`,
      {
        body,
        requireAgentAuth: true,
        configPath,
      },
    ),
  );
};

export async function runAutolaunchSubjectShow(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(
    await requestJson("GET", `/v1/agent/subjects/${encodeURIComponent(subjectId)}`, {
      requireAgentAuth: true,
      configPath,
    }),
  );
}

export async function runAutolaunchSubjectIngress(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(
    await requestJson(
      "GET",
      `/v1/agent/subjects/${encodeURIComponent(subjectId)}/ingress`,
      { requireAgentAuth: true, configPath },
    ),
  );
}

export async function runAutolaunchSubjectStake(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/stake`,
    { amount: requireArg(getFlag(args, "amount"), "amount") },
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectUnstake(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/unstake`,
    { amount: requireArg(getFlag(args, "amount"), "amount") },
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectClaimUsdc(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-usdc`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectClaimEmissions(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-emissions`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectClaimAndStakeEmissions(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-and-stake-emissions`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchSubjectSweepIngress(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  const address = requireArg(getFlag(args, "address"), "address");

  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/ingress/${encodeURIComponent(address)}/sweep`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchHoldingsList(
  args: ParsedCliArgs,
): Promise<void> {
  printJson(
    await requestJson(
      "GET",
      appendQuery("/v1/agent/me/holdings", {
        subject: getFlag(args, "subject"),
      }),
      { requireAgentAuth: true },
    ),
  );
}

const requireHoldingSubjectId = (args: ParsedCliArgs): string =>
  requirePositional(args, 3, "subject-id");

export async function runAutolaunchHoldingsStake(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireHoldingSubjectId(args);
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/stake`,
    { amount: requireArg(getFlag(args, "amount"), "amount") },
    args,
    configPath,
  );
}

export async function runAutolaunchHoldingsUnstake(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireHoldingSubjectId(args);
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/unstake`,
    { amount: requireArg(getFlag(args, "amount"), "amount") },
    args,
    configPath,
  );
}

export async function runAutolaunchHoldingsClaimUsdc(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireHoldingSubjectId(args);
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-usdc`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchHoldingsClaimEmissions(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireHoldingSubjectId(args);
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-emissions`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchHoldingsClaimAndStakeEmissions(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireHoldingSubjectId(args);
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/claim-and-stake-emissions`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchHoldingsSweepIngress(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireHoldingSubjectId(args);
  const ingressAddress = requireArg(getFlag(args, "address"), "address");
  await prepareOrSubmitWrite(
    "POST",
    `/v1/agent/subjects/${encodeURIComponent(subjectId)}/ingress/${encodeURIComponent(ingressAddress)}/sweep`,
    {},
    args,
    configPath,
  );
}

export async function runAutolaunchContractsAdminShow(
  configPath?: string,
): Promise<void> {
  printJson(
    await requestJson("GET", "/v1/agent/contracts/admin", {
      requireAgentAuth: true,
      configPath,
    }),
  );
}

export async function runAutolaunchContractsJobShow(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const jobId = requireJobFlag(args);
  printJson(
    await requestJson(
      "GET",
      `/v1/agent/contracts/jobs/${encodeURIComponent(jobId)}`,
      { requireAgentAuth: true, configPath },
    ),
  );
}

export async function runAutolaunchContractsSubjectShow(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const subjectId = requireSubjectFlag(args);
  printJson(
    await requestJson(
      "GET",
      `/v1/agent/contracts/subjects/${encodeURIComponent(subjectId)}`,
      { requireAgentAuth: true, configPath },
    ),
  );
}

export async function runAutolaunchStrategyMigrate(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  await postPrepareJobAction(args, "strategy", "migrate", {}, configPath);
}

export async function runAutolaunchStrategySweepToken(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareJobAction(args, "strategy", "sweep_token");
}

export async function runAutolaunchStrategySweepCurrency(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareJobAction(args, "strategy", "sweep_currency");
}

export async function runAutolaunchVestingRelease(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareJobAction(args, "vesting", "release");
}

export async function runAutolaunchVestingProposeBeneficiaryRotation(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareJobAction(args, "vesting", "propose_beneficiary_rotation", {
    beneficiary: requireArg(getFlag(args, "beneficiary"), "beneficiary"),
  });
}

export async function runAutolaunchVestingCancelBeneficiaryRotation(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareJobAction(args, "vesting", "cancel_beneficiary_rotation");
}

export async function runAutolaunchVestingExecuteBeneficiaryRotation(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareJobAction(args, "vesting", "execute_beneficiary_rotation");
}

export async function runAutolaunchFeeRegistryShow(
  args: ParsedCliArgs,
): Promise<void> {
  await runAutolaunchContractsJobShow(args);
}

export async function runAutolaunchFeeVaultShow(
  args: ParsedCliArgs,
): Promise<void> {
  await runAutolaunchContractsJobShow(args);
}

export async function runAutolaunchFeeVaultWithdrawTreasury(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareJobAction(args, "fee_vault", "withdraw_treasury", {
    currency: requireArg(getFlag(args, "currency"), "currency"),
    amount: requireArg(getFlag(args, "amount"), "amount"),
    recipient: requireArg(getFlag(args, "recipient"), "recipient"),
  });
}

export async function runAutolaunchFeeVaultWithdrawRegent(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareJobAction(args, "fee_vault", "withdraw_regent_share", {
    currency: requireArg(getFlag(args, "currency"), "currency"),
    amount: requireArg(getFlag(args, "amount"), "amount"),
    recipient: requireArg(getFlag(args, "recipient"), "recipient"),
  });
}

export async function runAutolaunchSplitterShow(
  args: ParsedCliArgs,
): Promise<void> {
  await runAutolaunchContractsSubjectShow(args);
}

export async function runAutolaunchSplitterSetPaused(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "set_paused", {
    paused: requireArg(getFlag(args, "paused"), "paused"),
  });
}

export async function runAutolaunchSplitterSetLabel(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "set_label", {
    label: requireArg(getFlag(args, "label"), "label"),
  });
}

export async function runAutolaunchSplitterProposeTreasuryRecipientRotation(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(
    args,
    "splitter",
    "propose_treasury_recipient_rotation",
    {
      recipient: requireArg(getFlag(args, "recipient"), "recipient"),
    },
  );
}

export async function runAutolaunchSplitterCancelTreasuryRecipientRotation(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(
    args,
    "splitter",
    "cancel_treasury_recipient_rotation",
  );
}

export async function runAutolaunchSplitterExecuteTreasuryRecipientRotation(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(
    args,
    "splitter",
    "execute_treasury_recipient_rotation",
  );
}

export async function runAutolaunchSplitterSetProtocolRecipient(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "set_protocol_recipient", {
    recipient: requireArg(getFlag(args, "recipient"), "recipient"),
  });
}

export async function runAutolaunchSplitterSweepTreasuryResidual(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "sweep_treasury_residual", {
    amount: requireArg(getFlag(args, "amount"), "amount"),
  });
}

export async function runAutolaunchSplitterSweepProtocolReserve(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "sweep_protocol_reserve", {
    amount: requireArg(getFlag(args, "amount"), "amount"),
  });
}

export async function runAutolaunchSplitterReassignDust(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "reassign_dust", {
    amount: requireArg(getFlag(args, "amount"), "amount"),
  });
}

export async function runAutolaunchIngressCreate(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "ingress_factory", "create", {
    label: requireArg(getFlag(args, "label"), "label"),
    make_default: getFlag(args, "make-default") ?? "false",
  });
}

export async function runAutolaunchIngressSetDefault(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "ingress_factory", "set_default", {
    ingress_address: requireArg(getFlag(args, "address"), "address"),
  });
}

export async function runAutolaunchIngressSetLabel(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "ingress_account", "set_label", {
    ingress_address: requireArg(getFlag(args, "address"), "address"),
    label: requireArg(getFlag(args, "label"), "label"),
  });
}

export async function runAutolaunchIngressRescue(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "ingress_account", "rescue", {
    ingress_address: requireArg(getFlag(args, "address"), "address"),
    token: requireArg(getFlag(args, "token"), "token"),
    amount: requireArg(getFlag(args, "amount"), "amount"),
    recipient: requireArg(getFlag(args, "recipient"), "recipient"),
  });
}

export async function runAutolaunchRegistryShow(
  args: ParsedCliArgs,
): Promise<void> {
  await runAutolaunchContractsSubjectShow(args);
}

export async function runAutolaunchRegistrySetSubjectManager(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "registry", "set_subject_manager", {
    account: requireArg(getFlag(args, "account"), "account"),
    enabled: requireArg(getFlag(args, "enabled"), "enabled"),
  });
}

export async function runAutolaunchRegistryLinkIdentity(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "registry", "link_identity", {
    identity_chain_id: requireArg(
      getFlag(args, "identity-chain-id"),
      "identity-chain-id",
    ),
    identity_registry: requireArg(
      getFlag(args, "identity-registry"),
      "identity-registry",
    ),
    identity_agent_id: requireArg(
      getFlag(args, "identity-agent-id"),
      "identity-agent-id",
    ),
  });
}

export async function runAutolaunchRegistryRotateSafe(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "registry", "rotate_safe", {
    new_safe: requireArg(getFlag(args, "new-safe"), "new-safe"),
  });
}

export async function runAutolaunchRevenueShareFactorySetAuthorizedCreator(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  await postPrepareAdminAction(
    "revenue_share_factory",
    "set_authorized_creator",
    {
      account: requireArg(getFlag(args, "account"), "account"),
      enabled: requireArg(getFlag(args, "enabled"), "enabled"),
    },
    configPath,
  );
}

export async function runAutolaunchRevenueIngressFactorySetAuthorizedCreator(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareAdminAction(
    "revenue_ingress_factory",
    "set_authorized_creator",
    {
      account: requireArg(getFlag(args, "account"), "account"),
      enabled: requireArg(getFlag(args, "enabled"), "enabled"),
    },
  );
}
