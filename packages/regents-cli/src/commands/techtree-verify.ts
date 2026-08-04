import { CliUsageError } from "../cli-usage-error.js";
import { daemonCall } from "../daemon-client.js";
import { JsonRpcError } from "../internal-runtime/index.js";
import { getBooleanFlag, getFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";

const parseHermesCommand = (value: string | undefined): string[] | undefined => {
  if (value === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((part) => typeof part === "string" && part.length > 0)) {
      return parsed;
    }
  } catch {
    // Report the same stable usage error for malformed JSON and malformed arrays.
  }
  throw new CliUsageError({
    code: "invalid_flag_value",
    message: "--hermes-command-json must be a non-empty JSON string array.",
  });
};

export async function runTechtreeVerifyRun(args: ParsedCliArgs, configPath?: string): Promise<void> {
  if (!getBooleanFlag(args, "builtin")) {
    throw new CliUsageError({ code: "missing_required_argument", message: "--builtin is required.", missing: ["--builtin"] });
  }
  const fixture = getBooleanFlag(args, "fixture");
  const hermesCommand = parseHermesCommand(getFlag(args, "hermes-command-json"));
  if (fixture && hermesCommand) {
    throw new CliUsageError({ code: "invalid_flag_value", message: "--fixture cannot be combined with --hermes-command-json." });
  }
  if (!fixture && !hermesCommand) {
    throw new JsonRpcError("Use --fixture or provide --hermes-command-json to configure the Verify executor.", {
      code: "missing_verify_executor_configuration",
      nextSteps: ["Run `regents techtree verify run --builtin --fixture --json` for the offline path."],
    });
  }
  printJson(await daemonCall("techtree.verify.run", {
    builtin: true,
    executor: fixture ? "fixture" : "hermes",
    hermes_command: hermesCommand,
  }, configPath));
}

export async function runTechtreeVerifyStatus(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.verify.status", {
    comparison_id: requireArg(getFlag(args, "comparison-id"), "--comparison-id"),
  }, configPath));
}

export async function runTechtreeVerifyReceiptShow(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.verify.receipt.show", {
    digest: requireArg(getFlag(args, "digest"), "--digest"),
  }, configPath));
}
