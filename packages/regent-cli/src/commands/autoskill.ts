import path from "node:path";

import type {
  AutoskillEvalPublishRequest,
  AutoskillListingCreateInput,
  AutoskillReviewCreateInput,
  AutoskillSkillPublishRequest,
} from "../internal-types/index.js";

import { daemonCall } from "../daemon-client.js";
import { getFlag, requireArg, type ParsedCliArgs } from "../parse.js";
import { printJson } from "../printer.js";

const resolveWorkspace = (args: ParsedCliArgs, fallbackIndex: number): string =>
  path.resolve(getFlag(args, "workspace") ?? args.positionals[fallbackIndex] ?? process.cwd());

const parseNodeId = (value: string | undefined, name: string): number => {
  const parsed = Number.parseInt(requireArg(value, name), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid ${name}`);
  }

  return parsed;
};

const parseOptionalJson = (value: string | undefined): Record<string, unknown> | undefined => {
  if (!value) {
    return undefined;
  }

  return JSON.parse(value) as Record<string, unknown>;
};

export async function runAutoskillInitSkill(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.autoskill.initSkill",
      {
        workspace_path: resolveWorkspace(args, 4),
      },
      configPath,
    ),
  );
}

export async function runAutoskillInitEval(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.autoskill.initEval",
      {
        workspace_path: resolveWorkspace(args, 4),
      },
      configPath,
    ),
  );
}

export async function runAutoskillPublishSkill(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const workspacePath = resolveWorkspace(args, 4);
  const input: AutoskillSkillPublishRequest = {
    title: getFlag(args, "title") ?? path.basename(workspacePath),
    skill_slug: getFlag(args, "skill-slug") ?? path.basename(workspacePath),
    skill_version: getFlag(args, "skill-version") ?? "0.1.0",
    access_mode: (getFlag(args, "access-mode") ?? "public_free") as AutoskillSkillPublishRequest["access_mode"],
    marimo_entrypoint: getFlag(args, "marimo-entrypoint") ?? "session.marimo.py",
    primary_file: getFlag(args, "primary-file") ?? "SKILL.md",
    ...(getFlag(args, "summary") ? { summary: getFlag(args, "summary")! } : {}),
    ...(getFlag(args, "slug") ? { slug: getFlag(args, "slug")! } : {}),
    ...(getFlag(args, "payment-rail")
      ? { payment_rail: getFlag(args, "payment-rail") as AutoskillSkillPublishRequest["payment_rail"] }
      : {}),
    ...(getFlag(args, "access-policy")
      ? { access_policy: parseOptionalJson(getFlag(args, "access-policy")) }
      : {}),
  };

  const parentId = getFlag(args, "parent-id");
  if (parentId) {
    input.parent_id = parseNodeId(parentId, "parent-id");
  }

  printJson(
    await daemonCall(
      "techtree.autoskill.publishSkill",
      {
        workspace_path: workspacePath,
        input,
      },
      configPath,
    ),
  );
}

export async function runAutoskillPublishEval(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const workspacePath = resolveWorkspace(args, 4);
  const version = getFlag(args, "version") ?? "0.1.0";
  const input: AutoskillEvalPublishRequest = {
    title: getFlag(args, "title") ?? path.basename(workspacePath),
    slug: getFlag(args, "slug") ?? path.basename(workspacePath),
    access_mode: (getFlag(args, "access-mode") ?? "public_free") as AutoskillEvalPublishRequest["access_mode"],
    marimo_entrypoint: getFlag(args, "marimo-entrypoint") ?? "session.marimo.py",
    primary_file: getFlag(args, "primary-file") ?? "scenario.yaml",
    ...(getFlag(args, "summary") ? { summary: getFlag(args, "summary")! } : {}),
    ...(getFlag(args, "payment-rail")
      ? { payment_rail: getFlag(args, "payment-rail") as AutoskillEvalPublishRequest["payment_rail"] }
      : {}),
    ...(getFlag(args, "access-policy")
      ? { access_policy: parseOptionalJson(getFlag(args, "access-policy")) }
      : {}),
    bundle_manifest: {
      metadata: {
        version,
      },
    },
  };

  const parentId = getFlag(args, "parent-id");
  if (parentId) {
    input.parent_id = parseNodeId(parentId, "parent-id");
  }

  printJson(
    await daemonCall(
      "techtree.autoskill.publishEval",
      {
        workspace_path: workspacePath,
        input,
      },
      configPath,
    ),
  );
}

export async function runAutoskillPublishResult(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.autoskill.publishResult",
      {
        workspace_path: resolveWorkspace(args, 4),
        input: {
          skill_node_id: parseNodeId(getFlag(args, "skill-node-id"), "skill-node-id"),
          eval_node_id: parseNodeId(getFlag(args, "eval-node-id"), "eval-node-id"),
          runtime_kind: (getFlag(args, "runtime-kind") ?? "local") as
            | "local"
            | "molab"
            | "wasm"
            | "self_hosted",
          raw_score: Number(requireArg(getFlag(args, "raw-score") ?? "0", "raw-score")),
          normalized_score: Number(requireArg(getFlag(args, "normalized-score") ?? "0", "normalized-score")),
        },
      },
      configPath,
    ),
  );
}

export async function runAutoskillReview(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const payload: AutoskillReviewCreateInput = {
    kind: (requireArg(getFlag(args, "kind"), "kind") === "replicable" ? "replicable" : "community"),
    skill_node_id: parseNodeId(getFlag(args, "skill-node-id"), "skill-node-id"),
    ...(getFlag(args, "result-id")
      ? { result_id: parseNodeId(getFlag(args, "result-id"), "result-id") }
      : {}),
    ...(getFlag(args, "rating") ? { rating: Number(getFlag(args, "rating")) } : {}),
    ...(getFlag(args, "note") ? { note: getFlag(args, "note")! } : {}),
    ...(getFlag(args, "runtime-kind")
      ? { runtime_kind: getFlag(args, "runtime-kind") as AutoskillReviewCreateInput["runtime_kind"] }
      : {}),
    ...(getFlag(args, "reported-score")
      ? { reported_score: Number(getFlag(args, "reported-score")) }
      : {}),
    ...(getFlag(args, "details") ? { details: parseOptionalJson(getFlag(args, "details")) } : {}),
  };

  printJson(await daemonCall("techtree.autoskill.review", payload, configPath));
}

export async function runAutoskillListingCreate(args: ParsedCliArgs, configPath?: string): Promise<void> {
  const payload: AutoskillListingCreateInput = {
    skill_node_id: parseNodeId(getFlag(args, "skill-node-id"), "skill-node-id"),
    payment_rail: (getFlag(args, "payment-rail") ?? "onchain") as "onchain",
    chain_id: Number(requireArg(getFlag(args, "chain-id"), "chain-id")),
    usdc_token_address: requireArg(getFlag(args, "usdc-token-address"), "usdc-token-address") as `0x${string}`,
    treasury_address: requireArg(getFlag(args, "treasury-address"), "treasury-address") as `0x${string}`,
    seller_payout_address: requireArg(
      getFlag(args, "seller-payout-address"),
      "seller-payout-address",
    ) as `0x${string}`,
    price_usdc: requireArg(getFlag(args, "price-usdc"), "price-usdc"),
    ...(getFlag(args, "listing-meta") ? { listing_meta: parseOptionalJson(getFlag(args, "listing-meta")) } : {}),
  };

  printJson(await daemonCall("techtree.autoskill.listing.create", payload, configPath));
}

export async function runAutoskillBuy(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.autoskill.buy",
      {
        node_id: parseNodeId(getFlag(args, "node-id") ?? args.positionals[3], "node-id"),
      },
      configPath,
    ),
  );
}

export async function runAutoskillPull(args: ParsedCliArgs, configPath?: string): Promise<void> {
  printJson(
    await daemonCall(
      "techtree.autoskill.pull",
      {
        node_id: parseNodeId(getFlag(args, "node-id") ?? args.positionals[3], "node-id"),
        workspace_path: resolveWorkspace(args, 4),
      },
      configPath,
    ),
  );
}
