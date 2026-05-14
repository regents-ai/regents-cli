import fs from "node:fs/promises";
import path from "node:path";

import type {
  AutoskillBundleAccessResponse,
  AutoskillBuyResponse,
  AutoskillCreateEvalResponse,
  AutoskillCreateListingResponse,
  AutoskillCreateResultResponse,
  AutoskillCreateReviewResponse,
  AutoskillCreateSkillResponse,
  AutoskillNotebookPairParams,
  AutoskillNotebookPairResponse,
  AutoskillEvalPublishInput,
  AutoskillEvalPublishRequest,
  AutoskillListingCreateInput,
  AutoskillRefundResponse,
  AutoskillResultPublishInput,
  AutoskillReviewCreateInput,
  AutoskillSkillPublishInput,
  AutoskillSkillPublishRequest,
} from "../../../internal-types/index.js";

import type { RuntimeContext } from "../../runtime.js";
import { RegentX402Client } from "../../x402/client.js";
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
} from "../../workloads/autoskill.js";
import { prepareAutoskillNotebookPair } from "../../workloads/notebook-pair.js";

type HeaderInput = ConstructorParameters<typeof Headers>[0];

const headersRecord = (headers: HeaderInput | undefined): Record<string, string> => {
  const normalized = new Headers(headers);
  return Object.fromEntries(normalized.entries());
};

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

export async function handleTechtreeAutoskillNotebookPair(
  _ctx: RuntimeContext,
  params: AutoskillNotebookPairParams,
): Promise<AutoskillNotebookPairResponse> {
  return prepareAutoskillNotebookPair(params.workspace_path);
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
  params: { node_id: number; max_deposit_amount: string },
): Promise<AutoskillBuyResponse> {
  const node = (await ctx.techtree.getNode(params.node_id)).data;
  const payload = node.paid_payload;

  if (!payload) {
    throw new Error("node does not expose an active paid payload");
  }

  const path = `/v1/agent/tree/nodes/${params.node_id}/payload`;
  const url = `${ctx.techtree.baseUrl}${path}`;
  const init = await ctx.techtree.buildAuthedRequestInit("GET", path);
  const headers = headersRecord(init.headers);
  const x402 = new RegentX402Client({
    stateDir: ctx.config.runtime.stateDir,
    walletSecretSource: ctx.walletSecretSource,
  });
  const prepared = await x402.prepare({
    url,
    method: "GET",
    headers,
    max_amount: payload.x402_price_atomic,
    max_deposit_amount: params.max_deposit_amount,
    approve: true,
  });
  if (prepared.intent.selected.scheme !== "batch-settlement") {
    throw new Error("paid payload did not offer batch-settlement");
  }
  const fetched = await x402.fetchApproved({
    url,
    method: "GET",
    headers,
    intent_id: prepared.intent.intent_id,
  });

  return {
    data: {
      node_id: params.node_id,
      payment_scheme: prepared.intent.selected.scheme,
      amount_atomic: prepared.intent.selected.amount,
      max_deposit_amount: params.max_deposit_amount,
      x402_receipt_id: fetched.receipt?.receipt_id ?? null,
      status: fetched.status,
      ok: fetched.ok,
    },
  };
}

export async function handleTechtreeAutoskillRefund(
  ctx: RuntimeContext,
  params: { node_id: number; amount?: string },
): Promise<AutoskillRefundResponse> {
  const node = (await ctx.techtree.getNode(params.node_id)).data;
  if (!node.paid_payload) {
    throw new Error("node does not expose an active paid payload");
  }

  const path = `/v1/agent/tree/nodes/${params.node_id}/payload`;
  const url = `${ctx.techtree.baseUrl}${path}`;
  const init = await ctx.techtree.buildAuthedRequestInit("GET", path);
  const x402 = new RegentX402Client({
    stateDir: ctx.config.runtime.stateDir,
    walletSecretSource: ctx.walletSecretSource,
  });
  const refund = await x402.refund({
    url,
    headers: headersRecord(init.headers),
    ...(params.amount !== undefined ? { amount: params.amount } : {}),
  });

  return {
    data: {
      node_id: params.node_id,
      amount: refund.amount,
      settlement: refund.settlement,
      ok: refund.ok,
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
