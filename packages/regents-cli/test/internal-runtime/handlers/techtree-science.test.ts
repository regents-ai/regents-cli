import { describe, expect, it, vi } from "vitest";

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

const { handleTechtreeScienceRun } = await import("../../../src/internal-runtime/handlers/techtree/science.js");

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
});
