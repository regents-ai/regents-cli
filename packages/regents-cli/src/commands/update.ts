import { spawnSync } from "node:child_process";

import type { ParsedCliArgs } from "../parse.js";

import { getBooleanFlag, getFlag } from "../parse.js";
import { cliVersion, printJson, printText } from "../printer.js";

export async function runUpdate(args: ParsedCliArgs): Promise<number> {
  const target = getFlag(args, "version") ?? "latest";
  const wantsJson = getBooleanFlag(args, "json");
  const spec = `@regentslabs/cli@${target}`;
  const before = cliVersion() || "unknown";

  if (!wantsJson) {
    printText(`Updating ${spec} (current: ${before})...`);
  }

  const result = spawnSync("npm", ["install", "-g", spec], {
    stdio: wantsJson ? "pipe" : "inherit",
    encoding: "utf8",
    timeout: 300_000,
  });

  const ok = result.status === 0 && !result.error;

  if (wantsJson) {
    printJson({
      ok,
      target,
      previous_version: before,
      detail: ok
        ? `Installed ${spec}.`
        : (result.error?.message ?? `${result.stderr ?? ""}`.trim() ?? "npm install failed"),
      next: ok ? ["regents setup --quick", "regents doctor"] : ["npm install -g " + spec],
    });
    return ok ? 0 : 1;
  }

  if (ok) {
    printText(`Updated. Run 'regents setup --quick' to refresh plugins, and 'regents doctor' to verify.`);
    return 0;
  }

  printText(`Update failed. Try running it directly: npm install -g ${spec}`);
  return 1;
}
