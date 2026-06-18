import fs from "node:fs/promises";
import path from "node:path";

import type {
  RegentRunMetadata,
  TechtreeCompilerOutput,
  TechtreePublishResponse,
  TechtreeTreeName,
  TechtreeWorkspaceActionResult,
} from "../../../internal-types/index.js";

import type { RuntimeContext } from "../../runtime.js";
import { runTechtreeCoreJson, type TechtreeCoreEntrypoint } from "../../techtree/core.js";

type NodeType = "artifact" | "run" | "review";

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

export const writeResolvedMetadata = async (workspacePath: string, metadata: unknown): Promise<void> => {
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
      runtime: "regents-cli"

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

export const runWorkspaceInit = async (
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

export const compileWorkspace = async (
  entrypoint: Extract<TechtreeCoreEntrypoint, "artifact.compile" | "run.compile" | "review.compile">,
  workspacePath: string,
): Promise<TechtreeCompilerOutput<Record<string, unknown>>> => {
  return await runTechtreeCoreJson<TechtreeCompilerOutput<Record<string, unknown>>>(entrypoint, {
    workspace_path: workspacePath,
  }, { cwd: workspacePath });
};

export const publishWorkspace = async (
  ctx: RuntimeContext,
  tree: TechtreeTreeName,
  nodeType: NodeType,
  entrypoint: Extract<TechtreeCoreEntrypoint, "artifact.compile" | "run.compile" | "review.compile">,
  workspacePath: string,
): Promise<TechtreePublishResponse & { tree: TechtreeTreeName }> => {
  const compiled = await compileWorkspace(entrypoint, workspacePath);
  const published = await ctx.techtreePublisher.publishNode({
    node_type: nodeType,
    workspace_path: workspacePath,
    dist_path: compiled.dist_path,
    header: compiled.node_header,
    manifest: compiled.manifest,
    payload_index: compiled.payload_index,
  });

  return {
    tree,
    ...published,
  };
};
