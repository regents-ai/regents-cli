import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type {
  LocalAgentIdentity,
  RegentConfig,
  TerminalScienceAgentKey,
  TerminalScienceEnvironmentKind,
  TerminalScienceGoal,
  TerminalScienceRunResponse,
} from "../../internal-types/index.js";

const TSB_REPO = "harbor-framework/terminal-bench-science";
const TSB_GIT_URL = `https://github.com/${TSB_REPO}.git`;
const TSB_SCHEMA = "regent.techtree.science_run.v1";
const TSB_KIND = "terminal_bench_science_run";
const DEFAULT_TIMEOUT_SECONDS = 1800;
const text = new TextEncoder();

export interface ParsedTerminalScienceTaskUri {
  taskUri: string;
  taskRepo: string;
  repoOwner: string;
  repoName: string;
  taskPath: string;
  domain: string;
  field: string;
  taskName: string;
}

export interface TerminalScienceRunParams {
  task?: string;
  agent?: string;
  model?: string;
  env?: string;
  run_dir?: string;
  timeout_seconds?: number;
  publish_run?: boolean;
}

export interface TerminalScienceSetGoalParams {
  task: string;
  agent?: string;
  model?: string;
  env?: string;
}

export interface TerminalScienceRepoCheckout {
  repoPath: string;
  commit: string;
}

export interface TerminalScienceRunOptions {
  runner?: TerminalScienceRunner;
  repoResolver?: TerminalScienceRepoResolver;
}

export interface TerminalScienceRunnerInvocation {
  repoPath: string;
  taskPath: string;
  agent: TerminalScienceAgentKey;
  harborAgent: string;
  model: string;
  environment: TerminalScienceEnvironmentKind;
  timeoutSeconds: number;
}

export interface TerminalScienceRunnerResult {
  command: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export type TerminalScienceRunner = (invocation: TerminalScienceRunnerInvocation) => Promise<TerminalScienceRunnerResult>;

export type TerminalScienceRepoResolver = (
  config: RegentConfig,
  taskRepo: string,
  ref: string,
) => Promise<TerminalScienceRepoCheckout>;

export function parseTerminalScienceTaskUri(input: string): ParsedTerminalScienceTaskUri {
  const trimmed = input.trim();
  const match = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+):(.+)$/u.exec(trimmed);
  if (!match) {
    throw new Error("TSB task must use owner/repo:tasks/domain/field/task");
  }

  const taskRepo = match[1] ?? "";
  const taskPath = normalizeTaskPath(match[2] ?? "");
  const parts = taskPath.split("/");
  if (taskRepo !== TSB_REPO) {
    throw new Error("TSB task repo must be harbor-framework/terminal-bench-science");
  }
  if (parts.length < 4) {
    throw new Error("TSB task path must include tasks/domain/field/task");
  }

  const [repoOwner, repoName] = taskRepo.split("/") as [string, string];
  return {
    taskUri: `${taskRepo}:${taskPath}`,
    taskRepo,
    repoOwner,
    repoName,
    taskPath,
    domain: parts[1] ?? "unknown",
    field: parts[2] ?? "general",
    taskName: parts.slice(3).join("/"),
  };
}

export function buildTerminalScienceGoal(
  config: RegentConfig,
  params: TerminalScienceSetGoalParams,
): TerminalScienceGoal {
  const parsed = parseTerminalScienceTaskUri(params.task);
  const agent = normalizeAgent(params.agent ?? config.workloads.science.defaultAgent);
  const environment = normalizeEnvironment(params.env ?? config.workloads.science.defaultEnvironment);
  const model = params.model ?? config.workloads.science.defaultModel;
  const goalHash = sha256Hex(`${parsed.taskUri}:${agent}:${model}:${environment}`).slice(0, 24);

  return {
    goal_id: `tsg_${goalHash}`,
    kind: "terminal_bench_science_goal",
    task_uri: parsed.taskUri,
    task_repo: parsed.taskRepo,
    task_ref: config.workloads.science.defaultTaskRef,
    task_path: parsed.taskPath,
    agent_profile: agent,
    model,
    environment,
    status: "active",
    updated_at: new Date().toISOString(),
  };
}

export async function buildAndRunTerminalScience(
  config: RegentConfig,
  params: TerminalScienceRunParams,
  activeGoal: TerminalScienceGoal | undefined,
  identity: LocalAgentIdentity | undefined,
  options: TerminalScienceRunOptions = {},
): Promise<TerminalScienceRunResponse> {
  const runner = options.runner ?? defaultTerminalScienceRunner;
  const repoResolver = options.repoResolver ?? defaultTerminalScienceRepoResolver;
  const goal = params.task
    ? buildTerminalScienceGoal(config, {
        task: params.task,
        agent: params.agent,
        model: params.model,
        env: params.env,
      })
    : activeGoal;

  if (!goal) {
    throw new Error("Set a Terminal Science Bench goal first, or pass --task.");
  }

  const parsed = parseTerminalScienceTaskUri(goal.task_uri);
  const agent = normalizeAgent(params.agent ?? goal.agent_profile);
  const environment = normalizeEnvironment(params.env ?? goal.environment);
  const model = params.model ?? goal.model;
  const agentAdapter = resolveHarborAgentAdapter(config, agent);
  const timeoutSeconds = params.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS;
  const checkout = await repoResolver(config, parsed.taskRepo, goal.task_ref);
  const repoPath = checkout.repoPath;
  const commit = checkout.commit;
  const taskRoot = path.join(repoPath, parsed.taskPath);
  await ensureTaskDirectory(taskRoot);

  const localAttemptId = `local_${new Date().toISOString().replace(/[:.]/gu, "-")}_${sha256Hex(crypto.randomUUID()).slice(0, 8)}`;
  const runId = `tsr_${sha256Hex(`${parsed.taskUri}:${commit}:${localAttemptId}`).slice(0, 24)}`;
  const runDir = path.resolve(params.run_dir ?? path.join(config.workloads.science.workspaceRoot, "runs", runId));
  await fs.mkdir(runDir, { recursive: true });

  const result = await runner({
    repoPath,
    taskPath: parsed.taskPath,
    agent,
    harborAgent: agentAdapter.harborAgent,
    model,
    environment,
    timeoutSeconds,
  });

  const succeeded = result.exitCode === 0 && result.timedOut === false;
  const executionStatus = result.timedOut ? "timeout" : succeeded ? "passed" : "failed";
  const reward = succeeded ? 1 : 0;
  const stdoutSha = sha256Hex(result.stdout);
  const stderrSha = sha256Hex(result.stderr);
  const logSha = sha256Hex(`${result.stdout}\n${result.stderr}`);
  const taskHashes = await hashTaskFiles(taskRoot);
  const files = {
    goal: path.join(runDir, "goal.json"),
    run_envelope: path.join(runDir, "run-envelope.json"),
    public_summary: path.join(runDir, "public-summary.json"),
    harbor_stdout: path.join(runDir, "harbor-stdout.log"),
    harbor_stderr: path.join(runDir, "harbor-stderr.log"),
    checksums: path.join(runDir, "checksums.json"),
  };
  const publicSummary = {
    schema: "regent.techtree.science_public_summary.v1",
    run_id: runId,
    local_attempt_id: localAttemptId,
    task_uri: parsed.taskUri,
    task_commit: commit,
    agent,
    model,
    environment,
    status: executionStatus,
    reward,
    verifier_result: succeeded ? "passed" : "failed",
    stdout_sha256: `sha256:${stdoutSha}`,
    stderr_sha256: `sha256:${stderrSha}`,
  };
  const publicSummaryJson = jsonPayload(publicSummary);

  const envelope = {
    schema: TSB_SCHEMA,
    kind: TSB_KIND,
    ids: {
      goal_id: goal.goal_id,
      run_id: runId,
      local_attempt_id: localAttemptId,
      agent_id: identity?.tokenId ?? null,
      node_id: null,
      certificate_id: null,
    },
    task: {
      benchmark: "terminal-bench-science",
      upstream_name: "TB-Science",
      task_uri: parsed.taskUri,
      repo: TSB_GIT_URL,
      repo_owner: parsed.repoOwner,
      repo_name: parsed.repoName,
      ref: goal.task_ref,
      commit,
      path: parsed.taskPath,
      domain: parsed.domain,
      field: parsed.field,
      task_name: parsed.taskName,
      task_toml_sha256: taskHashes.taskToml,
      instruction_sha256: taskHashes.instruction,
      environment_sha256: taskHashes.environment,
      verifier_sha256: taskHashes.verifier,
    },
    runner: {
      harness: "harbor",
      harness_version: "harbor",
      harness_commit: null,
      command: result.command.join(" "),
      environment: {
        kind: environment,
        provider: "local",
        image_digest: null,
        cpus: null,
        memory_mb: null,
        gpus: 0,
        allow_internet: true,
      },
    },
    agent: {
      agent_key: agent,
      agent_display_name: agentDisplayName(agent),
      adapter: agentAdapter.adapter,
      adapter_version: null,
      model,
      model_provider: modelProvider(model),
      runtime: "regents-cli",
      runtime_profile: "science",
      identity: {
        agent_id: identity?.tokenId ?? null,
        wallet: identity?.walletAddress ?? null,
        chain_id: identity?.chainId ?? null,
      },
    },
    execution: {
      status: executionStatus,
      started_at: result.startedAt,
      ended_at: result.endedAt,
      duration_ms: result.durationMs,
      exit_code: result.exitCode,
      attempt: 1,
      timeout_sec: timeoutSeconds,
      failure_reason: succeeded ? null : result.timedOut ? "Timed out" : "Task did not pass",
    },
    result: {
      success: succeeded,
      reward,
      score: reward,
      verifier: {
        kind: "terminal-bench-science",
        name: "harbor run",
        passed: succeeded,
        stdout_sha256: `sha256:${stdoutSha}`,
        stderr_sha256: `sha256:${stderrSha}`,
      },
      tests: {
        passed: succeeded ? 1 : 0,
        failed: succeeded ? 0 : 1,
        skipped: 0,
      },
    },
    artifacts: {
      public: {
        summary: {
          uri: "local:public-summary.json",
          sha256: `sha256:${sha256Hex(publicSummaryJson)}`,
          format: "json",
          redacted: true,
          visibility: "public",
        },
      },
      private: {
        stdout: {
          uri: "local:harbor-stdout.log",
          sha256: `sha256:${stdoutSha}`,
          format: "text",
          redacted: false,
          visibility: "reviewer_only",
        },
        stderr: {
          uri: "local:harbor-stderr.log",
          sha256: `sha256:${stderrSha}`,
          format: "text",
          redacted: false,
          visibility: "reviewer_only",
        },
        combined_logs: {
          uri: "local:harbor-stdout.log+harbor-stderr.log",
          sha256: `sha256:${logSha}`,
          format: "text",
          redacted: false,
          visibility: "reviewer_only",
        },
      },
    },
    costs: {
      input_tokens: 0,
      output_tokens: 0,
      tool_calls: 0,
      estimated_usd: null,
      metering_source: "agent_adapter",
    },
    provenance: {
      regents_cli_version: "local",
      techtree_api_version: null,
      os: process.platform,
      machine_fingerprint_hash: null,
      git_clean: true,
      created_by: "local_operator",
      redaction_policy: "regent.techtree.science_redaction.v1",
    },
    publish: {
      publish_run: params.publish_run === true,
      visibility: params.publish_run === true ? config.workloads.science.publishVisibility : "local",
      node_id: null,
      techtree_url: null,
      room_key: null,
      created_at: null,
    },
  };

  const goalJson = jsonPayload(goal);
  const envelopeJson = jsonPayload(envelope);
  const checksums = {
    "goal.json": `sha256:${sha256Hex(goalJson)}`,
    "run-envelope.json": `sha256:${sha256Hex(envelopeJson)}`,
    "public-summary.json": `sha256:${sha256Hex(publicSummaryJson)}`,
    "harbor-stdout.log": `sha256:${stdoutSha}`,
    "harbor-stderr.log": `sha256:${stderrSha}`,
  };
  const checksumsJson = jsonPayload({
    schema: "regent.techtree.science_run_checksums.v1",
    files: checksums,
  });

  await Promise.all([
    fs.writeFile(files.goal, goalJson),
    fs.writeFile(files.run_envelope, envelopeJson),
    fs.writeFile(files.public_summary, publicSummaryJson),
    fs.writeFile(files.harbor_stdout, result.stdout),
    fs.writeFile(files.harbor_stderr, result.stderr),
    fs.writeFile(files.checksums, checksumsJson),
  ]);

  return {
    ok: true,
    goal,
    run_id: runId,
    local_attempt_id: localAttemptId,
    run_dir: runDir,
    status: executionStatus,
    exit_code: result.exitCode,
    command: result.command.join(" "),
    public_summary: publicSummary,
    artifact_envelope: envelope,
    files,
    checksums,
  };
}

async function defaultTerminalScienceRunner(
  invocation: TerminalScienceRunnerInvocation,
): Promise<TerminalScienceRunnerResult> {
  if (invocation.environment !== "docker") {
    throw new Error("Terminal Science Bench runs currently support --env docker.");
  }

  const command = [
    "harbor",
    "run",
    "-p",
    invocation.taskPath,
    "-a",
    invocation.harborAgent,
    "-m",
    invocation.model,
  ];
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  return await new Promise<TerminalScienceRunnerResult>((resolve, reject) => {
    const child = spawn(command[0] as string, command.slice(1), {
      cwd: invocation.repoPath,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, invocation.timeoutSeconds * 1000);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`unable to start Terminal Science Bench runner: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const ended = Date.now();
      resolve({
        command,
        stdout,
        stderr,
        exitCode: code,
        timedOut,
        startedAt,
        endedAt: new Date(ended).toISOString(),
        durationMs: Math.max(0, ended - started),
      });
    });
  });
}

async function ensureTerminalScienceRepo(
  config: RegentConfig,
  taskRepo: string,
  ref: string,
): Promise<string> {
  if (taskRepo !== TSB_REPO) {
    throw new Error("TSB task repo must be harbor-framework/terminal-bench-science");
  }

  const repoPath = path.join(config.workloads.science.taskRepoRoot, "harbor-framework", "terminal-bench-science");
  const gitDir = path.join(repoPath, ".git");
  if (!(await exists(gitDir))) {
    await fs.mkdir(path.dirname(repoPath), { recursive: true });
    await runProcess("git", ["clone", "--depth", "1", "--branch", ref, TSB_GIT_URL, repoPath], process.cwd());
    return repoPath;
  }

  await runProcess("git", ["fetch", "--depth", "1", "origin", ref], repoPath);
  await runProcess("git", ["checkout", "--detach", "FETCH_HEAD"], repoPath);
  return repoPath;
}

async function defaultTerminalScienceRepoResolver(
  config: RegentConfig,
  taskRepo: string,
  ref: string,
): Promise<TerminalScienceRepoCheckout> {
  const repoPath = await ensureTerminalScienceRepo(config, taskRepo, ref);
  return {
    repoPath,
    commit: await runGit(repoPath, ["rev-parse", "HEAD"]),
  };
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  return (await runProcess("git", args, repoPath)).trim();
}

async function runProcess(command: string, args: string[], cwd: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

async function hashTaskFiles(taskRoot: string): Promise<{
  taskToml: string | null;
  instruction: string | null;
  environment: string | null;
  verifier: string | null;
}> {
  const [taskToml, instruction, environment, verifier] = await Promise.all([
    hashFileIfPresent(path.join(taskRoot, "task.toml")),
    hashFileIfPresent(path.join(taskRoot, "instruction.md")),
    hashTreeIfPresent(path.join(taskRoot, "environment")),
    hashTreeIfPresent(path.join(taskRoot, "tests")),
  ]);

  return { taskToml, instruction, environment, verifier };
}

async function hashFileIfPresent(filePath: string): Promise<string | null> {
  if (!(await exists(filePath))) {
    return null;
  }
  return `sha256:${crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex")}`;
}

async function hashTreeIfPresent(root: string): Promise<string | null> {
  if (!(await exists(root))) {
    return null;
  }
  const files: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  await visit(root);
  const hashes = await Promise.all(
    files.sort().map(async (file) => `${path.relative(root, file)}:${await hashFileIfPresent(file)}`),
  );
  return `sha256:${sha256Hex(hashes.join("\n"))}`;
}

async function ensureTaskDirectory(taskRoot: string): Promise<void> {
  const stat = await fs.stat(taskRoot).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error("TSB task path was not found in the local benchmark repo");
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeTaskPath(input: string): string {
  if (input.startsWith("/")) {
    throw new Error("TSB task path must stay under tasks/");
  }
  const normalized = input;
  if (!normalized.startsWith("tasks/") || normalized.includes("..") || path.isAbsolute(normalized)) {
    throw new Error("TSB task path must stay under tasks/");
  }
  return normalized;
}

function normalizeAgent(value: string): TerminalScienceAgentKey {
  if (value === "codex" || value === "openclaw" || value === "hermes" || value === "custom") {
    return value;
  }
  throw new Error("--agent must be codex, openclaw, hermes, or custom");
}

function resolveHarborAgentAdapter(
  config: RegentConfig,
  agent: TerminalScienceAgentKey,
): { harborAgent: string; adapter: string } {
  if (agent === "codex") {
    return { harborAgent: "codex", adapter: "harbor.codex" };
  }

  const harness = config.agents.harnesses[agent];
  if (harness?.enabled && harness.profiles.includes("science")) {
    return {
      harborAgent: harness.entrypoint,
      adapter: "harbor.external",
    };
  }

  throw new Error(`${agentDisplayName(agent)} needs a science-enabled Harbor adapter before it can run.`);
}

function normalizeEnvironment(value: string): TerminalScienceEnvironmentKind {
  if (value === "docker") {
    return value;
  }
  throw new Error("--env must be docker");
}

function agentDisplayName(agent: TerminalScienceAgentKey): string {
  switch (agent) {
    case "codex":
      return "Codex";
    case "openclaw":
      return "OpenClaw";
    case "hermes":
      return "Hermes";
    case "custom":
      return "Custom";
  }
}

function modelProvider(model: string): string | null {
  const [provider] = model.split("/");
  return provider && provider !== model ? provider : null;
}

function sha256Hex(value: string | Uint8Array): string {
  return crypto.createHash("sha256").update(typeof value === "string" ? text.encode(value) : value).digest("hex");
}

function jsonPayload(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJson(entryValue)]),
    );
  }
  return value;
}
