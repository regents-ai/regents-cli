import { CLI_COMMANDS } from "../command-registry.js";
import type { ParsedCliArgs } from "../parse.js";

export type CliRouteContext = {
  rawArgs: string[];
  parsedArgs: ParsedCliArgs;
  configPath: string | undefined;
  positionals: readonly string[];
};

export type CliRouteHandler = (context: CliRouteContext) => Promise<number>;

export type CliRoute = {
  command: string;
  pattern: readonly string[];
  variadicTail: boolean;
  handler: CliRouteHandler;
};

export const route = (
  pattern: string,
  handler: CliRouteHandler,
  options?: { readonly variadicTail?: boolean },
): CliRoute => ({
  command: pattern,
  pattern: pattern.split(" "),
  variadicTail: options?.variadicTail ?? false,
  handler,
});

const isPlaceholderPart = (part: string): boolean => part.startsWith("<") && part.endsWith(">");

const inputIsReservedLiteralCommandPrefix = (
  candidate: CliRoute,
  positionals: readonly string[],
): boolean =>
  CLI_COMMANDS.some((command) => {
    if (command === candidate.command) {
      return false;
    }

    const commandParts = command.split(" ");
    if (commandParts.length < positionals.length) {
      return false;
    }

    return positionals.every((part, index) => {
      const commandPart = commandParts[index];
      return commandPart !== undefined && !isPlaceholderPart(commandPart) && commandPart === part;
    });
  });

export const routeMatches = (candidate: CliRoute, positionals: readonly string[]): boolean => {
  if (candidate.pattern.length > positionals.length) {
    return false;
  }

  if (!candidate.variadicTail && candidate.pattern.length !== positionals.length) {
    return false;
  }

  return candidate.pattern.every((part, index) => {
    const input = positionals[index];
    if (!isPlaceholderPart(part)) {
      return part === input;
    }

    if (!input) {
      return false;
    }

    return !inputIsReservedLiteralCommandPrefix(candidate, positionals.slice(0, index + 1));
  });
};

export const dispatchRoute = async (
  routes: readonly CliRoute[],
  context: CliRouteContext,
): Promise<number | undefined> => {
  const matchedRoute = routes.find((candidate) => routeMatches(candidate, context.positionals));
  return matchedRoute ? matchedRoute.handler(context) : undefined;
};

export const assertRouteRegistryMatches = (routes: readonly CliRoute[]): void => {
  const routeCommands = routes.map((candidate) => candidate.command).sort();
  const registryCommands = [...CLI_COMMANDS].sort();
  const routeCommandSet = new Set(routeCommands);
  const routeCommandsWithoutPlaceholders = new Set(
    routeCommands.map((command) =>
      command
        .split(" ")
        .filter((part) => !isPlaceholderPart(part))
        .join(" "),
    ),
  );
  const registryCommandSet = new Set<string>(registryCommands);
  const missingRoutes = registryCommands.filter(
    (command) => !routeCommandSet.has(command) && !routeCommandsWithoutPlaceholders.has(command),
  );
  const missingRegistryEntries = routeCommands.filter((command) => {
    const commandWithoutPlaceholders = command
      .split(" ")
      .filter((part) => !isPlaceholderPart(part))
      .join(" ");
    return !registryCommandSet.has(command) && !registryCommandSet.has(commandWithoutPlaceholders);
  });

  if (missingRoutes.length > 0 || missingRegistryEntries.length > 0) {
    throw new Error(
      [
        missingRoutes.length > 0 ? `CLI registry commands missing routes: ${missingRoutes.join(", ")}` : undefined,
        missingRegistryEntries.length > 0
          ? `CLI routes missing registry commands: ${missingRegistryEntries.join(", ")}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
};
