import { CliUsageError } from "../cli-usage-error.js";
import { getFlag, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";
import { pluginStatus, type RegentAgentRuntimeSelector } from "../internal-runtime/plugin-bridge.js";

const parseRuntime = (value: string | undefined): RegentAgentRuntimeSelector => {
  if (value === "auto" || value === "hermes" || value === "openclaw") {
    return value;
  }
  throw new CliUsageError({
    code: "invalid_flag_value",
    message: "--runtime must be auto, hermes, or openclaw.",
  });
};

export async function runSetup(args: ParsedCliArgs): Promise<number> {
  const runtime = parseRuntime(getFlag(args, "runtime"));

  printJson({
    ok: true,
    runtime,
    plugin_status: pluginStatus(runtime),
    next: [
      "regents plugin install --runtime auto",
      "regents identity ensure",
      "regents run",
      "regents techtree work next --json",
    ],
  });

  return 0;
}
