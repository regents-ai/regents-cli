import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultConfig } from "../../../src/internal-runtime/config.js";
import {
  buildAndRunTerminalScience,
  buildTerminalScienceGoal,
  parseTerminalScienceTaskUri,
} from "../../../src/internal-runtime/workloads/terminal-science.js";

const taskUri =
  "harbor-framework/terminal-bench-science:tasks/physical-sciences/chemistry-and-materials/example";
const tempDirs: string[] = [];

const makeTempDir = async (prefix: string): Promise<string> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
};

const prepareTaskRepo = async (): Promise<string> => {
  const root = await makeTempDir("terminal-science-repo-");
  const taskRoot = path.join(root, "tasks", "physical-sciences", "chemistry-and-materials", "example");
  await fs.mkdir(path.join(taskRoot, "environment"), { recursive: true });
  await fs.mkdir(path.join(taskRoot, "tests"), { recursive: true });
  await fs.writeFile(path.join(taskRoot, "task.toml"), "name = \"example\"\n");
  await fs.writeFile(path.join(taskRoot, "instruction.md"), "# Example\n");
  await fs.writeFile(path.join(taskRoot, "environment", "Dockerfile"), "FROM alpine:3.20\n");
  await fs.writeFile(path.join(taskRoot, "tests", "test.sh"), "#!/bin/sh\nexit 0\n");
  return root;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
});

describe("terminal science workload", () => {
  it("parses canonical Terminal Science Bench task URIs", () => {
    expect(parseTerminalScienceTaskUri(taskUri)).toEqual({
      taskUri,
      taskRepo: "harbor-framework/terminal-bench-science",
      repoOwner: "harbor-framework",
      repoName: "terminal-bench-science",
      taskPath: "tasks/physical-sciences/chemistry-and-materials/example",
      domain: "physical-sciences",
      field: "chemistry-and-materials",
      taskName: "example",
    });
  });

  it("rejects non-canonical task URIs", () => {
    expect(() => parseTerminalScienceTaskUri("other/repo:tasks/a/b/c")).toThrow(
      "TSB task repo must be harbor-framework/terminal-bench-science",
    );
    expect(() =>
      parseTerminalScienceTaskUri(
        "harbor-framework/terminal-bench-science:/tasks/physical-sciences/chemistry-and-materials/example",
      ),
    ).toThrow("TSB task path must stay under tasks/");
    expect(() =>
      parseTerminalScienceTaskUri(
        "harbor-framework/terminal-bench-science:tasks/physical-sciences/../example",
      ),
    ).toThrow("TSB task path must stay under tasks/");
    expect(() => parseTerminalScienceTaskUri("harbor-framework/terminal-bench-science:tasks/a/b")).toThrow(
      "TSB task path must include tasks/domain/field/task",
    );
  });

  it("builds a saved goal without running the benchmark", () => {
    const goal = buildTerminalScienceGoal(defaultConfig(), { task: taskUri });

    expect(goal.kind).toBe("terminal_bench_science_goal");
    expect(goal.task_uri).toBe(taskUri);
    expect(goal.task_ref).toBe("main");
    expect(goal.agent_profile).toBe("codex");
    expect(goal.model).toBe("openai/gpt-5.4");
    expect(goal.environment).toBe("docker");
  });

  it("rejects unsupported environments before a run starts", () => {
    expect(() => buildTerminalScienceGoal(defaultConfig(), { task: taskUri, env: "slurm" })).toThrow(
      "--env must be docker",
    );
  });

  it("requires a task or saved goal for a run", async () => {
    await expect(buildAndRunTerminalScience(defaultConfig(), {}, undefined, undefined)).rejects.toThrow(
      "Set a Terminal Science Bench goal first, or pass --task.",
    );
  });

  it("writes a successful local run folder without Techtree publish inputs", async () => {
    const repoPath = await prepareTaskRepo();
    const runDir = await makeTempDir("terminal-science-run-");
    const config = defaultConfig(path.join(runDir, "config.json"));
    const run = await buildAndRunTerminalScience(
      config,
      { task: taskUri, run_dir: runDir },
      undefined,
      {
        tokenId: "agent_test",
        walletAddress: "0x1111111111111111111111111111111111111111",
        chainId: 8453,
        registryAddress: "0x2222222222222222222222222222222222222222",
      },
      {
        repoResolver: async () => ({ repoPath, commit: "abc123" }),
        runner: async (invocation) => ({
          command: ["harbor", "run", "-p", invocation.taskPath, "-a", invocation.agent, "-m", invocation.model],
          stdout: "verifier passed\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          startedAt: "2026-05-15T18:22:41.000Z",
          endedAt: "2026-05-15T18:22:42.000Z",
          durationMs: 1000,
        }),
      },
    );

    expect(run.ok).toBe(true);
    expect(run.status).toBe("passed");
    expect(run.run_dir).toBe(runDir);
    expect(run.files).toEqual({
      goal: path.join(runDir, "goal.json"),
      run_envelope: path.join(runDir, "run-envelope.json"),
      public_summary: path.join(runDir, "public-summary.json"),
      harbor_stdout: path.join(runDir, "harbor-stdout.log"),
      harbor_stderr: path.join(runDir, "harbor-stderr.log"),
      checksums: path.join(runDir, "checksums.json"),
    });

    const [goal, envelope, summary, stdout, stderr, checksums] = await Promise.all([
      fs.readFile(run.files.goal, "utf8").then(JSON.parse),
      fs.readFile(run.files.run_envelope, "utf8").then(JSON.parse),
      fs.readFile(run.files.public_summary, "utf8").then(JSON.parse),
      fs.readFile(run.files.harbor_stdout, "utf8"),
      fs.readFile(run.files.harbor_stderr, "utf8"),
      fs.readFile(run.files.checksums, "utf8").then(JSON.parse),
    ]);

    expect(goal.task_uri).toBe(taskUri);
    expect(summary.status).toBe("passed");
    expect(summary.reward).toBe(1);
    expect(stdout).toBe("verifier passed\n");
    expect(stderr).toBe("");
    expect(envelope.publish.publish_run).toBe(false);
    expect(envelope.task.commit).toBe("abc123");
    expect(envelope.ids.node_id).toBeNull();
    expect(envelope.ids.certificate_id).toBeNull();
    expect(envelope.artifacts.public.summary.uri).toBe("local:public-summary.json");
    expect(envelope.artifacts.private.stdout.visibility).toBe("reviewer_only");
    expect(Object.keys(checksums.files).sort()).toEqual([
      "goal.json",
      "harbor-stderr.log",
      "harbor-stdout.log",
      "public-summary.json",
      "run-envelope.json",
    ]);
  });

  it("writes a failed local run folder", async () => {
    const repoPath = await prepareTaskRepo();
    const runDir = await makeTempDir("terminal-science-failed-run-");
    const config = defaultConfig(path.join(runDir, "config.json"));
    const goal = buildTerminalScienceGoal(config, { task: taskUri });

    const run = await buildAndRunTerminalScience(
      config,
      { run_dir: runDir },
      goal,
      undefined,
      {
        repoResolver: async () => ({ repoPath, commit: "def456" }),
        runner: async () => ({
          command: ["harbor", "run", "-p", "tasks/physical-sciences/chemistry-and-materials/example", "-a", "codex", "-m", "openai/gpt-5.4"],
          stdout: "",
          stderr: "verifier failed\n",
          exitCode: 1,
          timedOut: false,
          startedAt: "2026-05-15T18:22:41.000Z",
          endedAt: "2026-05-15T18:22:42.000Z",
          durationMs: 1000,
        }),
      },
    );

    expect(run.status).toBe("failed");
    expect(run.public_summary.reward).toBe(0);
    expect(await fs.readFile(run.files.harbor_stderr, "utf8")).toBe("verifier failed\n");
  });

  it("requires a science-enabled Harbor adapter for non-Codex agents", async () => {
    const repoPath = await prepareTaskRepo();
    const runDir = await makeTempDir("terminal-science-openclaw-run-");
    const config = defaultConfig(path.join(runDir, "config.json"));

    await expect(
      buildAndRunTerminalScience(
        config,
        { task: taskUri, run_dir: runDir, agent: "openclaw" },
        undefined,
        undefined,
        {
          repoResolver: async () => ({ repoPath, commit: "abc123" }),
          runner: async () => {
            throw new Error("runner should not start");
          },
        },
      ),
    ).rejects.toThrow("OpenClaw needs a science-enabled Harbor adapter before it can run.");
  });
});
