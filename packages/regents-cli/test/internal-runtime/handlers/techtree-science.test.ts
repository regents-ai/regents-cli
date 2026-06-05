import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultConfig } from "../../../src/internal-runtime/config.js";
import type { RuntimeContext } from "../../../src/internal-runtime/runtime.js";
import type { TerminalScienceGoal, TerminalScienceRunResponse } from "../../../src/internal-types/index.js";

const buildAndRunTerminalScienceMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/internal-runtime/workloads/terminal-science.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/internal-runtime/workloads/terminal-science.js")>();
  return {
    ...actual,
    buildAndRunTerminalScience: buildAndRunTerminalScienceMock,
  };
});

const { handleTechtreeScienceAgentSet, handleTechtreeScienceRun, handleTechtreeScienceSetGoal } =
  await import("../../../src/internal-runtime/handlers/techtree/science.js");

const tempDirs: string[] = [];

const makeTempDir = async (prefix: string): Promise<string> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
});

describe("techtree science handler", () => {
  it("runs locally without creating Techtree benchmark records", async () => {
    const goal: TerminalScienceGoal = {
      goal_id: "tsg_test",
      kind: "terminal_bench_science_goal",
      task_uri: "harbor-framework/terminal-bench-science:tasks/physical-sciences/chemistry-and-materials/example",
      task_repo: "harbor-framework/terminal-bench-science",
      task_ref: "main",
      task_path: "tasks/physical-sciences/chemistry-and-materials/example",
      agent_profile: "codex",
      model: "openai/gpt-5.4",
      environment: "docker",
      status: "active",
      updated_at: "2026-05-15T00:00:00.000Z",
    };
    const run: TerminalScienceRunResponse = {
      ok: true,
      goal,
      run_id: "tsr_test",
      local_attempt_id: "local_test",
      run_dir: "/tmp/terminal-science-run",
      status: "passed",
      exit_code: 0,
      command: "harbor run -p tasks/physical-sciences/chemistry-and-materials/example -a codex -m openai/gpt-5.4",
      public_summary: { status: "passed" },
      artifact_envelope: {
        artifacts: { public: {}, private: {} },
        publish: { publish_run: false },
      },
      files: {
        goal: "/tmp/terminal-science-run/goal.json",
        run_envelope: "/tmp/terminal-science-run/run-envelope.json",
        public_summary: "/tmp/terminal-science-run/public-summary.json",
        harbor_stdout: "/tmp/terminal-science-run/harbor-stdout.log",
        harbor_stderr: "/tmp/terminal-science-run/harbor-stderr.log",
        checksums: "/tmp/terminal-science-run/checksums.json",
      },
      checksums: {},
    };
    const techtree = {
      createScienceGoal: vi.fn(),
      getActiveScienceGoal: vi.fn(),
      createScienceRun: vi.fn(),
      uploadScienceRunArtifacts: vi.fn(),
      publishScienceRun: vi.fn(),
      createBenchmarkCapsule: vi.fn(),
      createBenchmarkVersion: vi.fn(),
      getBenchmarkHarness: vi.fn(),
      createBenchmarkHarness: vi.fn(),
      createBenchmarkAttempt: vi.fn(),
      createBenchmarkValidation: vi.fn(),
      publishBenchmarkCapsule: vi.fn(),
      getBenchmarkAttemptProof: vi.fn(),
    };
    const stateStore = {
      read: vi.fn(() => ({ techtreeScienceGoal: goal })),
      patch: vi.fn(),
    };
    const ctx = {
      config: defaultConfig(),
      stateStore,
      techtree,
    } as unknown as RuntimeContext;

    buildAndRunTerminalScienceMock.mockResolvedValueOnce(run);

    await expect(handleTechtreeScienceRun(ctx, { run_dir: "/tmp/terminal-science-run" })).resolves.toEqual(run);
    expect(buildAndRunTerminalScienceMock).toHaveBeenCalledWith(
      ctx.config,
      { run_dir: "/tmp/terminal-science-run" },
      goal,
      undefined,
    );
    expect(stateStore.patch).toHaveBeenCalledWith({ techtreeScienceGoal: goal });
    expect(techtree.createBenchmarkCapsule).not.toHaveBeenCalled();
    expect(techtree.createBenchmarkAttempt).not.toHaveBeenCalled();
    expect(techtree.createBenchmarkValidation).not.toHaveBeenCalled();
    expect(techtree.publishBenchmarkCapsule).not.toHaveBeenCalled();
  });

  it("saves Terminal Science goals in Techtree", async () => {
    const goal: TerminalScienceGoal = {
      goal_id: "tsg_remote",
      kind: "terminal_bench_science_goal",
      task_uri: "harbor-framework/terminal-bench-science:tasks/physical-sciences/chemistry-and-materials/example",
      task_repo: "harbor-framework/terminal-bench-science",
      task_ref: "main",
      task_path: "tasks/physical-sciences/chemistry-and-materials/example",
      agent_profile: "codex",
      model: "openai/gpt-5.4",
      environment: "docker",
      status: "active",
      updated_at: "2026-05-15T00:00:00.000Z",
    };
    const stateStore = { patch: vi.fn() };
    const techtree = {
      createScienceGoal: vi.fn().mockResolvedValue({ data: goal }),
    };
    const ctx = {
      config: defaultConfig(),
      stateStore,
      techtree,
    } as unknown as RuntimeContext;

    await expect(handleTechtreeScienceSetGoal(ctx, { task: goal.task_uri })).resolves.toEqual({
      ok: true,
      goal,
    });
    expect(techtree.createScienceGoal).toHaveBeenCalledWith({
      task: goal.task_uri,
      agent: "codex",
      model: "openai/gpt-5.4",
      env: "docker",
    });
    expect(stateStore.patch).toHaveBeenCalledWith({ techtreeScienceGoal: goal });
  });

  it("publishes local runs through the Terminal Science endpoints", async () => {
    const goal: TerminalScienceGoal = {
      goal_id: "tsg_publish",
      kind: "terminal_bench_science_goal",
      task_uri: "harbor-framework/terminal-bench-science:tasks/physical-sciences/chemistry-and-materials/example",
      task_repo: "harbor-framework/terminal-bench-science",
      task_ref: "main",
      task_path: "tasks/physical-sciences/chemistry-and-materials/example",
      agent_profile: "codex",
      model: "openai/gpt-5.4",
      environment: "docker",
      status: "active",
      updated_at: "2026-05-15T00:00:00.000Z",
    };
    const artifactEnvelope = {
      ids: { goal_id: goal.goal_id, run_id: "tsr_publish" },
      artifacts: { public: { summary: { uri: "local:summary.json" } }, private: {} },
      publish: { publish_run: false, visibility: "local" },
    };
    const run: TerminalScienceRunResponse = {
      ok: true,
      goal,
      run_id: "tsr_publish",
      local_attempt_id: "local_publish",
      run_dir: "/tmp/terminal-science-run",
      status: "passed",
      exit_code: 0,
      command: "harbor run -p tasks/physical-sciences/chemistry-and-materials/example -a codex -m openai/gpt-5.4",
      public_summary: { status: "passed" },
      artifact_envelope: artifactEnvelope,
      files: {
        goal: "/tmp/terminal-science-run/goal.json",
        run_envelope: "/tmp/terminal-science-run/run-envelope.json",
        public_summary: "/tmp/terminal-science-run/public-summary.json",
        harbor_stdout: "/tmp/terminal-science-run/harbor-stdout.log",
        harbor_stderr: "/tmp/terminal-science-run/harbor-stderr.log",
        checksums: "/tmp/terminal-science-run/checksums.json",
      },
      checksums: {},
    };
    const techtree = {
      createScienceRun: vi.fn().mockResolvedValue({ data: { run_id: run.run_id, created: true } }),
      uploadScienceRunArtifacts: vi.fn().mockResolvedValue({ data: { run_id: run.run_id, uploaded: true } }),
      publishScienceRun: vi.fn().mockResolvedValue({
        data: {
          run: { run_id: run.run_id },
          publication: { node_id: 123, status: "pinned" },
        },
      }),
    };
    const stateStore = {
      read: vi.fn(() => ({ techtreeScienceGoal: goal })),
      patch: vi.fn(),
    };
    const ctx = {
      config: defaultConfig(),
      stateStore,
      techtree,
    } as unknown as RuntimeContext;

    buildAndRunTerminalScienceMock.mockResolvedValueOnce(run);

    const published = await handleTechtreeScienceRun(ctx, { publish_run: true });

    expect(published.publication).toEqual({ node_id: 123, status: "pinned" });
    expect(techtree.createScienceRun).toHaveBeenCalledWith({
      goal_id: goal.goal_id,
      artifact_envelope: expect.objectContaining({
        publish: expect.objectContaining({ publish_run: true, visibility: "public" }),
      }),
    });
    expect(techtree.uploadScienceRunArtifacts).toHaveBeenCalledWith(run.run_id, {
      artifacts: artifactEnvelope.artifacts,
    });
    expect(techtree.publishScienceRun).toHaveBeenCalledWith(run.run_id, { visibility: "public" });
  });

  it("updates the configured Terminal Science agent", async () => {
    const tempDir = await makeTempDir("terminal-science-agent-config-");
    const configPath = path.join(tempDir, "config.json");
    const config = defaultConfig(configPath);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    const ctx = {
      config,
      runtime: { configPath },
    } as unknown as RuntimeContext;

    await expect(handleTechtreeScienceAgentSet(ctx, { agent: "hermes" })).resolves.toEqual({
      ok: true,
      agent: "hermes",
      config_path: configPath,
    });

    const saved = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      workloads: { science: { defaultAgent: string } };
    };
    expect(saved.workloads.science.defaultAgent).toBe("hermes");
    expect(config.workloads.science.defaultAgent).toBe("hermes");
  });
});
