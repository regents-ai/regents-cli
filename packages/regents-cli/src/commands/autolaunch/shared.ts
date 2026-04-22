import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, mainnet } from "viem/chains";

import { loadConfig } from "../../internal-runtime/config.js";
import {
  EnvWalletSecretSource,
  FileWalletSecretSource,
} from "../../internal-runtime/agent/key-store.js";
import { getFlag, requireArg, type ParsedCliArgs } from "../../parse.js";
import { buildAgentAuthHeaders } from "../agent-auth.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:4010";
export const AGENT_PRIVATE_KEY_ENV = "AUTOLAUNCH_AGENT_PRIVATE_KEY";

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface RequestOptions {
  readonly body?: unknown;
  readonly requireAgentAuth?: boolean;
  readonly configPath?: string;
}

export interface PreparedTxRequest {
  readonly chain_id: 1 | 8453 | 84532;
  readonly to: Address;
  readonly data: Hex;
  readonly value?: string | number | bigint | null;
}

export type AutolaunchChainId = "84532" | "8453";

const AUTOLAUNCH_CHAIN_IDS: Readonly<Record<string, string>> = {
  "base-sepolia": "84532",
  base: "8453",
  "base-mainnet": "8453",
};

export const baseUrl = (): string => {
  return (process.env.AUTOLAUNCH_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
};

export const failIfNotObject = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("autolaunch API returned a non-object payload");
  }

  return value as JsonObject;
};

export const requestJson = async (
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<JsonObject> => {
  const headers = new Headers({ accept: "application/json" });

  if (options.body) {
    headers.set("content-type", "application/json");
  }

  if (options.requireAgentAuth) {
    const authHeaders = await buildAgentAuthHeaders({
      method,
      path,
      configPath: options.configPath,
    });

    for (const [key, value] of Object.entries(authHeaders)) {
      headers.set(key, value);
    }
  }

  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const parsed = text ? failIfNotObject(JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    throw new Error(JSON.stringify(parsed, null, 2));
  }

  return parsed;
};

export const requestTypedJson = async <T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> => {
  const headers = new Headers({ accept: "application/json" });

  if (options.body) {
    headers.set("content-type", "application/json");
  }

  if (options.requireAgentAuth) {
    const authHeaders = await buildAgentAuthHeaders({
      method,
      path,
      configPath: options.configPath,
    });

    for (const [key, value] of Object.entries(authHeaders)) {
      headers.set(key, value);
    }
  }

  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const parsed = text ? failIfNotObject(JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    throw new Error(JSON.stringify(parsed, null, 2));
  }

  return parsed as T;
};

export const appendQuery = (
  path: string,
  params: Record<string, string | undefined | boolean>,
): string => {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === false) {
      continue;
    }

    search.set(key, value === true ? "true" : String(value));
  }

  const query = search.toString();
  return query ? `${path}?${query}` : path;
};

export const requirePositional = (
  args: ParsedCliArgs,
  index: number,
  label: string,
): string => {
  const value = args.positionals[index];
  if (!value) {
    throw new Error(`missing required positional argument: ${label}`);
  }

  return value;
};

export const launchChainId = (args: ParsedCliArgs): string => {
  const explicit = getFlag(args, "chain-id");
  if (explicit) {
    return explicit;
  }

  const chain = (getFlag(args, "chain") ?? "base-sepolia").toLowerCase();
  return AUTOLAUNCH_CHAIN_IDS[chain] ?? chain;
};

export const autolaunchChainId = (args: ParsedCliArgs): AutolaunchChainId => {
  const resolved = launchChainId(args);
  if (resolved === "84532" || resolved === "8453") {
    return resolved;
  }

  throw new Error("autolaunch only supports Base Sepolia (84532) and Base mainnet (8453)");
};

export const configuredPrivateKey = async (
  configPath?: string,
): Promise<`0x${string}`> => {
  const config = loadConfig(configPath);
  const secretSource = process.env[config.wallet.privateKeyEnv]
    ? new EnvWalletSecretSource(config.wallet.privateKeyEnv)
    : new FileWalletSecretSource(config.wallet.keystorePath);

  return await secretSource.getPrivateKeyHex();
};

interface ChainWalletClients {
  readonly chain: typeof mainnet | typeof base | typeof baseSepolia;
  readonly rpcUrl: string;
}

const walletClientsForPreparedTxChain = async (
  chainId: PreparedTxRequest["chain_id"],
): Promise<ChainWalletClients> => {
  if (chainId === 1) {
    const rpcUrl =
      process.env.ETH_MAINNET_RPC_URL ?? process.env.ETHEREUM_RPC_URL;
    if (!rpcUrl) {
      throw new Error(
        "missing ETH_MAINNET_RPC_URL or ETHEREUM_RPC_URL for Ethereum mainnet submit mode",
      );
    }

    return {
      chain: mainnet,
      rpcUrl,
    };
  }

  if (chainId === 8453) {
    const rpcUrl = process.env.BASE_MAINNET_RPC_URL ?? process.env.BASE_RPC_URL;
    if (!rpcUrl) {
      throw new Error(
        "missing BASE_MAINNET_RPC_URL or BASE_RPC_URL for Base mainnet submit mode",
      );
    }

    return {
      chain: base,
      rpcUrl,
    };
  }

  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    throw new Error("missing BASE_SEPOLIA_RPC_URL for Base Sepolia submit mode");
  }

  return {
    chain: baseSepolia,
    rpcUrl,
  };
};

const requirePreparedTxChainId = (
  value: unknown,
): PreparedTxRequest["chain_id"] => {
  const chainId = Number(value);
  if (chainId === 1 || chainId === 8453 || chainId === 84532) {
    return chainId;
  }

  throw new Error(`unsupported chain for submit mode: ${String(value)}`);
};

export const extractPreparedTxRequest = (
  value: unknown,
): PreparedTxRequest | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const txRequest = value as Record<string, unknown>;
  const to = txRequest.to;
  const data = txRequest.data;

  if (typeof to !== "string" || !isAddress(to)) {
    throw new Error("prepared tx_request.to is missing or invalid");
  }

  if (typeof data !== "string" || !isHex(data)) {
    throw new Error("prepared tx_request.data is missing or invalid");
  }

  if (
    !(
      typeof txRequest.value === "string" ||
      typeof txRequest.value === "number" ||
      typeof txRequest.value === "bigint" ||
      txRequest.value == null
    )
  ) {
    throw new Error("prepared tx_request.value is invalid");
  }

  return {
    chain_id: requirePreparedTxChainId(txRequest.chain_id),
    to,
    data,
    value: txRequest.value,
  };
};

export const submitPreparedTxRequest = async (
  txRequest: PreparedTxRequest,
  configPath?: string,
): Promise<`0x${string}`> => {
  const account = privateKeyToAccount(await configuredPrivateKey(configPath));
  const { chain, rpcUrl } = await walletClientsForPreparedTxChain(
    txRequest.chain_id,
  );
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const txHash = await walletClient.sendTransaction({
    account,
    chain,
    to: txRequest.to,
    data: txRequest.data,
    value: BigInt(String(txRequest.value ?? "0x0")),
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
};

export const requireLaunchIdentity = (args: ParsedCliArgs) => {
  const chainId = autolaunchChainId(args);
  const agentSafeAddress = requireArg(getFlag(args, "agent-safe-address"), "agent-safe-address");

  return {
    agent: requireArg(getFlag(args, "agent"), "agent"),
    chainId,
    name: requireArg(getFlag(args, "name"), "name"),
    symbol: requireArg(getFlag(args, "symbol"), "symbol"),
    agentSafeAddress,
  };
};

export const parsePollingIntervalSeconds = (
  args: ParsedCliArgs,
  flagName = "interval",
  fallbackSeconds = 2,
): number => {
  const rawValue = getFlag(args, flagName);
  if (rawValue === undefined) {
    return fallbackSeconds;
  }

  const parsedValue = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`--${flagName} must be a positive number`);
  }

  return parsedValue;
};
