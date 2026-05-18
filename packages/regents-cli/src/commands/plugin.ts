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
  const report = pluginStatus(parseRuntimeSelector(getFlag(args, "runtime")));
  const missing = report.runtimes.filter((runtime) => !runtime.installed);

  printJson({
    ...report,
    next_steps: missing.length > 0
      ? [`regents plugin install --runtime ${report.selectedRuntime}`]
      : ["regents run"],
  });
  return 0;
}

export async function runPluginInstall(args: ParsedCliArgs): Promise<number> {
  const runtime = parseInstallRuntimeSelector(getFlag(args, "runtime"));
  const runtimes = selectedRuntimes(runtime);
  const includesHermes = runtimes.includes("hermes");

  printJson({
    ok: true,
    selectedRuntime: runtime,
    installed_plugins: runtimes.map((entry) => installPlugin(entry)),
    next_steps: [
      ...(includesHermes ? ["hermes auth add xai-oauth"] : []),
      `regents plugin doctor --runtime ${runtime}`,
      "regents run",
    ],
  });
  return 0;
}

export async function runPluginDoctor(args: ParsedCliArgs): Promise<number> {
  const report = pluginStatus(parseRuntimeSelector(getFlag(args, "runtime")));
  const missing = report.runtimes.filter((runtime) => !runtime.installed).map((runtime) => runtime.runtime);
  printJson({
    ...report,
    ok: missing.length === 0,
    missing,
    next_steps: missing.length > 0
      ? [`regents plugin install --runtime ${report.selectedRuntime}`]
      : ["regents run"],
  });
  return 0;
}
