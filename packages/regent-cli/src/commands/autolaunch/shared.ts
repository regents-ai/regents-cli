import { getFlag, requireArg, type ParsedCliArgs } from "../../parse.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:4000";
const SESSION_COOKIE_ENV = "AUTOLAUNCH_SESSION_COOKIE";
const PRIVY_TOKEN_ENV = "AUTOLAUNCH_PRIVY_BEARER_TOKEN";
export const AGENT_PRIVATE_KEY_ENV = "AUTOLAUNCH_AGENT_PRIVATE_KEY";

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export interface RequestOptions {
  readonly body?: Record<string, unknown>;
  readonly requireSession?: boolean;
}

export type AutolaunchChainId = "1" | "11155111";

const AUTOLAUNCH_CHAIN_IDS: Readonly<Record<string, string>> = {
  mainnet: "1",
  ethereum: "1",
  "ethereum-mainnet": "1",
  sepolia: "11155111",
  "ethereum-sepolia": "11155111",
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

export const toCookieHeader = async (): Promise<string | undefined> => {
  const existing = process.env[SESSION_COOKIE_ENV];
  if (existing) {
    return existing;
  }

  const bearer = process.env[PRIVY_TOKEN_ENV];
  if (!bearer) {
    return undefined;
  }

  const displayName = process.env.AUTOLAUNCH_DISPLAY_NAME;
  const walletAddress = process.env.AUTOLAUNCH_WALLET_ADDRESS;
  const sessionBody: Record<string, string> = {};

  if (displayName) {
    sessionBody.display_name = displayName;
  }

  if (walletAddress) {
    sessionBody.wallet_address = walletAddress;
  }

  const response = await fetch(`${baseUrl()}/api/auth/privy/session`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(sessionBody),
  });

  if (!response.ok) {
    throw new Error(
      `Unable to exchange Privy bearer token for session cookie: ${await response.text()}`,
    );
  }

  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Privy session exchange succeeded but no session cookie was returned");
  }

  const cookie = setCookie.split(";", 1)[0] ?? "";
  process.env[SESSION_COOKIE_ENV] = cookie;
  return cookie;
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

  if (options.requireSession) {
    const cookie = await toCookieHeader();
    if (!cookie) {
      throw new Error(
        "This command requires an authenticated session. Set AUTOLAUNCH_SESSION_COOKIE or AUTOLAUNCH_PRIVY_BEARER_TOKEN.",
      );
    }

    headers.set("cookie", cookie);
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

  const chain = (getFlag(args, "chain") ?? "ethereum").toLowerCase();
  return AUTOLAUNCH_CHAIN_IDS[chain] ?? chain;
};

export const autolaunchChainId = (args: ParsedCliArgs): AutolaunchChainId => {
  const resolved = launchChainId(args);
  if (resolved === "1" || resolved === "11155111") {
    return resolved;
  }

  throw new Error("autolaunch identities only support Ethereum mainnet or Ethereum Sepolia");
};

export const requireLaunchIdentity = (args: ParsedCliArgs) => {
  return {
    agent: requireArg(getFlag(args, "agent"), "agent"),
    chainId: launchChainId(args),
    name: requireArg(getFlag(args, "name"), "name"),
    symbol: requireArg(getFlag(args, "symbol"), "symbol"),
    treasuryAddress: requireArg(getFlag(args, "treasury-address"), "treasury-address"),
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
