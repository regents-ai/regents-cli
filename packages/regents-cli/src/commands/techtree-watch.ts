import { daemonCall } from "../daemon-client.js";
import { getFlag, parseIntegerFlag, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";
import { tailChatScopes } from "./chat.js";

const parseCsvFlag = (args: string[] | ParsedCliArgs, name: string): string[] | undefined => {
  const value = getFlag(args, name);
  if (!value) {
    return undefined;
  }

  const parsed = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
};

export async function runTechtreeWatch(nodeId: number, configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.watch.create", { nodeId }, configPath));
}

export async function runTechtreeWatchList(configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.watch.list", undefined, configPath));
}

export async function runTechtreeWatchTail(configPath?: string): Promise<void> {
  await tailChatScopes(["system"], null, configPath);
}

export async function runTechtreeUnwatch(nodeId: number, configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.watch.delete", { nodeId }, configPath));
}

export async function runTechtreeStar(nodeId: number, configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.stars.create", { nodeId }, configPath));
}

export async function runTechtreeUnstar(nodeId: number, configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.stars.delete", { nodeId }, configPath));
}

export async function runTechtreeInbox(args: string[], configPath?: string): Promise<void> {
  const kind = parseCsvFlag(args, "kind");
  printJson(
    await daemonCall(
      "techtree.inbox.get",
      {
        cursor: parseIntegerFlag(args, "cursor"),
        limit: parseIntegerFlag(args, "limit"),
        seed: getFlag(args, "seed"),
        kind,
      },
      configPath,
    ),
  );
}

export async function runTechtreeOpportunities(args: string[], configPath?: string): Promise<void> {
  const limit = parseIntegerFlag(args, "limit");
  const seed = getFlag(args, "seed");
  const kind = parseCsvFlag(args, "kind");
  const params = {
    ...(limit !== undefined ? { limit } : {}),
    ...(seed ? { seed } : {}),
    ...(kind ? { kind } : {}),
  };

  printJson(
    await daemonCall(
      "techtree.opportunities.list",
      params,
      configPath,
    ),
  );
}
