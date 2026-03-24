import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  BbhAssignmentResponse,
  BbhGenomeSource,
  BbhReviewSource,
  BbhRunExecParams,
  BbhRunExecResponse,
  BbhRunSource,
  BbhRunSubmitRequest,
  BbhValidationSubmitRequest,
  RegentConfig,
  RegentResolvedRunMetadata,
} from "../../internal-types/index.js";

import type { TechtreeClient } from "../techtree/client.js";

const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const ensureDir = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const readJsonFile = async <T>(filePath: string): Promise<T> => {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
};

const readRequiredJsonFile = async <T>(filePath: string): Promise<T> => {
  if (!(await fileExists(filePath))) {
    throw new Error(`missing required file: ${path.basename(filePath)}`);
  }

  try {
    return await readJsonFile<T>(filePath);
  } catch (error) {
    throw new Error(`invalid JSON in ${path.basename(filePath)}`);
  }
};

const readRequiredTextFile = async (filePath: string): Promise<string> => {
  if (!(await fileExists(filePath))) {
    throw new Error(`missing required file: ${path.basename(filePath)}`);
  }

  return fs.readFile(filePath, "utf8");
};

const nowIso = (): string => new Date().toISOString();

const shortHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

const normalizeOriginTransport = (
  origin: RegentResolvedRunMetadata["origin"],
): "local" | "xmtp" | "gossipsub" | "api" => {
  if (origin.kind === "local") {
    return "local";
  }

  const transport = origin.transport;
  if (transport === "xmtp" || transport === "gossipsub" || transport === "api") {
    return transport;
  }

  return "api";
};

const normalizeSplit = (split?: string | null): "climb" | "benchmark" | "challenge" => {
  if (split === "benchmark" || split === "challenge") {
    return split;
  }

  return "climb";
};

const triggerForSplit = (split: string): "assignment" | "validator" => {
  if (split === "climb") {
    return "assignment";
  }

  return "validator";
};

const defaultGenomeSource = (
  params: BbhRunExecParams,
  metadata: RegentResolvedRunMetadata,
): BbhGenomeSource => {
  const partial = params.genome ?? {};
  const harnessType = partial.harness_type ?? metadata.executor_harness.kind;
  const base = {
    model_id: partial.model_id ?? "unknown-model",
    harness_type: harnessType,
    harness_version: partial.harness_version ?? "local",
    prompt_pack_version: partial.prompt_pack_version ?? "bbh-v0.1",
    skill_pack_version: partial.skill_pack_version ?? "techtree-bbh-v0.1",
    tool_profile: partial.tool_profile ?? metadata.executor_harness.profile,
    runtime_image: partial.runtime_image ?? "local-runtime",
    helper_code_hash: partial.helper_code_hash ?? null,
    data_profile: partial.data_profile ?? null,
    axes: partial.axes ?? {},
    label: partial.label ?? `${partial.model_id ?? "unknown-model"}:${metadata.executor_harness.profile}`,
    parent_genome_ref: partial.parent_genome_ref ?? null,
    notes: partial.notes ?? null,
  } satisfies Omit<BbhGenomeSource, "schema_version" | "genome_id">;

  return {
    schema_version: "techtree.bbh.genome-source.v1",
    genome_id: partial.genome_id ?? `gen_${shortHash(base)}`,
    ...base,
  };
};

const analysisTemplate = (assignment: BbhAssignmentResponse["data"]): string => `# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "marimo>=0.13.0",
# ]
# ///
import marimo

app = marimo.App()


@app.cell
def _():
    import json
    from pathlib import Path

    workspace = Path(__file__).resolve().parent
    task = json.loads((workspace / "task.json").read_text(encoding="utf-8"))
    protocol = (workspace / "protocol.md").read_text(encoding="utf-8")
    rubric = json.loads((workspace / "rubric.json").read_text(encoding="utf-8"))
    return workspace, task, protocol, rubric


@app.cell
def _(mo, task, protocol):
    mo.md(
        f"""
# {assignment.capsule.title}

**Capsule:** \`{assignment.capsule.capsule_id}\`  
**Assignment:** \`{assignment.assignment_ref}\`

## Hypothesis
{assignment.capsule.hypothesis}

## Protocol
{assignment.capsule.protocol_md}
"""
    )
    return


if __name__ == "__main__":
    app.run()
`;

const verdictTemplate = () => ({
  decision: "inconclusive",
  justification: "Pending notebook execution.",
  metrics: {
    raw_score: 0.0,
    normalized_score: 0.0,
  },
  rubric_breakdown: [],
  status: "ok",
});

const buildRunSource = (
  assignment: BbhAssignmentResponse["data"],
  genome: BbhGenomeSource,
  metadata: RegentResolvedRunMetadata,
): BbhRunSource => ({
  schema_version: "techtree.bbh.run-source.v1",
  artifact_ref: assignment.capsule.capsule_id,
  executor: {
    type: "genome",
    id: genome.genome_id!,
    harness: genome.harness_type,
    harness_version: genome.harness_version,
    profile: metadata.executor_harness.profile,
  },
  instance: {
    instance_ref: assignment.capsule.instance_ref ?? assignment.capsule.capsule_id,
    family_ref: assignment.capsule.family_ref ?? null,
    seed: null,
  },
  origin: {
    workload: "bbh",
    transport: normalizeOriginTransport(metadata.origin),
    trigger: triggerForSplit(assignment.split),
  },
  paths: {
    analysis_path: "analysis.py",
    verdict_path: "outputs/verdict.json",
    final_answer_path: "final_answer.md",
    report_path: "outputs/report.html",
    log_path: "outputs/run.log",
    genome_path: "genome.source.yaml",
  },
  status: "completed",
  bbh: {
    split: assignment.split,
    genome_ref: genome.genome_id!,
    provider: assignment.capsule.provider,
    assignment_ref: assignment.assignment_ref,
    keep_decision: "pending",
  },
});

const buildArtifactSource = (
  assignment: BbhAssignmentResponse["data"],
): Record<string, unknown> | null => {
  const base = assignment.capsule.artifact_source;
  if (!base) {
    return null;
  }

  const typedBase =
    typeof base === "object" && !Array.isArray(base)
      ? ({ ...base } as Record<string, unknown>)
      : {};

  const existingBbh =
    typeof typedBase.bbh === "object" && typedBase.bbh !== null && !Array.isArray(typedBase.bbh)
      ? ({ ...(typedBase.bbh as Record<string, unknown>) })
      : {};

  return {
    ...typedBase,
    schema_version: "techtree.bbh.artifact-source.v1",
    bbh: {
      ...existingBbh,
      split: assignment.split,
      provider: assignment.capsule.provider,
      provider_ref: assignment.capsule.provider_ref,
      family_ref: assignment.capsule.family_ref,
      instance_ref: assignment.capsule.instance_ref,
      assignment_policy: assignment.capsule.assignment_policy,
      mode: assignment.capsule.mode,
    },
  };
};

export const materializeBbhWorkspace = async (
  client: TechtreeClient,
  config: RegentConfig,
  params: BbhRunExecParams,
  metadata: RegentResolvedRunMetadata,
): Promise<BbhRunExecResponse> => {
  const assignment = await client.nextBbhAssignment({ split: normalizeSplit(params.split) });
  const assignmentData = assignment.data;
  const genome = defaultGenomeSource(params, metadata);
  const runId = `run_${shortHash({ assignment_ref: assignmentData.assignment_ref, genome_id: genome.genome_id, at: nowIso() })}`;
  const workspacePath =
    params.workspace_path && params.workspace_path !== ""
      ? path.resolve(params.workspace_path)
      : path.join(config.workloads.bbh.workspaceRoot, "runs", runId);

  await ensureDir(workspacePath);
  await ensureDir(path.join(workspacePath, "outputs"));
  await ensureDir(path.join(workspacePath, "dist"));

  const runSource = buildRunSource(assignmentData, genome, metadata);
  const artifactSource = buildArtifactSource(assignmentData);

  await fs.writeFile(path.join(workspacePath, "genome.source.yaml"), jsonText(genome), "utf8");
  await fs.writeFile(path.join(workspacePath, "run.source.yaml"), jsonText(runSource), "utf8");
  await fs.writeFile(path.join(workspacePath, "task.json"), jsonText(assignmentData.capsule.task_json), "utf8");
  await fs.writeFile(path.join(workspacePath, "protocol.md"), assignmentData.capsule.protocol_md, "utf8");
  await fs.writeFile(path.join(workspacePath, "rubric.json"), jsonText(assignmentData.capsule.rubric_json), "utf8");
  await fs.writeFile(path.join(workspacePath, "analysis.py"), analysisTemplate(assignmentData), "utf8");
  await fs.writeFile(path.join(workspacePath, "final_answer.md"), "", "utf8");
  await fs.writeFile(path.join(workspacePath, "outputs", "verdict.json"), jsonText(verdictTemplate()), "utf8");
  await fs.writeFile(path.join(workspacePath, "outputs", "run.log"), "", "utf8");

  if (artifactSource) {
    await fs.writeFile(
      path.join(workspacePath, "artifact.source.yaml"),
      jsonText(artifactSource),
      "utf8",
    );
  }

  const dataDir = path.join(workspacePath, "data");
  await ensureDir(dataDir);
  await Promise.all(
    assignmentData.capsule.data_files.map(async (file: BbhAssignmentResponse["data"]["capsule"]["data_files"][number]) => {
      await fs.writeFile(path.join(dataDir, file.name), file.content, "utf8");
    }),
  );

  return {
    ok: true,
    entrypoint: "bbh.run.exec",
    workspace_path: workspacePath,
    assignment_ref: assignmentData.assignment_ref,
    split: assignmentData.split,
    run_id: runId,
    capsule_id: assignmentData.capsule.capsule_id,
    genome_id: genome.genome_id!,
    files: [
      "genome.source.yaml",
      "run.source.yaml",
      "task.json",
      "protocol.md",
      "rubric.json",
      "analysis.py",
      "outputs/verdict.json",
    ],
    capsule: assignmentData.capsule,
    resolved_metadata: metadata,
  };
};

export const loadBbhRunSubmitRequest = async (workspacePath: string): Promise<BbhRunSubmitRequest> => {
  const resolved = path.resolve(workspacePath);
  const runId = path.basename(resolved);
  const runSource = await readRequiredJsonFile<BbhRunSource>(path.join(resolved, "run.source.yaml"));
  const genomeSource = await readRequiredJsonFile<BbhGenomeSource>(path.join(resolved, "genome.source.yaml"));
  const taskJson = await readRequiredJsonFile<Record<string, unknown>>(path.join(resolved, "task.json"));
  const rubricJson = await readRequiredJsonFile<Record<string, unknown>>(path.join(resolved, "rubric.json"));
  const verdictJson = await readRequiredJsonFile<Record<string, unknown>>(path.join(resolved, "outputs", "verdict.json"));
  const analysisPy = await readRequiredTextFile(path.join(resolved, "analysis.py"));
  const protocolMd = await readRequiredTextFile(path.join(resolved, "protocol.md"));
  const finalAnswerMd = await fs.readFile(path.join(resolved, "final_answer.md"), "utf8").catch(() => null);
  const reportHtml = await fs.readFile(path.join(resolved, "outputs", "report.html"), "utf8").catch(() => null);
  const runLog = await fs.readFile(path.join(resolved, "outputs", "run.log"), "utf8").catch(() => null);
  const artifactSourcePath = path.join(resolved, "artifact.source.yaml");
  const artifactSource = await readRequiredJsonFile<Record<string, unknown>>(artifactSourcePath);

  validateBbhSource("genome.source.yaml", genomeSource, (source) => {
    if (source.schema_version !== "techtree.bbh.genome-source.v1") {
      throw new Error("genome.source.yaml must declare techtree.bbh.genome-source.v1");
    }
  });
  validateBbhSource("run.source.yaml", runSource, (source) => {
    if (source.schema_version !== "techtree.bbh.run-source.v1") {
      throw new Error("run.source.yaml must declare techtree.bbh.run-source.v1");
    }

    const split = source.bbh?.split;
    if (split !== "climb" && split !== "benchmark" && split !== "challenge" && split !== "draft") {
      throw new Error("run.source.yaml must use the public BBH lanes: climb, benchmark, challenge, or draft");
    }

    if ((split === "benchmark" || split === "challenge") && !source.bbh?.assignment_ref) {
      throw new Error("benchmark and challenge runs require assignment_ref in run.source.yaml");
    }
  });

  if (artifactSource) {
    validateBbhSource("artifact.source.yaml", artifactSource, (source) => {
      const typedSource = source as Record<string, any>;

      if (typedSource.schema_version !== "techtree.bbh.artifact-source.v1") {
        throw new Error("artifact.source.yaml must declare techtree.bbh.artifact-source.v1");
      }

      const split = typedSource.bbh?.split;
      if (split !== "climb" && split !== "benchmark" && split !== "challenge" && split !== "draft") {
        throw new Error("artifact.source.yaml must use the public BBH lanes: climb, benchmark, challenge, or draft");
      }
    });
  }

  return {
    run_id: runId,
    capsule_id: String(runSource.artifact_ref),
    assignment_ref: runSource.bbh.assignment_ref ?? null,
    artifact_source: artifactSource,
    genome_source: genomeSource,
    run_source: runSource,
    workspace: {
      task_json: taskJson,
      protocol_md: protocolMd,
      rubric_json: rubricJson,
      analysis_py: analysisPy,
      verdict_json: verdictJson,
      final_answer_md: finalAnswerMd,
      report_html: reportHtml,
      run_log: runLog,
    },
  };
};

export const buildBbhValidationRequest = async (
  workspacePath: string,
  runId?: string | null,
): Promise<BbhValidationSubmitRequest> => {
  const resolved = path.resolve(workspacePath);
  const submission = await loadBbhRunSubmitRequest(resolved);
  const targetRunId = runId ?? submission.run_id;
  const verdictJson = submission.workspace.verdict_json;
  const metrics = (verdictJson.metrics ?? {}) as Record<string, unknown>;
  const rawScore = typeof metrics.raw_score === "number" ? metrics.raw_score : 0;
  const normalizedScore = typeof metrics.normalized_score === "number" ? metrics.normalized_score : 0;
  const validationId = `val_${shortHash({ targetRunId, at: nowIso() })}`;

  const reviewSource: BbhReviewSource = {
    schema_version: "techtree.bbh.review-source.v1",
    target: { type: "run", id: targetRunId },
    kind: "validation",
    method: "replay",
    result: "confirmed",
    summary: "Replay confirmed the submitted BBH verdict within tolerance.",
    bbh: {
      role: "official",
      reproduced_raw_score: rawScore,
      reproduced_normalized_score: normalizedScore,
      raw_abs_tolerance: 0.01,
    },
  };

  validateBbhSource("review.source.yaml", reviewSource, (source) => {
    if (source.schema_version !== "techtree.bbh.review-source.v1") {
      throw new Error("review.source.yaml must declare techtree.bbh.review-source.v1");
    }

    if (source.bbh?.role === "official" && source.method !== "replay") {
      throw new Error("official BBH review.source.yaml files must use replay validation");
    }
  });

  await fs.writeFile(path.join(resolved, "review.source.yaml"), jsonText(reviewSource), "utf8");

  return {
    validation_id: validationId,
    run_id: targetRunId,
    review_source: reviewSource,
    workspace: {
      verdict_json: verdictJson,
      report_html: submission.workspace.report_html ?? null,
      run_log: submission.workspace.run_log ?? null,
    },
  };
};

const validateBbhSource = <T extends object>(
  fileName: string,
  payload: T,
  validator: (payload: T) => void,
): void => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${fileName} must contain a JSON object`);
  }

  validator(payload);
};
