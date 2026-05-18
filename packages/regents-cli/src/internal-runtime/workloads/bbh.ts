import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  BbhAssignmentResponse,
  BbhDraftCreateRequest,
  BbhDraftProposalSubmitRequest,
  BbhDraftWorkspaceBundle,
  BbhReviewDecision,
  BbhReviewPacket,
  BbhReviewSubmitRequest,
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

const readOptionalJsonFile = async <T>(filePath: string): Promise<T | null> => {
  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    return await readJsonFile<T>(filePath);
  } catch {
    throw new Error(`invalid JSON in ${path.basename(filePath)}`);
  }
};

const readOptionalTextFile = async (filePath: string): Promise<string | null> => {
  if (!(await fileExists(filePath))) {
    return null;
  }

  return fs.readFile(filePath, "utf8");
};

const readRequiredTextFile = async (filePath: string): Promise<string> => {
  if (!(await fileExists(filePath))) {
    throw new Error(`missing required file: ${path.basename(filePath)}`);
  }

  return fs.readFile(filePath, "utf8");
};

const nowIso = (): string => new Date().toISOString();
const DEFAULT_SCORER_VERSION = "hypotest-v1";
const DEFAULT_SEARCH_SUMMARY_PATH = "outputs/skydiscover/search_summary.json";
const DEFAULT_SEARCH_LOG_PATH = "outputs/skydiscover/search.log";
const DEFAULT_BEST_PROGRAM_PATH = "outputs/skydiscover/best_program.py";
const DEFAULT_EVALUATOR_ARTIFACTS_PATH = "outputs/skydiscover/evaluator_artifacts.json";
const DEFAULT_CHECKPOINT_POINTER_PATH = "outputs/skydiscover/latest_checkpoint.txt";
const DEFAULT_BEST_SOLUTION_PATCH_PATH = "outputs/skydiscover/best_solution.patch";

const shortHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

const fullHash = (value: unknown): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

const fileHash = async (filePath: string): Promise<string> =>
  `sha256:${createHash("sha256").update(await fs.readFile(filePath)).digest("hex")}`;

const isNonEmptyRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;

const requireWorkspaceText = (value: unknown, field: string): string => {
  if (typeof value !== "string") {
    throw new Error(`server response missing required workspace field: ${field}`);
  }

  return value;
};

const requireWorkspaceJson = <T extends Record<string, unknown>>(value: unknown, field: string): T => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`server response missing required workspace field: ${field}`);
  }

  return value as T;
};

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

const isSkydiscoverSolver = (kind: string): boolean => kind === "skydiscover";

const executionDefaultsForAssignment = (
  assignment: BbhAssignmentResponse["data"],
): NonNullable<BbhAssignmentResponse["data"]["capsule"]["execution_defaults"]> | null => {
  return assignment.capsule.execution_defaults ?? null;
};

const defaultSolverKindForMetadata = (
  metadata: RegentResolvedRunMetadata,
): BbhRunSource["solver"]["kind"] => {
  if (metadata.executor_harness.kind === "hermes" || metadata.executor_harness.kind === "openclaw") {
    return metadata.executor_harness.kind;
  }

  throw new Error("BBH run workspaces require executor harness kind `hermes` or `openclaw`");
};

const bbhHarnessTypeForMetadata = (
  metadata: RegentResolvedRunMetadata,
): BbhGenomeSource["harness_type"] => {
  const kind = metadata.executor_harness.kind;
  if (kind === "openclaw" || kind === "hermes" || kind === "claude_code" || kind === "custom") {
    return kind;
  }

  throw new Error("BBH workspaces require executor harness kind `openclaw`, `hermes`, `claude_code`, or `custom`");
};

export const buildBbhGenomeSource = (
  params: BbhRunExecParams,
  metadata: RegentResolvedRunMetadata,
): BbhGenomeSource => {
  const partial = params.genome ?? {};
  const harnessType = partial.harness_type ?? bbhHarnessTypeForMetadata(metadata);
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

const loadGenomeSourceFromFile = async (filePath: string): Promise<BbhGenomeSource> => {
  const genomeSource = await readRequiredJsonFile<BbhGenomeSource>(path.resolve(filePath));

  validateBbhSource("genome source", genomeSource, (source) => {
    if (source.schema_version !== "techtree.bbh.genome-source.v1") {
      throw new Error("genome source must declare techtree.bbh.genome-source.v1");
    }
  });

  return genomeSource;
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

const marimoPyprojectToml = () => `[tool.marimo.runtime]
watcher_on_save = "autorun"
`;

const evaluatorShimTemplate = () =>
  `"""Hypotest adapter shim for SkyDiscover BBH workspaces."""

def evaluate(candidate_program_path, dataset_ref, capsule_data_ref=None):
    return {"combined_score": 0.0, "artifacts": []}
`;

const seedProgramTemplate = (capsuleId: string) =>
  `"""Seed program for SkyDiscover BBH search."""

CAPSULE_ID = "${capsuleId}"

# EVOLVE-BLOCK START
def solve(task):
    return {"status": "pending", "capsule_id": CAPSULE_ID, "task": task}
# EVOLVE-BLOCK END
`;

const buildSolverSource = (metadata: RegentResolvedRunMetadata): BbhRunSource["solver"] => ({
  kind: defaultSolverKindForMetadata(metadata),
  entrypoint: metadata.executor_harness.entrypoint ?? null,
});

const buildSearchSource = (metadata: RegentResolvedRunMetadata): NonNullable<BbhRunSource["search"]> => ({
  algorithm: metadata.executor_harness.kind,
  checkpoint_ref: null,
  summary: null,
});

const buildExecutorSource = (
  genome: BbhGenomeSource,
  metadata: RegentResolvedRunMetadata,
): BbhRunSource["executor"] => ({
  type: "genome",
  id: genome.genome_id ?? null,
  harness: bbhHarnessTypeForMetadata(metadata),
  harness_version: genome.harness_version,
  profile: metadata.executor_harness.profile,
});

const buildEvaluatorSource = (assignment: BbhAssignmentResponse["data"]): BbhRunSource["evaluator"] => {
  const defaults = executionDefaultsForAssignment(assignment);
  return {
    kind: defaults?.evaluator.kind ?? "hypotest",
    dataset_ref: defaults?.evaluator.dataset_ref ?? assignment.capsule.provider_ref,
    benchmark_ref:
      defaults?.evaluator.benchmark_ref ?? assignment.capsule.family_ref ?? assignment.capsule.capsule_id,
    scorer_version: defaults?.evaluator.scorer_version ?? DEFAULT_SCORER_VERSION,
  };
};

const buildRunPaths = (assignment: BbhAssignmentResponse["data"]): NonNullable<BbhRunSource["paths"]> => ({
  analysis_path: assignment.capsule.execution_defaults?.workspace.analysis_path ?? "analysis.py",
  verdict_path: assignment.capsule.execution_defaults?.workspace.verdict_path ?? "outputs/verdict.json",
  final_answer_path: assignment.capsule.execution_defaults?.workspace.final_answer_path ?? "final_answer.md",
  report_path: assignment.capsule.execution_defaults?.workspace.report_path ?? "outputs/report.html",
  log_path: assignment.capsule.execution_defaults?.workspace.log_path ?? "outputs/run.log",
  genome_path: assignment.capsule.execution_defaults?.workspace.genome_path ?? "genome.source.yaml",
  search_config_path: assignment.capsule.execution_defaults?.workspace.search_config_path ?? "search.config.yaml",
  evaluator_path: assignment.capsule.execution_defaults?.workspace.evaluator_path ?? "eval/hypotest_skydiscover.py",
  seed_program_path: assignment.capsule.execution_defaults?.workspace.seed_program_path ?? "solver/initial_program.py",
  best_program_path: assignment.capsule.execution_defaults?.workspace.best_program_path ?? DEFAULT_BEST_PROGRAM_PATH,
  search_summary_path:
    assignment.capsule.execution_defaults?.workspace.search_summary_path ?? DEFAULT_SEARCH_SUMMARY_PATH,
  evaluator_artifacts_path:
    assignment.capsule.execution_defaults?.workspace.evaluator_artifacts_path ?? DEFAULT_EVALUATOR_ARTIFACTS_PATH,
  checkpoint_pointer_path:
    assignment.capsule.execution_defaults?.workspace.checkpoint_pointer_path ?? DEFAULT_CHECKPOINT_POINTER_PATH,
  best_solution_patch_path:
    assignment.capsule.execution_defaults?.workspace.best_solution_patch_path ?? DEFAULT_BEST_SOLUTION_PATCH_PATH,
  search_log_path: assignment.capsule.execution_defaults?.workspace.search_log_path ?? DEFAULT_SEARCH_LOG_PATH,
});

const resolveRunSourcePaths = (runSource: BbhRunSource) => {
  const paths = runSource.paths ?? {};

  return {
    analysis_path: paths.analysis_path ?? "analysis.py",
    verdict_path: paths.verdict_path ?? "outputs/verdict.json",
    final_answer_path: paths.final_answer_path ?? "final_answer.md",
    report_path: paths.report_path ?? "outputs/report.html",
    log_path: paths.log_path ?? "outputs/run.log",
    genome_path: paths.genome_path ?? "genome.source.yaml",
    search_config_path: paths.search_config_path ?? "search.config.yaml",
    evaluator_path: paths.evaluator_path ?? "eval/hypotest_skydiscover.py",
    seed_program_path: paths.seed_program_path ?? "solver/initial_program.py",
    best_program_path: paths.best_program_path ?? DEFAULT_BEST_PROGRAM_PATH,
    search_summary_path: paths.search_summary_path ?? DEFAULT_SEARCH_SUMMARY_PATH,
    evaluator_artifacts_path: paths.evaluator_artifacts_path ?? DEFAULT_EVALUATOR_ARTIFACTS_PATH,
    checkpoint_pointer_path: paths.checkpoint_pointer_path ?? DEFAULT_CHECKPOINT_POINTER_PATH,
    best_solution_patch_path: paths.best_solution_patch_path ?? DEFAULT_BEST_SOLUTION_PATCH_PATH,
    search_log_path: paths.search_log_path ?? DEFAULT_SEARCH_LOG_PATH,
  };
};

const buildRunSource = (
  assignment: BbhAssignmentResponse["data"],
  genome: BbhGenomeSource,
  metadata: RegentResolvedRunMetadata,
): BbhRunSource => {
  const defaults = executionDefaultsForAssignment(assignment);
  const solverKind = defaults?.solver.kind ?? defaultSolverKindForMetadata(metadata);
  const evaluator = buildEvaluatorSource(assignment);
  const paths = buildRunPaths(assignment);

  return {
    schema_version: "techtree.bbh.run-source.v1",
    artifact_ref: assignment.capsule.capsule_id,
    executor: buildExecutorSource(genome, metadata),
    solver: {
      kind: solverKind,
      entrypoint: defaults?.solver.entrypoint ?? buildSolverSource(metadata).entrypoint,
    },
    ...(isSkydiscoverSolver(solverKind)
      ? {
          search: {
            algorithm: defaults?.solver.search_algorithm ?? buildSearchSource(metadata).algorithm,
            checkpoint_ref: null,
            summary: null,
          },
        }
      : {}),
    evaluator,
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
    paths,
    status: "completed",
    artifact_manifest: [],
    bbh: {
      split: assignment.split,
      genome_ref: genome.genome_id!,
      provider: assignment.capsule.provider,
      assignment_ref: assignment.assignment_ref,
      keep_decision: "pending",
    },
  };
};

const buildSearchConfig = (runSource: BbhRunSource): Record<string, unknown> => ({
  schema_version: "techtree.bbh.search-config.v1",
  solver: runSource.solver,
  search: runSource.search ?? { algorithm: runSource.solver.kind, checkpoint_ref: null, summary: null },
  evaluator: runSource.evaluator,
});

const searchSummaryTemplate = (runSource: BbhRunSource): Record<string, unknown> => ({
  best_score: 0,
  best_iteration: 0,
  iterations_requested: runSource.search?.budget ?? 1,
  iterations_completed: 0,
  total_evaluations: 0,
  elapsed_ms: 0,
  checkpoint_ref: runSource.search?.checkpoint_ref ?? null,
  artifact_keys: [
    "config_path",
    "summary_path",
    "log_path",
    "best_program_path",
    "evaluator_artifacts_path",
    "checkpoint_pointer_path",
    "best_solution_patch_path",
    "verdict_path",
  ],
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

const draftNotebookTemplate = (): string => `# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "marimo>=0.13.0",
# ]
# ///
import marimo

app = marimo.App()


@app.cell
def _():
    import marimo as mo
    return mo


@app.cell
def _(mo):
    mo.md(
        """
# Capsule draft

Use this notebook to shape the draft capsule locally before sending it to TechTree.
"""
    )
    return


if __name__ == "__main__":
    app.run()
`;

const draftCapsuleSourceTemplate = (): Record<string, unknown> => ({
  schema_version: "techtree.bbh.capsule-source.v1",
  kind: "capsule_draft",
  title: "Untitled BBH capsule",
  summary: "Draft capsule prepared locally with Regents CLI.",
  lane: "draft",
});

const draftGenomeSourceTemplate = (): Record<string, unknown> => ({
  schema_version: "techtree.bbh.genome-recommendation.v1",
  recommended_genome_id: null,
  notes: [],
});

const reviewSummaryTemplate = (): string => `# Review summary

State the decision, the key evidence, and any edits required before approval.
`;

const reviewChecklistTemplate = (): Record<string, unknown> => ({
  completeness: false,
  reproducibility: false,
  safety: false,
  notes: [],
});

const reviewSuggestedEditsTemplate = (): Record<string, unknown> => ({
  edits: [],
});

const reviewDecisionFromChecklist = (value: Record<string, unknown>): BbhReviewDecision => {
  const decision = value.decision;
  if (
    decision === "approve" ||
    decision === "approve_with_edits" ||
    decision === "changes_requested" ||
    decision === "reject"
  ) {
    return decision;
  }

  return "changes_requested";
};

const draftWorkspaceFiles = [
  "notebook.py",
  "hypothesis.md",
  "protocol.md",
  "rubric.json",
  "capsule.source.yaml",
  "genome/recommended.source.yaml",
  "genome/notes.md",
] as const;

const reviewWorkspaceFiles = [
  "review.request.json",
  "capsule.json",
  "notebook.py",
  "hypothesis.md",
  "protocol.md",
  "rubric.json",
  "genome-recommendation.source.json",
  "prior-proposals.json",
  "evidence-pack.json",
  "review.checklist.json",
  "suggested-edits.json",
  "summary.md",
  "certificate.payload.json",
] as const;

export const materializeBbhDraftWorkspace = async (
  workspacePath: string,
  bundle?: BbhDraftWorkspaceBundle | null,
): Promise<string[]> => {
  const resolved = path.resolve(workspacePath);
  await ensureDir(resolved);
  await ensureDir(path.join(resolved, "genome"));

  const source = bundle ?? {
    notebook_py: draftNotebookTemplate(),
    hypothesis_md: "",
    protocol_md: "",
    rubric_json: {},
    capsule_source: draftCapsuleSourceTemplate(),
    recommended_genome_source: draftGenomeSourceTemplate(),
    genome_notes_md: "",
  };

  await fs.writeFile(path.join(resolved, "notebook.py"), requireWorkspaceText(source.notebook_py, "notebook_py"), "utf8");
  await fs.writeFile(path.join(resolved, "hypothesis.md"), requireWorkspaceText(source.hypothesis_md, "hypothesis_md"), "utf8");
  await fs.writeFile(path.join(resolved, "protocol.md"), requireWorkspaceText(source.protocol_md, "protocol_md"), "utf8");
  await fs.writeFile(path.join(resolved, "rubric.json"), jsonText(requireWorkspaceJson(source.rubric_json, "rubric_json")), "utf8");
  await fs.writeFile(path.join(resolved, "capsule.source.yaml"), jsonText(requireWorkspaceJson(source.capsule_source, "capsule_source")), "utf8");
  await fs.writeFile(
    path.join(resolved, "genome", "recommended.source.yaml"),
    jsonText(
      source.recommended_genome_source === undefined || source.recommended_genome_source === null
        ? draftGenomeSourceTemplate()
        : requireWorkspaceJson(source.recommended_genome_source, "recommended_genome_source"),
    ),
    "utf8",
  );
  await fs.writeFile(path.join(resolved, "genome", "notes.md"), source.genome_notes_md ?? "", "utf8");

  return [...draftWorkspaceFiles];
};

export const loadBbhDraftCreateRequest = async (workspacePath: string, args: {
  title: string;
  seed?: string | null;
  parent_id?: number | null;
}): Promise<BbhDraftCreateRequest> => {
  const resolved = path.resolve(workspacePath);
  const workspace = {
    notebook_py: await readRequiredTextFile(path.join(resolved, "notebook.py")),
    hypothesis_md: await readRequiredTextFile(path.join(resolved, "hypothesis.md")),
    protocol_md: await readRequiredTextFile(path.join(resolved, "protocol.md")),
    rubric_json: await readRequiredJsonFile<Record<string, unknown>>(path.join(resolved, "rubric.json")),
    capsule_source: await readRequiredJsonFile<Record<string, unknown>>(path.join(resolved, "capsule.source.yaml")),
    recommended_genome_source: await readRequiredJsonFile<Record<string, unknown>>(
      path.join(resolved, "genome", "recommended.source.yaml"),
    ),
    genome_notes_md: await fs.readFile(path.join(resolved, "genome", "notes.md"), "utf8").catch(() => ""),
  } satisfies BbhDraftWorkspaceBundle;

  return {
    title: args.title,
    ...(args.seed ? { seed: args.seed } : {}),
    ...(args.parent_id ? { parent_id: args.parent_id } : {}),
    workspace,
  };
};

export const loadBbhDraftProposalRequest = async (
  workspacePath: string,
  summary: string,
): Promise<BbhDraftProposalSubmitRequest> => {
  const createRequest = await loadBbhDraftCreateRequest(workspacePath, { title: path.basename(path.resolve(workspacePath)) });

  return {
    summary,
    workspace: createRequest.workspace,
    workspace_manifest_hash: fullHash(createRequest.workspace),
  };
};

export const materializeBbhReviewWorkspace = async (
  workspacePath: string,
  packet: BbhReviewPacket,
): Promise<string[]> => {
  const resolved = path.resolve(workspacePath);
  await ensureDir(resolved);

  await fs.writeFile(path.join(resolved, "review.request.json"), jsonText(packet.request), "utf8");
  await fs.writeFile(path.join(resolved, "capsule.json"), jsonText(packet.capsule), "utf8");
  await fs.writeFile(path.join(resolved, "notebook.py"), requireWorkspaceText(packet.workspace.notebook_py, "notebook_py"), "utf8");
  await fs.writeFile(path.join(resolved, "hypothesis.md"), requireWorkspaceText(packet.workspace.hypothesis_md, "hypothesis_md"), "utf8");
  await fs.writeFile(path.join(resolved, "protocol.md"), requireWorkspaceText(packet.workspace.protocol_md, "protocol_md"), "utf8");
  await fs.writeFile(path.join(resolved, "rubric.json"), jsonText(requireWorkspaceJson(packet.workspace.rubric_json, "rubric_json")), "utf8");
  await fs.writeFile(
    path.join(resolved, "genome-recommendation.source.json"),
    jsonText(packet.workspace.recommended_genome_source ?? {}),
    "utf8",
  );
  await fs.writeFile(path.join(resolved, "prior-proposals.json"), jsonText(packet.prior_proposals), "utf8");
  await fs.writeFile(path.join(resolved, "evidence-pack.json"), jsonText(packet.evidence_pack_summary ?? {}), "utf8");
  await fs.writeFile(
    path.join(resolved, "review.checklist.json"),
    jsonText(packet.checklist_template ?? reviewChecklistTemplate()),
    "utf8",
  );
  await fs.writeFile(path.join(resolved, "suggested-edits.json"), jsonText(reviewSuggestedEditsTemplate()), "utf8");
  await fs.writeFile(path.join(resolved, "summary.md"), reviewSummaryTemplate(), "utf8");
  await fs.writeFile(path.join(resolved, "certificate.payload.json"), jsonText(packet.certificate_payload ?? {}), "utf8");

  return [...reviewWorkspaceFiles];
};

export const loadBbhReviewSubmitRequest = async (workspacePath: string): Promise<BbhReviewSubmitRequest> => {
  const resolved = path.resolve(workspacePath);
  const request = await readRequiredJsonFile<{ request_id: string; capsule_id: string }>(path.join(resolved, "review.request.json"));
  const checklist = await readRequiredJsonFile<Record<string, unknown>>(path.join(resolved, "review.checklist.json"));
  const suggestedEdits = await readRequiredJsonFile<Record<string, unknown>>(path.join(resolved, "suggested-edits.json"));
  const summary = await readRequiredTextFile(path.join(resolved, "summary.md"));
  const certificatePayload = await readRequiredJsonFile<Record<string, unknown>>(
    path.join(resolved, "certificate.payload.json"),
  ).catch(() => ({}));
  const genomeRecommendationSource = await readRequiredJsonFile<Record<string, unknown>>(
    path.join(resolved, "genome-recommendation.source.json"),
  ).catch(() => null);

  return {
    request_id: request.request_id,
    capsule_id: request.capsule_id,
    checklist_json: checklist,
    suggested_edits_json: suggestedEdits,
    decision: reviewDecisionFromChecklist(checklist),
    summary_md: summary,
    ...(isNonEmptyRecord(genomeRecommendationSource) ? { genome_recommendation_source: genomeRecommendationSource } : {}),
    ...(certificatePayload && Object.keys(certificatePayload).length > 0 ? { certificate_payload: certificatePayload } : {}),
  };
};

export const materializeBbhWorkspace = async (
  client: TechtreeClient,
  config: RegentConfig,
  params: BbhRunExecParams,
  metadata: RegentResolvedRunMetadata,
): Promise<BbhRunExecResponse> => {
  const assignment = params.capsule_id
    ? await client.selectBbhAssignment({ capsule_id: params.capsule_id })
    : await client.nextBbhAssignment({ split: normalizeSplit(params.split) });
  const assignmentData = assignment.data;

  if (params.capsule_id && params.split && assignmentData.split !== params.split) {
    throw new Error(
      `selected capsule ${params.capsule_id} uses lane ${assignmentData.split}, which does not match requested lane ${params.split}`,
    );
  }

  const genome =
    params.genome_path && params.genome_path !== ""
      ? await loadGenomeSourceFromFile(params.genome_path)
      : buildBbhGenomeSource(params, metadata);
  const runId = `run_${shortHash({ assignment_ref: assignmentData.assignment_ref, genome_id: genome.genome_id, at: nowIso() })}`;
  const workspacePath =
    params.workspace_path && params.workspace_path !== ""
      ? path.resolve(params.workspace_path)
      : path.join(config.workloads.bbh.workspaceRoot, "runs", runId);

  await ensureDir(workspacePath);
  await ensureDir(path.join(workspacePath, "dist"));

  const runSource = buildRunSource(assignmentData, genome, metadata);
  const searchConfig = buildSearchConfig(runSource);
  const artifactSource = buildArtifactSource(assignmentData);
  const paths = runSource.paths ?? {};
  const analysisPath = path.join(workspacePath, paths.analysis_path ?? "analysis.py");
  const verdictPath = path.join(workspacePath, paths.verdict_path ?? "outputs/verdict.json");
  const finalAnswerPath = path.join(workspacePath, paths.final_answer_path ?? "final_answer.md");
  const reportPath = path.join(workspacePath, paths.report_path ?? "outputs/report.html");
  const runLogPath = path.join(workspacePath, paths.log_path ?? "outputs/run.log");
  const genomePath = path.join(workspacePath, paths.genome_path ?? "genome.source.yaml");
  const searchConfigPath = path.join(workspacePath, paths.search_config_path ?? "search.config.yaml");
  const evaluatorPath = path.join(workspacePath, paths.evaluator_path ?? "eval/hypotest_skydiscover.py");
  const seedProgramPath = path.join(workspacePath, paths.seed_program_path ?? "solver/initial_program.py");
  const bestProgramPath = path.join(workspacePath, paths.best_program_path ?? DEFAULT_BEST_PROGRAM_PATH);
  const searchSummaryPath = path.join(workspacePath, paths.search_summary_path ?? DEFAULT_SEARCH_SUMMARY_PATH);
  const evaluatorArtifactsPath = path.join(
    workspacePath,
    paths.evaluator_artifacts_path ?? DEFAULT_EVALUATOR_ARTIFACTS_PATH,
  );
  const checkpointPointerPath = path.join(
    workspacePath,
    paths.checkpoint_pointer_path ?? DEFAULT_CHECKPOINT_POINTER_PATH,
  );
  const bestSolutionPatchPath = path.join(
    workspacePath,
    paths.best_solution_patch_path ?? DEFAULT_BEST_SOLUTION_PATCH_PATH,
  );
  const searchLogPath = path.join(workspacePath, paths.search_log_path ?? DEFAULT_SEARCH_LOG_PATH);

  await Promise.all([
    ensureDir(path.dirname(verdictPath)),
    ensureDir(path.dirname(reportPath)),
    ensureDir(path.dirname(runLogPath)),
    ensureDir(path.dirname(searchConfigPath)),
    ensureDir(path.dirname(evaluatorPath)),
    ensureDir(path.dirname(seedProgramPath)),
    ensureDir(path.dirname(bestProgramPath)),
    ensureDir(path.dirname(searchSummaryPath)),
    ensureDir(path.dirname(evaluatorArtifactsPath)),
    ensureDir(path.dirname(checkpointPointerPath)),
    ensureDir(path.dirname(bestSolutionPatchPath)),
    ensureDir(path.dirname(searchLogPath)),
  ]);

  await fs.writeFile(genomePath, jsonText(genome), "utf8");
  await fs.writeFile(path.join(workspacePath, "run.source.yaml"), jsonText(runSource), "utf8");
  await fs.writeFile(searchConfigPath, jsonText(searchConfig), "utf8");
  await fs.writeFile(path.join(workspacePath, "task.json"), jsonText(assignmentData.capsule.task_json), "utf8");
  await fs.writeFile(path.join(workspacePath, "protocol.md"), assignmentData.capsule.protocol_md, "utf8");
  await fs.writeFile(path.join(workspacePath, "rubric.json"), jsonText(assignmentData.capsule.rubric_json), "utf8");
  await fs.writeFile(analysisPath, analysisTemplate(assignmentData), "utf8");
  await fs.writeFile(evaluatorPath, evaluatorShimTemplate(), "utf8");
  await fs.writeFile(seedProgramPath, seedProgramTemplate(assignmentData.capsule.capsule_id), "utf8");
  await fs.writeFile(bestProgramPath, seedProgramTemplate(assignmentData.capsule.capsule_id), "utf8");
  await fs.writeFile(path.join(workspacePath, "pyproject.toml"), marimoPyprojectToml(), "utf8");
  await fs.writeFile(finalAnswerPath, "", "utf8");
  await fs.writeFile(verdictPath, jsonText(verdictTemplate()), "utf8");
  await fs.writeFile(runLogPath, "", "utf8");
  await fs.writeFile(searchLogPath, "", "utf8");
  await fs.writeFile(searchSummaryPath, jsonText(searchSummaryTemplate(runSource)), "utf8");
  await fs.writeFile(evaluatorArtifactsPath, jsonText({ combined_score: 0, artifacts: [] }), "utf8");
  await fs.writeFile(checkpointPointerPath, "", "utf8");
  await fs.writeFile(bestSolutionPatchPath, "", "utf8");

  runSource.artifact_manifest = await Promise.all(
    [
      { path: analysisPath, kind: "workspace_file" as const, required_for_validation: false },
      { path: searchConfigPath, kind: "workspace_file" as const, required_for_validation: true },
      { path: evaluatorPath, kind: "workspace_file" as const, required_for_validation: true },
      { path: seedProgramPath, kind: "workspace_file" as const, required_for_validation: true },
      { path: bestProgramPath, kind: "generated_output" as const, required_for_validation: true },
      { path: searchSummaryPath, kind: "generated_output" as const, required_for_validation: true },
      { path: evaluatorArtifactsPath, kind: "generated_output" as const, required_for_validation: true },
      { path: checkpointPointerPath, kind: "checkpoint_pointer" as const, required_for_validation: false },
      { path: bestSolutionPatchPath, kind: "generated_output" as const, required_for_validation: false },
      { path: verdictPath, kind: "generated_output" as const, required_for_validation: true },
    ].map(async (entry) => ({
      path: path.relative(workspacePath, entry.path),
      kind: entry.kind,
      sha256: await fileHash(entry.path),
      size_bytes: (await fs.stat(entry.path)).size,
      required_for_validation: entry.required_for_validation,
    })),
  );
  await fs.writeFile(path.join(workspacePath, "run.source.yaml"), jsonText(runSource), "utf8");

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
      path.relative(workspacePath, genomePath),
      "run.source.yaml",
      path.relative(workspacePath, searchConfigPath),
      "task.json",
      "protocol.md",
      "rubric.json",
      path.relative(workspacePath, analysisPath),
      path.relative(workspacePath, evaluatorPath),
      path.relative(workspacePath, seedProgramPath),
      "pyproject.toml",
      path.relative(workspacePath, verdictPath),
      path.relative(workspacePath, runLogPath),
      path.relative(workspacePath, searchLogPath),
      path.relative(workspacePath, searchSummaryPath),
      path.relative(workspacePath, bestProgramPath),
      path.relative(workspacePath, evaluatorArtifactsPath),
      path.relative(workspacePath, checkpointPointerPath),
      path.relative(workspacePath, bestSolutionPatchPath),
    ],
    capsule: assignmentData.capsule,
    resolved_metadata: metadata,
  };
};

export const loadBbhRunSubmitRequest = async (workspacePath: string): Promise<BbhRunSubmitRequest> => {
  const resolved = path.resolve(workspacePath);
  const runId = path.basename(resolved);
  const runSource = await readRequiredJsonFile<BbhRunSource>(path.join(resolved, "run.source.yaml"));
  const paths = resolveRunSourcePaths(runSource);
  const genomeSource = await readRequiredJsonFile<BbhGenomeSource>(path.join(resolved, paths.genome_path));
  const taskJson = await readRequiredJsonFile<Record<string, unknown>>(path.join(resolved, "task.json"));
  const rubricJson = await readRequiredJsonFile<Record<string, unknown>>(path.join(resolved, "rubric.json"));
  const verdictJson = await readRequiredJsonFile<Record<string, unknown>>(
    path.join(resolved, paths.verdict_path),
  );
  const searchSummaryJson = await readOptionalJsonFile<Record<string, unknown>>(
    path.join(resolved, paths.search_summary_path),
  );
  const analysisPy = await readRequiredTextFile(path.join(resolved, paths.analysis_path));
  const protocolMd = await readRequiredTextFile(path.join(resolved, "protocol.md"));
  const finalAnswerMd = await fs
    .readFile(path.join(resolved, paths.final_answer_path), "utf8")
    .catch(() => null);
  const reportHtml = await fs
    .readFile(path.join(resolved, paths.report_path), "utf8")
    .catch(() => null);
  const runLog = await fs.readFile(path.join(resolved, paths.log_path), "utf8").catch(() => null);
  const searchLog = await readOptionalTextFile(path.join(resolved, paths.search_log_path));
  const artifactSourcePath = path.join(resolved, "artifact.source.yaml");
  const artifactSource = await readOptionalJsonFile<Record<string, unknown>>(artifactSourcePath);

  validateBbhSource("genome.source.yaml", genomeSource, (source) => {
    if (source.schema_version !== "techtree.bbh.genome-source.v1") {
      throw new Error("genome.source.yaml must declare techtree.bbh.genome-source.v1");
    }
  });
  validateBbhSource("run.source.yaml", runSource, (source) => {
    if (source.schema_version !== "techtree.bbh.run-source.v1") {
      throw new Error("run.source.yaml must declare techtree.bbh.run-source.v1");
    }

    if (!source.executor || typeof source.executor !== "object" || Array.isArray(source.executor)) {
      throw new Error("run.source.yaml must include executor metadata");
    }
    if (!source.solver || typeof source.solver !== "object" || Array.isArray(source.solver)) {
      throw new Error("run.source.yaml must include solver metadata");
    }
    if (!source.evaluator || typeof source.evaluator !== "object" || Array.isArray(source.evaluator)) {
      throw new Error("run.source.yaml must include evaluator metadata");
    }

    if (source.executor.type !== "genome" && source.executor.type !== "actor" && source.executor.type !== "system") {
      throw new Error("run.source.yaml must include an executor type");
    }
    if (typeof source.executor.harness !== "string" || source.executor.harness.trim() === "") {
      throw new Error("run.source.yaml must include an executor harness");
    }
    if (typeof source.executor.harness_version !== "string" || source.executor.harness_version.trim() === "") {
      throw new Error("run.source.yaml must include an executor harness_version");
    }
    if (typeof source.solver.kind !== "string" || source.solver.kind.trim() === "") {
      throw new Error("run.source.yaml must include a solver kind");
    }
    if (typeof source.evaluator.kind !== "string" || source.evaluator.kind.trim() === "") {
      throw new Error("run.source.yaml must include an evaluator kind");
    }
    if (typeof source.evaluator.dataset_ref !== "string" || source.evaluator.dataset_ref.trim() === "") {
      throw new Error("run.source.yaml must include an evaluator dataset_ref");
    }
    if (typeof source.evaluator.scorer_version !== "string" || source.evaluator.scorer_version.trim() === "") {
      throw new Error("run.source.yaml must include an evaluator scorer_version");
    }

    // Search metadata belongs only to the SkyDiscover path; direct notebook runners
    // still submit the same BBH shape, but without a search block.
    if (isSkydiscoverSolver(source.solver.kind)) {
      if (!source.search || typeof source.search !== "object" || Array.isArray(source.search)) {
        throw new Error("run.source.yaml must include search metadata for skydiscover runs");
      }
      if (typeof source.search.algorithm !== "string" || source.search.algorithm.trim() === "") {
        throw new Error("run.source.yaml must include a search algorithm");
      }
    } else if (source.search !== undefined && source.search !== null) {
      throw new Error("run.source.yaml may include search metadata only for skydiscover runs");
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
    artifact_source: artifactSource ?? null,
    genome_source: genomeSource,
    run_source: runSource,
    workspace: {
      task_json: taskJson,
      protocol_md: protocolMd,
      rubric_json: rubricJson,
      analysis_py: analysisPy,
      verdict_json: verdictJson,
      search_summary_json: searchSummaryJson,
      search_log: searchLog,
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
  const runPaths = submission.run_source.paths ?? {};
  const targetRunId = runId ?? submission.run_id;
  const verdictJson = submission.workspace.verdict_json;
  const metrics = (verdictJson.metrics ?? {}) as Record<string, unknown>;
  const rawScore = typeof metrics.raw_score === "number" ? metrics.raw_score : 0;
  const normalizedScore = typeof metrics.normalized_score === "number" ? metrics.normalized_score : 0;
  const validationId = `val_${shortHash({ targetRunId, at: nowIso() })}`;
  const bestProgramPath = path.join(resolved, runPaths.best_program_path ?? DEFAULT_BEST_PROGRAM_PATH);
  const submittedProgramSha = (await fileExists(bestProgramPath)) ? await fileHash(bestProgramPath) : null;

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
      evaluator_kind: submission.run_source.evaluator.kind,
      dataset_ref: submission.run_source.evaluator.dataset_ref,
      scorer_version: submission.run_source.evaluator.scorer_version ?? DEFAULT_SCORER_VERSION,
      assignment_ref: submission.assignment_ref ?? submission.run_source.bbh.assignment_ref ?? null,
      submitted_program_sha256: submittedProgramSha,
      reproduced_program_sha256: submittedProgramSha,
      score_match: true,
      artifact_match: true,
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
      search_summary_json: submission.workspace.search_summary_json ?? null,
      search_log: submission.workspace.search_log ?? null,
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
