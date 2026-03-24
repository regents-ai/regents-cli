import fs from "node:fs";

import * as RegentRuntime from "../internal-runtime/index.js";

import { getFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";

const resolveConfigPath = (args: ParsedCliArgs): string => {
  return RegentRuntime.expandHome(getFlag(args, "config") ?? RegentRuntime.defaultConfigPath());
};

const readFileFlag = (value: string | undefined, name: string): string => {
  const requiredValue = requireArg(value, name);
  if (!requiredValue.startsWith("@")) {
    throw new Error(`--${name} must use @/absolute/or/relative/path.json syntax`);
  }

  return fs.readFileSync(requiredValue.slice(1), "utf8");
};

export async function runConfigRead(args: ParsedCliArgs): Promise<void> {
  printJson(RegentRuntime.loadConfig(resolveConfigPath(args)));
}

export async function runConfigWrite(args: ParsedCliArgs): Promise<void> {
  const configPath = resolveConfigPath(args);
  const rawInput = readFileFlag(getFlag(args, "input"), "input");
  const parsedInput = JSON.parse(rawInput) as unknown;
  const writtenConfig = RegentRuntime.writeConfigReplacement(configPath, parsedInput);

  printJson({
    ok: true,
    configPath,
    config: writtenConfig,
  });
}
