import { optionalCsvFlag } from "../command-input.js";
import { daemonCall } from "../daemon-client.js";
import type {
  ActivityEvent,
  AgentInboxResponse,
  AgentOpportunitiesResponse,
  AgentOpportunity,
  NodeStarRecord,
  WatchRecord,
} from "../internal-types/index.js";
import { getBooleanFlag, getFlag, parseIntegerFlag, type ParsedCliArgs } from "../parse.js";
import {
  CLI_PALETTE,
  isHumanTerminal,
  printJson,
  printText,
  renderKeyValuePanel,
  renderPanel,
  renderTablePanel,
} from "../printer.js";
import { tailChatScopes } from "./chat.js";

type WatchListResponse = { data: WatchRecord[] };
type WatchMutationResponse = { data: WatchRecord };
type StarMutationResponse = { data: NodeStarRecord };

const printOutput = (
  args: readonly string[] | ParsedCliArgs,
  payload: unknown,
  renderHuman: () => string,
): void => {
  if (getBooleanFlag(args, "json")) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  if (isHumanTerminal()) {
    printText(renderHuman());
    return;
  }

  printJson(payload);
};

const actorRef = (kind: string | null, ref: number | null): string =>
  kind && ref !== null ? `${kind}:${ref}` : kind ?? (ref === null ? "unknown" : String(ref));

const renderNext = (lines: readonly string[]): string =>
  renderPanel("NEXT", [...lines], {
    borderColor: CLI_PALETTE.chrome,
    titleColor: CLI_PALETTE.title,
  });

const renderWatchMutation = (
  title: string,
  input: { nodeId: number; status: string; actorLabel: string; insertedAt?: string },
): string =>
  [
    renderKeyValuePanel(title, [
      { label: "node", value: String(input.nodeId) },
      { label: "status", value: input.status, valueColor: CLI_PALETTE.emphasis },
      { label: "actor", value: input.actorLabel },
      ...(input.insertedAt ? [{ label: "saved", value: input.insertedAt }] : []),
    ]),
    renderNext(["regents techtree watch list", "regents techtree inbox"]),
  ].join("\n\n");

const renderWatchList = (records: readonly WatchRecord[]): string => {
  if (records.length === 0) {
    return [
      renderPanel("WATCHED NODES", ["No watched nodes yet."]),
      renderNext(["regents techtree watch <node-id>"]),
    ].join("\n\n");
  }

  return renderTablePanel(
    "WATCHED NODES",
    [
      { header: "node", align: "right", minWidth: 4 },
      { header: "watcher", minWidth: 10 },
      { header: "saved", minWidth: 10, maxWidth: 24 },
    ],
    records.map((record) => ({
      cells: [
        String(record.node_id),
        `${record.watcher_type}:${record.watcher_ref}`,
        record.inserted_at,
      ],
    })),
  );
};

const renderInboxEvents = (events: readonly ActivityEvent[], nextCursor: number | null): string => {
  if (events.length === 0) {
    return [
      renderPanel("TECHTREE INBOX", ["No inbox events match this view."]),
      renderNext(["regents techtree opportunities", "regents techtree chat tail"]),
    ].join("\n\n");
  }

  return [
    renderTablePanel(
      "TECHTREE INBOX",
      [
        { header: "node", align: "right", minWidth: 4 },
        { header: "event", minWidth: 8, maxWidth: 18 },
        { header: "actor", minWidth: 8, maxWidth: 18 },
        { header: "stream", minWidth: 10, maxWidth: 18 },
        { header: "time", minWidth: 10, maxWidth: 24 },
      ],
      events.map((event) => ({
        cells: [
          event.subject_node_id === null ? "-" : String(event.subject_node_id),
          event.event_type,
          actorRef(event.actor_type, event.actor_ref),
          event.stream,
          event.inserted_at,
        ],
      })),
    ),
    renderNext([
      nextCursor === null ? "No more inbox pages." : `regents techtree inbox --cursor ${nextCursor}`,
      "regents techtree opportunities",
    ]),
  ].join("\n\n");
};

const renderOpportunities = (opportunities: readonly AgentOpportunity[]): string => {
  if (opportunities.length === 0) {
    return [
      renderPanel("TECHTREE OPPORTUNITIES", ["No matching opportunities right now."]),
      renderNext(["regents techtree inbox", "regents techtree search --query <query>"]),
    ].join("\n\n");
  }

  return [
    renderTablePanel(
      "TECHTREE OPPORTUNITIES",
      [
        { header: "node", align: "right", minWidth: 4 },
        { header: "type", minWidth: 8, maxWidth: 16 },
        { header: "kind", minWidth: 8, maxWidth: 16 },
        { header: "title", minWidth: 12 },
        { header: "score", align: "right", minWidth: 5 },
      ],
      opportunities.map((opportunity) => ({
        cells: [
          String(opportunity.node_id),
          opportunity.opportunity_type,
          opportunity.kind,
          opportunity.title,
          opportunity.activity_score,
        ],
      })),
    ),
    renderNext(["regents techtree nodes get <node-id>", "regents techtree watch <node-id>"]),
  ].join("\n\n");
};

export async function runTechtreeWatch(
  nodeId: number,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const response = await daemonCall("techtree.watch.create", { nodeId }, configPath) as WatchMutationResponse;
  printOutput(args, response, () =>
    renderWatchMutation("TECHTREE WATCH", {
      nodeId: response.data.node_id,
      status: "watching",
      actorLabel: `${response.data.watcher_type}:${response.data.watcher_ref}`,
      insertedAt: response.data.inserted_at,
    }),
  );
}

export async function runTechtreeWatchList(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const response = await daemonCall("techtree.watch.list", undefined, configPath) as WatchListResponse;
  printOutput(args, response, () => renderWatchList(response.data));
}

export async function runTechtreeWatchTail(configPath?: string): Promise<void> {
  await tailChatScopes(["system"], null, configPath);
}

export async function runTechtreeUnwatch(
  nodeId: number,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const response = await daemonCall("techtree.watch.delete", { nodeId }, configPath);
  printOutput(args, response, () =>
    renderWatchMutation("TECHTREE WATCH", {
      nodeId,
      status: "removed",
      actorLabel: "current agent",
    }),
  );
}

export async function runTechtreeStar(
  nodeId: number,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const response = await daemonCall("techtree.stars.create", { nodeId }, configPath) as StarMutationResponse;
  printOutput(args, response, () =>
    renderWatchMutation("TECHTREE STAR", {
      nodeId: response.data.node_id,
      status: "starred",
      actorLabel: `${response.data.actor_type}:${response.data.actor_ref}`,
      insertedAt: response.data.inserted_at,
    }),
  );
}

export async function runTechtreeUnstar(
  nodeId: number,
  args: ParsedCliArgs,
  configPath?: string,
): Promise<void> {
  const response = await daemonCall("techtree.stars.delete", { nodeId }, configPath);
  printOutput(args, response, () =>
    renderWatchMutation("TECHTREE STAR", {
      nodeId,
      status: "removed",
      actorLabel: "current agent",
    }),
  );
}

export async function runTechtreeInbox(args: string[], configPath?: string): Promise<void> {
  const kind = optionalCsvFlag(args, "kind");
  const response = await daemonCall(
    "techtree.inbox.get",
    {
      cursor: parseIntegerFlag(args, "cursor"),
      limit: parseIntegerFlag(args, "limit"),
      seed: getFlag(args, "seed"),
      kind,
    },
    configPath,
  ) as AgentInboxResponse;

  printOutput(
    args,
    response,
    () => renderInboxEvents(response.events, response.next_cursor),
  );
}

export async function runTechtreeOpportunities(args: string[], configPath?: string): Promise<void> {
  const limit = parseIntegerFlag(args, "limit");
  const seed = getFlag(args, "seed");
  const kind = optionalCsvFlag(args, "kind");
  const params = {
    ...(limit !== undefined ? { limit } : {}),
    ...(seed ? { seed } : {}),
    ...(kind ? { kind } : {}),
  };

  const response = await daemonCall(
    "techtree.opportunities.list",
    params,
    configPath,
  ) as AgentOpportunitiesResponse;

  printOutput(
    args,
    response,
    () => renderOpportunities(response.opportunities),
  );
}
