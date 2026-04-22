export interface ParsedCliArgs {
  raw: readonly string[];
  positionals: readonly string[];
  flags: ReadonlyMap<string, string | true>;
}

const isFlagToken = (value: string): boolean => value.startsWith("--");

export function parseCliArgs(args: readonly string[]): ParsedCliArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === undefined) {
      continue;
    }

    if (value === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }

    if (isFlagToken(value)) {
      const equalsIndex = value.indexOf("=");
      if (equalsIndex > 0) {
        flags.set(value.slice(2, equalsIndex), value.slice(equalsIndex + 1));
        continue;
      }

      const next = args[index + 1];
      if (next === undefined || isFlagToken(next)) {
        flags.set(value.slice(2), true);
        continue;
      }

      flags.set(value.slice(2), next);
      index += 1;
      continue;
    }

    positionals.push(value);
  }

  return {
    raw: args,
    positionals,
    flags,
  };
}

const isParsedCliArgs = (args: readonly string[] | ParsedCliArgs): args is ParsedCliArgs =>
  !Array.isArray(args);

const ensureParsed = (args: readonly string[] | ParsedCliArgs): ParsedCliArgs =>
  isParsedCliArgs(args) ? args : parseCliArgs(args);

export function getFlag(args: readonly string[] | ParsedCliArgs, name: string): string | undefined {
  const parsed = ensureParsed(args);
  const value = parsed.flags.get(name);
  return value === true ? undefined : value;
}

export function getBooleanFlag(args: readonly string[] | ParsedCliArgs, name: string): boolean {
  const parsed = ensureParsed(args);
  return parsed.flags.get(name) === true;
}

export function requireArg(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`missing required argument: ${name}`);
  }

  return value;
}

export function parsePositiveInteger(value: string, errorMessage: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new Error(errorMessage);
  }

  return parsed;
}

export function parseIntegerFlag(args: readonly string[] | ParsedCliArgs, name: string): number | undefined {
  const value = getFlag(args, name);
  if (value === undefined) {
    return undefined;
  }

  return parsePositiveInteger(value, `invalid integer for --${name}`);
}
