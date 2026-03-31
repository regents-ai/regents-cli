import fs from "node:fs/promises";
import path from "node:path";

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, mainnet, sepolia } from "viem/chains";

import type {
  ActivityListResponse,
  AgentInboxResponse,
  AgentOpportunitiesResponse,
  AutoskillBundleAccessResponse,
  AutoskillBuyResponse,
  AutoskillCreateEvalResponse,
  AutoskillCreateListingResponse,
  AutoskillCreateResultResponse,
  AutoskillCreateReviewResponse,
  AutoskillCreateSkillResponse,
  AutoskillEvalPublishInput,
  AutoskillEvalPublishRequest,
  AutoskillListingCreateInput,
  AutoskillResultPublishInput,
  AutoskillReviewCreateInput,
  AutoskillSkillPublishInput,
  AutoskillSkillPublishRequest,
  BbhCapsuleGetResponse,
  BbhCapsuleListResponse,
  BbhCertificateVerifyParams,
  BbhCertificateVerifyResponse,
  BbhDraftApplyParams,
  BbhDraftCreateParams,
  BbhDraftGetResponse,
  BbhDraftListResponse,
  BbhDraftProposalListResponse,
  BbhDraftProposalSubmitParams,
  BbhDraftProposalSubmitResponse,
  BbhDraftPullParams,
  BbhDraftPullResponse,
  BbhDraftReadyParams,
  BbhLeaderboardResponse,
  BbhReviewerApplyParams,
  BbhReviewerApplyResponse,
  BbhReviewerOrcidLinkParams,
  BbhReviewerOrcidLinkResponse,
  BbhReviewerStatusResponse,
  BbhReviewListParams,
  BbhReviewListResponse,
  BbhReviewPullParams,
  BbhReviewPullResponse,
  BbhReviewSubmitParams,
  BbhReviewSubmitResponse,
  BbhRunExecParams,
  BbhRunExecResponse,
  BbhSubmitParams,
  BbhSyncParams,
  BbhRunSubmitResponse,
  BbhSyncResponse,
  BbhValidateParams,
  BbhValidationSubmitResponse,
  RegentRunMetadata,
  CommentCreateInput,
  CommentCreateResponse,
  PaidPayloadSummary,
  NodeCreateInput,
  NodeCreateResponse,
  NodeStarRecord,
  TreeComment,
  TreeNode,
  ChatboxListResponse,
  ChatboxPostInput,
  ChatboxPostResponse,
  TechtreeCompilerOutput,
  TechtreeFetchResponse,
  TechtreeNodeId,
  TechtreePinResponse,
  TechtreePublishResponse,
  TechtreeTreeName,
  TechtreeVerifyResponse,
  TechtreeWorkspaceActionResult,
  TechtreeV1BbhCapsulesGetParams,
  TechtreeV1BbhCapsulesListParams,
  WatchRecord,
  WorkPacketResponse,
} from "../../internal-types/index.js";

import type { RuntimeContext } from "../runtime.js";
import { runTechtreeCoreJson, type TechtreeCoreEntrypoint } from "../techtree/core.js";
import {
  loadBbhDraftCreateRequest,
  loadBbhDraftProposalRequest,
  loadBbhReviewSubmitRequest,
  buildBbhValidationRequest,
  loadBbhRunSubmitRequest,
  materializeBbhDraftWorkspace,
  materializeBbhReviewWorkspace,
  materializeBbhWorkspace,
} from "../workloads/bbh.js";
import {
  buildAutoskillBundlePayload,
  defaultSkillSlug,
  defaultTitle,
  defaultVersion,
  initAutoskillEvalWorkspace,
  initAutoskillSkillWorkspace,
  loadAutoskillResultPayload,
  materializeAutoskillBundle,
  writeDefaultResultFiles,
} from "../workloads/autoskill.js";

type NodeType = "artifact" | "run" | "review";

const ERC20_APPROVE_ABI = [
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const TECHTREE_CONTENT_SETTLEMENT_ABI = [
  {
    inputs: [
      { internalType: "bytes32", name: "listingRef", type: "bytes32" },
      { internalType: "address", name: "seller", type: "address" },
      { internalType: "bytes32", name: "bundleRef", type: "bytes32" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "settlePurchase",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const readRunMetadata = (input: Record<string, unknown>): RegentRunMetadata | null => {
  const metadata = input.metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const record = metadata as Record<string, unknown>;
  const executorHarness = record.executor_harness;
  const origin = record.origin;

  if (!executorHarness || typeof executorHarness !== "object" || !origin || typeof origin !== "object") {
    return null;
  }

  const executorHarnessRecord = executorHarness as Record<string, unknown>;
  const originRecord = origin as Record<string, unknown>;

  if (typeof executorHarnessRecord.kind !== "string" || typeof executorHarnessRecord.profile !== "string") {
    return null;
  }

  if (typeof originRecord.kind !== "string") {
    return null;
  }

  const resolved: RegentRunMetadata = {
    executor_harness: {
      kind: executorHarnessRecord.kind as RegentRunMetadata["executor_harness"]["kind"],
      profile: executorHarnessRecord.profile,
      ...(typeof executorHarnessRecord.entrypoint === "string" || executorHarnessRecord.entrypoint === null
        ? { entrypoint: executorHarnessRecord.entrypoint }
        : {}),
    },
    origin: {
      kind: originRecord.kind as RegentRunMetadata["origin"]["kind"],
      ...(typeof originRecord.transport === "string" || originRecord.transport === null
        ? { transport: originRecord.transport as RegentRunMetadata["origin"]["transport"] }
        : {}),
      ...(typeof originRecord.session_id === "string" || originRecord.session_id === null
        ? { session_id: originRecord.session_id }
        : {}),
      ...(typeof originRecord.trigger_ref === "string" || originRecord.trigger_ref === null
        ? { trigger_ref: originRecord.trigger_ref }
        : {}),
    },
  };

  return resolved;
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`missing ${label}`);
  }

  return value;
};

const requirePositiveInteger = (value: unknown, label: string): number => {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`missing ${label}`);
  }

  return Number(value);
};

const requireAddress = (value: unknown, label: string): Address => {
  const normalized = requireString(value, label).trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`invalid ${label}`);
  }

  return normalized as Address;
};

const requireHex32 = (value: unknown, label: string): Hex => {
  const normalized = requireString(value, label).trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`invalid ${label}`);
  }

  return normalized as Hex;
};

const parseUsdcAmount = (value: unknown): bigint => {
  const raw = requireString(value, "price_usdc");
  const [wholePart, fractionalPart = ""] = raw.split(".");
  if (!/^\d+$/.test(wholePart) || !/^\d*$/.test(fractionalPart)) {
    throw new Error("price_usdc must be a decimal string");
  }

  const paddedFraction = `${fractionalPart}000000`.slice(0, 6);
  return BigInt(wholePart) * 1_000_000n + BigInt(paddedFraction || "0");
};

const rpcUrlForChain = (chainId: number): string => {
  const resolved =
    chainId === 84532
      ? process.env.BASE_SEPOLIA_RPC_URL ?? process.env.ANVIL_RPC_URL
      : chainId === 8453
        ? process.env.BASE_MAINNET_RPC_URL ?? process.env.BASE_RPC_URL
        : chainId === 11155111
          ? process.env.ETHEREUM_SEPOLIA_RPC_URL ?? process.env.ANVIL_RPC_URL
          : chainId === 1
            ? process.env.ETHEREUM_MAINNET_RPC_URL ?? process.env.ETHEREUM_RPC_URL
            : undefined;

  if (!resolved) {
    throw new Error(`missing RPC URL for chain ${chainId}`);
  }

  return resolved;
};

const viemChainForId = (chainId: number) => {
  switch (chainId) {
    case 84532:
      return baseSepolia;
    case 8453:
      return base;
    case 11155111:
      return sepolia;
    case 1:
      return mainnet;
    default:
      throw new Error(`unsupported purchase chain ${chainId}`);
  }
};

const writeResolvedMetadata = async (workspacePath: string, metadata: unknown): Promise<void> => {
  await fs.writeFile(
    path.join(workspacePath, "resolved-metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
};

const writeIfBbhTree = async (
  tree: TechtreeTreeName,
  workspacePath: string,
  nodeType: NodeType,
  input: Record<string, unknown>,
): Promise<void> => {
  if (tree !== "bbh") {
    return;
  }

  if (nodeType === "artifact") {
    await fs.writeFile(
      path.join(workspacePath, "artifact.source.yaml"),
      `schema_version: techtree.artifact-source.v1

title: "BBH capsule artifact"
summary: "Canonical BBH capsule prepared for Regent v1 publishing."

parents: []

notebook:
  entrypoint: analysis.py
  include:
    - analysis.py
    - pyproject.toml
    - uv.lock
    - outputs/**/*
    - logs/**/*
  exclude: []
  marimo_version: "0.11.8"

env:
  lockfile_path: uv.lock
  image: null
  system:
    python: "3.11"
    platform: "linux/amd64"
  runtime_policy:
    network: none
    filesystem: workspace_write
    secrets: forbidden
    gpu: false
  external_resources: []

claims: []
sources: []
licenses:
  notebook: "MIT"
  data: "CC-BY-4.0"
  outputs: "CC-BY-4.0"

eval:
  mode: fixed
  instance:
    seed: 1
    instance_id: "bbh-capsule"
    params:
      tree: bbh
      benchmark: bbh
      split: eval
  protocol:
    entrypoint: analysis.py
    allowed_tools:
      - python
    output_contract:
      required_files:
        - outputs/verdict.json
  rubric:
    scorer: outputs/verdict.json
    primary_metric: score
`,
      "utf8",
    );
    await fs.writeFile(path.join(workspacePath, "analysis.py"), "print('bbh artifact analysis')\n", "utf8");
    await fs.mkdir(path.join(workspacePath, "outputs"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, "logs"), { recursive: true });
    return;
  }

  if (nodeType === "run") {
    await fs.writeFile(
      path.join(workspacePath, "run.source.yaml"),
      `schema_version: techtree.run-source.v1

artifact_id: "${String(input.artifact_id ?? "")}"

executor:
  type: genome
  id: "genome:bbh-local"
  version_ref: null

instance:
  seed: 1
  instance_id: "bbh-run"
  params:
    tree: bbh
    benchmark: bbh
    split: eval
    genome:
      fingerprint: "local-dev"
      display_name: "Local Dev Genome"
      model: "unknown"
      router: "unknown"
      planner: null
      critic: null
      tool_policy: "balanced"
      runtime: "regent-cli"

execution:
  output_dir: outputs/
  allow_resume: false
`,
      "utf8",
    );
    await fs.mkdir(path.join(workspacePath, "outputs"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, "logs"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, "outputs", "verdict.json"),
      `${JSON.stringify({ score: null, matched: null, reproducible: null }, null, 2)}\n`,
      "utf8",
    );
    return;
  }

  await fs.writeFile(
    path.join(workspacePath, "review.source.yaml"),
    `schema_version: techtree.review-source.v1

target:
  type: run
  id: "${String(input.target_id ?? "")}"

kind: validation
method: replay

scope:
  level: whole
  path: null

result: confirmed
summary: "Official BBH replay review."

findings: []

evidence:
  refs:
    - kind: run
      ref: "${String(input.target_id ?? "")}"
      note: "Validated BBH run"
  attachments:
    include:
      - outputs/**/*
      - logs/**/*
    exclude: []
`,
    "utf8",
  );
  await fs.mkdir(path.join(workspacePath, "outputs"), { recursive: true });
  await fs.mkdir(path.join(workspacePath, "logs"), { recursive: true });
};

const runWorkspaceInit = async (
  ctx: RuntimeContext,
  tree: TechtreeTreeName,
  entrypoint: Extract<TechtreeCoreEntrypoint, "artifact.init" | "run.init" | "review.init">,
  input: Record<string, unknown>,
): Promise<TechtreeWorkspaceActionResult> => {
  const result = await runTechtreeCoreJson<TechtreeWorkspaceActionResult>(entrypoint, input, {
    cwd: String(input.workspace_path),
  });
  const nodeType = entrypoint.split(".")[0] as NodeType;
  await writeIfBbhTree(tree, String(input.workspace_path), nodeType, input);
  const resolvedMetadata = ctx.agentRouter.resolveRunMetadata(readRunMetadata(input));
  await writeResolvedMetadata(String(input.workspace_path), resolvedMetadata);
  return {
    ...result,
    tree,
    resolved_metadata: resolvedMetadata,
  };
};

const compileWorkspace = async (
  entrypoint: Extract<TechtreeCoreEntrypoint, "artifact.compile" | "run.compile" | "review.compile">,
  workspacePath: string,
): Promise<TechtreeCompilerOutput<Record<string, unknown>>> => {
  return await runTechtreeCoreJson<TechtreeCompilerOutput<Record<string, unknown>>>(entrypoint, {
    workspace_path: workspacePath,
  }, { cwd: workspacePath });
};

const pinWorkspace = async (
  ctx: RuntimeContext,
  tree: TechtreeTreeName,
  nodeType: NodeType,
  entrypoint: Extract<TechtreeCoreEntrypoint, "artifact.compile" | "run.compile" | "review.compile">,
  workspacePath: string,
): Promise<TechtreePinResponse & {
  tree: TechtreeTreeName;
  compiled: TechtreeCompilerOutput<Record<string, unknown>>;
}> => {
  const compiled = await compileWorkspace(entrypoint, workspacePath);
  const client = ctx.techtreePublisher;
  const pinned = await client.pinNode({
    node_type: nodeType,
    workspace_path: workspacePath,
    dist_path: compiled.dist_path,
  });

  return {
    ...pinned,
    tree,
    compiled,
  };
};

const publishWorkspace = async (
  ctx: RuntimeContext,
  tree: TechtreeTreeName,
  nodeType: NodeType,
  entrypoint: Extract<TechtreeCoreEntrypoint, "artifact.compile" | "run.compile" | "review.compile">,
  workspacePath: string,
): Promise<TechtreePublishResponse & { tree: TechtreeTreeName }> => {
  const client = ctx.techtreePublisher;
  const compiled = await compileWorkspace(entrypoint, workspacePath);
  const pinned = await client.pinNode({
    node_type: nodeType,
    workspace_path: workspacePath,
    dist_path: compiled.dist_path,
  });
  const published = await client.publishNode({
    node_type: nodeType,
    workspace_path: workspacePath,
    dist_path: compiled.dist_path,
    header: compiled.node_header,
    manifest_cid: pinned.manifest_cid,
    payload_cid: pinned.payload_cid,
  });

  return {
    tree,
    ...published,
  };
};

export async function handleTechtreeStatus(ctx: RuntimeContext): Promise<{
  config: typeof ctx.config.techtree;
  health: Record<string, unknown>;
}> {
  return {
    config: ctx.config.techtree,
    health: await ctx.techtree.health(),
  };
}

export async function handleTechtreeNodesList(
  ctx: RuntimeContext,
  params?: { limit?: number; seed?: string },
): Promise<{ data: TreeNode[] }> {
  return ctx.techtree.listNodes(params);
}

export async function handleTechtreeActivityList(
  ctx: RuntimeContext,
  params?: { limit?: number },
): Promise<ActivityListResponse> {
  return ctx.techtree.listActivity(params);
}

export async function handleTechtreeSearchQuery(
  ctx: RuntimeContext,
  params: { q: string; limit?: number },
): Promise<{
  data: {
    nodes: TreeNode[];
    comments: TreeComment[];
  };
}> {
  return ctx.techtree.search(params);
}

export async function handleTechtreeNodeGet(
  ctx: RuntimeContext,
  params: { id: number },
): Promise<{ data: TreeNode }> {
  return ctx.techtree.getNode(params.id);
}

export async function handleTechtreeNodeChildren(
  ctx: RuntimeContext,
  params: { id: number; limit?: number },
): Promise<{ data: TreeNode[] }> {
  return ctx.techtree.getChildren(params.id, { limit: params.limit });
}

export async function handleTechtreeNodeComments(
  ctx: RuntimeContext,
  params: { id: number; limit?: number },
): Promise<{ data: TreeComment[] }> {
  return ctx.techtree.getComments(params.id, { limit: params.limit });
}

export async function handleTechtreeNodeLineageList(
  ctx: RuntimeContext,
  params: { id: number },
): Promise<{ data: Record<string, unknown> | null }> {
  return ctx.techtree.listNodeLineageClaims(params.id);
}

export async function handleTechtreeNodeLineageClaim(
  ctx: RuntimeContext,
  params: { id: number; input: Record<string, unknown> },
): Promise<{ data: Record<string, unknown> }> {
  return ctx.techtree.claimNodeLineage(params.id, params.input);
}

export async function handleTechtreeNodeLineageWithdraw(
  ctx: RuntimeContext,
  params: { id: number; claimId: string },
): Promise<{ ok: true }> {
  return ctx.techtree.withdrawNodeLineageClaim(params.id, params.claimId);
}

export async function handleTechtreeNodeCrossChainLinksList(
  ctx: RuntimeContext,
  params: { id: number },
): Promise<{ data: Record<string, unknown>[] }> {
  return ctx.techtree.listNodeCrossChainLinks(params.id);
}

export async function handleTechtreeNodeCrossChainLinksCreate(
  ctx: RuntimeContext,
  params: { id: number; input: Record<string, unknown> },
): Promise<{ data: Record<string, unknown> }> {
  return ctx.techtree.createNodeCrossChainLink(params.id, params.input);
}

export async function handleTechtreeNodeCrossChainLinksClear(
  ctx: RuntimeContext,
  params: { id: number },
): Promise<{ ok: true }> {
  return ctx.techtree.clearNodeCrossChainLinks(params.id);
}

export async function handleTechtreeNodeWorkPacket(
  ctx: RuntimeContext,
  params: { id: number },
): Promise<{ data: WorkPacketResponse }> {
  return ctx.techtree.getWorkPacket(params.id);
}

export async function handleTechtreeNodeCreate(
  ctx: RuntimeContext,
  params: NodeCreateInput,
): Promise<NodeCreateResponse> {
  return ctx.techtree.createNode(params);
}

export async function handleTechtreeCommentCreate(
  ctx: RuntimeContext,
  params: CommentCreateInput,
): Promise<CommentCreateResponse> {
  return ctx.techtree.createComment(params);
}

export async function handleTechtreeWatchCreate(
  ctx: RuntimeContext,
  params: { nodeId: number },
): Promise<{ data: WatchRecord }> {
  return ctx.techtree.watchNode(params.nodeId);
}

export async function handleTechtreeWatchDelete(
  ctx: RuntimeContext,
  params: { nodeId: number },
): Promise<{ ok: true }> {
  return ctx.techtree.unwatchNode(params.nodeId);
}

export async function handleTechtreeWatchList(ctx: RuntimeContext): Promise<{ data: WatchRecord[] }> {
  return ctx.techtree.listWatches();
}

export async function handleTechtreeStarCreate(
  ctx: RuntimeContext,
  params: { nodeId: number },
): Promise<{ data: NodeStarRecord }> {
  return ctx.techtree.starNode(params.nodeId);
}

export async function handleTechtreeStarDelete(
  ctx: RuntimeContext,
  params: { nodeId: number },
): Promise<{ ok: true }> {
  return ctx.techtree.unstarNode(params.nodeId);
}

export async function handleTechtreeAutoskillInitSkill(
  _ctx: RuntimeContext,
  params: { workspace_path: string },
): Promise<{
  ok: true;
  entrypoint: "autoskill.init.skill";
  workspace_path: string;
  files: string[];
}> {
  const workspacePath = path.resolve(params.workspace_path);
  const files = await initAutoskillSkillWorkspace(workspacePath);
  await writeDefaultResultFiles(workspacePath);

  return {
    ok: true,
    entrypoint: "autoskill.init.skill",
    workspace_path: workspacePath,
    files: [...files, "result.json", "artifacts.json", "repro-manifest.json"],
  };
}

export async function handleTechtreeAutoskillInitEval(
  _ctx: RuntimeContext,
  params: { workspace_path: string },
): Promise<{
  ok: true;
  entrypoint: "autoskill.init.eval";
  workspace_path: string;
  files: string[];
}> {
  const workspacePath = path.resolve(params.workspace_path);
  const files = await initAutoskillEvalWorkspace(workspacePath);

  return {
    ok: true,
    entrypoint: "autoskill.init.eval",
    workspace_path: workspacePath,
    files,
  };
}

export async function handleTechtreeAutoskillPublishSkill(
  ctx: RuntimeContext,
  params: { workspace_path: string; input: AutoskillSkillPublishRequest },
): Promise<AutoskillCreateSkillResponse & {
  workspace_path: string;
  bundle_hash: string;
  manifest: Record<string, unknown>;
}> {
  const workspacePath = path.resolve(params.workspace_path);
  const input = params.input;
  const bundle = await buildAutoskillBundlePayload(workspacePath, "skill", {
    accessMode: input.access_mode,
    marimoEntrypoint: input.marimo_entrypoint,
    primaryFile: input.primary_file,
    previewMd: input.preview_md,
    metadata: {
      skill_slug: input.skill_slug,
      skill_version: input.skill_version,
      title: input.title,
      slug: input.slug ?? input.skill_slug,
    },
  });

  const payload: AutoskillSkillPublishInput = {
    ...input,
    title: input.title || defaultTitle(workspacePath),
    skill_slug: input.skill_slug || defaultSkillSlug(workspacePath),
    skill_version: input.skill_version || defaultVersion(workspacePath),
    preview_md: bundle.previewMd ?? "# Preview only",
    bundle_manifest: bundle.manifest,
    marimo_entrypoint: bundle.marimoEntrypoint,
    primary_file: bundle.primaryFile ?? undefined,
    ...(input.access_mode === "gated_paid"
      ? {
          encrypted_bundle_archive_b64: bundle.archiveBase64,
          encryption_meta: input.encryption_meta ?? {
            mode: "placeholder",
            note: "v0.1 structural placeholder",
          },
        }
      : {
          bundle_archive_b64: bundle.archiveBase64,
        }),
  };

  const response = await ctx.techtree.createAutoskillSkill(payload);
  return {
    ...response,
    workspace_path: workspacePath,
    bundle_hash: bundle.archiveHash,
    manifest: bundle.manifest,
  };
}

export async function handleTechtreeAutoskillPublishEval(
  ctx: RuntimeContext,
  params: { workspace_path: string; input: AutoskillEvalPublishRequest },
): Promise<AutoskillCreateEvalResponse & {
  workspace_path: string;
  bundle_hash: string;
  manifest: Record<string, unknown>;
}> {
  const workspacePath = path.resolve(params.workspace_path);
  const input = params.input;
  const bundle = await buildAutoskillBundlePayload(workspacePath, "eval", {
    accessMode: input.access_mode,
    marimoEntrypoint: input.marimo_entrypoint,
    primaryFile: input.primary_file,
    previewMd: input.preview_md,
    version:
      typeof input.bundle_manifest?.metadata === "object" && input.bundle_manifest.metadata
        ? String((input.bundle_manifest.metadata as Record<string, unknown>).version ?? defaultVersion(workspacePath))
        : defaultVersion(workspacePath),
    metadata: {
      slug: input.slug,
      title: input.title,
    },
  });

  const payload: AutoskillEvalPublishInput = {
    ...input,
    title: input.title || defaultTitle(workspacePath),
    slug: input.slug || defaultSkillSlug(workspacePath),
    preview_md: bundle.previewMd ?? "Autoskill eval preview",
    bundle_manifest: bundle.manifest,
    marimo_entrypoint: bundle.marimoEntrypoint,
    primary_file: bundle.primaryFile ?? undefined,
    ...(input.access_mode === "gated_paid"
      ? {
          encrypted_bundle_archive_b64: bundle.archiveBase64,
          encryption_meta: input.encryption_meta ?? {
            mode: "placeholder",
            note: "v0.1 structural placeholder",
          },
        }
      : {
          bundle_archive_b64: bundle.archiveBase64,
        }),
  };

  const response = await ctx.techtree.createAutoskillEval(payload);
  return {
    ...response,
    workspace_path: workspacePath,
    bundle_hash: bundle.archiveHash,
    manifest: bundle.manifest,
  };
}

export async function handleTechtreeAutoskillPublishResult(
  ctx: RuntimeContext,
  params: { workspace_path: string; input: AutoskillResultPublishInput },
): Promise<AutoskillCreateResultResponse> {
  const workspacePayload = await loadAutoskillResultPayload(params.workspace_path);

  return ctx.techtree.publishAutoskillResult({
    ...workspacePayload,
    ...params.input,
  } as AutoskillResultPublishInput);
}

export async function handleTechtreeAutoskillReview(
  ctx: RuntimeContext,
  params: AutoskillReviewCreateInput,
): Promise<AutoskillCreateReviewResponse> {
  return ctx.techtree.createAutoskillReview(params);
}

export async function handleTechtreeAutoskillListingCreate(
  ctx: RuntimeContext,
  params: AutoskillListingCreateInput,
): Promise<AutoskillCreateListingResponse> {
  return ctx.techtree.createAutoskillListing(params);
}

export async function handleTechtreeAutoskillBuy(
  ctx: RuntimeContext,
  params: { node_id: number },
): Promise<AutoskillBuyResponse> {
  const node = (await ctx.techtree.getNode(params.node_id)).data;
  const payload = node.paid_payload;

  if (!payload) {
    throw new Error("node does not expose an active paid payload");
  }

  const settlementContract = requireAddress(payload.settlement_contract_address, "settlement contract");
  const usdcToken = requireAddress(payload.usdc_token_address, "USDC token");
  const sellerPayout = requireAddress(payload.seller_payout_address, "seller payout address");
  const listingRef = requireHex32(payload.listing_ref, "listing ref");
  const bundleRef = requireHex32(payload.bundle_ref, "bundle ref");
  const chainId = requirePositiveInteger(payload.chain_id, "chain_id");
  const rpcUrl = rpcUrlForChain(chainId);
  const amountUnits = parseUsdcAmount(payload.price_usdc);
  const amountUsdc = requireString(payload.price_usdc, "price_usdc");
  const privateKey = await ctx.walletSecretSource.getPrivateKeyHex();
  const account = privateKeyToAccount(privateKey);
  const chain = viemChainForId(chainId);

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    chain,
    account,
    transport: http(rpcUrl),
  });

  const approveTxHash = await walletClient.writeContract({
    account,
    address: usdcToken,
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [settlementContract, amountUnits],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

  const purchaseTxHash = await walletClient.writeContract({
    account,
    address: settlementContract,
    abi: TECHTREE_CONTENT_SETTLEMENT_ABI,
    functionName: "settlePurchase",
    args: [listingRef, sellerPayout, bundleRef, amountUnits],
  });
  await publicClient.waitForTransactionReceipt({ hash: purchaseTxHash });

  const verified = await ctx.techtree.verifyNodePurchase(params.node_id, purchaseTxHash);

  return {
    data: {
      node_id: params.node_id,
      approve_tx_hash: approveTxHash,
      purchase_tx_hash: purchaseTxHash,
      chain_id: chainId,
      amount_usdc: amountUsdc,
      listing_ref: verified.data.listing_ref,
      bundle_ref: verified.data.bundle_ref,
    },
  };
}

export async function handleTechtreeAutoskillPull(
  ctx: RuntimeContext,
  params: { node_id: number; workspace_path: string },
): Promise<{
  ok: true;
  node_id: number;
  workspace_path: string;
  files: string[];
  marimo_entrypoint: string;
  primary_file: string | null;
}> {
  const bundle: AutoskillBundleAccessResponse = await ctx.techtree.getAutoskillBundle(params.node_id);

  const downloadUrl = bundle.data.download_url ?? bundle.data.bundle_uri;

  if (!downloadUrl || downloadUrl.startsWith("ipfs://")) {
    throw new Error("autoskill bundle does not expose a fetchable download URL");
  }

  const bundleText = await ctx.techtree.fetchExternalText(downloadUrl);
  const workspacePath = path.resolve(params.workspace_path);
  const files = await materializeAutoskillBundle(workspacePath, bundleText);

  await fs.writeFile(
    path.join(workspacePath, "bundle.manifest.json"),
    `${JSON.stringify(bundle.data.manifest, null, 2)}\n`,
    "utf8",
  );

  return {
    ok: true,
    node_id: params.node_id,
    workspace_path: workspacePath,
    files,
    marimo_entrypoint: bundle.data.marimo_entrypoint,
    primary_file: bundle.data.primary_file,
  };
}

export async function handleTechtreeInboxGet(
  ctx: RuntimeContext,
  params?: { cursor?: number; limit?: number; seed?: string; kind?: string | string[] },
): Promise<AgentInboxResponse> {
  return ctx.techtree.getInbox(params);
}

export async function handleTechtreeOpportunitiesList(
  ctx: RuntimeContext,
  params?: Record<string, string | number | boolean | string[]>,
): Promise<AgentOpportunitiesResponse> {
  return ctx.techtree.getOpportunities(params);
}

export async function handleTechtreeChatboxHistory(
  ctx: RuntimeContext,
  params?: { before?: number; limit?: number; room?: "webapp" | "agent" },
): Promise<ChatboxListResponse> {
  return ctx.techtree.listChatboxMessages(params);
}

export async function handleTechtreeChatboxPost(
  ctx: RuntimeContext,
  params: ChatboxPostInput,
): Promise<ChatboxPostResponse> {
  return ctx.techtree.createAgentChatboxMessage(params);
}

export async function handleTechtreeV1ArtifactInit(
  ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string },
): Promise<TechtreeWorkspaceActionResult> {
  return runWorkspaceInit(ctx, params.tree, "artifact.init", params);
}

export async function handleTechtreeV1ArtifactCompile(
  _ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string },
): Promise<TechtreeCompilerOutput<Record<string, unknown>>> {
  return compileWorkspace("artifact.compile", params.workspace_path);
}

export async function handleTechtreeV1ArtifactPin(
  ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string },
) {
  return pinWorkspace(ctx, params.tree, "artifact", "artifact.compile", params.workspace_path);
}

export async function handleTechtreeV1ArtifactPublish(
  ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string },
) {
  return publishWorkspace(ctx, params.tree, "artifact", "artifact.compile", params.workspace_path);
}

export async function handleTechtreeV1RunInit(
  ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string; artifact_id: TechtreeNodeId },
): Promise<TechtreeWorkspaceActionResult> {
  return runWorkspaceInit(ctx, params.tree, "run.init", params);
}

export async function handleTechtreeV1RunExec(
  ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string; metadata?: RegentRunMetadata | null },
): Promise<TechtreeWorkspaceActionResult> {
  const result = await ctx.workload.runExec({
    tree: params.tree,
    workspace_path: params.workspace_path,
    metadata: params.metadata ?? null,
  });
  const resolvedMetadata = ctx.agentRouter.resolveRunMetadata(params.metadata ?? null);
  await writeResolvedMetadata(params.workspace_path, resolvedMetadata);
  return {
    ...result,
    tree: params.tree,
    resolved_metadata: resolvedMetadata,
  };
}

export async function handleTechtreeV1RunCompile(
  _ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string },
): Promise<TechtreeCompilerOutput<Record<string, unknown>>> {
  return compileWorkspace("run.compile", params.workspace_path);
}

export async function handleTechtreeV1RunPin(
  ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string },
) {
  return pinWorkspace(ctx, params.tree, "run", "run.compile", params.workspace_path);
}

export async function handleTechtreeV1RunPublish(
  ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string },
) {
  return publishWorkspace(ctx, params.tree, "run", "run.compile", params.workspace_path);
}

export async function handleTechtreeV1ReviewInit(
  ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string; target_id: TechtreeNodeId },
): Promise<TechtreeWorkspaceActionResult> {
  return runWorkspaceInit(ctx, params.tree, "review.init", params);
}

export async function handleTechtreeV1ReviewExec(
  _ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string },
): Promise<TechtreeWorkspaceActionResult> {
  const result = await runTechtreeCoreJson<TechtreeWorkspaceActionResult>("review.exec", params, {
    cwd: params.workspace_path,
  });
  return {
    ...result,
    tree: params.tree,
  };
}

export async function handleTechtreeV1ReviewCompile(
  _ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string },
): Promise<TechtreeCompilerOutput<Record<string, unknown>>> {
  return compileWorkspace("review.compile", params.workspace_path);
}

export async function handleTechtreeV1ReviewPin(
  ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string },
) {
  return pinWorkspace(ctx, params.tree, "review", "review.compile", params.workspace_path);
}

export async function handleTechtreeV1ReviewPublish(
  ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; workspace_path: string },
) {
  return publishWorkspace(ctx, params.tree, "review", "review.compile", params.workspace_path);
}

export async function handleTechtreeV1Fetch(
  ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; node_id: TechtreeNodeId; workspace_path?: string | null },
): Promise<TechtreeFetchResponse & { tree: TechtreeTreeName }> {
  const client = ctx.techtreePublisher;
  const fetched = await client.fetchNode({
    node_id: params.node_id,
    materialize_to: params.workspace_path,
  });
  return {
    tree: params.tree,
    ...fetched,
  };
}

export async function handleTechtreeV1Verify(
  ctx: RuntimeContext,
  params: { tree: TechtreeTreeName; node_id: TechtreeNodeId; workspace_path?: string | null },
): Promise<TechtreeVerifyResponse & { tree: TechtreeTreeName }> {
  const client = ctx.techtreePublisher;
  const fetched = await client.fetchNode({
    node_id: params.node_id,
    materialize_to: params.workspace_path,
  });
  const verification = await runTechtreeCoreJson<TechtreeVerifyResponse>("verify", {
    node_id: params.node_id,
    workspace_path: params.workspace_path,
    fetched,
  }, { cwd: params.workspace_path ?? process.cwd() });
  return {
    tree: params.tree,
    ...verification,
  };
}

export async function handleTechtreeV1BbhLeaderboard(
  ctx: RuntimeContext,
  params?: { split?: "climb" | "benchmark" | "challenge" | "draft" },
): Promise<BbhLeaderboardResponse> {
  return ctx.techtree.getBbhLeaderboard(params);
}

export async function handleTechtreeV1BbhCapsulesList(
  ctx: RuntimeContext,
  params?: TechtreeV1BbhCapsulesListParams,
): Promise<BbhCapsuleListResponse> {
  return ctx.techtree.listBbhCapsules(
    params?.split === undefined ? undefined : { split: params.split ?? undefined },
  );
}

export async function handleTechtreeV1BbhCapsulesGet(
  ctx: RuntimeContext,
  params: TechtreeV1BbhCapsulesGetParams,
): Promise<BbhCapsuleGetResponse> {
  return ctx.techtree.getBbhCapsule(params.capsule_id);
}

export async function handleTechtreeV1BbhRunExec(
  ctx: RuntimeContext,
  params: BbhRunExecParams,
): Promise<BbhRunExecResponse> {
  const resolvedMetadata = ctx.agentRouter.resolveRunMetadata(params.metadata ?? null);
  return materializeBbhWorkspace(ctx.techtree, ctx.config, params, resolvedMetadata);
}

export async function handleTechtreeV1BbhDraftInit(
  _ctx: RuntimeContext,
  params: { workspace_path: string },
): Promise<TechtreeWorkspaceActionResult> {
  const workspacePath = path.resolve(params.workspace_path);
  const files = await materializeBbhDraftWorkspace(workspacePath);

  return {
    ok: true,
    tree: "bbh",
    entrypoint: "bbh.draft.init",
    workspace_path: workspacePath,
    files,
  };
}

export async function handleTechtreeV1BbhDraftCreate(
  ctx: RuntimeContext,
  params: BbhDraftCreateParams,
): Promise<BbhDraftGetResponse> {
  return ctx.techtree.createBbhDraft(await loadBbhDraftCreateRequest(params.workspace_path, params));
}

export async function handleTechtreeV1BbhDraftList(
  ctx: RuntimeContext,
  _params?: Record<string, never>,
): Promise<BbhDraftListResponse> {
  return ctx.techtree.listBbhDrafts();
}

export async function handleTechtreeV1BbhDraftPull(
  ctx: RuntimeContext,
  params: BbhDraftPullParams,
): Promise<BbhDraftPullResponse> {
  const workspacePath = path.resolve(params.workspace_path);
  const draft = await ctx.techtree.getBbhDraft(params.capsule_id);
  const files = await materializeBbhDraftWorkspace(workspacePath, draft.data.workspace);

  return {
    ok: true,
    entrypoint: "bbh.draft.pull",
    workspace_path: workspacePath,
    capsule_id: params.capsule_id,
    files,
    capsule: draft.data.capsule,
  };
}

export async function handleTechtreeV1BbhDraftPropose(
  ctx: RuntimeContext,
  params: BbhDraftProposalSubmitParams,
): Promise<BbhDraftProposalSubmitResponse> {
  return ctx.techtree.createBbhDraftProposal(
    params.capsule_id,
    await loadBbhDraftProposalRequest(params.workspace_path, params.summary),
  );
}

export async function handleTechtreeV1BbhDraftProposals(
  ctx: RuntimeContext,
  params: { capsule_id: string },
): Promise<BbhDraftProposalListResponse> {
  return ctx.techtree.listBbhDraftProposals(params.capsule_id);
}

export async function handleTechtreeV1BbhDraftApply(
  ctx: RuntimeContext,
  params: BbhDraftApplyParams,
): Promise<BbhDraftGetResponse> {
  return ctx.techtree.applyBbhDraftProposal(params.capsule_id, params.proposal_id);
}

export async function handleTechtreeV1BbhDraftReady(
  ctx: RuntimeContext,
  params: BbhDraftReadyParams,
): Promise<BbhDraftGetResponse> {
  return ctx.techtree.readyBbhDraft(params.capsule_id);
}

export async function handleTechtreeV1BbhSubmit(
  ctx: RuntimeContext,
  params: BbhSubmitParams,
): Promise<BbhRunSubmitResponse> {
  return ctx.techtree.submitBbhRun(await loadBbhRunSubmitRequest(params.workspace_path));
}

export async function handleTechtreeV1BbhValidate(
  ctx: RuntimeContext,
  params: BbhValidateParams,
): Promise<BbhValidationSubmitResponse> {
  return ctx.techtree.submitBbhValidation(await buildBbhValidationRequest(params.workspace_path, params.run_id));
}

export async function handleTechtreeV1BbhSync(
  ctx: RuntimeContext,
  params?: BbhSyncParams,
): Promise<BbhSyncResponse> {
  const workspaceRoot = params?.workspace_root ?? path.join(ctx.config.workloads.bbh.workspaceRoot, "runs");

  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true }).catch(() => []);
  const runIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  return ctx.techtree.syncBbh({ run_ids: runIds });
}

export async function handleTechtreeV1ReviewerOrcidLink(
  ctx: RuntimeContext,
  params?: BbhReviewerOrcidLinkParams,
): Promise<BbhReviewerOrcidLinkResponse> {
  if (params?.request_id) {
    return ctx.techtree.getReviewerOrcidLinkStatus(params.request_id);
  }

  return ctx.techtree.startReviewerOrcidLink();
}

export async function handleTechtreeV1ReviewerApply(
  ctx: RuntimeContext,
  params: BbhReviewerApplyParams,
): Promise<BbhReviewerApplyResponse> {
  return ctx.techtree.applyReviewerProfile(params);
}

export async function handleTechtreeV1ReviewerStatus(
  ctx: RuntimeContext,
): Promise<BbhReviewerStatusResponse> {
  return ctx.techtree.getReviewerProfile();
}

export async function handleTechtreeV1ReviewList(
  ctx: RuntimeContext,
  params?: BbhReviewListParams,
): Promise<BbhReviewListResponse> {
  return ctx.techtree.listBbhReviews(params);
}

export async function handleTechtreeV1ReviewClaim(
  ctx: RuntimeContext,
  params: { request_id: string },
): Promise<{ data: import("../../internal-types/index.js").BbhReviewRequest }> {
  return ctx.techtree.claimBbhReview(params.request_id);
}

export async function handleTechtreeV1ReviewPull(
  ctx: RuntimeContext,
  params: BbhReviewPullParams,
): Promise<BbhReviewPullResponse> {
  const workspacePath = path.resolve(params.workspace_path);
  const packet = await ctx.techtree.getBbhReviewPacket(params.request_id);
  const files = await materializeBbhReviewWorkspace(workspacePath, packet.data);

  return {
    ok: true,
    entrypoint: "bbh.review.pull",
    workspace_path: workspacePath,
    request_id: params.request_id,
    capsule_id: packet.data.request.capsule_id,
    files,
    review: packet.data.request,
  };
}

export async function handleTechtreeV1ReviewSubmit(
  ctx: RuntimeContext,
  params: BbhReviewSubmitParams,
): Promise<BbhReviewSubmitResponse> {
  const request = await loadBbhReviewSubmitRequest(params.workspace_path);
  return ctx.techtree.submitBbhReview(request.request_id, request);
}

export async function handleTechtreeV1CertificateVerify(
  ctx: RuntimeContext,
  params: BbhCertificateVerifyParams,
): Promise<BbhCertificateVerifyResponse> {
  return ctx.techtree.verifyBbhCertificate(params.capsule_id);
}
