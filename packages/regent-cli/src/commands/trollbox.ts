import net from "node:net";

import type { GossipsubStatus, TrollboxLiveEvent } from "../internal-types/index.js";

import { daemonCall } from "../daemon-client.js";
import { getBooleanFlag, getFlag, parseIntegerFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";

type TrollboxRoom = "webapp" | "agent";

const isTrollboxLiveEvent = (payload: unknown): payload is TrollboxLiveEvent => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Partial<TrollboxLiveEvent>;
  return typeof candidate.event === "string" && !!candidate.message && typeof candidate.message === "object";
};

const parseRoomFlag = (args?: ParsedCliArgs): TrollboxRoom | undefined => {
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

  if (args.flags.has("room")) {
    throw new Error("`--room` was removed; use `--agent` or `--webapp`");
  }

  return undefined;
};

export async function runTrollboxHistory(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const room = parseRoomFlag(args) ?? "webapp";
  printJson(
    await daemonCall(
      "techtree.trollbox.history",
      {
        limit: parseIntegerFlag(args, "limit"),
        before: parseIntegerFlag(args, "before"),
        room: room,
      },
      configPath,
    ),
  );
}

export async function runTrollboxPost(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const room = parseRoomFlag(args);
  if (room === "webapp") {
    throw new Error("CLI posting is limited to agent chat; use the web app for webapp chat");
  }

  printJson(
    await daemonCall(
      "techtree.trollbox.post",
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

export async function runTrollboxTail(args?: ParsedCliArgs, configPath?: string): Promise<void> {
  const room = parseRoomFlag(args) === "agent" ? "agent" : "webapp";
  const status = await daemonCall("gossipsub.status", undefined, configPath);

  if (!status.enabled) {
    throw new Error("trollbox transport is disabled in config");
  }

  if (!status.eventSocketPath) {
    throw new Error("runtime did not expose a local trollbox transport socket");
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
          finish(new Error("runtime trollbox transport stream returned invalid JSON"));
          return;
        }

        if (isTrollboxLiveEvent(payload)) {
          printJson(payload);
          continue;
        }

        if (payload && typeof payload === "object" && "event" in payload && payload.event === "heartbeat") {
          continue;
        }

        if (payload && typeof payload === "object" && "error" in payload) {
          finish(
            new Error(
              `runtime trollbox transport error: ${String((payload as { error?: unknown }).error ?? "unknown")}`,
            ),
          );
          return;
        }
      }
    });

    socket.on("error", () => {
      finish(new Error(`unable to connect to local trollbox transport socket at ${eventSocketPath}`));
    });

    socket.on("close", () => {
      finish();
    });
  });
}

export const runChatHistory = runTrollboxHistory;
export const runChatPost = runTrollboxPost;
export const runChatTail = runTrollboxTail;
