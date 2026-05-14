import { CliUsageError } from "../cli-usage-error.js";
import { getFlag, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";
import {
  installPlugin,
  pluginStatus,
  selectedRuntimes,
  type RegentAgentRuntimeSelector,
} from "../internal-runtime/plugin-bridge.js";

const parseRuntimeSelector = (value: string | undefined): RegentAgentRuntimeSelector => {
  const runtime = value ?? "auto";
  if (runtime === "auto" || runtime === "hermes" || runtime === "openclaw") {
    return runtime;
  }
  throw new CliUsageError({
    code: "invalid_flag_value",
    message: "--runtime must be auto, hermes, or openclaw.",
  });
};

const parseInstallRuntimeSelector = (value: string | undefined): RegentAgentRuntimeSelector => {
  if (value === "auto" || value === "hermes" || value === "openclaw") {
    return value;
  }
  throw new CliUsageError({
    code: "invalid_flag_value",
    message: "--runtime must be auto, hermes, or openclaw.",
  });
};

export async function runPluginStatus(args: ParsedCliArgs): Promise<number> {
  printJson(pluginStatus(parseRuntimeSelector(getFlag(args, "runtime"))));
  return 0;
}

export async function runPluginInstall(args: ParsedCliArgs): Promise<number> {
  const runtime = parseInstallRuntimeSelector(getFlag(args, "runtime"));

  printJson({
    ok: true,
    selectedRuntime: runtime,
    installed_plugins: selectedRuntimes(runtime).map((entry) => installPlugin(entry)),
  });
  return 0;
}

export async function runPluginDoctor(args: ParsedCliArgs): Promise<number> {
  const report = pluginStatus(parseRuntimeSelector(getFlag(args, "runtime")));
  printJson({
    ...report,
    ok: report.runtimes.every((runtime) => runtime.installed),
    missing: report.runtimes.filter((runtime) => !runtime.installed).map((runtime) => runtime.runtime),
  });
  return 0;
}
