import {
  runRegentStakingAccount,
  runRegentStakingClaimAndRestakeRegent,
  runRegentStakingClaimRegent,
  runRegentStakingClaimUsdc,
  runRegentStakingShow,
  runRegentStakingStake,
  runRegentStakingUnstake,
} from "../commands/regent-staking.js";
import { route, type CliRoute } from "./shared.js";

export const regentStakingRoutes: readonly CliRoute[] = [
  route("regent-staking show", async ({ configPath }) => {
    await runRegentStakingShow(configPath);
    return 0;
  }),
  route("regent-staking account", async ({ parsedArgs, configPath }) => {
    await runRegentStakingAccount(parsedArgs, configPath);
    return 0;
  }, { variadicTail: true }),
  route("regent-staking stake", async ({ parsedArgs, configPath }) => {
    await runRegentStakingStake(parsedArgs, configPath);
    return 0;
  }),
  route("regent-staking unstake", async ({ parsedArgs, configPath }) => {
    await runRegentStakingUnstake(parsedArgs, configPath);
    return 0;
  }),
  route("regent-staking claim-usdc", async ({ parsedArgs, configPath }) => {
    await runRegentStakingClaimUsdc(parsedArgs, configPath);
    return 0;
  }),
  route("regent-staking claim-regent", async ({ parsedArgs, configPath }) => {
    await runRegentStakingClaimRegent(parsedArgs, configPath);
    return 0;
  }),
  route("regent-staking claim-and-restake-regent", async ({ parsedArgs, configPath }) => {
    await runRegentStakingClaimAndRestakeRegent(parsedArgs, configPath);
    return 0;
  }),
];
