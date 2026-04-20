import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type { RegentConfig, RegentIdentityNetwork } from "../internal-types/index.js";

import { CommandExitError } from "./errors.js";
import { receiptMatchesRequest } from "./identity/cache.js";
import { readIdentityReceipt } from "./identity/cache.js";
import { ensureParentDir } from "./paths.js";

const execFileAsync = promisify(execFile);
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/u;
const CDP_BIN = "cdp";
const DEFAULT_ACCOUNT_NAME = "main";
const COINBASE_PROVIDER = "coinbase-cdp" as const;

export interface CoinbaseWalletAccount {
  name: string;
  address: `0x${string}`;
}

export interface CoinbaseWalletStatus {
  ok: boolean;
  provider: typeof COINBASE_PROVIDER;
  cli_available: boolean;
  api_key_present: boolean;
  wallet_secret_present: boolean;
  account: CoinbaseWalletAccount | null;
  identity_ready: boolean;
  receipt_expires_at?: string;
  next_action?: {
    reason: string;
    command: string;
  };
}

const normalizeAddress = (value: unknown): `0x${string}` | null => {
  if (typeof value !== "string" || !ADDRESS_REGEX.test(value)) {
    return null;
  }
  return value.toLowerCase() as `0x${string}`;
};

const walletStatePath = (config: RegentConfig): string =>
  path.join(config.runtime.stateDir, "coinbase-wallet.json");

const readWalletState = (config: RegentConfig): CoinbaseWalletAccount | null => {
  const filePath = walletStatePath(config);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { name?: unknown; address?: unknown };
    const name = typeof parsed.name === "string" && parsed.name ? parsed.name : null;
    const address = normalizeAddress(parsed.address);
    return name && address ? { name, address } : null;
  } catch {
    return null;
  }
};

const writeWalletState = (config: RegentConfig, account: CoinbaseWalletAccount): string => {
  const filePath = walletStatePath(config);
  ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(account, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
  return filePath;
};

const parseAccountPayload = (payload: unknown): CoinbaseWalletAccount | null => {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const name = typeof record.name === "string" && record.name ? record.name : null;
  const address = normalizeAddress(record.address);
  return name && address ? { name, address } : null;
};

const parseAccountsList = (payload: unknown): CoinbaseWalletAccount[] => {
  const items =
    Array.isArray(payload)
      ? payload
      : typeof payload === "object" && payload !== null && Array.isArray((payload as { accounts?: unknown[] }).accounts)
        ? (payload as { accounts: unknown[] }).accounts
        : [];
  return items
    .map((item) => parseAccountPayload(item))
    .filter((item): item is CoinbaseWalletAccount => item !== null);
};

const execCdpJson = async (args: string[], timeoutMs: number): Promise<unknown> => {
  try {
    const { stdout } = await execFileAsync(CDP_BIN, args, {
      encoding: "utf8",
      timeout: timeoutMs,
    });
    const trimmed = stdout.trim();
    return trimmed === "" ? {} : JSON.parse(trimmed);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new CommandExitError(
      "COINBASE_CDP_MISSING",
      "Coinbase wallet setup is not ready on this machine.",
      10,
      { details: { cause, command: `${CDP_BIN} ${args.join(" ")}` } },
    );
  }
};

const maybeExecCdpJson = async (args: string[], timeoutMs: number): Promise<unknown | null> => {
  try {
    return await execCdpJson(args, timeoutMs);
  } catch {
    return null;
  }
};

const accountForSelector = (accounts: CoinbaseWalletAccount[], selector: string): CoinbaseWalletAccount | null => {
  const requestedAddress = normalizeAddress(selector);
  return accounts.find((account) => account.name === selector || account.address === requestedAddress) ?? null;
};

const resolveStoredOrNamedAccount = async (
  config: RegentConfig,
  timeoutMs: number,
  input?: { walletHint?: string; expectedAddress?: `0x${string}` },
): Promise<CoinbaseWalletAccount | null> => {
  const storedWallet = readWalletState(config);
  const preferredSelectors = [
    input?.walletHint,
    ...(input?.walletHint ? [] : [storedWallet?.name, storedWallet?.address]),
    input?.expectedAddress,
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

  if (preferredSelectors.length > 0) {
    const byName = parseAccountPayload(
      await maybeExecCdpJson(["evm", "accounts", "by-name", preferredSelectors[0]], timeoutMs),
    );
    if (byName) {
      return byName;
    }

    const listed = parseAccountsList(await maybeExecCdpJson(["evm", "accounts", "list"], timeoutMs));
    for (const selector of preferredSelectors) {
      const matchedAccount = accountForSelector(listed, selector);
      if (matchedAccount) {
        return matchedAccount;
      }
    }
    return null;
  }

  const defaultAccount = parseAccountPayload(await maybeExecCdpJson(["evm", "accounts", "by-name", DEFAULT_ACCOUNT_NAME], timeoutMs));
  if (defaultAccount) {
    return defaultAccount;
  }

  const listed = parseAccountsList(await maybeExecCdpJson(["evm", "accounts", "list"], timeoutMs));
  return accountForSelector(listed, DEFAULT_ACCOUNT_NAME) ?? listed[0] ?? null;
};

export const resolveCoinbaseAccount = async (
  config: RegentConfig,
  input?: { walletHint?: string; expectedAddress?: `0x${string}`; timeoutMs?: number },
): Promise<CoinbaseWalletAccount | null> => {
  const timeoutMs = input?.timeoutMs ?? config.auth.requestTimeoutMs;
  return resolveStoredOrNamedAccount(config, timeoutMs, input);
};

const nextActionForStatus = (status: Omit<CoinbaseWalletStatus, "next_action">): CoinbaseWalletStatus["next_action"] => {
  if (!status.cli_available) {
    return {
      reason: "The Coinbase command line tool is not installed yet.",
      command: "npm install -g @coinbase/cdp-cli && regents wallet setup",
    };
  }
  if (!status.api_key_present) {
    return {
      reason: "The Coinbase API key is missing.",
      command: "Set CDP_KEY_ID and CDP_KEY_SECRET, then run regents wallet setup",
    };
  }
  if (!status.wallet_secret_present) {
    return {
      reason: "The Coinbase wallet secret is missing.",
      command: "Set CDP_WALLET_SECRET, then run regents wallet setup",
    };
  }
  if (!status.account) {
    return {
      reason: "No Coinbase wallet account has been prepared for this machine.",
      command: "regents wallet setup",
    };
  }
  if (!status.identity_ready) {
    return {
      reason: "The wallet is ready, but the Regent identity receipt is missing or expired.",
      command: "regents identity ensure",
    };
  }
  return undefined;
};

export const coinbaseStatus = async (
  config: RegentConfig,
  input?: { walletHint?: string; network?: RegentIdentityNetwork; timeoutMs?: number },
): Promise<CoinbaseWalletStatus> => {
  const timeoutMs = input?.timeoutMs ?? config.auth.requestTimeoutMs;
  let cliAvailable = true;
  let account: CoinbaseWalletAccount | null = null;
  try {
    account = await resolveStoredOrNamedAccount(config, timeoutMs, input);
  } catch {
    cliAvailable = false;
  }

  const receipt = readIdentityReceipt();
  const receiptValid =
    receipt?.provider === COINBASE_PROVIDER &&
    account &&
    receiptMatchesRequest({
      receipt,
      network: input?.network ?? receipt.network,
      regentBaseUrl: config.auth.baseUrl,
      walletHint: account.address,
    })
      ? receipt
      : null;

  const baseStatus: Omit<CoinbaseWalletStatus, "next_action"> = {
    ok: false,
    provider: COINBASE_PROVIDER,
    cli_available: cliAvailable,
    api_key_present: Boolean(process.env.CDP_KEY_ID) && Boolean(process.env.CDP_KEY_SECRET),
    wallet_secret_present: Boolean(process.env.CDP_WALLET_SECRET),
    account,
    identity_ready: receiptValid !== null,
    ...(receiptValid ? { receipt_expires_at: receiptValid.receipt_expires_at } : {}),
  };

  const nextAction = nextActionForStatus(baseStatus);
  return {
    ...baseStatus,
    ok: nextAction === undefined,
    ...(nextAction ? { next_action: nextAction } : {}),
  };
};

const requireCdpReadyForWrites = (): void => {
  if (!process.env.CDP_KEY_ID || !process.env.CDP_KEY_SECRET || !process.env.CDP_WALLET_SECRET) {
    throw new CommandExitError(
      "COINBASE_CDP_MISSING",
      "Coinbase credentials are not ready for wallet setup.",
      10,
      {
        details: {
          api_key_present: Boolean(process.env.CDP_KEY_ID) && Boolean(process.env.CDP_KEY_SECRET),
          wallet_secret_present: Boolean(process.env.CDP_WALLET_SECRET),
        },
      },
    );
  }
};

export const setupCoinbaseWallet = async (
  config: RegentConfig,
  input?: { walletName?: string; timeoutMs?: number },
): Promise<{
  ok: true;
  provider: typeof COINBASE_PROVIDER;
  wallet: CoinbaseWalletAccount;
  created: boolean;
  state_path: string;
}> => {
  requireCdpReadyForWrites();
  const timeoutMs = input?.timeoutMs ?? config.auth.requestTimeoutMs;
  const walletName = input?.walletName || DEFAULT_ACCOUNT_NAME;

  let wallet = await resolveStoredOrNamedAccount(config, timeoutMs, { walletHint: walletName });
  let created = false;
  if (!wallet) {
    wallet = parseAccountPayload(await execCdpJson(["evm", "accounts", "create", `name=${walletName}`], timeoutMs));
    created = true;
  }
  if (!wallet) {
    throw new CommandExitError("COINBASE_CDP_MISSING", "Coinbase did not return a wallet account.", 10);
  }

  const statePath = writeWalletState(config, wallet);
  return {
    ok: true,
    provider: COINBASE_PROVIDER,
    wallet,
    created,
    state_path: statePath,
  };
};

export const signMessageWithCoinbase = async (
  config: RegentConfig,
  input: { message: string; walletHint?: string; timeoutMs?: number; expectedAddress?: `0x${string}` },
): Promise<{ provider: typeof COINBASE_PROVIDER; address: `0x${string}`; walletHint?: string; signature: `0x${string}` }> => {
  requireCdpReadyForWrites();
  const timeoutMs = input.timeoutMs ?? config.auth.requestTimeoutMs;
  const wallet = await resolveStoredOrNamedAccount(config, timeoutMs, {
    walletHint: input.walletHint,
    expectedAddress: input.expectedAddress,
  });
  if (!wallet) {
    throw new CommandExitError("COINBASE_CDP_MISSING", "No Coinbase wallet account is ready on this machine.", 10);
  }
  if (input.expectedAddress && wallet.address.toLowerCase() !== input.expectedAddress.toLowerCase()) {
    throw new CommandExitError(
      "COINBASE_CDP_MISSING",
      "The saved Regent identity no longer matches the current Coinbase wallet.",
      10,
      { details: { expectedAddress: input.expectedAddress, address: wallet.address } },
    );
  }

  const payload = await execCdpJson(
    ["evm", "accounts", "sign", "message", wallet.address, `message=${input.message}`],
    timeoutMs,
  );
  const record = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const signature =
    (typeof record.signature === "string" && record.signature.startsWith("0x") && record.signature) ||
    (typeof record.signedMessage === "string" && record.signedMessage.startsWith("0x") && record.signedMessage);
  if (!signature) {
    throw new CommandExitError("COINBASE_CDP_MISSING", "Coinbase did not return a message signature.", 10);
  }

  return {
    provider: COINBASE_PROVIDER,
    address: wallet.address,
    ...(wallet.name ? { walletHint: wallet.name } : {}),
    signature: signature as `0x${string}`,
  };
};

export const exportHermesMcp = (): {
  ok: true;
  provider: typeof COINBASE_PROVIDER;
  mcpServers: Record<string, { transport: "stdio"; command: string; args: string[] }>;
} => ({
  ok: true,
  provider: COINBASE_PROVIDER,
  mcpServers: {
    "coinbase-cdp": {
      transport: "stdio",
      command: CDP_BIN,
      args: ["mcp"],
    },
  },
});

export const coinbaseProviderName = (): typeof COINBASE_PROVIDER => COINBASE_PROVIDER;
