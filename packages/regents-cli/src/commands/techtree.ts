import fs from "node:fs";

import type { NodeCreateInput } from "../internal-types/index.js";

import { daemonCall } from "../daemon-client.js";
import { getFlag, parseIntegerFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";
import { runChatboxTail } from "./chatbox.js";

const readAtPathValue = (value: string): string => {
  if (!value.startsWith("@")) {
    return value;
  }

  return fs.readFileSync(value.slice(1), "utf8");
};

const readJsonObjectValue = (value: string, name: string): Record<string, unknown> => {
  const raw = readAtPathValue(value);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`invalid ${name}`);
  }
};

const getRepeatedFlagValues = (args: string[], name: string): string[] => {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value) {
      continue;
    }

    if (value === `--${name}`) {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        index += 1;
      }

      continue;
    }

    if (value.startsWith(`--${name}=`)) {
      values.push(value.slice(name.length + 3));
    }
  }

  return values;
};

const parseSidelink = (value: string): { node_id: number; tag: string; ordinal?: number } => {
  const [nodeIdRaw, tag, ordinalRaw] = value.split(":");

  if (!nodeIdRaw || !tag) {
    throw new Error("invalid --sidelink value");
  }

  const parsePositiveInteger = (raw: string): number => {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new Error("invalid --sidelink value");
    }

    return parsed;
  };

  const parsed: { node_id: number; tag: string; ordinal?: number } = {
    node_id: parsePositiveInteger(nodeIdRaw),
    tag,
  };

  if (ordinalRaw !== undefined) {
    parsed.ordinal = parsePositiveInteger(ordinalRaw);
  }

  return parsed;
};

const assertSkillTriplet = (input: {
  skillSlug?: string;
  skillVersion?: string;
  skillMdBody?: string;
}): void => {
  const present = [input.skillSlug, input.skillVersion, input.skillMdBody].filter(
    (value) => value !== undefined,
  ).length;

  if (present !== 0 && present !== 3) {
    throw new Error(
      "skill node inputs must include --skill-slug, --skill-version, and --skill-md together",
    );
  }
};

const parseCsvFlag = (args: string[] | ParsedCliArgs, name: string): string[] | undefined => {
  const value = getFlag(args, name);
  if (!value) {
    return undefined;
  }

  const parsed = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
};

const parseNodeId = (value: string | undefined, name = "node id"): number => {
  const parsed = Number.parseInt(requireArg(value, name), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid ${name}`);
  }

  return parsed;
};

const parseNonNegativeIntegerFlag = (args: string[], name: string): number | undefined => {
  const value = getFlag(args, name);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new Error(`invalid integer for --${name}`);
  }

  return parsed;
};

const parseClaimId = (value: string | undefined): string => requireArg(value, "--claim-id");

export async function runTechtreeStatus(configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.status", undefined, configPath));
}

export async function runTechtreeScienceTasksList(args: string[], configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.list",
      {
        limit: parseIntegerFlag(args, "limit"),
        stage: getFlag(args, "stage"),
        science_domain: getFlag(args, "science-domain"),
        science_field: getFlag(args, "science-field"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksGet(args: string[], configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.get",
      {
        id: parseNodeId(args[3], "science task id"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeActivity(args: string[] | ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.activity.list",
      {
        limit: parseIntegerFlag(args, "limit"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeNodesList(args: string[], configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.nodes.list",
      {
        limit: parseIntegerFlag(args, "limit"),
        seed: getFlag(args, "seed"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeNodeGet(id: number, configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.nodes.get", { id }, configPath));
}

export async function runTechtreeNodeChildren(args: string[], id: number, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.nodes.children",
      {
        id,
        limit: parseIntegerFlag(args, "limit"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeNodeComments(args: string[], id: number, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.nodes.comments",
      {
        id,
        limit: parseIntegerFlag(args, "limit"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeNodeLineageList(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.nodes.lineage.list",
      {
        id: parseNodeId(args.positionals[4], "node id"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeNodeLineageClaim(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.nodes.lineage.claim",
      {
        id: parseNodeId(args.positionals[4], "node id"),
        input: readJsonObjectValue(requireArg(getFlag(args, "input"), "--input"), "--input"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeNodeLineageWithdraw(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.nodes.lineage.withdraw",
      {
        id: parseNodeId(args.positionals[4], "node id"),
        claimId: parseClaimId(getFlag(args, "claim-id")),
      },
      configPath,
    ),
  );
}

export async function runTechtreeNodeCrossChainLinksList(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.nodes.crossChainLinks.list",
      {
        id: parseNodeId(args.positionals[4], "node id"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeNodeCrossChainLinksCreate(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.nodes.crossChainLinks.create",
      {
        id: parseNodeId(args.positionals[4], "node id"),
        input: readJsonObjectValue(requireArg(getFlag(args, "input"), "--input"), "--input"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeNodeCrossChainLinksClear(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.nodes.crossChainLinks.clear",
      {
        id: parseNodeId(args.positionals[4], "node id"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeNodeWorkPacket(id: number, configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.nodes.workPacket", { id }, configPath));
}

export async function runTechtreeSearch(args: string[] | ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.search.query",
      {
        q: requireArg(getFlag(args, "query") ?? getFlag(args, "q"), "--query"),
        limit: parseIntegerFlag(args, "limit"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeNodeCreate(args: string[], configPath?: string): Promise<void> {
  const skillSlug = getFlag(args, "skill-slug");
  const skillVersion = getFlag(args, "skill-version");
  const skillMdFlag = getFlag(args, "skill-md");
  const skillMdBody = skillMdFlag ? readAtPathValue(skillMdFlag) : undefined;
  const crossChainLinkFlag = getFlag(args, "cross-chain-link");
  const paidPayloadFlag = getFlag(args, "paid-payload");
  const sidelinks = getRepeatedFlagValues(args, "sidelink").map(parseSidelink);

  assertSkillTriplet({ skillSlug, skillVersion, skillMdBody });

  const notebookFlag = requireArg(getFlag(args, "notebook-source"), "--notebook-source");
  const payload: NodeCreateInput & {
    sidelinks?: Array<{ node_id: number; tag: string; ordinal?: number }>;
  } = {
    seed: requireArg(getFlag(args, "seed"), "--seed"),
    kind: requireArg(getFlag(args, "kind"), "--kind") as NodeCreateInput["kind"],
    title: requireArg(getFlag(args, "title"), "--title"),
    parent_id: parseIntegerFlag(args, "parent-id"),
    notebook_source: readAtPathValue(notebookFlag),
    slug: getFlag(args, "slug"),
    summary: getFlag(args, "summary"),
    skill_slug: skillSlug,
    skill_version: skillVersion,
    skill_md_body: skillMdBody,
    idempotency_key: getFlag(args, "idempotency-key"),
  };

  if (crossChainLinkFlag) {
    payload.cross_chain_link = readJsonObjectValue(crossChainLinkFlag, "--cross-chain-link");
  }

  if (paidPayloadFlag) {
    payload.paid_payload = readJsonObjectValue(paidPayloadFlag, "--paid-payload") as NodeCreateInput["paid_payload"];
  }

  if (sidelinks.length > 0) {
    payload.sidelinks = sidelinks;
  }

  printJson(await daemonCall("techtree.nodes.create", payload, configPath));
}

export async function runTechtreeCommentAdd(args: string[], configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.comments.create",
      {
        node_id: requireInteger(parseIntegerFlag(args, "node-id"), "--node-id"),
        body_markdown: requireArg(getFlag(args, "body-markdown"), "--body-markdown"),
        body_plaintext: getFlag(args, "body-plaintext"),
        idempotency_key: getFlag(args, "idempotency-key"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeWatch(nodeId: number, configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.watch.create", { nodeId }, configPath));
}

export async function runTechtreeWatchList(configPath?: string): Promise<void> {
  printJson(await daemonCall("techtree.watch.list", undefined, configPath));
}

export async function runTechtreeWatchTail(args?: ParsedCliArgs, configPath?: string): Promise<void> {
  await runChatboxTail(args, configPath);
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

export async function runTechtreeScienceTasksInit(args: string[], configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.init",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
        title: getFlag(args, "title"),
        summary: getFlag(args, "summary"),
        science_domain: getFlag(args, "science-domain"),
        science_field: getFlag(args, "science-field"),
        task_slug: getFlag(args, "task-slug"),
        claimed_expert_time: getFlag(args, "claimed-expert-time"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksChecklist(
  args: string[],
  configPath?: string,
): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.checklist",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksEvidence(
  args: string[],
  configPath?: string,
): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.evidence",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksExport(args: string[], configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.export",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
        output_path: getFlag(args, "output-path"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksSubmit(args: string[], configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.submit",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
        harbor_pr_url: getFlag(args, "pr-url"),
        latest_review_follow_up_note: getFlag(args, "follow-up-note"),
      },
      configPath,
    ),
  );
}

export async function runTechtreeScienceTasksReviewUpdate(
  args: string[],
  configPath?: string,
): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.scienceTasks.reviewUpdate",
      {
        workspace_path: requireArg(getFlag(args, "workspace-path"), "--workspace-path"),
        harbor_pr_url: getFlag(args, "pr-url"),
        latest_review_follow_up_note: getFlag(args, "follow-up-note"),
        open_reviewer_concerns_count: parseNonNegativeIntegerFlag(args, "open-reviewer-concerns-count"),
        any_concern_unanswered:
          getFlag(args, "any-concern-unanswered") === undefined
            ? undefined
            : getFlag(args, "any-concern-unanswered") === "true",
        latest_rerun_after_latest_fix:
          getFlag(args, "latest-rerun-after-latest-fix") === undefined
            ? undefined
            : getFlag(args, "latest-rerun-after-latest-fix") === "true",
        latest_fix_at: getFlag(args, "latest-fix-at"),
        last_rerun_at: getFlag(args, "last-rerun-at"),
      },
      configPath,
    ),
  );
}

const requireInteger = (value: number | undefined, name: string): number => {
  if (value === undefined) {
    throw new Error(`missing required argument: ${name}`);
  }

  return value;
};
