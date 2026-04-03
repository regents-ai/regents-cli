import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import type { paths as RegentServicePaths } from "../generated/regent-services-openapi.js";

import { loadConfig } from "../internal-runtime/config.js";
import { FileWalletSecretSource, EnvWalletSecretSource } from "../internal-runtime/agent/key-store.js";
import { getBooleanFlag, getFlag, requireArg, type ParsedCliArgs } from "../parse.js";
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
type RegentStakingClaimRegentResponse = JsonSuccessResponseFor<
  RegentServicePaths,
  "/api/regent/staking/claim-regent",
  "post"
>;
type RegentStakingClaimAndRestakeRegentResponse = JsonSuccessResponseFor<
  RegentServicePaths,
  "/api/regent/staking/claim-and-restake-regent",
  "post"
>;

const configuredPrivateKey = async (configPath?: string): Promise<`0x${string}`> => {
  const config = loadConfig(configPath);
  const secretSource =
    process.env[config.wallet.privateKeyEnv]
      ? new EnvWalletSecretSource(config.wallet.privateKeyEnv)
      : new FileWalletSecretSource(config.wallet.keystorePath);

  return await secretSource.getPrivateKeyHex();
};

const submitPreparedBaseTx = async (
  txRequest: Record<string, unknown>,
  configPath?: string,
): Promise<`0x${string}`> => {
  const rpcUrl = process.env.BASE_MAINNET_RPC_URL ?? process.env.BASE_RPC_URL;
  if (!rpcUrl) {
    throw new Error("missing BASE_MAINNET_RPC_URL or BASE_RPC_URL for submit mode");
  }

  const account = privateKeyToAccount(await configuredPrivateKey(configPath));
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
  const txHash = await walletClient.sendTransaction({
    account,
    chain: base,
    to: String(txRequest.to) as `0x${string}`,
    data: String(txRequest.data) as Hex,
    value: BigInt(String(txRequest.value ?? "0x0")),
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
};

const printPreparedOrSubmitted = async (
  payload: Record<string, unknown>,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> => {
  if (!getBooleanFlag(args, "submit")) {
    printJson(payload);
    return;
  }

  const txRequest = payload.tx_request as Record<string, unknown> | undefined;
  if (!txRequest) {
    printJson(payload);
    return;
  }

  const txHash = await submitPreparedBaseTx(txRequest, configPath);
  printJson({ ...payload, submitted: true, tx_hash: txHash });
};

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

export async function runRegentStakingClaimUsdc(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const payload = await requestTypedJson<RegentStakingClaimResponse>("POST", "/api/regent/staking/claim-usdc", {
      body: {},
      requireSession: true,
    });

  await printPreparedOrSubmitted(payload as Record<string, unknown>, args, configPath);
}

export async function runRegentStakingClaimRegent(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const payload = await requestTypedJson<RegentStakingClaimRegentResponse>(
    "POST",
    "/api/regent/staking/claim-regent",
    {
      body: {},
      requireSession: true,
    },
  );

  await printPreparedOrSubmitted(payload as Record<string, unknown>, args, configPath);
}

export async function runRegentStakingClaimAndRestakeRegent(
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const payload = await requestTypedJson<RegentStakingClaimAndRestakeRegentResponse>(
    "POST",
    "/api/regent/staking/claim-and-restake-regent",
    {
      body: {},
      requireSession: true,
    },
  );

  await printPreparedOrSubmitted(payload as Record<string, unknown>, args, configPath);
}
