import net from "node:net";

import type { ChatLiveEvent } from "../internal-types/index.js";

import { daemonCall } from "../daemon-client.js";
import {
  errorMessage,
  listXmtpDms,
  loadConfig,
  loadXmtpClientInfo,
  sendXmtpConversationText,
  sendXmtpDm,
} from "../internal-runtime/index.js";
import { getBooleanFlag, getFlag, parseIntegerFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { CLI_PALETTE, isHumanTerminal, printJson, printJsonLine, renderPanel, tone } from "../printer.js";

const NODE_SCOPE_PREFIX = "node:";

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

  if (typeof message.author === "string") {
    lines.push(`${tone("author", CLI_PALETTE.secondary)} ${tone(message.author, CLI_PALETTE.primary)}`);
  }

  if (typeof message.created_at === "string") {
    lines.push(`${tone("time", CLI_PALETTE.secondary)} ${tone(message.created_at, CLI_PALETTE.secondary)}`);
  }

  return renderPanel(`◆ CHAT · ${event.event}`, lines, {
    borderColor: CLI_PALETTE.emphasis,
    titleColor: CLI_PALETTE.title,
  });
};

const requireScope = (args: ParsedCliArgs): string => requireArg(args.positionals[3], "scope");

const parseNodeIdFromScope = (scope: string): number => {
  const raw = scope.slice(NODE_SCOPE_PREFIX.length);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`invalid node scope: ${scope}; expected node:<node-id>`);
  }

  return Number.parseInt(raw, 10);
};

const requireNodeIdPositional = (args: ParsedCliArgs): number => {
  const raw = requireArg(args.positionals[3], "node-id");
  if (!/^\d+$/.test(raw)) {
    throw new Error(`invalid node-id: ${raw}; expected a numeric Techtree node id`);
  }

  return Number.parseInt(raw, 10);
};

export const resolveLocalXmtpInboxId = async (configPath?: string): Promise<string> => {
  const config = loadConfig(configPath);

  try {
    return (await loadXmtpClientInfo(config.xmtp)).inboxId;
  } catch (error) {
    throw new Error(
      `local XMTP identity is unavailable (${errorMessage(error)}); run \`regents xmtp init\` first`,
    );
  }
};

export async function runTechtreeChatList(configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.chat.channels", undefined, configPath));
}

export async function runTechtreeChatRead(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.chat.history",
      {
        scope: requireScope(args),
        limit: parseIntegerFlag(args, "limit"),
        before: parseIntegerFlag(args, "before"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeChatSend(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const scope = requireScope(args);
  const message = requireArg(getFlag(args, "message"), "--message");

  if (!scope.startsWith(NODE_SCOPE_PREFIX)) {
    printJson(
      await daemonCall(
        "techtree.chat.post",
        {
          scope,
          body: message,
          reply_to_message_id: parseIntegerFlag(args, "reply-to"),
          client_message_id: getFlag(args, "client-message-id"),
        },
        configPath,
      ),
    );
    return;
  }

  const nodeId = parseNodeIdFromScope(scope);
  const joinHint = `run \`regents techtree chat join ${nodeId}\` to join the node room`;
  const channels = await daemonCall("techtree.chat.channels", undefined, configPath);
  const room = channels.data.find((channel) => channel.scope === scope);

  if (!room) {
    throw new Error(`node room ${scope} does not exist yet; ${joinHint}`);
  }

  if (!room.xmtp_group_id) {
    throw new Error(`node room ${scope} has no XMTP group yet; ${joinHint}`);
  }

  const config = loadConfig(configPath);

  try {
    const result = await sendXmtpConversationText(config.xmtp, room.xmtp_group_id, message);
    printJson({ ...result, scope });
  } catch (error) {
    throw new Error(
      `unable to send to ${scope} over the local XMTP runtime (${errorMessage(error)}); if you are not a member yet, ${joinHint}`,
    );
  }
}

export async function runTechtreeChatJoin(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const nodeId = requireNodeIdPositional(args);
  const xmtpInboxId = await resolveLocalXmtpInboxId(configPath);

  printJson(await daemonCall("techtree.chat.join", { nodeId, xmtpInboxId }, configPath));
}

export async function runTechtreeChatTail(args: ParsedCliArgs, configPath?: string): Promise<void> {
  await tailChatScope(requireScope(args), configPath);
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

export async function tailChatScope(scope: string, configPath?: string): Promise<void> {
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
      socket.write(`${JSON.stringify({ scope })}\n`);
      if (isHumanTerminal()) {
        process.stdout.write(
          `${renderPanel("◆ CHAT LISTENING", [
            `${tone("scope", CLI_PALETTE.secondary)} ${tone(scope, CLI_PALETTE.primary, true)}`,
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
