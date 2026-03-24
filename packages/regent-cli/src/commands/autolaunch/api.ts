import { getBooleanFlag, getFlag, requireArg, type ParsedCliArgs } from "../../parse.js";
import { printJson } from "../../printer.js";
import {
  appendQuery,
  launchChainId,
  parsePollingIntervalSeconds,
  requestJson,
  requireLaunchIdentity,
  requirePositional,
} from "./shared.js";

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

export async function runAutolaunchAgentsList(args: ParsedCliArgs): Promise<void> {
  printJson(
    await requestJson(
      "GET",
      appendQuery("/api/agents", { launchable: getBooleanFlag(args, "launchable") }),
    ),
  );
}

export async function runAutolaunchAgentShow(agentId: string): Promise<void> {
  printJson(await requestJson("GET", `/api/agents/${encodeURIComponent(agentId)}`));
}

export async function runAutolaunchAgentReadiness(agentId: string): Promise<void> {
  printJson(await requestJson("GET", `/api/agents/${encodeURIComponent(agentId)}/readiness`));
}

export async function runAutolaunchLaunchPreview(args: ParsedCliArgs): Promise<void> {
  const required = requireLaunchIdentity(args);
  const body = {
    agent_id: required.agent,
    chain_id: required.chainId,
    token_name: required.name,
    token_symbol: required.symbol,
    treasury_address: required.treasuryAddress,
    total_supply: getFlag(args, "total-supply") ?? "100000000000000000000000000000",
    launch_notes: getFlag(args, "launch-notes"),
  };

  printJson(await requestJson("POST", "/api/launch/preview", { body, requireSession: true }));
}

export async function runAutolaunchLaunchCreate(args: ParsedCliArgs): Promise<void> {
  const required = requireLaunchIdentity(args);

  const body = {
    agent_id: required.agent,
    chain_id: required.chainId,
    token_name: required.name,
    token_symbol: required.symbol,
    treasury_address: required.treasuryAddress,
    total_supply: getFlag(args, "total-supply") ?? "100000000000000000000000000000",
    launch_notes: getFlag(args, "launch-notes"),
    wallet_address: requireArg(getFlag(args, "wallet-address"), "wallet-address"),
    nonce: requireArg(getFlag(args, "nonce"), "nonce"),
    message: requireArg(getFlag(args, "message"), "message"),
    signature: requireArg(getFlag(args, "signature"), "signature"),
    issued_at: requireArg(getFlag(args, "issued-at"), "issued-at"),
  };

  printJson(await requestJson("POST", "/api/launch/jobs", { body, requireSession: true }));
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
