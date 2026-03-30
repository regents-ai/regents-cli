import type { paths as AutolaunchPaths } from "../../generated/autolaunch-openapi.js";
import { getBooleanFlag, getFlag, requireArg, type ParsedCliArgs } from "../../parse.js";
import { printJson } from "../../printer.js";
import type {
  JsonRequestBodyFor,
  JsonSuccessResponseFor,
} from "../../contracts/openapi-helpers.js";
import {
  appendQuery,
  launchChainId,
  parsePollingIntervalSeconds,
  requestJson,
  requestTypedJson,
  requireLaunchIdentity,
  requirePositional,
} from "./shared.js";

type AutolaunchAgentsListResponse = JsonSuccessResponseFor<AutolaunchPaths, "/api/agents", "get">;
type AutolaunchAgentResponse = JsonSuccessResponseFor<AutolaunchPaths, "/api/agents/{id}", "get">;
type AutolaunchAgentReadinessResponse = JsonSuccessResponseFor<
  AutolaunchPaths,
  "/api/agents/{id}/readiness",
  "get"
>;
type LaunchPreviewBody = JsonRequestBodyFor<AutolaunchPaths, "/api/launch/preview", "post">;
type LaunchPreviewResponse = JsonSuccessResponseFor<
  AutolaunchPaths,
  "/api/launch/preview",
  "post"
>;
type LaunchCreateBody = JsonRequestBodyFor<AutolaunchPaths, "/api/launch/jobs", "post">;
type LaunchCreateResponse = JsonSuccessResponseFor<AutolaunchPaths, "/api/launch/jobs", "post">;

const postBidMutation = async (
  action: "exit" | "claim",
  bidId: string,
  txHash: string,
): Promise<void> => {
  printJson(
    await requestJson("POST", `/api/bids/${encodeURIComponent(bidId)}/${action}`, {
      body: { tx_hash: txHash },
      requireSession: true,
    }),
  );
};

const AGENT_LAUNCH_TOTAL_SUPPLY = "100000000000000000000000000000";

export async function runAutolaunchAgentsList(args: ParsedCliArgs): Promise<void> {
  printJson(
    await requestTypedJson<AutolaunchAgentsListResponse>(
      "GET",
      appendQuery("/api/agents", { launchable: getBooleanFlag(args, "launchable") }),
    ),
  );
}

export async function runAutolaunchAgentShow(agentId: string): Promise<void> {
  printJson(
    await requestTypedJson<AutolaunchAgentResponse>("GET", `/api/agents/${encodeURIComponent(agentId)}`),
  );
}

export async function runAutolaunchAgentReadiness(agentId: string): Promise<void> {
  printJson(
    await requestTypedJson<AutolaunchAgentReadinessResponse>(
      "GET",
      `/api/agents/${encodeURIComponent(agentId)}/readiness`,
    ),
  );
}

export async function runAutolaunchLaunchPreview(args: ParsedCliArgs): Promise<void> {
  const required = requireLaunchIdentity(args);
  const body: LaunchPreviewBody = {
    agent_id: required.agent,
    chain_id: required.chainId,
    token_name: required.name,
    token_symbol: required.symbol,
    recovery_safe_address: required.treasuryAddress,
    auction_proceeds_recipient: required.treasuryAddress,
    ethereum_revenue_treasury: required.treasuryAddress,
    total_supply: AGENT_LAUNCH_TOTAL_SUPPLY,
    launch_notes: getFlag(args, "launch-notes"),
  };

  printJson(
    await requestTypedJson<LaunchPreviewResponse>("POST", "/api/launch/preview", {
      body,
      requireSession: true,
    }),
  );
}

export async function runAutolaunchLaunchCreate(args: ParsedCliArgs): Promise<void> {
  const required = requireLaunchIdentity(args);

  const body: LaunchCreateBody = {
    agent_id: required.agent,
    chain_id: required.chainId,
    token_name: required.name,
    token_symbol: required.symbol,
    recovery_safe_address: required.treasuryAddress,
    auction_proceeds_recipient: required.treasuryAddress,
    ethereum_revenue_treasury: required.treasuryAddress,
    total_supply: AGENT_LAUNCH_TOTAL_SUPPLY,
    launch_notes: getFlag(args, "launch-notes"),
    wallet_address: requireArg(getFlag(args, "wallet-address"), "wallet-address"),
    nonce: requireArg(getFlag(args, "nonce"), "nonce"),
    message: requireArg(getFlag(args, "message"), "message"),
    signature: requireArg(getFlag(args, "signature"), "signature"),
    issued_at: requireArg(getFlag(args, "issued-at"), "issued-at"),
  };

  printJson(
    await requestTypedJson<LaunchCreateResponse>("POST", "/api/launch/jobs", {
      body,
      requireSession: true,
    }),
  );
}

export async function runAutolaunchJobsWatch(args: ParsedCliArgs): Promise<void> {
  const jobId = requirePositional(args, 3, "job-id");
  const intervalSeconds = parsePollingIntervalSeconds(args);
  const shouldWatch = getBooleanFlag(args, "watch");

  for (;;) {
    const payload = await requestJson("GET", `/api/launch/jobs/${encodeURIComponent(jobId)}`);
    printJson(payload);

    const status =
      typeof payload.job === "object" && payload.job
        ? (payload.job as Record<string, unknown>).status
        : undefined;
    if (!shouldWatch || status === "ready" || status === "failed" || status === "blocked") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

export async function runAutolaunchAuctionsList(args: ParsedCliArgs): Promise<void> {
  printJson(
    await requestJson(
      "GET",
      appendQuery("/api/auctions", {
        sort: getFlag(args, "sort") ?? "hottest",
        status: getFlag(args, "status"),
        chain: getFlag(args, "chain"),
        mine_only: getBooleanFlag(args, "mine-only"),
      }),
    ),
  );
}

export async function runAutolaunchAuctionShow(auctionId: string): Promise<void> {
  printJson(await requestJson("GET", `/api/auctions/${encodeURIComponent(auctionId)}`));
}

export async function runAutolaunchBidsQuote(args: ParsedCliArgs): Promise<void> {
  const auctionId = requireArg(getFlag(args, "auction"), "auction");
  const body = {
    amount: requireArg(getFlag(args, "amount"), "amount"),
    max_price: requireArg(getFlag(args, "max-price"), "max-price"),
  };

  printJson(
    await requestJson("POST", `/api/auctions/${encodeURIComponent(auctionId)}/bid_quote`, {
      body,
    }),
  );
}

export async function runAutolaunchBidsPlace(args: ParsedCliArgs): Promise<void> {
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
    await requestJson("POST", `/api/auctions/${encodeURIComponent(auctionId)}/bids`, {
      body,
      requireSession: true,
    }),
  );
}

export async function runAutolaunchBidsMine(args: ParsedCliArgs): Promise<void> {
  printJson(
    await requestJson(
      "GET",
      appendQuery("/api/me/bids", {
        auction: getFlag(args, "auction"),
        status: getFlag(args, "status"),
      }),
      { requireSession: true },
    ),
  );
}

export async function runAutolaunchBidsExit(args: ParsedCliArgs): Promise<void> {
  const bidId = requirePositional(args, 3, "bid-id");
  await postBidMutation("exit", bidId, requireArg(getFlag(args, "tx-hash"), "tx-hash"));
}

export async function runAutolaunchBidsClaim(args: ParsedCliArgs): Promise<void> {
  const bidId = requirePositional(args, 3, "bid-id");
  await postBidMutation("claim", bidId, requireArg(getFlag(args, "tx-hash"), "tx-hash"));
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

export async function runAutolaunchEnsPlan(args: ParsedCliArgs): Promise<void> {
  printJson(
    await requestJson("POST", "/api/ens/link/plan", {
      body: buildEnsLinkBody(args),
      requireSession: true,
    }),
  );
}

export async function runAutolaunchEnsPrepareEnsip25(args: ParsedCliArgs): Promise<void> {
  printJson(
    await requestJson("POST", "/api/ens/link/prepare-ensip25", {
      body: buildEnsLinkBody(args),
      requireSession: true,
    }),
  );
}

export async function runAutolaunchEnsPrepareErc8004(args: ParsedCliArgs): Promise<void> {
  printJson(
    await requestJson("POST", "/api/ens/link/prepare-erc8004", {
      body: buildEnsLinkBody(args),
      requireSession: true,
    }),
  );
}

export async function runAutolaunchEnsPrepareBidirectional(args: ParsedCliArgs): Promise<void> {
  printJson(
    await requestJson("POST", "/api/ens/link/prepare-bidirectional", {
      body: buildEnsLinkBody(args),
      requireSession: true,
    }),
  );
}

const requireJobFlag = (args: ParsedCliArgs): string => requireArg(getFlag(args, "job"), "job");
const requireSubjectFlag = (args: ParsedCliArgs): string =>
  requireArg(getFlag(args, "subject"), "subject");

const postPrepareJobAction = async (
  args: ParsedCliArgs,
  resource: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<void> => {
  const jobId = requireJobFlag(args);

  printJson(
    await requestJson(
      "POST",
      `/api/contracts/jobs/${encodeURIComponent(jobId)}/${resource}/${action}/prepare`,
      { body, requireSession: true },
    ),
  );
};

const postPrepareSubjectAction = async (
  args: ParsedCliArgs,
  resource: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<void> => {
  const subjectId = requireSubjectFlag(args);

  printJson(
    await requestJson(
      "POST",
      `/api/contracts/subjects/${encodeURIComponent(subjectId)}/${resource}/${action}/prepare`,
      { body, requireSession: true },
    ),
  );
};

const postPrepareAdminAction = async (
  resource: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<void> => {
  printJson(
    await requestJson("POST", `/api/contracts/admin/${resource}/${action}/prepare`, {
      body,
      requireSession: true,
    }),
  );
};

export async function runAutolaunchSubjectShow(args: ParsedCliArgs): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(await requestJson("GET", `/api/subjects/${encodeURIComponent(subjectId)}`, { requireSession: true }));
}

export async function runAutolaunchSubjectIngress(args: ParsedCliArgs): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(await requestJson("GET", `/api/subjects/${encodeURIComponent(subjectId)}/ingress`, { requireSession: true }));
}

export async function runAutolaunchSubjectStake(args: ParsedCliArgs): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(
    await requestJson("POST", `/api/subjects/${encodeURIComponent(subjectId)}/stake`, {
      body: { amount: requireArg(getFlag(args, "amount"), "amount") },
      requireSession: true,
    }),
  );
}

export async function runAutolaunchSubjectUnstake(args: ParsedCliArgs): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(
    await requestJson("POST", `/api/subjects/${encodeURIComponent(subjectId)}/unstake`, {
      body: { amount: requireArg(getFlag(args, "amount"), "amount") },
      requireSession: true,
    }),
  );
}

export async function runAutolaunchSubjectClaimUsdc(args: ParsedCliArgs): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  printJson(
    await requestJson("POST", `/api/subjects/${encodeURIComponent(subjectId)}/claim-usdc`, {
      body: {},
      requireSession: true,
    }),
  );
}

export async function runAutolaunchSubjectSweepIngress(args: ParsedCliArgs): Promise<void> {
  const subjectId = requirePositional(args, 3, "subject-id");
  const address = requireArg(getFlag(args, "address"), "address");

  printJson(
    await requestJson(
      "POST",
      `/api/subjects/${encodeURIComponent(subjectId)}/ingress/${encodeURIComponent(address)}/sweep`,
      { body: {}, requireSession: true },
    ),
  );
}

export async function runAutolaunchContractsAdminShow(): Promise<void> {
  printJson(await requestJson("GET", "/api/contracts/admin", { requireSession: true }));
}

export async function runAutolaunchContractsJobShow(args: ParsedCliArgs): Promise<void> {
  const jobId = requireJobFlag(args);
  printJson(await requestJson("GET", `/api/contracts/jobs/${encodeURIComponent(jobId)}`, { requireSession: true }));
}

export async function runAutolaunchContractsSubjectShow(args: ParsedCliArgs): Promise<void> {
  const subjectId = requireSubjectFlag(args);
  printJson(await requestJson("GET", `/api/contracts/subjects/${encodeURIComponent(subjectId)}`, { requireSession: true }));
}

export async function runAutolaunchStrategyMigrate(args: ParsedCliArgs): Promise<void> {
  await postPrepareJobAction(args, "strategy", "migrate");
}

export async function runAutolaunchStrategySweepToken(args: ParsedCliArgs): Promise<void> {
  await postPrepareJobAction(args, "strategy", "sweep_token");
}

export async function runAutolaunchStrategySweepCurrency(args: ParsedCliArgs): Promise<void> {
  await postPrepareJobAction(args, "strategy", "sweep_currency");
}

export async function runAutolaunchVestingRelease(args: ParsedCliArgs): Promise<void> {
  await postPrepareJobAction(args, "vesting", "release");
}

export async function runAutolaunchFeeRegistryShow(args: ParsedCliArgs): Promise<void> {
  await runAutolaunchContractsJobShow(args);
}

export async function runAutolaunchFeeRegistrySetHookEnabled(args: ParsedCliArgs): Promise<void> {
  await postPrepareJobAction(args, "fee_registry", "set_hook_enabled", {
    enabled: requireArg(getFlag(args, "enabled"), "enabled"),
  });
}

export async function runAutolaunchFeeVaultShow(args: ParsedCliArgs): Promise<void> {
  await runAutolaunchContractsJobShow(args);
}

export async function runAutolaunchFeeVaultWithdrawTreasury(args: ParsedCliArgs): Promise<void> {
  await postPrepareJobAction(args, "fee_vault", "withdraw_treasury", {
    currency: requireArg(getFlag(args, "currency"), "currency"),
    amount: requireArg(getFlag(args, "amount"), "amount"),
    recipient: requireArg(getFlag(args, "recipient"), "recipient"),
  });
}

export async function runAutolaunchFeeVaultWithdrawRegent(args: ParsedCliArgs): Promise<void> {
  await postPrepareJobAction(args, "fee_vault", "withdraw_regent_share", {
    currency: requireArg(getFlag(args, "currency"), "currency"),
    amount: requireArg(getFlag(args, "amount"), "amount"),
    recipient: requireArg(getFlag(args, "recipient"), "recipient"),
  });
}

export async function runAutolaunchSplitterShow(args: ParsedCliArgs): Promise<void> {
  await runAutolaunchContractsSubjectShow(args);
}

export async function runAutolaunchSplitterSetPaused(args: ParsedCliArgs): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "set_paused", {
    paused: requireArg(getFlag(args, "paused"), "paused"),
  });
}

export async function runAutolaunchSplitterSetLabel(args: ParsedCliArgs): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "set_label", {
    label: requireArg(getFlag(args, "label"), "label"),
  });
}

export async function runAutolaunchSplitterSetTreasuryRecipient(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "set_treasury_recipient", {
    recipient: requireArg(getFlag(args, "recipient"), "recipient"),
  });
}

export async function runAutolaunchSplitterSetProtocolRecipient(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "set_protocol_recipient", {
    recipient: requireArg(getFlag(args, "recipient"), "recipient"),
  });
}

export async function runAutolaunchSplitterSetProtocolSkimBps(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "set_protocol_skim_bps", {
    skim_bps: requireArg(getFlag(args, "skim-bps"), "skim-bps"),
  });
}

export async function runAutolaunchSplitterWithdrawTreasuryResidual(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "withdraw_treasury_residual", {
    amount: requireArg(getFlag(args, "amount"), "amount"),
    recipient: requireArg(getFlag(args, "recipient"), "recipient"),
  });
}

export async function runAutolaunchSplitterWithdrawProtocolReserve(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "withdraw_protocol_reserve", {
    amount: requireArg(getFlag(args, "amount"), "amount"),
    recipient: requireArg(getFlag(args, "recipient"), "recipient"),
  });
}

export async function runAutolaunchSplitterReassignDust(args: ParsedCliArgs): Promise<void> {
  await postPrepareSubjectAction(args, "splitter", "reassign_dust", {
    amount: requireArg(getFlag(args, "amount"), "amount"),
  });
}

export async function runAutolaunchIngressCreate(args: ParsedCliArgs): Promise<void> {
  await postPrepareSubjectAction(args, "ingress_factory", "create", {
    label: requireArg(getFlag(args, "label"), "label"),
    make_default: getFlag(args, "make-default") ?? "false",
  });
}

export async function runAutolaunchIngressSetDefault(args: ParsedCliArgs): Promise<void> {
  await postPrepareSubjectAction(args, "ingress_factory", "set_default", {
    ingress_address: requireArg(getFlag(args, "address"), "address"),
  });
}

export async function runAutolaunchIngressSetLabel(args: ParsedCliArgs): Promise<void> {
  await postPrepareSubjectAction(args, "ingress_account", "set_label", {
    ingress_address: requireArg(getFlag(args, "address"), "address"),
    label: requireArg(getFlag(args, "label"), "label"),
  });
}

export async function runAutolaunchIngressRescue(args: ParsedCliArgs): Promise<void> {
  await postPrepareSubjectAction(args, "ingress_account", "rescue", {
    ingress_address: requireArg(getFlag(args, "address"), "address"),
    token: requireArg(getFlag(args, "token"), "token"),
    amount: requireArg(getFlag(args, "amount"), "amount"),
    recipient: requireArg(getFlag(args, "recipient"), "recipient"),
  });
}

export async function runAutolaunchRegistryShow(args: ParsedCliArgs): Promise<void> {
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

export async function runAutolaunchRegistryLinkIdentity(args: ParsedCliArgs): Promise<void> {
  await postPrepareSubjectAction(args, "registry", "link_identity", {
    identity_chain_id: requireArg(getFlag(args, "identity-chain-id"), "identity-chain-id"),
    identity_registry: requireArg(getFlag(args, "identity-registry"), "identity-registry"),
    identity_agent_id: requireArg(getFlag(args, "identity-agent-id"), "identity-agent-id"),
  });
}

export async function runAutolaunchRevenueShareFactorySetAuthorizedCreator(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareAdminAction("revenue_share_factory", "set_authorized_creator", {
    account: requireArg(getFlag(args, "account"), "account"),
    enabled: requireArg(getFlag(args, "enabled"), "enabled"),
  });
}

export async function runAutolaunchRevenueIngressFactorySetAuthorizedCreator(
  args: ParsedCliArgs,
): Promise<void> {
  await postPrepareAdminAction("revenue_ingress_factory", "set_authorized_creator", {
    account: requireArg(getFlag(args, "account"), "account"),
    enabled: requireArg(getFlag(args, "enabled"), "enabled"),
  });
}
