import {
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  submitValidatedTransaction,
  type SupportedTransactionChainId,
  type TransactionRequest,
} from "../../internal-runtime/base-contract-client.js";
import { loadConfig } from "../../internal-runtime/config.js";
import type { SiwaAudience } from "../../internal-types/index.js";
import {
  EnvWalletSecretSource,
  FileWalletSecretSource,
} from "../../internal-runtime/agent/key-store.js";
import { getFlag, requireArg, type ParsedCliArgs } from "../../parse.js";
import { requestProductJson } from "../product-http.js";

export const AGENT_PRIVATE_KEY_ENV = "AUTOLAUNCH_AGENT_PRIVATE_KEY";

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface RequestOptions {
  readonly body?: unknown;
  readonly requireAgentAuth?: boolean;
  readonly authAudience?: SiwaAudience;
  readonly configPath?: string;
  readonly chainId?: number;
}

export interface PreparedTxRequest extends TransactionRequest {}

export interface WalletAction {
  readonly action_id: string;
  readonly resource: string;
  readonly action: string;
  readonly chain_id: SupportedTransactionChainId;
  readonly to: Address;
  readonly value: string;
  readonly data: Hex;
  readonly expected_signer: Address;
  readonly expires_at: string;
  readonly idempotency_key: string;
  readonly risk_copy: string;
}

export type AutolaunchChainId = "84532" | "8453";

const AUTOLAUNCH_CHAIN_IDS: Readonly<Record<string, string>> = {
  "base-sepolia": "84532",
  base: "8453",
  "base-mainnet": "8453",
};

export const baseUrl = (configPath?: string): string => {
  return (process.env.AUTOLAUNCH_BASE_URL ?? loadConfig(configPath).services.autolaunch.baseUrl).replace(/\/+$/, "");
};

export const failIfNotObject = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("autolaunch API returned a non-object payload");
  }

  return value as JsonObject;
};

const requestRawJson = async <T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: RequestOptions = {},
): Promise<T> => {
  const payload = await requestProductJson<unknown>(method, path, {
    body: options.body,
    configPath: options.configPath,
    requireAgentAuth: options.requireAgentAuth,
    authAudience: options.authAudience ?? "autolaunch",
    service: "autolaunch",
    commandName: "regents autolaunch",
    chainId: options.chainId,
  });

  return failIfNotObject(payload) as T;
};

export const requestJson = async (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: RequestOptions = {},
): Promise<JsonObject> => requestRawJson<JsonObject>(method, path, options);

export const requestTypedJson = async <T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: RequestOptions = {},
): Promise<T> => requestRawJson<T>(method, path, options);

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

const requirePreparedTxChainId = (
  value: unknown,
): PreparedTxRequest["chain_id"] => {
  const chainId = Number(value);
  if (chainId === 1 || chainId === 8453 || chainId === 84532) {
    return chainId;
  }

  throw new Error(`unsupported chain for submit mode: ${String(value)}`);
};

const requireStringField = (
  value: unknown,
  field: string,
): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`prepared wallet_action.${field} is missing or invalid`);
  }

  return value;
};

const requireAddressField = (
  value: unknown,
  field: string,
): Address => {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`prepared wallet_action.${field} is missing or invalid`);
  }

  return value;
};

const requireHexField = (
  value: unknown,
  field: string,
): Hex => {
  if (typeof value !== "string" || !isHex(value)) {
    throw new Error(`prepared wallet_action.${field} is missing or invalid`);
  }

  return value;
};

export const extractWalletAction = (
  value: unknown,
): WalletAction | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const walletAction = value as Record<string, unknown>;

  return {
    action_id: requireStringField(walletAction.action_id, "action_id"),
    resource: requireStringField(walletAction.resource, "resource"),
    action: requireStringField(walletAction.action, "action"),
    chain_id: requirePreparedTxChainId(walletAction.chain_id),
    to: requireAddressField(walletAction.to, "to"),
    value: requireStringField(walletAction.value, "value"),
    data: requireHexField(walletAction.data, "data"),
    expected_signer: requireAddressField(walletAction.expected_signer, "expected_signer"),
    expires_at: requireStringField(walletAction.expires_at, "expires_at"),
    idempotency_key: requireStringField(walletAction.idempotency_key, "idempotency_key"),
    risk_copy: requireStringField(walletAction.risk_copy, "risk_copy"),
  };
};

export const txRequestFromWalletAction = (
  value: unknown,
): TransactionRequest | null => {
  const walletAction = extractWalletAction(value);
  if (!walletAction) {
    return null;
  }

  return {
    chain_id: walletAction.chain_id,
    to: walletAction.to,
    value: walletAction.value,
    data: walletAction.data,
    expected_signer: walletAction.expected_signer,
  };
};

export const extractPreparedTxRequest = (
  value: unknown,
  expectedSignerValue: unknown,
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
    expected_signer: requireAddressField(expectedSignerValue, "expected_signer"),
  };
};

export const submitPreparedTxRequest = async (
  txRequest: PreparedTxRequest,
  configPath?: string,
): Promise<`0x${string}`> => {
  const account = privateKeyToAccount(await configuredPrivateKey(configPath));
  return submitValidatedTransaction(account, txRequest);
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
