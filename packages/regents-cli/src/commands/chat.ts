import net from "node:net";

import type { ChatLiveEvent, RegentConfig } from "../internal-types/index.js";

import { daemonCall } from "../daemon-client.js";
import {
  addChatSubscription,
  listChatSubscriptions,
  listXmtpDms,
  loadConfig,
  readChatCursors,
  removeChatSubscription,
  sendXmtpDm,
  writeChatCursors,
  type ChatProduct,
} from "../internal-runtime/index.js";
import { getBooleanFlag, getFlag, parseIntegerFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { CLI_PALETTE, isHumanTerminal, printJson, printJsonLine, renderPanel, tone } from "../printer.js";
import { resolveChatAuthorFilter, type ChatAuthorFilter, type ChatAuthorMessage } from "./chat-filter.js";
import { collectUnreadMessages, CHAT_UNREAD_PAGE_LIMIT } from "./chat-unread.js";

const DEFAULT_SCOPES = ["system"] as const;

const isChatLiveEvent = (payload: unknown): payload is ChatLiveEvent => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<ChatLiveEvent>;
  return typeof candidate.event === "string" && !!candidate.message && typeof candidate.message === "object";
};

const truncate = (value: string, max = 96): string => {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, Math.max(0, max - 1))}…`;
};

const renderChatEvent = (event: ChatLiveEvent): string => {
  const message = event.message as Record<string, unknown>;
  const scopeLabel = typeof message.scope === "string" && message.scope !== "" ? message.scope : "chat";
  const lines = [
    `${tone("event", CLI_PALETTE.secondary)} ${tone(event.event, CLI_PALETTE.primary, true)}`,
  ];

  if (typeof message.id === "string" || typeof message.id === "number") {
    lines.push(`${tone("id", CLI_PALETTE.secondary)} ${tone(String(message.id), CLI_PALETTE.primary)}`);
  }

  if (typeof message.scope === "string" && message.scope !== "") {
    lines.push(`${tone("scope", CLI_PALETTE.secondary)} ${tone(message.scope, CLI_PALETTE.primary)}`);
  }

  if (typeof message.body === "string" && message.body.trim() !== "") {
    lines.push(`${tone("body", CLI_PALETTE.secondary)} ${tone(truncate(message.body.trim()), CLI_PALETTE.primary)}`);
  }

  const author = message.author_label ?? message.author_wallet_address ?? message.author;
  if (typeof author === "string" && author !== "") {
    lines.push(`${tone("author", CLI_PALETTE.secondary)} ${tone(author, CLI_PALETTE.primary)}`);
  }

  if (typeof message.created_at === "string") {
    lines.push(`${tone("time", CLI_PALETTE.secondary)} ${tone(message.created_at, CLI_PALETTE.secondary)}`);
  }

  return renderPanel(`◆ CHAT · ${scopeLabel} · ${event.event}`, lines, {
    borderColor: CLI_PALETTE.emphasis,
    titleColor: CLI_PALETTE.title,
  });
};

const requireScope = (args: ParsedCliArgs): string => requireArg(args.positionals[3], "scope");

/**
 * Resolve the scopes for a variadic chat command: explicit positional scopes
 * win, then the locally saved subscriptions for the product, then ["system"].
 */
export const resolveChatScopes = (
  positionalScopes: readonly string[],
  config: RegentConfig,
  product: ChatProduct,
): readonly string[] => {
  if (positionalScopes.length > 0) {
    return positionalScopes;
  }

  const subscriptions = listChatSubscriptions(config, product);
  return subscriptions.length > 0 ? subscriptions : DEFAULT_SCOPES;
};

export async function runTechtreeChatList(configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.chat.channels", undefined, configPath));
}

export async function runTechtreeChatRead(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const filter = resolveChatAuthorFilter(args, loadConfig(configPath));
  const result = await daemonCall(
    "techtree.chat.history",
    {
      scope: requireScope(args),
      limit: parseIntegerFlag(args, "limit"),
      before: parseIntegerFlag(args, "before"),
    },
    configPath,
  );

  printJson(filter ? { ...result, data: result.data.filter(filter) } : result);
}

export async function runTechtreeChatSend(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.chat.post",
      {
        scope: requireScope(args),
        body: requireArg(getFlag(args, "message"), "--message"),
        reply_to_message_id: parseIntegerFlag(args, "reply-to"),
        client_message_id: getFlag(args, "client-message-id"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeChatTail(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const config = loadConfig(configPath);
  const scopes = resolveChatScopes(args.positionals.slice(3), config, "techtree");
  const filter = resolveChatAuthorFilter(args, config);

  await tailChatScopes(scopes, filter, configPath);
}

export async function runTechtreeChatUnread(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const config = loadConfig(configPath);
  const scopes = resolveChatScopes(args.positionals.slice(3), config, "techtree");
  const filter = resolveChatAuthorFilter(args, config);
  const peek = getBooleanFlag(args, "peek");

  printJson(
    await collectUnreadForScopes({
      scopes,
      filter,
      peek,
      config,
      product: "techtree",
      fetchPage: (scope, before) =>
        daemonCall("techtree.chat.history", { scope, limit: CHAT_UNREAD_PAGE_LIMIT, before }, configPath),
    }),
  );
}

export interface ChatUnreadScopeResult {
  scope: string;
  unread_count: number;
  cursor: number | null;
  messages: ChatAuthorMessage[];
}

export interface ChatUnreadResult {
  peek: boolean;
  data: ChatUnreadScopeResult[];
}

/**
 * Shared unread driver for both products: per scope, page the newest messages
 * back to the saved cursor, report the new ones oldest-first, and advance the
 * cursor to the newest fetched id unless peeking.
 */
export const collectUnreadForScopes = async (input: {
  scopes: readonly string[];
  filter: ChatAuthorFilter;
  peek: boolean;
  config: RegentConfig;
  product: ChatProduct;
  fetchPage: (scope: string, before?: number) => Promise<{
    data: ChatAuthorMessage[];
    pagination?: { limit?: number; next_cursor?: number | null };
  }>;
}): Promise<ChatUnreadResult> => {
  const cursors = readChatCursors(input.config, input.product);
  const nextCursors: Record<string, number> = { ...cursors };
  const data: ChatUnreadScopeResult[] = [];

  for (const scope of input.scopes) {
    const cursor = cursors[scope];
    const { messages, newestId } = await collectUnreadMessages(
      (before) => input.fetchPage(scope, before),
      cursor,
    );

    if (newestId !== undefined) {
      nextCursors[scope] = newestId;
    }

    const visible = input.filter ? messages.filter(input.filter) : messages;
    data.push({
      scope,
      unread_count: visible.length,
      cursor: newestId ?? cursor ?? null,
      messages: visible,
    });
  }

  if (!input.peek) {
    writeChatCursors(input.config, input.product, nextCursors);
  }

  return { peek: input.peek, data };
};

export async function runTechtreeChatSubscribeAdd(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const scope = requireArg(args.positionals[4], "scope");
  const config = loadConfig(configPath);
  printJson({ ok: true, product: "techtree", ...addChatSubscription(config, "techtree", scope) });
}

export async function runTechtreeChatSubscribeRemove(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const scope = requireArg(args.positionals[4], "scope");
  const config = loadConfig(configPath);
  printJson({ ok: true, product: "techtree", ...removeChatSubscription(config, "techtree", scope) });
}

export async function runTechtreeChatSubscribeList(configPath?: string): Promise<void> {
  const config = loadConfig(configPath);
  printJson({ ok: true, product: "techtree", scopes: listChatSubscriptions(config, "techtree") });
}

export async function runTechtreeDm(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const target = requireArg(args.positionals[2], "node-id or address");
  const message = requireArg(getFlag(args, "message"), "--message");

  let wallet: string;
  if (/^\d+$/.test(target)) {
    const node = await daemonCall("techtree.nodes.get", { id: Number.parseInt(target, 10) }, configPath);
    const creatorWallet = node.data.creator_agent?.wallet_address;
    if (!creatorWallet) {
      throw new Error(`node ${target} has no creator agent wallet to DM`);
    }

    wallet = creatorWallet;
  } else if (/^0x[0-9a-fA-F]{40}$/.test(target)) {
    wallet = target;
  } else {
    throw new Error(`invalid DM target: ${target}; expected a numeric node id or a 0x wallet address`);
  }

  const config = loadConfig(configPath);
  printJson(await sendXmtpDm(config.xmtp, wallet, message));
}

export async function runTechtreeDmList(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const config = loadConfig(configPath);
  printJson(await listXmtpDms(config.xmtp, { sync: getBooleanFlag(args, "sync") }));
}

export async function tailChatScopes(
  scopes: readonly string[],
  filter: ChatAuthorFilter,
  configPath?: string,
): Promise<void> {
  const status = await daemonCall("gossipsub.status", undefined, configPath);

  if (!status.enabled) {
    throw new Error("chat transport is disabled in config");
  }

  if (!status.eventSocketPath) {
    throw new Error("runtime did not expose a local chat transport socket");
  }

  const eventSocketPath = status.eventSocketPath;

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(eventSocketPath);
    let buffer = "";
    let settled = false;

    const cleanup = (): void => {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
      socket.removeAllListeners();
      socket.end();
      socket.destroy();
    };

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const handleSignal = () => {
      finish();
    };

    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ scopes })}\n`);
      if (isHumanTerminal()) {
        process.stdout.write(
          `${renderPanel("◆ CHAT LISTENING", [
            `${tone("scopes", CLI_PALETTE.secondary)} ${tone(scopes.join(", "), CLI_PALETTE.primary, true)}`,
            `${tone("socket", CLI_PALETTE.secondary)} ${tone(eventSocketPath, CLI_PALETTE.primary)}`,
          ], {
            borderColor: CLI_PALETTE.emphasis,
            titleColor: CLI_PALETTE.title,
          })}\n\n`,
        );
      }
    });
    socket.on("data", (chunk) => {
      buffer += chunk;

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex < 0) {
          break;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) {
          continue;
        }

        let payload: unknown;

        try {
          payload = JSON.parse(line) as unknown;
        } catch {
          finish(new Error("runtime chat transport stream returned invalid JSON"));
          return;
        }

        if (isChatLiveEvent(payload)) {
          if (filter && !filter(payload.message)) {
            continue;
          }

          if (isHumanTerminal()) {
            process.stdout.write(`${renderChatEvent(payload)}\n\n`);
          } else {
            printJsonLine(payload);
          }
          continue;
        }

        if (payload && typeof payload === "object" && "event" in payload && payload.event === "heartbeat") {
          continue;
        }

        if (payload && typeof payload === "object" && "error" in payload) {
          finish(
            new Error(
              `runtime chat transport error: ${String((payload as { error?: unknown }).error ?? "unknown")}`,
            ),
          );
          return;
        }
      }
    });

    socket.on("error", () => {
      finish(new Error(`unable to connect to local chat transport socket at ${eventSocketPath}`));
    });

    socket.on("close", () => {
      finish();
    });
  });
}
