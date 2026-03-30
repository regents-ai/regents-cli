import type { paths as RegentServicePaths } from "../generated/regent-services-openapi.js";

import { getFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";
import type {
  JsonRequestBodyFor,
  JsonSuccessResponseFor,
} from "../contracts/openapi-helpers.js";
import { requestTypedJson, requirePositional } from "./autolaunch/shared.js";

type RegentStakingOverviewResponse = JsonSuccessResponseFor<
  RegentServicePaths,
  "/api/regent/staking",
  "get"
>;
type RegentStakingAccountResponse = JsonSuccessResponseFor<
  RegentServicePaths,
  "/api/regent/staking/account/{address}",
  "get"
>;
type RegentStakingStakeBody = JsonRequestBodyFor<
  RegentServicePaths,
  "/api/regent/staking/stake",
  "post"
>;
type RegentStakingStakeResponse = JsonSuccessResponseFor<
  RegentServicePaths,
  "/api/regent/staking/stake",
  "post"
>;
type RegentStakingUnstakeBody = JsonRequestBodyFor<
  RegentServicePaths,
  "/api/regent/staking/unstake",
  "post"
>;
type RegentStakingUnstakeResponse = JsonSuccessResponseFor<
  RegentServicePaths,
  "/api/regent/staking/unstake",
  "post"
>;
type RegentStakingClaimResponse = JsonSuccessResponseFor<
  RegentServicePaths,
  "/api/regent/staking/claim-usdc",
  "post"
>;

export async function runRegentStakingShow(): Promise<void> {
  printJson(await requestTypedJson<RegentStakingOverviewResponse>("GET", "/api/regent/staking"));
}

export async function runRegentStakingAccount(args: ParsedCliArgs): Promise<void> {
  const address = requirePositional(args, 2, "address");
  printJson(
    await requestTypedJson<RegentStakingAccountResponse>(
      "GET",
      `/api/regent/staking/account/${encodeURIComponent(address)}`,
    ),
  );
}

export async function runRegentStakingStake(args: ParsedCliArgs): Promise<void> {
  const body: RegentStakingStakeBody = {
    amount: requireArg(getFlag(args, "amount"), "amount"),
  };
  printJson(
    await requestTypedJson<RegentStakingStakeResponse>("POST", "/api/regent/staking/stake", {
      body,
      requireSession: true,
    }),
  );
}

export async function runRegentStakingUnstake(args: ParsedCliArgs): Promise<void> {
  const body: RegentStakingUnstakeBody = {
    amount: requireArg(getFlag(args, "amount"), "amount"),
  };
  printJson(
    await requestTypedJson<RegentStakingUnstakeResponse>("POST", "/api/regent/staking/unstake", {
      body,
      requireSession: true,
    }),
  );
}

export async function runRegentStakingClaimUsdc(): Promise<void> {
  printJson(
    await requestTypedJson<RegentStakingClaimResponse>("POST", "/api/regent/staking/claim-usdc", {
      body: {},
      requireSession: true,
    }),
  );
}
