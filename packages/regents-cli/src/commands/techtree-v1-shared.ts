import path from "node:path";

import type { TechtreeNodeId, TechtreeTreeName } from "../internal-types/index.js";

import { CliUsageError } from "../cli-usage-error.js";
import { getFlag, getFlags, requireArg, type ParsedCliArgs } from "../parse.js";

export const normalizeTree = (value: string): TechtreeTreeName => {
  if (value === "main" || value === "bbh") {
    return value;
  }

  throw new Error("invalid tree; expected `main` or `bbh`");
};

export const workspaceFlag = (args: ParsedCliArgs): string | undefined => getFlag(args, "workspace") ?? getFlag(args, "path");

export const normalizeWorkspacePath = (args: ParsedCliArgs, fallbackIndex: number): string => {
  const explicit = workspaceFlag(args);
  if (explicit) {
    return path.resolve(explicit);
  }

  const positional = args.positionals[fallbackIndex];
  return positional ? path.resolve(positional) : process.cwd();
};

export const optionalWorkspacePath = (args: ParsedCliArgs): string | null => workspaceFlag(args) ?? null;

export const normalizeNodeId = (value: string | undefined, name = "node id"): TechtreeNodeId => {
  const required = requireArg(value, name);
  if (!/^0x[0-9a-f]{64}$/.test(required)) {
    throw new CliUsageError({
      code: "invalid_flag_value",
      message: `invalid ${name}`,
    });
  }

  return required as TechtreeNodeId;
};

export const readRepeatedFlag = (args: ParsedCliArgs, name: string): string[] => [...getFlags(args, name)];

export const parseCsvFlag = (args: ParsedCliArgs, name: string): string[] => {
  const repeated = readRepeatedFlag(args, name);
  if (repeated.length > 0) {
    return repeated.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  }

  const single = getFlag(args, name);
  if (!single) {
    return [];
  }

  return single.split(",").map((value) => value.trim()).filter(Boolean);
};
