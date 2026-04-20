import type { IdentityEnsureFailure, IdentityStatusResponse, RegentIdentityNetwork } from "../internal-types/index.js";

import { coinbaseStatus, ensureIdentity, IdentityServiceClient, loadConfig } from "../internal-runtime/index.js";
import { CommandExitError } from "../internal-runtime/errors.js";
import { readIdentityReceipt } from "../internal-runtime/identity/cache.js";
import { getBooleanFlag, getFlag, parseIntegerFlag, type ParsedCliArgs } from "../parse.js";
import { printJson, printText } from "../printer.js";

const parseNetwork = (value: string | undefined): RegentIdentityNetwork => {
  if (!value || value === "base") {
    return "base";
  }
  if (value === "base-sepolia") {
    return "base-sepolia";
  }
  throw new CommandExitError("UNSUPPORTED_NETWORK", `Unsupported network: ${value}`, 31);
};

const failurePayload = (error: CommandExitError): IdentityEnsureFailure => ({
  status: "error",
  code: error.code as IdentityEnsureFailure["code"],
  message: error.message,
  details: (error.details as Record<string, unknown> | undefined) ?? undefined,
});

const renderHumanSuccess = (result: Awaited<ReturnType<typeof ensureIdentity>>): string =>
  [
    "Regent identity ready.",
    `provider: ${result.provider}`,
    `network: ${result.network}`,
    `address: ${result.address}`,
    `agent_id: ${result.agent_id}`,
    `verified_until: ${result.receipt_expires_at}`,
    `cache: ${result.cache_path}`,
  ].join("\n");

const renderHumanStatus = (result: {
  ok: boolean;
  provider: "coinbase-cdp";
  network: RegentIdentityNetwork;
  wallet_ready: boolean;
  identity_ready: boolean;
  address?: `0x${string}`;
  next_action?: { command: string };
}): string =>
  [
    result.ok ? "Coinbase identity ready." : "Coinbase identity is not ready.",
    `network: ${result.network}`,
    `wallet_ready: ${result.wallet_ready ? "yes" : "no"}`,
    `identity_ready: ${result.identity_ready ? "yes" : "no"}`,
    ...(result.address ? [`address: ${result.address}`] : []),
    ...(result.next_action ? [`next: ${result.next_action.command}`] : []),
  ].join("\n");

export async function runIdentityStatus(
  args: readonly string[] | ParsedCliArgs,
  configPath?: string,
): Promise<number> {
  const json = getBooleanFlag(args, "json");

  try {
    const timeoutSeconds = parseIntegerFlag(args, "timeout") ?? 120;
    const network = parseNetwork(getFlag(args, "network"));
    const walletHint = getFlag(args, "wallet");
    const config = loadConfig(configPath);
    const wallet = await coinbaseStatus(config, {
      walletHint,
      network,
      timeoutMs: timeoutSeconds * 1000,
    });

    const cachedReceipt = readIdentityReceipt();

    if (!wallet.account) {
      const payload = {
        ok: false,
        provider: "coinbase-cdp" as const,
        network,
        wallet_ready: false,
        identity_ready: wallet.identity_ready,
        wallet,
        ...(wallet.next_action ? { next_action: wallet.next_action } : {}),
      };
      if (json) {
        printJson(payload);
      } else {
        printText(renderHumanStatus(payload));
      }
      return 1;
    }

    if (wallet.identity_ready) {
      const payload = {
        ok: true,
        provider: "coinbase-cdp" as const,
        network,
        wallet_ready: true,
        identity_ready: true,
        address: wallet.account.address,
        wallet,
        ...(cachedReceipt &&
        cachedReceipt.provider === "coinbase-cdp" &&
        cachedReceipt.network === network &&
        cachedReceipt.address === wallet.account.address
          ? {
              identity: {
                network: cachedReceipt.network,
                address: cachedReceipt.address,
                provider: cachedReceipt.provider,
                registered: true,
                verified: cachedReceipt.verified,
                agent_id: cachedReceipt.agent_id,
                agent_registry: cachedReceipt.agent_registry,
                receipt_expires_at: cachedReceipt.receipt_expires_at,
              },
            }
          : {}),
      };
      if (json) {
        printJson(payload);
      } else {
        printText(renderHumanStatus(payload));
      }
      return 0;
    }

    const client = new IdentityServiceClient(config.auth.baseUrl, timeoutSeconds * 1000);
    const remoteStatus: IdentityStatusResponse = await client.status({
      network,
      address: wallet.account.address,
      provider: "coinbase-cdp",
      ...(walletHint ? { wallet_hint: walletHint } : {}),
    });

    const identityReady =
      remoteStatus.data.verified === "onchain" && Boolean(remoteStatus.data.receipt_expires_at ?? wallet.receipt_expires_at);
    const payload = {
      ok: wallet.ok && identityReady,
      provider: "coinbase-cdp" as const,
      network,
      wallet_ready: true,
      identity_ready: identityReady,
      address: wallet.account.address,
      wallet,
      identity: remoteStatus.data,
      ...(identityReady
        ? {}
        : {
            next_action: {
              reason: "The wallet is ready, but the Regent identity still needs to be refreshed.",
              command: "regents identity ensure",
            },
          }),
    };

    if (json) {
      printJson(payload);
    } else {
      printText(renderHumanStatus(payload));
    }
    return payload.ok ? 0 : 1;
  } catch (error) {
    const failure =
      error instanceof CommandExitError
        ? error
        : new CommandExitError(
            "SERVICE_UNAVAILABLE",
            error instanceof Error ? error.message : "Coinbase identity status failed.",
            30,
          );

    if (json) {
      printJson(failurePayload(failure));
    } else {
      printText(failure.message);
    }
    return failure.exitCode;
  }
}

export async function runIdentityEnsure(
  args: readonly string[] | ParsedCliArgs,
  configPath?: string,
): Promise<number> {
  const json = getBooleanFlag(args, "json");

  try {
    const timeoutSeconds = parseIntegerFlag(args, "timeout") ?? 120;
    const result = await ensureIdentity({
      network: parseNetwork(getFlag(args, "network")),
      forceRefresh: getBooleanFlag(args, "force-refresh"),
      walletHint: getFlag(args, "wallet"),
      timeoutSeconds,
      config: loadConfig(configPath),
    });

    if (json) {
      printJson(result);
    } else {
      printText(renderHumanSuccess(result));
    }
    return 0;
  } catch (error) {
    const failure =
      error instanceof CommandExitError
        ? error
        : new CommandExitError(
            "SERVICE_UNAVAILABLE",
            error instanceof Error ? error.message : "Regent identity setup failed.",
            30,
          );

    if (json) {
      printJson(failurePayload(failure));
    } else {
      printText(failure.message);
    }
    return failure.exitCode;
  }
}
