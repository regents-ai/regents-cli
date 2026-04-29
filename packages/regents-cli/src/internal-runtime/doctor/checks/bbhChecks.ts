import { constants } from "node:fs";
import fs from "node:fs/promises";

import { TechtreeRuntimeClient } from "../../techtree/runtime-client.js";
import type { DoctorCheckDefinition } from "../types.js";
import { buildBackendDetails, skipDueToMissingConfig } from "./shared.js";

const createClient = (ctx: Parameters<DoctorCheckDefinition["run"]>[0]) =>
  new TechtreeRuntimeClient({
    baseUrl: ctx.config!.services.techtree.baseUrl,
    requestTimeoutMs: ctx.config!.services.techtree.requestTimeoutMs,
    config: ctx.config!,
  });

export function bbhChecks(): DoctorCheckDefinition[] {
  return [
    {
      id: "bbh.leaderboard.read",
      scope: "bbh",
      title: "BBH leaderboard view",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        try {
          const response = await createClient(ctx).getBbhLeaderboard({ split: "benchmark" });
          return {
            status: "ok",
            message: "BBH leaderboard is readable through the v0.1 public view",
            details: {
              entries: response.data.entries.length,
              generated_at: response.data.generated_at,
              split: response.data.split,
            },
          };
        } catch (error) {
          return {
            status: "fail",
            message: "BBH leaderboard could not be read from the v0.1 public view",
            details: buildBackendDetails(error),
            remediation: "Start the Techtree backend and verify `/v1/bbh/leaderboard`",
          };
        }
      },
    },
    {
      id: "bbh.workspace.root",
      scope: "bbh",
      title: "BBH workspace root",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        try {
          const workspaceRoot = ctx.config.workloads.bbh.workspaceRoot;
          await fs.mkdir(workspaceRoot, { recursive: true });
          await fs.access(workspaceRoot, constants.R_OK | constants.W_OK);

          return {
            status: "ok",
            message: "BBH workspace root is available for local solve runs",
            details: {
              workspace_root: workspaceRoot,
            },
          };
        } catch (error) {
          return {
            status: "fail",
            message: "BBH workspace root is not ready for local solve runs",
            details: buildBackendDetails(error),
            remediation: "Fix the Regent BBH workspace root path and ensure it is readable and writable",
          };
        }
      },
    },
  ];
}
