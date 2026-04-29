import type { IdentityEnsureFailure, IdentityStatusResponse, RegentIdentityNetwork } from "../internal-types/index.js";

import { coinbaseStatus, ensureIdentity, IdentityServiceClient, loadConfig } from "../internal-runtime/index.js";
import { CommandExitError } from "../internal-runtime/errors.js";
import { readIdentityReceipt } from "../internal-runtime/identity/cache.js";
import { getBooleanFlag, getFlag, parseIntegerFlag, type ParsedCliArgs } from "../parse.js";
import { CLI_PALETTE, printError, printJson, printText, renderKeyValuePanel, renderPanel, renderTablePanel, tone } from "../printer.js";

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
    renderKeyValuePanel("◆ IDENTITY READY", [
      { label: "provider", value: result.provider, valueColor: CLI_PALETTE.primary },
      { label: "network", value: result.network, valueColor: CLI_PALETTE.primary },
      { label: "address", value: result.address, valueColor: CLI_PALETTE.primary },
      { label: "agent id", value: String(result.agent_id), valueColor: CLI_PALETTE.emphasis },
      { label: "verified until", value: result.receipt_expires_at, valueColor: CLI_PALETTE.primary },
      { label: "cache", value: result.cache_path, valueColor: CLI_PALETTE.primary },
    ], {
      borderColor: CLI_PALETTE.chrome,
      titleColor: CLI_PALETTE.title,
    }),
    renderPanel("◆ NEXT STEP", [
      `${tone("regents identity status", CLI_PALETTE.emphasis, true)} to check whether the saved identity is still ready.`,
    ], {
      borderColor: CLI_PALETTE.chrome,
      titleColor: CLI_PALETTE.title,
    }),
  ].join("\n\n");

const renderHumanStatus = (result: {
  ok: boolean;
  provider: "coinbase-cdp";
  network: RegentIdentityNetwork;
  wallet_ready: boolean;
  identity_ready: boolean;
  address?: `0x${string}`;
  next_action?: { command: string; reason?: string };
}): string =>
  [
    renderKeyValuePanel("◆ COINBASE IDENTITY", [
      { label: "status", value: result.ok ? "ready" : "not ready", valueColor: result.ok ? CLI_PALETTE.emphasis : CLI_PALETTE.error },
      { label: "network", value: result.network, valueColor: CLI_PALETTE.primary },
      { label: "wallet", value: result.wallet_ready ? "ready" : "missing", valueColor: result.wallet_ready ? CLI_PALETTE.emphasis : CLI_PALETTE.error },
      { label: "identity", value: result.identity_ready ? "ready" : "missing", valueColor: result.identity_ready ? CLI_PALETTE.emphasis : CLI_PALETTE.error },
      ...(result.address ? [{ label: "address", value: result.address, valueColor: CLI_PALETTE.primary }] : []),
    ], {
      borderColor: CLI_PALETTE.chrome,
      titleColor: CLI_PALETTE.title,
    }),
    ...(result.next_action
      ? [
          renderPanel("◆ NEXT STEP", [
            ...(result.next_action.reason ? [`${tone("why", CLI_PALETTE.secondary)} ${tone(result.next_action.reason, CLI_PALETTE.primary)}`] : []),
            `Run ${tone(result.next_action.command, CLI_PALETTE.emphasis, true)} to refresh the Regent identity once the wallet is ready.`,
          ], {
            borderColor: CLI_PALETTE.chrome,
            titleColor: CLI_PALETTE.title,
          }),
        ]
      : []),
  ].join("\n\n");

const buildIdentityGraph = () => {
  const receipt = readIdentityReceipt();

  if (!receipt) {
    return {
      ok: false,
      command: "identity graph",
      status: "waiting",
      agent_id: null,
      wallet_tuple: null,
      local_receipt: null,
      product_links: {
        platform: null,
        autolaunch: null,
        techtree: null,
        mobile: null,
        erc8004_agentbook: null,
      },
      gaps: ["Run regents identity ensure to create the local identity receipt."],
    };
  }

  return {
    ok: true,
    command: "identity graph",
    status: "ready",
    agent_id: String(receipt.agent_id),
    wallet_tuple: {
      wallet_address: receipt.address,
      chain_id: receipt.network === "base" ? 8453 : 84532,
      registry_address: receipt.agent_registry,
      token_id: String(receipt.agent_id),
    },
    local_receipt: {
      provider: receipt.provider,
      network: receipt.network,
      verified: receipt.verified,
      receipt_expires_at: receipt.receipt_expires_at,
    },
    product_links: {
      platform: null,
      autolaunch: null,
      techtree: null,
      mobile: null,
      erc8004_agentbook: {
        agent_id: String(receipt.agent_id),
        registry_address: receipt.agent_registry,
        token_id: String(receipt.agent_id),
      },
    },
    gaps: [
      "Platform, Autolaunch, Techtree, and mobile links must come from their owning product APIs.",
    ],
  };
};

const renderHumanGraph = (graph: ReturnType<typeof buildIdentityGraph>): string => {
  const rows = [
    { cells: ["agent id", graph.agent_id ?? "not ready"] },
    { cells: ["wallet", graph.wallet_tuple?.wallet_address ?? "not ready"] },
    { cells: ["chain", graph.wallet_tuple ? String(graph.wallet_tuple.chain_id) : "not ready"] },
    { cells: ["registry", graph.wallet_tuple?.registry_address ?? "not ready"] },
    { cells: ["token", graph.wallet_tuple?.token_id ?? "not ready"] },
  ];

  return [
    renderKeyValuePanel("◆ IDENTITY GRAPH", [
      { label: "status", value: graph.status, valueColor: graph.ok ? CLI_PALETTE.emphasis : CLI_PALETTE.error },
      { label: "source", value: graph.local_receipt ? "local receipt" : "missing" },
    ], {
      borderColor: CLI_PALETTE.chrome,
      titleColor: CLI_PALETTE.title,
    }),
    renderTablePanel("◆ CURRENT MAPPING", [{ header: "field" }, { header: "value" }], rows),
    ...(graph.gaps.length > 0 ? [renderPanel("◆ NEXT", graph.gaps)] : []),
  ].join("\n\n");
};

export async function runIdentityGraph(args: readonly string[] | ParsedCliArgs): Promise<number> {
  const json = getBooleanFlag(args, "json");
  const graph = buildIdentityGraph();

  if (json) {
    printJson(graph);
  } else {
    printText(renderHumanGraph(graph));
  }

  return graph.ok ? 0 : 1;
}

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

    const client = new IdentityServiceClient(config.services.siwa.baseUrl, timeoutSeconds * 1000, config);
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
      printError(failure);
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
      printError(failure);
    }
    return failure.exitCode;
  }
}
