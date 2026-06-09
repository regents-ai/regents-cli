#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isCliUsageError, withCliUsageContext } from "./cli-usage-error.js";
import { knownCliCommand } from "./command-registry.js";
import { runOperatorOverview } from "./commands/operator.js";
import { nextStepForPositionals, printScopedHelp, usageHintForPositionals } from "./help.js";
import { defaultConfigPath, expandHome } from "./internal-runtime/index.js";
import { getBooleanFlag, getFlag, parseCliArgs } from "./parse.js";
import { printError, setRawJsonOutput } from "./printer.js";
import { cliRoutes, dispatchRoute, type CliRouteContext } from "./routes/index.js";

export const parseConfigPath = (args: string[]): string | undefined => {
  const configFlag = getFlag(args, "config");
  return configFlag ? expandHome(configFlag) : undefined;
};

const helpPositionals = (positionals: readonly string[]): string[] =>
  positionals.filter((value) => value !== "-h" && value !== "--help");

export async function runCliEntrypoint(rawArgs: string[]): Promise<number> {
  try {
    const parsedArgs = parseCliArgs(rawArgs);
    const configPath = parseConfigPath(rawArgs);
    setRawJsonOutput(getBooleanFlag(parsedArgs, "json"));
    const [namespace] = parsedArgs.positionals;

    const routeContext: CliRouteContext = {
      rawArgs,
      parsedArgs,
      configPath,
      positionals: parsedArgs.positionals,
    };

    if (namespace === "feynman") {
      const routedResult = await dispatchRoute(cliRoutes, routeContext);
      if (routedResult !== undefined) {
        return routedResult;
      }
    }

    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      printScopedHelp(helpPositionals(parsedArgs.positionals), configPath ?? defaultConfigPath());
      return 0;
    }

    if (!namespace) {
      return runOperatorOverview(parsedArgs, configPath);
    }

    const routedResult = await dispatchRoute(cliRoutes, routeContext);
    if (routedResult !== undefined) {
      return routedResult;
    }

    const enteredCommand = parsedArgs.positionals.join(" ");
    throw new Error(
      knownCliCommand(parsedArgs.positionals)
        ? `Command is not available yet: ${enteredCommand}`
        : `Unknown command: ${enteredCommand}`,
    );
  } catch (error) {
    const parsedArgs = parseCliArgs(rawArgs);
    const usageError = isCliUsageError(error)
      ? withCliUsageContext(error, usageHintForPositionals(parsedArgs.positionals) ?? {})
      : error;
    printError(usageError, { nextStep: nextStepForPositionals(parsedArgs.positionals) });
    return 1;
  }
}

export async function runCli(rawArgs: string[] = process.argv.slice(2)): Promise<number | void> {
  return runCliEntrypoint(rawArgs);
}

const main = async (): Promise<void> => {
  const exitCode = await runCliEntrypoint(process.argv.slice(2));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
};

const isMainModule = (): boolean => {
  const invokedPath = process.argv[1];
  if (!invokedPath) {
    return false;
  }

  const currentModulePath = fileURLToPath(import.meta.url);

  try {
    return fs.realpathSync(invokedPath) === fs.realpathSync(currentModulePath);
  } catch {
    return path.resolve(invokedPath) === path.resolve(currentModulePath);
  }
};

if (isMainModule()) {
  void main();
}
