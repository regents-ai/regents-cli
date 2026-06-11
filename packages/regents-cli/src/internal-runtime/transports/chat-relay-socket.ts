import fs from "node:fs";
import net from "node:net";

import { ensureParentDir } from "../paths.js";
import { DEFAULT_CHAT_SCOPE, type GossipsubAdapter } from "./gossipsub-adapter.js";
import { resolveRelaySocketPath } from "./unix-socket-path.js";

export const resolveChatRelaySocketPath = (runtimeSocketPath: string): string => {
  return resolveRelaySocketPath(runtimeSocketPath, "chat");
};

export class ChatRelaySocketServer {
  readonly socketPath: string;

  private readonly adapter: GossipsubAdapter;
  private server: net.Server | null = null;

  constructor(runtimeSocketPath: string, adapter: GossipsubAdapter) {
    this.socketPath = resolveChatRelaySocketPath(runtimeSocketPath);
    this.adapter = adapter;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    ensureParentDir(this.socketPath);
    if (fs.existsSync(this.socketPath)) {
      fs.rmSync(this.socketPath, { force: true });
    }

    this.server = net.createServer((socket) => {
      socket.setEncoding("utf8");

      let unsubscribe: (() => void) | null = null;
      let buffer = "";
      let subscribed = false;

      const subscribe = (scope: string) => {
        if (subscribed) {
          return;
        }

        subscribed = true;

        void this.adapter
          .subscribeChat((event) => {
            socket.write(`${JSON.stringify(event)}\n`);
          }, scope)
          .then((dispose) => {
            unsubscribe = dispose;
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "unable to subscribe to chat relay";
            socket.write(`${JSON.stringify({ error: message })}\n`);
            socket.end();
          });
      };

      const cleanup = (): void => {
        if (!unsubscribe) {
          return;
        }

        const dispose = unsubscribe;
        unsubscribe = null;
        dispose();
      };

      socket.on("close", cleanup);
      socket.on("error", cleanup);
      socket.on("end", cleanup);
      socket.on("data", (chunk) => {
        buffer += chunk;

        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex < 0) {
            break;
          }

          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line === "") {
            subscribe(DEFAULT_CHAT_SCOPE);
            continue;
          }

          try {
            const payload = JSON.parse(line) as { scope?: unknown };
            subscribe(typeof payload.scope === "string" && payload.scope !== "" ? payload.scope : DEFAULT_CHAT_SCOPE);
          } catch {
            subscribe(DEFAULT_CHAT_SCOPE);
          }
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.socketPath, () => {
        this.server?.off("error", reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const activeServer = this.server;
    this.server = null;

    if (activeServer) {
      await new Promise<void>((resolve, reject) => {
        activeServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    if (fs.existsSync(this.socketPath)) {
      fs.rmSync(this.socketPath, { force: true });
    }
  }
}
