import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { DoctorCheckDefinition } from "../types.js";
import { skipDueToMissingConfig } from "./shared.js";

const resolveRepoRoot = (): string => process.cwd();

export function artifactChecks(): DoctorCheckDefinition[] {
  return [
    {
      id: "artifact.core.dir",
      scope: "artifact",
      title: "Artifact core toolchain",
      run: async (ctx) => {
        const repoRoot = resolveRepoRoot();
        const coreDir = path.join(repoRoot, "core");
        const pyprojectPath = path.join(coreDir, "pyproject.toml");
        const exists = fs.existsSync(coreDir) && fs.existsSync(pyprojectPath);

        return {
          status: exists ? "ok" : "fail",
          message: exists
            ? "Canonical techtree core workspace is present"
            : "Canonical techtree core workspace is missing",
          details: {
            coreDir,
            pyprojectPath,
          },
          remediation: exists ? undefined : "Restore the repository `core/` workspace before compiling artifacts",
        };
      },
    },
    {
      id: "artifact.uv.available",
      scope: "artifact",
      title: "uv executable",
      run: async (_ctx) => {
        const probe = spawnSync("uv", ["--version"], { encoding: "utf8" });
        const ok = probe.status === 0;

        return {
          status: ok ? "ok" : "fail",
          message: ok ? "uv is available for canonical artifact compilation" : "uv is unavailable",
          details: {
            stdout: probe.stdout?.trim() || null,
            stderr: probe.stderr?.trim() || null,
          },
          remediation: ok ? undefined : "Install uv before using `regent techtree <tree> artifact|run|review ...`",
        };
      },
    },
    {
      id: "artifact.workspace.root",
      scope: "artifact",
      title: "Artifact workspace root",
      run: async (ctx) => {
        if (!ctx.config) {
          return skipDueToMissingConfig();
        }

        return {
          status: "ok",
          message: "Artifact workflows use the current workspace path; no separate legacy BBH bundle root remains",
          details: {
            cwd: process.cwd(),
          },
        };
      },
    },
  ];
}
