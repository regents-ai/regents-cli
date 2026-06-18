import type {
  RegentRunMetadata,
  TechtreeCompilerOutput,
  TechtreeFetchResponse,
  TechtreeNodeId,
  TechtreeTreeName,
  TechtreeVerifyResponse,
  TechtreeWorkspaceActionResult,
} from "../../../internal-types/index.js";

import type { RuntimeContext } from "../../runtime.js";
import { runTechtreeCoreJson } from "../../techtree/core.js";
import { compileWorkspace, publishWorkspace, runWorkspaceInit, writeResolvedMetadata } from "./workspace.js";

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
