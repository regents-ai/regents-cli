import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  RegentHarnessConfig,
  ScienceTaskChecklistEntry,
  ScienceTaskChecklistUpdateInput,
  ScienceTaskDetail,
  ScienceTaskEvidenceUpdateInput,
  ScienceTaskPacketFile,
  ScienceTaskReviewUpdateInput,
  ScienceTaskRunEvidence,
  ScienceTaskSubmitInput,
} from "../../internal-types/index.js";
import { buildSafeSubprocessEnv } from "../safe-subprocess-env.js";

const SCIENCE_TASK_METADATA_FILE = "science-task.json";
const DIST_FOLDER = "dist";
const HARBOR_REVIEW_LOOP_OUTPUT_FILE = path.join(DIST_FOLDER, "harbor-review-loop.json");
const HARBOR_REVIEW_LOOP_LOG_FOLDER = path.join(DIST_FOLDER, "harbor-review-loop");
const HARBOR_REVIEW_LOOP_SCHEMA_VERSION = "techtree.science-task.harbor-review-loop.v1";
const DEFAULT_REVIEW_LOOP_TIMEOUT_SECONDS = 1800;

const CHECKLIST_LABELS: Record<string, string> = {
  instruction_and_tests_match: "instruction and tests match exactly",
  tests_do_not_check_hidden_behavior: "tests do not check hidden behavior",
  structured_output_described_exactly: "structured output is described exactly when needed",
  difficulty_comes_from_work: "difficulty comes from the work, not vague wording",
  expert_time_is_believable: "expert time claim is believable",
  thresholds_are_defended: "thresholds are defended",
  hidden_answers_not_easy_to_fetch: "hidden answers are not easy to read or fetch",
  dependencies_pinned_when_needed: "dependencies are pinned when they matter",
  environment_reproducible_for_reruns: "the environment is reproducible enough for reruns",
  schema_and_policy_details_correct: "schema and policy details are correct",
  canary_requirements_met: "canary requirements are met",
  unrelated_file_drift_absent: "unrelated file drift is absent",
  oracle_evidence_exists: "oracle evidence exists with exact command",
  frontier_evidence_exists: "frontier evidence exists with exact command",
  failure_analysis_is_honest: "failure analysis explains agent limits without hiding task flaws",
  open_reviewer_concerns_answered: "every open Harbor reviewer concern has a direct answer",
};

const DEFAULT_PACKET_FILES: Record<string, string> = {
  "instruction.md": "# Task instruction\n\nDescribe the full behavior the agent must deliver.\n",
  "task.toml": `# Harbor task metadata
name = "replace-me"
`,
  "environment/Dockerfile": `FROM python:3.12-slim

WORKDIR /workspace
COPY . /workspace
`,
  "tests/test.sh": `#!/usr/bin/env bash
set -euo pipefail

python -m pytest tests/test_task.py
`,
  "tests/test_task.py": `def test_placeholder():
    assert True
`,
  "solution-notes.md": "# Solution notes\n\nWrite the reference solution outline here.\n",
  "scripts/README.md": "# Helper scripts\n\nList task-local helper scripts here.\n",
  "task-notes.md": `# Task notes

Record what reviewers need to know before rerunning this task.

- Exact local checks:
- Oracle run:
- Frontier run:
- Known review concerns:
`,
};

interface ScienceTaskWorkspaceMetadata {
  schema_version: "techtree.science-task.v1";
  node_id?: number;
  title: string;
  summary?: string | null;
  science_domain: string;
  science_field: string;
  task_slug: string;
  structured_output_shape?: Record<string, unknown> | null;
  claimed_expert_time: string;
  threshold_rationale?: string | null;
  anti_cheat_notes: string;
  reproducibility_notes: string;
  dependency_pinning_status: string;
  canary_status: string;
  failure_analysis: string;
  checklist: Record<string, ScienceTaskChecklistEntry>;
  oracle_run?: ScienceTaskRunEvidence | null;
  frontier_run?: ScienceTaskRunEvidence | null;
  harbor_pr_url?: string | null;
  latest_review_follow_up_note?: string | null;
  open_reviewer_concerns_count: number;
  any_concern_unanswered: boolean;
  latest_rerun_after_latest_fix: boolean;
  latest_fix_at?: string | null;
  last_rerun_at?: string | null;
}

interface ScienceTaskReviewLoopOutput {
  schema_version: typeof HARBOR_REVIEW_LOOP_SCHEMA_VERSION;
  checklist: Record<string, ScienceTaskChecklistEntry>;
  oracle_run: ScienceTaskRunEvidence;
  frontier_run: ScienceTaskRunEvidence;
  failure_analysis: string;
  review: {
    harbor_pr_url: string;
    latest_review_follow_up_note?: string | null;
    open_reviewer_concerns_count: number;
    any_concern_unanswered: boolean;
    latest_rerun_after_latest_fix: boolean;
    latest_fix_at?: string | null;
    last_rerun_at?: string | null;
  };
}

export interface ScienceTaskReviewLoopInvocation {
  entrypoint: string;
  args: string[];
  cwd: string;
  prompt: string;
  output_path: string;
  log_path: string;
  timeout_seconds: number;
}

export interface ScienceTaskReviewLoopRunResult {
  exitCode: number;
  timedOut?: boolean;
}

export type ScienceTaskHermesRunner = (
  invocation: ScienceTaskReviewLoopInvocation,
) => Promise<ScienceTaskReviewLoopRunResult>;

export interface ScienceTaskReviewLoopResult {
  workspace_path: string;
  node_id: number;
  harbor_pr_url: string;
  output_path: string;
  log_path: string;
}

const ensureDir = async (targetPath: string): Promise<void> => {
  await fs.mkdir(targetPath, { recursive: true });
};

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`invalid ${label}`);
  }

  return value;
};

const requireStringField = (record: Record<string, unknown>, field: string): string => {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`invalid ${field}`);
  }

  return value;
};

const optionalStringField = (record: Record<string, unknown>, field: string): string | null => {
  const value = record[field];
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`invalid ${field}`);
  }

  return value;
};

const optionalTimestampField = (record: Record<string, unknown>, field: string): string | null => {
  const value = optionalStringField(record, field);
  if (value === null || value.trim() === "") {
    return null;
  }

  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`invalid ${field}`);
  }

  return value;
};

const requireBooleanField = (record: Record<string, unknown>, field: string): boolean => {
  const value = record[field];
  if (typeof value !== "boolean") {
    throw new Error(`invalid ${field}`);
  }

  return value;
};

const requireNonNegativeIntegerField = (record: Record<string, unknown>, field: string): number => {
  const value = record[field];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`invalid ${field}`);
  }

  return Number(value);
};

const validateChecklistOutput = (value: unknown): Record<string, ScienceTaskChecklistEntry> => {
  const record = requireRecord(value, "checklist");
  const knownKeys = Object.keys(CHECKLIST_LABELS);
  const receivedKeys = Object.keys(record);
  const unexpectedKey = receivedKeys.find((key) => !knownKeys.includes(key));
  if (unexpectedKey) {
    throw new Error(`invalid checklist key: ${unexpectedKey}`);
  }

  return knownKeys.reduce<Record<string, ScienceTaskChecklistEntry>>((acc, key) => {
    const entry = requireRecord(record[key], `checklist.${key}`);
    const status = entry.status;
    if (status !== "pass" && status !== "fail" && status !== "unknown") {
      throw new Error(`invalid checklist status for ${key}`);
    }

    const note = optionalStringField(entry, "note");
    acc[key] = {
      status,
      ...(note ? { note } : {}),
    };
    return acc;
  }, {});
};

const validateRunEvidenceOutput = (value: unknown, label: string): ScienceTaskRunEvidence => {
  const record = requireRecord(value, label);
  const keyLines = record.key_lines;
  if (
    keyLines !== undefined &&
    (!Array.isArray(keyLines) || keyLines.some((line) => typeof line !== "string"))
  ) {
    throw new Error(`invalid ${label}.key_lines`);
  }

  return {
    command: requireStringField(record, "command"),
    summary: requireStringField(record, "summary"),
    ...(Array.isArray(keyLines) ? { key_lines: keyLines } : {}),
  };
};

const validateReviewLoopOutput = (value: unknown): ScienceTaskReviewLoopOutput => {
  const record = requireRecord(value, "review loop output");
  if (record.schema_version !== HARBOR_REVIEW_LOOP_SCHEMA_VERSION) {
    throw new Error("invalid review loop schema version");
  }

  const review = requireRecord(record.review, "review");
  return {
    schema_version: HARBOR_REVIEW_LOOP_SCHEMA_VERSION,
    checklist: validateChecklistOutput(record.checklist),
    oracle_run: validateRunEvidenceOutput(record.oracle_run, "oracle_run"),
    frontier_run: validateRunEvidenceOutput(record.frontier_run, "frontier_run"),
    failure_analysis: requireStringField(record, "failure_analysis"),
    review: {
      harbor_pr_url: requireStringField(review, "harbor_pr_url"),
      latest_review_follow_up_note: optionalStringField(review, "latest_review_follow_up_note"),
      open_reviewer_concerns_count: requireNonNegativeIntegerField(
        review,
        "open_reviewer_concerns_count",
      ),
      any_concern_unanswered: requireBooleanField(review, "any_concern_unanswered"),
      latest_rerun_after_latest_fix: requireBooleanField(review, "latest_rerun_after_latest_fix"),
      latest_fix_at: optionalTimestampField(review, "latest_fix_at"),
      last_rerun_at: optionalTimestampField(review, "last_rerun_at"),
    },
  };
};

const normalizeChecklist = (
  value?: Record<string, ScienceTaskChecklistEntry> | null,
): Record<string, ScienceTaskChecklistEntry> =>
  Object.keys(CHECKLIST_LABELS).reduce<Record<string, ScienceTaskChecklistEntry>>((acc, key) => {
    const entry = value?.[key];
    acc[key] = {
      status: entry?.status ?? "unknown",
      ...(entry?.note ? { note: entry.note } : {}),
    };
    return acc;
  }, {});

const defaultMetadata = (overrides: {
  title?: string;
  summary?: string;
  science_domain?: string;
  science_field?: string;
  task_slug?: string;
  claimed_expert_time?: string;
}): ScienceTaskWorkspaceMetadata => ({
  schema_version: "techtree.science-task.v1",
  title: overrides.title ?? "Science task draft",
  summary: overrides.summary ?? "Harbor-ready science benchmark task draft.",
  science_domain: overrides.science_domain ?? "life-sciences",
  science_field: overrides.science_field ?? "biology",
  task_slug: overrides.task_slug ?? "replace-me",
  claimed_expert_time: overrides.claimed_expert_time ?? "2 hours",
  threshold_rationale: "Document why each threshold is defensible.",
  anti_cheat_notes: "Explain how the hidden answer stays out of easy reach.",
  reproducibility_notes: "Record the steps that make reruns deterministic enough for review.",
  dependency_pinning_status: "List pinned dependencies and note any intentional exceptions.",
  canary_status: "Document required canary strings and where they appear.",
  failure_analysis: "Explain why this task is still valid even if the frontier model fails.",
  checklist: normalizeChecklist(),
  oracle_run: null,
  frontier_run: null,
  harbor_pr_url: null,
  latest_review_follow_up_note: null,
  open_reviewer_concerns_count: 0,
  any_concern_unanswered: false,
  latest_rerun_after_latest_fix: false,
  latest_fix_at: null,
  last_rerun_at: null,
});

export const initScienceTaskWorkspace = async (
  workspacePath: string,
  overrides: {
    title?: string;
    summary?: string;
    science_domain?: string;
    science_field?: string;
    task_slug?: string;
    claimed_expert_time?: string;
  },
): Promise<string[]> => {
  const resolved = path.resolve(workspacePath);
  await ensureDir(resolved);
  await ensureDir(path.join(resolved, "environment"));
  await ensureDir(path.join(resolved, "tests"));
  await ensureDir(path.join(resolved, "scripts"));

  for (const [relativePath, contents] of Object.entries(DEFAULT_PACKET_FILES)) {
    const targetPath = path.join(resolved, relativePath);
    if (!(await fileExists(targetPath))) {
      await ensureDir(path.dirname(targetPath));
      await fs.writeFile(targetPath, contents, "utf8");
    }
    if (relativePath === "tests/test.sh") {
      await fs.chmod(targetPath, 0o755);
    }
  }

  const metadataPath = path.join(resolved, SCIENCE_TASK_METADATA_FILE);
  const metadata = (await fileExists(metadataPath))
    ? await readScienceTaskWorkspaceMetadata(resolved)
    : defaultMetadata(overrides);

  await writeScienceTaskWorkspaceMetadata(resolved, {
    ...metadata,
    ...overrides,
    checklist: normalizeChecklist(metadata.checklist),
  });

  return [
    ...Object.keys(DEFAULT_PACKET_FILES),
    SCIENCE_TASK_METADATA_FILE,
  ].sort();
};

export const readScienceTaskWorkspaceMetadata = async (
  workspacePath: string,
): Promise<ScienceTaskWorkspaceMetadata> => {
  const metadataPath = path.join(path.resolve(workspacePath), SCIENCE_TASK_METADATA_FILE);
  const raw = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Partial<ScienceTaskWorkspaceMetadata>;

  return {
    ...defaultMetadata({}),
    ...raw,
    checklist: normalizeChecklist(raw.checklist),
  };
};

export const writeScienceTaskWorkspaceMetadata = async (
  workspacePath: string,
  metadata: ScienceTaskWorkspaceMetadata,
): Promise<void> => {
  await fs.writeFile(
    path.join(path.resolve(workspacePath), SCIENCE_TASK_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
};

export const scienceTaskReviewLoopOutputPath = (workspacePath: string): string =>
  path.join(path.resolve(workspacePath), HARBOR_REVIEW_LOOP_OUTPUT_FILE);

const scienceTaskReviewLoopLogPath = (workspacePath: string, timestamp = new Date()): string =>
  path.join(
    path.resolve(workspacePath),
    HARBOR_REVIEW_LOOP_LOG_FOLDER,
    `${timestamp.toISOString().replace(/[:.]/g, "-")}.log`,
  );

const buildReviewLoopPrompt = (input: {
  workspacePath: string;
  harborPrUrl: string;
  outputPath: string;
}): string => `Review this Harbor science task and bring the review record to merge-ready status.

Workspace: ${input.workspacePath}
Harbor PR: ${input.harborPrUrl}

Use the harbor-task-review-loop skill. Inspect the whole task workspace, including instruction.md, task.toml, environment/Dockerfile, tests, solution notes, helper scripts, and task-local notes. Apply the full Harbor checklist. Rerun required local checks or record exactly why a required check could not be rerun. Capture oracle evidence, frontier evidence, and an honest failure analysis.

Write exactly one JSON file at:
${input.outputPath}

The JSON file must use this exact shape. Replace every placeholder with the reviewed task's real values:
{
  "schema_version": "${HARBOR_REVIEW_LOOP_SCHEMA_VERSION}",
  "checklist": {
    ${Object.keys(CHECKLIST_LABELS).map((key) => `"${key}": { "status": "pass|fail|unknown", "note": "optional note" }`).join(",\n    ")}
  },
  "oracle_run": { "command": "exact command", "summary": "what happened", "key_lines": ["important line"] },
  "frontier_run": { "command": "exact command", "summary": "what happened", "key_lines": ["important line"] },
  "failure_analysis": "why the task remains valid and what the frontier run missed",
  "review": {
    "harbor_pr_url": "${input.harborPrUrl}",
    "latest_review_follow_up_note": "current reviewer-facing status",
    "open_reviewer_concerns_count": 0,
    "any_concern_unanswered": false,
    "latest_rerun_after_latest_fix": true,
    "latest_fix_at": "ISO timestamp or null",
    "last_rerun_at": "ISO timestamp or null"
  }
}

Do not copy placeholder values. Every checklist status must be exactly "pass", "fail", or "unknown". Do not write a passing status unless there is current evidence for it. Treat unknowns as blockers.`;

const defaultHermesRunner: ScienceTaskHermesRunner = async (invocation) => {
  await ensureDir(path.dirname(invocation.log_path));
  const logStream = createWriteStream(invocation.log_path, { flags: "a" });
  logStream.write(`$ ${[invocation.entrypoint, ...invocation.args].join(" ")}\n\n`);

  const child = spawn(invocation.entrypoint, invocation.args, {
    cwd: invocation.cwd,
    env: buildSafeSubprocessEnv(),
  });

  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, invocation.timeout_seconds * 1000);

  let exitCode = 1;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });
  } finally {
    clearTimeout(timeout);
    logStream.end();
    await once(logStream, "finish");
  }

  return { exitCode, timedOut };
};

const readReviewLoopOutput = async (outputPath: string): Promise<ScienceTaskReviewLoopOutput> => {
  let raw: string;
  try {
    raw = await fs.readFile(outputPath, "utf8");
  } catch {
    throw new Error("Hermes did not write dist/harbor-review-loop.json");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Hermes wrote malformed review-loop JSON");
  }

  return validateReviewLoopOutput(parsed);
};

const requireHermesHarness = (harness: RegentHarnessConfig | undefined): RegentHarnessConfig => {
  if (!harness || !harness.enabled) {
    throw new Error("Hermes harness is not configured or enabled");
  }

  if (!harness.entrypoint) {
    throw new Error("Hermes harness is missing an entrypoint");
  }

  return harness;
};

const normalizeReviewLoopTimeout = (value?: number): number => {
  const timeout = value ?? DEFAULT_REVIEW_LOOP_TIMEOUT_SECONDS;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new Error("invalid timeout_seconds");
  }

  return timeout;
};

export const runScienceTaskReviewLoop = async (input: {
  workspace_path: string;
  harbor_pr_url: string;
  timeout_seconds?: number;
  hermes_harness?: RegentHarnessConfig;
  runner?: ScienceTaskHermesRunner;
}): Promise<ScienceTaskReviewLoopResult> => {
  const workspacePath = path.resolve(input.workspace_path);
  const metadata = await readScienceTaskWorkspaceMetadata(workspacePath);
  if (!metadata.node_id) {
    throw new Error("science task workspace is not linked to a Techtree task yet");
  }

  if (!input.harbor_pr_url || input.harbor_pr_url.trim() === "") {
    throw new Error("missing Harbor PR URL");
  }

  const harness = requireHermesHarness(input.hermes_harness);
  const outputPath = scienceTaskReviewLoopOutputPath(workspacePath);
  const logPath = scienceTaskReviewLoopLogPath(workspacePath);
  const timeoutSeconds = normalizeReviewLoopTimeout(input.timeout_seconds);
  const prompt = buildReviewLoopPrompt({
    workspacePath,
    harborPrUrl: input.harbor_pr_url,
    outputPath,
  });
  const invocation: ScienceTaskReviewLoopInvocation = {
    entrypoint: harness.entrypoint,
    args: ["chat", "-Q", "-s", "harbor-task-review-loop", "-q", prompt],
    cwd: workspacePath,
    prompt,
    output_path: outputPath,
    log_path: logPath,
    timeout_seconds: timeoutSeconds,
  };

  await ensureDir(path.dirname(outputPath));
  await ensureDir(path.dirname(logPath));

  let runResult: ScienceTaskReviewLoopRunResult;
  try {
    runResult = await (input.runner ?? defaultHermesRunner)(invocation);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Hermes review loop could not start; see ${logPath}: ${message}`);
  }

  if (runResult.timedOut) {
    throw new Error(`Hermes review loop timed out after ${timeoutSeconds} seconds; see ${logPath}`);
  }

  if (runResult.exitCode !== 0) {
    throw new Error(`Hermes review loop failed with exit code ${runResult.exitCode}; see ${logPath}`);
  }

  const reviewLoopOutput = await readReviewLoopOutput(outputPath);
  if (reviewLoopOutput.review.harbor_pr_url !== input.harbor_pr_url) {
    throw new Error("review-loop output Harbor PR URL does not match --pr-url");
  }

  await writeScienceTaskWorkspaceMetadata(workspacePath, {
    ...metadata,
    checklist: reviewLoopOutput.checklist,
    oracle_run: reviewLoopOutput.oracle_run,
    frontier_run: reviewLoopOutput.frontier_run,
    failure_analysis: reviewLoopOutput.failure_analysis,
    harbor_pr_url: reviewLoopOutput.review.harbor_pr_url,
    latest_review_follow_up_note: reviewLoopOutput.review.latest_review_follow_up_note ?? null,
    open_reviewer_concerns_count: reviewLoopOutput.review.open_reviewer_concerns_count,
    any_concern_unanswered: reviewLoopOutput.review.any_concern_unanswered,
    latest_rerun_after_latest_fix: reviewLoopOutput.review.latest_rerun_after_latest_fix,
    latest_fix_at: reviewLoopOutput.review.latest_fix_at ?? null,
    last_rerun_at: reviewLoopOutput.review.last_rerun_at ?? null,
  });

  return {
    workspace_path: workspacePath,
    node_id: metadata.node_id,
    harbor_pr_url: reviewLoopOutput.review.harbor_pr_url,
    output_path: outputPath,
    log_path: logPath,
  };
};

const listWorkspaceFiles = async (workspacePath: string): Promise<string[]> => {
  const entries: string[] = [];
  const resolved = path.resolve(workspacePath);

  const walk = async (relativePath: string): Promise<void> => {
    const absolutePath = path.join(resolved, relativePath);
    const stat = await fs.stat(absolutePath);

    if (stat.isDirectory()) {
      const name = path.basename(absolutePath);
      if ([".git", "node_modules", DIST_FOLDER].includes(name)) {
        return;
      }

      const children = await fs.readdir(absolutePath);
      for (const child of children.sort()) {
        await walk(path.join(relativePath, child));
      }
      return;
    }

    const normalized = relativePath.replace(/^\.\//, "").split(path.sep).join("/");
    if (normalized !== SCIENCE_TASK_METADATA_FILE) {
      entries.push(normalized);
    }
  };

  await walk(".");
  return entries.sort();
};

const packetFileForBuffer = (buffer: Buffer): ScienceTaskPacketFile => {
  const looksBinary = buffer.includes(0);
  return looksBinary
    ? { encoding: "base64", content: buffer.toString("base64") }
    : { encoding: "utf8", content: buffer.toString("utf8") };
};

export const collectScienceTaskPacketFiles = async (
  workspacePath: string,
): Promise<Record<string, ScienceTaskPacketFile>> => {
  const resolved = path.resolve(workspacePath);
  const files = await listWorkspaceFiles(resolved);
  const packetFiles: Record<string, ScienceTaskPacketFile> = {};

  for (const relativePath of files) {
    const buffer = await fs.readFile(path.join(resolved, relativePath));
    packetFiles[relativePath] = packetFileForBuffer(buffer);
  }

  return packetFiles;
};

export const loadScienceTaskChecklistPayload = async (
  workspacePath: string,
): Promise<ScienceTaskChecklistUpdateInput & { node_id: number }> => {
  const metadata = await readScienceTaskWorkspaceMetadata(workspacePath);
  if (!metadata.node_id) {
    throw new Error("science task workspace is not linked to a Techtree task yet");
  }

  return {
    node_id: metadata.node_id,
    ...baseInputFromMetadata(metadata, await collectScienceTaskPacketFiles(workspacePath)),
    checklist: metadata.checklist,
  };
};

export const loadScienceTaskEvidencePayload = async (
  workspacePath: string,
): Promise<ScienceTaskEvidenceUpdateInput & { node_id: number }> => {
  const metadata = await readScienceTaskWorkspaceMetadata(workspacePath);
  if (!metadata.node_id) {
    throw new Error("science task workspace is not linked to a Techtree task yet");
  }

  if (!metadata.oracle_run || !metadata.frontier_run) {
    throw new Error("science task workspace is missing oracle or frontier evidence");
  }

  return {
    node_id: metadata.node_id,
    ...baseInputFromMetadata(metadata, await collectScienceTaskPacketFiles(workspacePath)),
    oracle_run: metadata.oracle_run,
    frontier_run: metadata.frontier_run,
  };
};

export const loadScienceTaskSubmitPayload = async (
  workspacePath: string,
  overrides?: { harbor_pr_url?: string; latest_review_follow_up_note?: string },
): Promise<ScienceTaskSubmitInput & { node_id: number; metadata: ScienceTaskWorkspaceMetadata }> => {
  const metadata = await readScienceTaskWorkspaceMetadata(workspacePath);
  if (!metadata.node_id) {
    throw new Error("science task workspace is not linked to a Techtree task yet");
  }

  const harbor_pr_url = overrides?.harbor_pr_url ?? metadata.harbor_pr_url ?? undefined;
  if (!harbor_pr_url) {
    throw new Error("missing Harbor PR URL");
  }

  const nextMetadata = {
    ...metadata,
    harbor_pr_url,
    latest_review_follow_up_note: overrides?.latest_review_follow_up_note ?? metadata.latest_review_follow_up_note ?? null,
  };

  return {
    node_id: metadata.node_id,
    metadata: nextMetadata,
    ...baseInputFromMetadata(nextMetadata, await collectScienceTaskPacketFiles(workspacePath)),
    harbor_pr_url,
    latest_review_follow_up_note: nextMetadata.latest_review_follow_up_note ?? undefined,
  };
};

export const loadScienceTaskReviewPayload = async (
  workspacePath: string,
  overrides?: {
    harbor_pr_url?: string;
    latest_review_follow_up_note?: string;
    open_reviewer_concerns_count?: number;
    any_concern_unanswered?: boolean;
    latest_rerun_after_latest_fix?: boolean;
    latest_fix_at?: string | null;
    last_rerun_at?: string | null;
  },
): Promise<ScienceTaskReviewUpdateInput & { node_id: number; metadata: ScienceTaskWorkspaceMetadata }> => {
  const metadata = await readScienceTaskWorkspaceMetadata(workspacePath);
  if (!metadata.node_id) {
    throw new Error("science task workspace is not linked to a Techtree task yet");
  }

  const harbor_pr_url = overrides?.harbor_pr_url ?? metadata.harbor_pr_url ?? undefined;
  if (!harbor_pr_url) {
    throw new Error("missing Harbor PR URL");
  }

  const nextMetadata: ScienceTaskWorkspaceMetadata = {
    ...metadata,
    harbor_pr_url,
    latest_review_follow_up_note:
      overrides?.latest_review_follow_up_note ?? metadata.latest_review_follow_up_note ?? null,
    open_reviewer_concerns_count:
      overrides?.open_reviewer_concerns_count ?? metadata.open_reviewer_concerns_count,
    any_concern_unanswered:
      overrides?.any_concern_unanswered ?? metadata.any_concern_unanswered,
    latest_rerun_after_latest_fix:
      overrides?.latest_rerun_after_latest_fix ?? metadata.latest_rerun_after_latest_fix,
    latest_fix_at: overrides?.latest_fix_at ?? metadata.latest_fix_at ?? null,
    last_rerun_at: overrides?.last_rerun_at ?? metadata.last_rerun_at ?? null,
  };

  return {
    node_id: metadata.node_id,
    metadata: nextMetadata,
    ...baseInputFromMetadata(nextMetadata, await collectScienceTaskPacketFiles(workspacePath)),
    harbor_pr_url,
    latest_review_follow_up_note: nextMetadata.latest_review_follow_up_note ?? undefined,
    open_reviewer_concerns_count: nextMetadata.open_reviewer_concerns_count,
    any_concern_unanswered: nextMetadata.any_concern_unanswered,
    latest_rerun_after_latest_fix: nextMetadata.latest_rerun_after_latest_fix,
    latest_fix_at: nextMetadata.latest_fix_at ?? undefined,
    last_rerun_at: nextMetadata.last_rerun_at ?? undefined,
  };
};

export const materializeScienceTaskPacket = async (
  outputPath: string,
  detail: ScienceTaskDetail,
): Promise<string[]> => {
  const resolved = path.resolve(outputPath);
  const written = new Set<string>();
  await ensureDir(resolved);

  for (const [relativePath, file] of Object.entries(detail.packet_files)) {
    const targetPath = path.join(resolved, relativePath);
    await ensureDir(path.dirname(targetPath));
    await fs.writeFile(
      targetPath,
      file.encoding === "base64" ? Buffer.from(file.content, "base64") : file.content,
    );
    written.add(relativePath);
  }

  const reviewSheet = buildReviewSheet(detail);
  const evidenceSheet = buildEvidenceSheet(detail);
  const submissionChecklist = buildSubmissionChecklist(detail);

  await fs.writeFile(path.join(resolved, "techtree-review-sheet.md"), reviewSheet, "utf8");
  await fs.writeFile(path.join(resolved, "techtree-evidence.md"), evidenceSheet, "utf8");
  await fs.writeFile(path.join(resolved, "techtree-submission-checklist.md"), submissionChecklist, "utf8");

  written.add("techtree-review-sheet.md");
  written.add("techtree-evidence.md");
  written.add("techtree-submission-checklist.md");

  return [...written].sort();
};

const buildReviewSheet = (detail: ScienceTaskDetail): string => {
  const lines = [
    "# Techtree review sheet",
    "",
    `- Title: ${detail.title}`,
    `- Workflow state: ${detail.workflow_state}`,
    `- Export path: ${detail.export_target_path}`,
    "",
    "## Checklist",
    "",
  ];

  for (const [key, label] of Object.entries(CHECKLIST_LABELS)) {
    const entry = detail.checklist[key];
    lines.push(`- [${entry?.status === "pass" ? "x" : " "}] ${label}`);
    if (entry?.note) {
      lines.push(`  Note: ${entry.note}`);
    }
  }

  lines.push("", "## Failure analysis", "", detail.failure_analysis, "");
  return `${lines.join("\n")}\n`;
};

const buildEvidenceSheet = (detail: ScienceTaskDetail): string => {
  const lines = [
    "# Techtree evidence",
    "",
    `- Packet hash: ${detail.packet_hash}`,
    `- Evidence hash: ${detail.evidence_packet_hash ?? "not recorded"}`,
    `- Files match latest evidence: ${detail.current_files_match_latest_evidence ? "yes" : "no"}`,
    "",
    "## Oracle run",
    "",
    `- Command: ${detail.oracle_run?.command ?? "not recorded"}`,
    `- Summary: ${detail.oracle_run?.summary ?? "not recorded"}`,
    "",
    "## Frontier run",
    "",
    `- Command: ${detail.frontier_run?.command ?? "not recorded"}`,
    `- Summary: ${detail.frontier_run?.summary ?? "not recorded"}`,
    "",
  ];

  return `${lines.join("\n")}\n`;
};

const buildSubmissionChecklist = (detail: ScienceTaskDetail): string => `# Harbor submission checklist

- Export path: \`${detail.export_target_path}\`
- Harbor PR URL: ${detail.harbor_pr_url ?? "not recorded"}
- Open reviewer concerns: ${detail.open_reviewer_concerns_count}
- Any concern unanswered: ${detail.any_concern_unanswered ? "yes" : "no"}
- Latest rerun after latest fix: ${detail.latest_rerun_after_latest_fix ? "yes" : "no"}
- Latest review follow-up note: ${detail.latest_review_follow_up_note ?? "not recorded"}
`;

const baseInputFromMetadata = (
  metadata: ScienceTaskWorkspaceMetadata,
  packet_files: Record<string, ScienceTaskPacketFile>,
) => ({
  title: metadata.title,
  summary: metadata.summary ?? undefined,
  science_domain: metadata.science_domain,
  science_field: metadata.science_field,
  task_slug: metadata.task_slug,
  structured_output_shape: metadata.structured_output_shape ?? undefined,
  claimed_expert_time: metadata.claimed_expert_time,
  threshold_rationale: metadata.threshold_rationale ?? undefined,
  anti_cheat_notes: metadata.anti_cheat_notes,
  reproducibility_notes: metadata.reproducibility_notes,
  dependency_pinning_status: metadata.dependency_pinning_status,
  canary_status: metadata.canary_status,
  failure_analysis: metadata.failure_analysis,
  packet_files,
});

export const updateScienceTaskWorkspaceMetadata = async (
  workspacePath: string,
  updater: (metadata: ScienceTaskWorkspaceMetadata) => ScienceTaskWorkspaceMetadata,
): Promise<ScienceTaskWorkspaceMetadata> => {
  const current = await readScienceTaskWorkspaceMetadata(workspacePath);
  const next = updater(current);
  await writeScienceTaskWorkspaceMetadata(workspacePath, next);
  return next;
};

export const scienceTaskMetadataPath = (workspacePath: string): string =>
  path.join(path.resolve(workspacePath), SCIENCE_TASK_METADATA_FILE);

export const scienceTaskExportPath = (workspacePath: string, detail: ScienceTaskDetail): string =>
  path.join(path.resolve(workspacePath), DIST_FOLDER, detail.export_target_path);

export const mergeScienceTaskMetadataForInit = (
  metadata: ScienceTaskWorkspaceMetadata,
  overrides: {
    title?: string;
    summary?: string;
    science_domain?: string;
    science_field?: string;
    task_slug?: string;
    claimed_expert_time?: string;
  },
): ScienceTaskWorkspaceMetadata => ({
  ...metadata,
  title: overrides.title ?? metadata.title,
  summary: overrides.summary ?? metadata.summary,
  science_domain: overrides.science_domain ?? metadata.science_domain,
  science_field: overrides.science_field ?? metadata.science_field,
  task_slug: overrides.task_slug ?? metadata.task_slug,
  claimed_expert_time: overrides.claimed_expert_time ?? metadata.claimed_expert_time,
});

export const scienceTaskTitleFromPath = (workspacePath: string): string =>
  path.basename(path.resolve(workspacePath)).replace(/[-_]+/g, " ");

export const scienceTaskChecklistLabels = (): Record<string, string> => CHECKLIST_LABELS;

export const scienceTaskMetadataSummary = (metadata: ScienceTaskWorkspaceMetadata): string =>
  `${text(metadata.science_domain)}/${text(metadata.science_field)}/${text(metadata.task_slug)}`;
