import type {
  TechtreeWorkKind,
  TechtreeWorkListResponse,
  TechtreeWorkResponse,
} from "../../../internal-types/index.js";
import fs from "node:fs";
import path from "node:path";
import { publishNotebookWorkspace } from "../../workloads/notebooks.js";
import { writeAcceptedWorkWorkspace, type AcceptedWorkWorkspaceResult } from "../../workloads/work.js";
import { publishWorkspace } from "./workspace.js";
import type { RuntimeContext } from "../../runtime.js";

export async function handleTechtreeWorkList(
  ctx: RuntimeContext,
  params?: { kind?: TechtreeWorkKind; limit?: number },
): Promise<TechtreeWorkListResponse> {
  return ctx.techtree.listWork(params);
}

export async function handleTechtreeWorkNext(
  ctx: RuntimeContext,
  params?: { kind?: TechtreeWorkKind },
): Promise<TechtreeWorkResponse> {
  return ctx.techtree.nextWork(params);
}

export async function handleTechtreeWorkAccept(
  ctx: RuntimeContext,
  params: { work_unit: string; workspace_path?: string },
): Promise<TechtreeWorkResponse | AcceptedWorkWorkspaceResult> {
  const response = await ctx.techtree.acceptWork(params.work_unit);

  if (!params.workspace_path) {
    return response;
  }

  return writeAcceptedWorkWorkspace({
    workspace_path: params.workspace_path,
    work: response.data,
  });
}

const V1_NODE_TYPES = ["artifact", "run", "review"] as const;

const detectV1NodeType = (workspacePath: string): (typeof V1_NODE_TYPES)[number] | null =>
  V1_NODE_TYPES.find((nodeType) => fs.existsSync(path.join(workspacePath, `${nodeType}.source.yaml`))) ?? null;

export async function handleTechtreeWorkPublish(
  ctx: RuntimeContext,
  params: { workspace_path: string },
): Promise<unknown> {
  if (fs.existsSync(path.join(params.workspace_path, "notebook.json"))) {
    return publishNotebookWorkspace(ctx, params);
  }

  const v1NodeType = detectV1NodeType(params.workspace_path);
  if (v1NodeType) {
    return publishWorkspace(ctx, "main", v1NodeType, `${v1NodeType}.compile`, params.workspace_path);
  }

  return {
    ok: true,
    workspace_path: params.workspace_path,
    next: [
      "Use the specialized publish command named in the workspace README.",
      "Notebook work uses regents techtree notebooks publish.",
      "Science Task work uses regents techtree science-tasks review-loop, then export.",
      "Benchmark work uses regents techtree benchmarks run submit, then validate.",
    ],
  };
}
