import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import type { DoctorCheckDefinition } from "../types.js";
import { writeInitialConfigIfMissing } from "../../config.js";
import { callJsonRpc } from "../../jsonrpc/client.js";
import { defaultConfigPath } from "../../paths.js";
import { buildBackendDetails, ensureDirExists, skipDueToMissingConfig, uniquePaths } from "./shared.js";

async function validateStaleSocketPath(socketPath: string): Promise<{
  stale: boolean;
  reason: "missing" | "non_socket_file" | "connection_refused" | "timeout" | "active";
}> {
  if (!fs.existsSync(socketPath)) {
    return { stale: true, reason: "missing" };
  }

  const stats = fs.lstatSync(socketPath);
  if (!stats.isSocket()) {
    return { stale: true, reason: "non_socket_file" };
  }

  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let settled = false;

    const finish = (result: { stale: boolean; reason: "connection_refused" | "timeout" | "active" }) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(250);
    socket.once("connect", () => finish({ stale: false, reason: "active" }));
    socket.once("timeout", () => finish({ stale: false, reason: "timeout" }));
    socket.once("error", (error) => {
      const errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      finish({
        stale: errorCode === "ECONNREFUSED" || errorCode === "ENOENT",
        reason: "connection_refused",
      });
    });
  });
}

export function runtimeChecks(): DoctorCheckDefinition[] {
  return [
    {
      id: "runtime.config.load",
      scope: "runtime",
      title: "config loaded",
      run: async (ctx) => {
        const existedBeforeCheck = fs.existsSync(ctx.configPath);

        if (!existedBeforeCheck && ctx.fix) {
          const created = writeInitialConfigIfMissing(ctx.configPath);
          if (created) {
            ctx.refreshConfig();
            return {
              status: ctx.config ? "ok" : "fail",
              message: ctx.config
                ? "Created a default config file and loaded it successfully"
                : "Created a default config file, but loading it still failed",
              details: {
                configPath: ctx.configPath,
                created,
                ...(ctx.configLoadError ? { error: ctx.configLoadError.message } : {}),
              },
              remediation: ctx.config ? undefined : "Inspect the generated config file and retry",
              fixApplied: ctx.config ? true : undefined,
            };
          }
        }

        if (!existedBeforeCheck) {
          return {
            status: "fail",
            message: "Config file is missing",
            details: {
              configPath: ctx.configPath || defaultConfigPath(),
            },
            remediation: "Run `regent create init`",
          };
        }

        if (ctx.configLoadError) {
          return {
            status: "fail",
            message: "Config file could not be parsed or validated",
            details: {
              configPath: ctx.configPath,
              error: ctx.configLoadError.message,
            },
            remediation: "Fix the config file JSON and required fields",
          };
        }

        return {
          status: "ok",
          message: "Config file exists and validates",
          details: {
            configPath: ctx.configPath,
          },
        };
      },
    },
    {
      id: "runtime.paths.ensure",
      scope: "runtime",
      title: "runtime paths ready",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        const requiredDirs = uniquePaths([
          path.dirname(ctx.configPath),
          ctx.config.runtime.stateDir,
          path.dirname(ctx.config.runtime.socketPath),
          path.dirname(ctx.config.wallet.keystorePath),
          path.dirname(ctx.config.gossipsub.peerIdPath),
        ]);
        const missing = requiredDirs.filter((dirPath) => !fs.existsSync(dirPath));

        if (missing.length === 0) {
          return {
            status: "ok",
            message: "Required runtime directories are present",
            details: {
              directories: requiredDirs,
            },
          };
        }

        if (ctx.fix) {
          for (const dirPath of missing) {
            ensureDirExists(dirPath);
          }

          return {
            status: "ok",
            message: "Created missing runtime directories",
            details: {
              directories: requiredDirs,
              created: missing,
            },
            remediation: "Run `regent run` if the daemon still is not available",
            fixApplied: true,
          };
        }

        return {
          status: "fail",
          message: "Required runtime directories are missing",
          details: {
            missing,
          },
          remediation: "Run `regent doctor --fix` or `regent create init`",
        };
      },
    },
    {
      id: "runtime.socket.reachable",
      scope: "runtime",
      title: "runtime socket reachable",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        const socketPath = ctx.config.runtime.socketPath;
        if (!fs.existsSync(socketPath)) {
          return {
            status: "warn",
            message: "Runtime socket is not present; the daemon is not running",
            details: {
              socketPath,
            },
            remediation: "Run `regent run`",
          };
        }

        try {
          await callJsonRpc(socketPath, "runtime.ping");
          return {
            status: "ok",
            message: "Runtime control socket is reachable",
            details: {
              socketPath,
            },
          };
        } catch (error) {
          if (ctx.fix) {
            const validation = await validateStaleSocketPath(socketPath);
            if (validation.stale) {
              fs.rmSync(socketPath, { force: true });
              return {
                status: "warn",
                message: "Removed a validated stale runtime socket; the daemon still is not running",
                details: {
                  socketPath,
                  validation,
                  error: buildBackendDetails(error),
                },
                remediation: "Run `regent run`",
                fixApplied: true,
              };
            }

            return {
              status: "warn",
              message: "Runtime socket exists but could not be validated as stale, so no local fix was applied",
              details: {
                socketPath,
                validation,
                error: buildBackendDetails(error),
              },
              remediation: "Stop the existing daemon cleanly or remove the socket manually after verification",
            };
          }

          return {
            status: "warn",
            message: "Runtime socket exists but is unreachable",
            details: {
              socketPath,
              error: buildBackendDetails(error),
            },
            remediation: "Run `regent doctor --fix` or `regent run`",
          };
        }
      },
    },
    {
      id: "runtime.wallet.source",
      scope: "runtime",
      title: "wallet available",
      run: async (ctx) => {
        if (!ctx.config || !ctx.walletSecretSource) {
          return skipDueToMissingConfig();
        }

        try {
          const privateKey = await ctx.walletSecretSource.getPrivateKeyHex();
          const walletAddress = await import("../../agent/wallet.js").then(({ deriveWalletAddress }) =>
            deriveWalletAddress(privateKey),
          );

          return {
            status: "ok",
            message: "Wallet secret source is available and signer initialized",
            details: {
              walletAddress,
              source:
                "envVarName" in ctx.walletSecretSource
                  ? { type: "env", envVarName: ctx.walletSecretSource.envVarName }
                  : "filePath" in ctx.walletSecretSource
                    ? { type: "file", filePath: ctx.walletSecretSource.filePath }
                    : { type: "unknown" },
            },
          };
        } catch (error) {
          return {
            status: "fail",
            message: "Wallet secret source could not be loaded",
            details: buildBackendDetails(error),
            remediation: `Set ${ctx.config.wallet.privateKeyEnv} or configure ${ctx.config.wallet.keystorePath}`,
          };
        }
      },
    },
  ];
}
