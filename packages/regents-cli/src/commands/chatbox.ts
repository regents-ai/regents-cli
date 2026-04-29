import net from "node:net";

import type { GossipsubStatus, ChatboxLiveEvent } from "../internal-types/index.js";

import { daemonCall } from "../daemon-client.js";
import { getBooleanFlag, getFlag, parseIntegerFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { CLI_PALETTE, isHumanTerminal, printJson, printJsonLine, renderPanel, tone } from "../printer.js";

type ChatboxRoom = "webapp" | "agent";

const isChatboxLiveEvent = (payload: unknown): payload is ChatboxLiveEvent => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<ChatboxLiveEvent>;
  return typeof candidate.event === "string" && !!candidate.message && typeof candidate.message === "object";
};

const truncate = (value: string, max = 96): string => {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, Math.max(0, max - 1))}…`;
};

const renderChatboxEvent = (event: ChatboxLiveEvent): string => {
  const message = event.message as unknown as Record<string, unknown>;
  const lines = [
    `${tone("event", CLI_PALETTE.secondary)} ${tone(event.event, CLI_PALETTE.primary, true)}`,
  ];

  if (typeof message.id === "string" || typeof message.id === "number") {
    lines.push(`${tone("id", CLI_PALETTE.secondary)} ${tone(String(message.id), CLI_PALETTE.primary)}`);
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

  return renderPanel(`◆ CHATBOX · ${event.event}`, lines, {
    borderColor: CLI_PALETTE.emphasis,
    titleColor: CLI_PALETTE.title,
  });
};

const parseRoomFlag = (args?: ParsedCliArgs): ChatboxRoom | undefined => {
  if (!args) {
    return undefined;
  }

  const wantsAgent = getBooleanFlag(args, "agent");
  const wantsWebapp = getBooleanFlag(args, "webapp");
  if (wantsAgent && wantsWebapp) {
    throw new Error("choose either `--agent` or `--webapp`, not both");
  }
  if (wantsAgent) {
    return "agent";
  }
  if (wantsWebapp) {
    return "webapp";
  }

  return undefined;
};

export async function runChatboxHistory(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const room = parseRoomFlag(args) ?? "webapp";
  printJson(
    await daemonCall(
      "techtree.chatbox.history",
      {
        limit: parseIntegerFlag(args, "limit"),
        before: parseIntegerFlag(args, "before"),
        room: room,
      },
      configPath,
    ),
  );
}

export async function runChatboxPost(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const room = parseRoomFlag(args);
  if (room === "webapp") {
    throw new Error("CLI posting is limited to agent chat; use the web app for webapp chat");
  }

  printJson(
    await daemonCall(
      "techtree.chatbox.post",
      {
        body: requireArg(getFlag(args, "body"), "body"),
        reply_to_message_id: parseIntegerFlag(args, "reply-to"),
        client_message_id: getFlag(args, "client-message-id"),
        room: "agent",
      },
      configPath,
    ),
  );
}

export async function runChatboxTail(args?: ParsedCliArgs, configPath?: string): Promise<void> {
  const room = parseRoomFlag(args) === "agent" ? "agent" : "webapp";
  const status = await daemonCall("gossipsub.status", undefined, configPath);

  if (!status.enabled) {
    throw new Error("chatbox transport is disabled in config");
  }

  if (!status.eventSocketPath) {
    throw new Error("runtime did not expose a local chatbox transport socket");
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
      socket.write(`${JSON.stringify({ room })}\n`);
      if (isHumanTerminal()) {
        process.stdout.write(
          `${renderPanel("◆ CHATBOX LISTENING", [
            `${tone("room", CLI_PALETTE.secondary)} ${tone(room, CLI_PALETTE.primary, true)}`,
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
          finish(new Error("runtime chatbox transport stream returned invalid JSON"));
          return;
        }

        if (isChatboxLiveEvent(payload)) {
          if (isHumanTerminal()) {
            process.stdout.write(`${renderChatboxEvent(payload)}\n\n`);
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
              `runtime chatbox transport error: ${String((payload as { error?: unknown }).error ?? "unknown")}`,
            ),
          );
          return;
        }
      }
    });

    socket.on("error", () => {
      finish(new Error(`unable to connect to local chatbox transport socket at ${eventSocketPath}`));
    });

    socket.on("close", () => {
      finish();
    });
  });
}
