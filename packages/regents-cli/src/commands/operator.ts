import fs from "node:fs";
import path from "node:path";

import { createPublicClient, formatEther, http } from "viem";
import { base, baseSepolia } from "viem/chains";

import {
  coinbaseStatus,
  defaultConfigPath,
  expandHome,
  loadConfig,
  writeInitialConfigIfMissing,
} from "../internal-runtime/index.js";
import { readIdentityReceipt, receiptMatchesRequest } from "../internal-runtime/identity/cache.js";
import { identityNetworkForChainId } from "../internal-runtime/identity/shared.js";
import type { RegentConfig } from "../internal-types/index.js";
import { getBooleanFlag, getFlag, parseCliArgs, type ParsedCliArgs } from "../parse.js";
import {
  CLI_PALETTE,
  isHumanTerminal,
  printJson,
  printText,
  renderKeyValuePanel,
  renderPanel,
  renderTablePanel,
} from "../printer.js";
import { runTechtreeSearch } from "./techtree.js";
import { loadResolvedPlatformSession, requestPlatformSessionJson } from "./platform.js";

const ensureDirectories = (paths: readonly string[]): void => {
  for (const targetPath of paths) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
};

const configPathFor = (args: ParsedCliArgs, configPath?: string): string =>
  expandHome(configPath ?? getFlag(args, "config") ?? defaultConfigPath());

const component = (
  name: string,
  status: "ready" | "waiting" | "blocked",
  detail?: string,
): { name: string; status: "ready" | "waiting" | "blocked"; detail?: string } => ({
  name,
  status,
  ...(detail ? { detail } : {}),
});

const statusColor = (status: string): string =>
  status === "ready" ? CLI_PALETTE.emphasis : status === "blocked" ? CLI_PALETTE.error : CLI_PALETTE.accent;

const printOperatorPayload = (
  payload: Record<string, unknown>,
  renderHuman: () => string,
): void => {
  if (isHumanTerminal()) {
    printText(renderHuman());
    return;
  }

  printJson(payload);
};

const readCurrentIdentityReceipt = (
  config: RegentConfig,
  input: { walletAddress?: string },
) => {
  const receipt = readIdentityReceipt();
  if (!receipt || !input.walletAddress) {
    return null;
  }

  try {
    const network = identityNetworkForChainId(config.auth.defaultChainId);
    return receipt.provider === "coinbase-cdp" &&
      receiptMatchesRequest({
        receipt,
        network,
        regentBaseUrl: config.services.siwa.baseUrl,
        walletHint: input.walletAddress,
      })
      ? receipt
      : null;
  } catch {
    return null;
  }
};

export async function runOperatorInit(args: ParsedCliArgs, configPath?: string): Promise<number> {
  const resolvedConfigPath = configPathFor(args, configPath);
  const configCreated = writeInitialConfigIfMissing(resolvedConfigPath);
  const config = loadConfig(resolvedConfigPath);
  const directories = {
    state: config.runtime.stateDir,
    socket: path.dirname(config.runtime.socketPath),
    wallet: path.dirname(config.wallet.keystorePath),
    xmtp: path.dirname(config.xmtp.dbPath),
    xmtpPolicy: path.dirname(config.xmtp.publicPolicyPath),
    gossipsub: path.dirname(config.gossipsub.peerIdPath),
  };

  ensureDirectories(Object.values(directories));

  const payload = {
    ok: true,
    command: "init",
    status: "ready",
    config_path: resolvedConfigPath,
    config_created: configCreated,
    directories,
    next_actions: ["regents status", "regents identity ensure"],
  };

  printOperatorPayload(payload, () =>
    [
      renderKeyValuePanel("◆ REGENT READY", [
        { label: "status", value: "ready", valueColor: CLI_PALETTE.emphasis },
        { label: "config", value: resolvedConfigPath },
        { label: "created", value: configCreated ? "yes" : "no" },
      ]),
      renderTablePanel(
        "◆ LOCAL FOLDERS",
        [
          { header: "area" },
          { header: "path" },
        ],
        Object.entries(directories).map(([name, directory]) => ({
          cells: [name, directory],
        })),
      ),
      renderPanel("◆ NEXT", ["regents status", "regents identity ensure"]),
    ].join("\n\n"),
  );
  return 0;
}

export async function runOperatorStatus(args: ParsedCliArgs, configPath?: string): Promise<number> {
  const resolvedConfigPath = configPathFor(args, configPath);
  const configExists = fs.existsSync(resolvedConfigPath);
  const config = loadConfig(resolvedConfigPath);
  const wallet = await coinbaseStatus(config, {
    walletHint: getFlag(args, "wallet"),
  }).catch((error: unknown) => ({
    ok: false as const,
    account: null,
    identity_ready: false,
    error: error instanceof Error ? error.message : "Wallet check failed.",
  }));
  const receipt = readCurrentIdentityReceipt(config, {
    walletAddress: wallet.account?.address,
  });
  const runtimeSocketReady = fs.existsSync(config.runtime.socketPath);

  const components = [
    component("config", configExists ? "ready" : "waiting", resolvedConfigPath),
    component(
      "wallet",
      wallet.ok ? "ready" : "waiting",
      wallet.account?.address ?? ("error" in wallet ? wallet.error : undefined),
    ),
    component("identity", receipt ? "ready" : "waiting", receipt ? `${receipt.network}:${receipt.agent_id}` : "Run regents identity ensure"),
    component("runtime", runtimeSocketReady ? "ready" : "waiting", config.runtime.socketPath),
    component("techtree", "ready", config.services.techtree.baseUrl),
    component("chatbox", runtimeSocketReady ? "ready" : "waiting"),
    component("xmtp", config.xmtp.enabled ? "ready" : "waiting", config.xmtp.env),
  ];
  const blocked = components.filter((item) => item.status === "blocked").length;
  const waiting = components.filter((item) => item.status === "waiting").length;

  const payload = {
    ok: blocked === 0,
    command: "status",
    status: blocked > 0 ? "blocked" : waiting > 0 ? "waiting" : "ready",
    config_path: resolvedConfigPath,
    components,
    next_actions: waiting > 0 ? ["regents init", "regents identity ensure", "regents run"] : [],
  };

  printOperatorPayload(payload, () =>
    [
      renderKeyValuePanel("◆ REGENT STATUS", [
        { label: "status", value: payload.status, valueColor: statusColor(payload.status) },
        { label: "config", value: resolvedConfigPath },
      ]),
      renderTablePanel(
        "◆ READINESS",
        [
          { header: "area" },
          { header: "status" },
          { header: "detail" },
        ],
        components.map((item) => ({
          cells: [item.name, item.status, item.detail ?? ""],
          colors: [undefined, statusColor(item.status), undefined],
        })),
      ),
      ...(waiting > 0 ? [renderPanel("◆ NEXT", payload.next_actions)] : []),
    ].join("\n\n"),
  );
  return blocked > 0 ? 1 : 0;
}

export async function runOperatorWhoami(args: ParsedCliArgs, configPath?: string): Promise<number> {
  const config = loadConfig(configPathFor(args, configPath));
  const full = getBooleanFlag(args, "full");
  const wallet = await coinbaseStatus(config, {
    walletHint: getFlag(args, "wallet"),
  });
  const receipt = readCurrentIdentityReceipt(config, {
    walletAddress: wallet.account?.address,
  });
  const platformProjection = full
    ? await (async () => {
        const { origin, session } = await loadResolvedPlatformSession(args);
        const { data } = await requestPlatformSessionJson({
          origin,
          session,
          method: "GET",
          path: "/api/agent-platform/projection",
          commandName: "regents whoami --full",
          configPath: configPathFor(args, configPath),
          chainId: config.auth.defaultChainId,
        });

        return data;
      })()
    : null;

  const payload = {
    ok: Boolean(wallet.account),
    command: "whoami",
    status: wallet.account ? "ready" : "waiting",
    wallet: wallet.account
      ? {
          name: wallet.account.name,
          address: wallet.account.address,
        }
      : null,
    identity: receipt
      ? {
          network: receipt.network,
          address: receipt.address,
          agent_id: receipt.agent_id,
          verified_until: receipt.receipt_expires_at,
        }
      : null,
    chain_id: config.auth.defaultChainId,
    ...(full
      ? {
          identity_graph: {
            agent_id: receipt?.agent_id ?? null,
            local_identity: receipt
              ? {
                  network: receipt.network,
                  address: receipt.address,
                  agent_id: receipt.agent_id,
                }
              : null,
            platform_projection: platformProjection,
          },
        }
      : {}),
  };

  printOperatorPayload(payload, () =>
    [
      renderKeyValuePanel("◆ CURRENT AGENT", [
        { label: "status", value: payload.status, valueColor: statusColor(payload.status) },
        { label: "wallet", value: wallet.account?.name ?? "not ready" },
        { label: "address", value: wallet.account?.address ?? "not ready" },
        { label: "identity", value: receipt ? `${receipt.network}:${receipt.agent_id}` : "not ready" },
        { label: "chain", value: String(config.auth.defaultChainId) },
        ...(full ? [{ label: "platform", value: platformProjection ? "loaded" : "not loaded" }] : []),
      ]),
    ].join("\n\n"),
  );
  return wallet.account ? 0 : 1;
}

export async function runOperatorBalance(args: ParsedCliArgs, configPath?: string): Promise<number> {
  const config = loadConfig(configPathFor(args, configPath));
  const chainId = config.auth.defaultChainId;
  const chain = chainId === 8453 ? base : chainId === 84532 ? baseSepolia : null;
  const rpcUrl =
    chainId === 8453
      ? process.env.BASE_MAINNET_RPC_URL ?? process.env.BASE_RPC_URL
      : chainId === 84532
        ? process.env.BASE_SEPOLIA_RPC_URL
        : undefined;
  const wallet = await coinbaseStatus(config, {
    walletHint: getFlag(args, "wallet"),
  });

  if (!wallet.account || !chain || !rpcUrl) {
    const payload = {
      ok: false,
      command: "balance",
      status: "waiting",
      chain_id: chainId,
      address: wallet.account?.address ?? null,
      next_actions: wallet.account ? ["Set the Base RPC URL for this chain."] : ["regents wallet setup"],
    };
    printOperatorPayload(payload, () =>
      [
        renderKeyValuePanel("◆ WALLET BALANCE", [
          { label: "status", value: "waiting", valueColor: CLI_PALETTE.accent },
          { label: "chain", value: String(chainId) },
          { label: "address", value: wallet.account?.address ?? "not ready" },
        ]),
        renderPanel("◆ NEXT", payload.next_actions),
      ].join("\n\n"),
    );
    return 1;
  }

  const account = wallet.account;
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const balance = await client.getBalance({ address: account.address });
  const payload = {
    ok: true,
    command: "balance",
    status: "ready",
    chain_id: chainId,
    address: account.address,
    eth: formatEther(balance),
    wei: balance.toString(),
  };
  printOperatorPayload(payload, () =>
    renderKeyValuePanel("◆ WALLET BALANCE", [
      { label: "status", value: "ready", valueColor: CLI_PALETTE.emphasis },
      { label: "address", value: account.address },
      { label: "chain", value: String(chainId) },
      { label: "ETH", value: payload.eth, valueColor: CLI_PALETTE.emphasis },
    ]),
  );
  return 0;
}

export async function runOperatorSearch(args: ParsedCliArgs, configPath?: string): Promise<number> {
  const query = getFlag(args, "query") ?? getFlag(args, "q") ?? args.positionals.slice(1).join(" ").trim();
  const searchArgs = parseCliArgs([
    "techtree",
    "search",
    "--query",
    query,
    ...(getFlag(args, "limit") ? ["--limit", getFlag(args, "limit") as string] : []),
  ]);
  await runTechtreeSearch(searchArgs, configPath);
  return 0;
}
