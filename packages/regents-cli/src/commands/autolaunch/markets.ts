import type { paths as AutolaunchPaths } from "../../generated/autolaunch-openapi.js";
import {
  getBooleanFlag,
  getFlag,
  requireArg,
  type ParsedCliArgs,
} from "../../parse.js";
import { printJson } from "../../printer.js";
import type { JsonSuccessResponseFor } from "../../contracts/openapi-helpers.js";
import {
  appendQuery,
  requestJson,
  requestTypedJson,
  requirePositional,
} from "./shared.js";

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
