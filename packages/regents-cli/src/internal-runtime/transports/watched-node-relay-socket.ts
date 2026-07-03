import fs from "node:fs";
import net from "node:net";

import { ensureParentDir } from "../paths.js";
import { claimUnixSocketPath } from "../unix-socket-guard.js";
import { WatchedNodeRelay } from "./watched-node-relay.js";
import { resolveRelaySocketPath } from "./unix-socket-path.js";

export const resolveWatchedNodeRelaySocketPath = (runtimeSocketPath: string): string => {
  return resolveRelaySocketPath(runtimeSocketPath, "watch");
};

export class WatchedNodeRelaySocketServer {
  readonly socketPath: string;

  private readonly relay: WatchedNodeRelay;
  private server: net.Server | null = null;

  constructor(runtimeSocketPath: string, relay: WatchedNodeRelay) {
    this.socketPath = resolveWatchedNodeRelaySocketPath(runtimeSocketPath);
    this.relay = relay;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    ensureParentDir(this.socketPath);
    await claimUnixSocketPath(this.socketPath);

    this.server = net.createServer((socket) => {
      socket.setEncoding("utf8");

      let unsubscribe: (() => void) | null = null;

      void this.relay
        .subscribe((event) => {
          socket.write(`${JSON.stringify(event)}\n`);
        })
        .then((dispose) => {
          unsubscribe = dispose;
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "unable to subscribe to watch relay";
          socket.write(`${JSON.stringify({ error: message })}\n`);
          socket.end();
        });

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
