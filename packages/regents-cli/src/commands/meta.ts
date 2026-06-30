import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

import { CliUsageError } from "../cli-usage-error.js";
import { getBooleanFlag, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";

const findWorkspaceRoot = (startPath: string): string | undefined => {
  let current = resolve(startPath);
  while (true) {
    if (
      existsSync(resolve(current, "meta/stack.yaml")) &&
      existsSync(resolve(current, "regents-cli/package.json"))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
};

const runScript = (
  args: ParsedCliArgs,
  scriptName: string,
  scriptArgs: readonly string[] = [],
): number => {
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  if (!workspaceRoot) {
    throw new CliUsageError({
      code: "missing_workspace",
      message: "Run this command inside the Regent workspace.",
    });
  }

  const scriptPath = resolve(workspaceRoot, "regents-cli/scripts", scriptName);
  const json = getBooleanFlag(args, "json");
  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: resolve(workspaceRoot, "regents-cli"),
    encoding: "utf8",
    stdio: json ? "pipe" : "inherit",
  });

  const status = result.status ?? 1;
  if (json) {
    printJson({
      ok: status === 0,
      command: args.positionals.join(" "),
      stdout: result.stdout?.trim() ?? "",
      stderr: result.stderr?.trim() ?? "",
    });
  }

  return status;
};

export async function runMetaCheck(args: ParsedCliArgs): Promise<number> {
  return runScript(args, "check-workspace.mjs");
}

export async function runMetaRender(args: ParsedCliArgs): Promise<number> {
  return runScript(
    args,
    "render-meta.mjs",
    getBooleanFlag(args, "check") ? ["--check"] : [],
  );
}
