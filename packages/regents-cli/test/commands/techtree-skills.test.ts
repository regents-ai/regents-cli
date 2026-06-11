import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const { daemonCallMock, spawnMock, loadAgentAuthStateMock, resolveSigningContextMock, buildHeadersMock, resolveCoreDirMock } =
  vi.hoisted(() => ({
    daemonCallMock: vi.fn(),
    spawnMock: vi.fn(),
    loadAgentAuthStateMock: vi.fn(),
    resolveSigningContextMock: vi.fn(),
    buildHeadersMock: vi.fn(),
    resolveCoreDirMock: vi.fn(),
  }));

vi.mock("../../src/daemon-client.js", () => ({
  daemonCall: daemonCallMock,
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));

vi.mock("../../src/commands/agent-auth.js", () => ({
  loadAgentAuthState: loadAgentAuthStateMock,
}));

vi.mock("../../src/internal-runtime/techtree/auth.js", () => ({
  resolveAuthenticatedAgentSigningContext: resolveSigningContextMock,
}));

vi.mock("../../src/internal-runtime/siwa/signing.js", () => ({
  buildSignerBackedAgentHeaders: buildHeadersMock,
}));

vi.mock("../../src/internal-runtime/techtree/core.js", () => ({
  resolveTechtreeCoreDir: resolveCoreDirMock,
}));

class FakeEngineChild extends EventEmitter {
  stdout = new PassThrough({ encoding: "utf8" });
  stderr = new PassThrough({ encoding: "utf8" });
  stdinChunks: string[] = [];
  stdin = {
    write: (chunk: string): boolean => {
      this.stdinChunks.push(chunk);
      return true;
    },
    end: (): void => {},
  };
}

const fakeConfig = {
  services: {
    techtree: { baseUrl: "https://techtree.example", requestTimeoutMs: 5_000 },
    siwa: { requestTimeoutMs: 5_000 },
  },
  runtime: { stateDir: "/tmp/regents-test-state", socketPath: "/tmp/regents-test.sock" },
};

const capsuleListResponse = {
  data: [
    {
      capsule_id: "bench_a",
      family_ref: "chem-synthesis",
      current_version_id: "benchv_a1",
    },
    {
      capsule_id: "bench_b",
      family_ref: "chem-synthesis",
      current_version_id: "benchv_b1",
    },
    {
      capsule_id: "bench_other",
      family_ref: "other-family",
      current_version_id: "benchv_o1",
    },
  ],
};

const engineReport = {
  run_id: "skillopt-run-1",
  family_ref: "chem-synthesis",
  train_version_ids: ["benchv_a1"],
  val_version_ids: ["benchv_b1"],
  improved: true,
  best_skill_md: "# Optimized skill\n\n- new rule\n",
  skipped_rounds: [],
  steps: [
    {
      round: 0,
      accepted: true,
      edit_count: 2,
      published_node_id: null,
      verdict: {
        step_id: "skillopt-run-1-step-0",
        run_id: "skillopt-run-1",
        round: 0,
        accepted: true,
        val_solve_rate_before: 0.25,
        val_solve_rate_after: 0.5,
        train_solve_rate: 0.5,
      },
    },
  ],
  publish_intents: {
    skill_versions: [
      {
        verdict: {
          step_id: "skillopt-run-1-step-0",
          run_id: "skillopt-run-1",
          round: 0,
          accepted: true,
          val_solve_rate_before: 0.25,
          val_solve_rate_after: 0.5,
          train_solve_rate: 0.5,
        },
        skill_md: "# Optimized skill\n\n- new rule\n",
      },
    ],
    null_results: [],
  },
};

const optimizeArgs = (workspace: string): string[] => [
  "techtree",
  "skills",
  "optimize",
  "--capsule-set",
  "chem-synthesis",
  "--workspace",
  workspace,
  "--skill-slug",
  "chem-helper",
  "--val-fraction",
  "0.25",
  "--rounds",
  "4",
  "--frozen-harness-base",
  "harness_123",
  "--budget-tokens",
  "1200",
];

describe("techtree skills optimize", () => {
  let workspace: string;

  beforeEach(() => {
    vi.resetAllMocks();
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "skillopt-test-"));
    fs.writeFileSync(path.join(workspace, "SKILL.md"), "# Skill\n\n- rule\n");

    loadAgentAuthStateMock.mockReturnValue({
      config: fakeConfig,
      stateStore: {},
      sessionStore: {},
      session: { receipt: "receipt-1" },
      identity: {},
    });
    resolveSigningContextMock.mockResolvedValue({
      session: { receipt: "receipt-1" },
      identity: {
        walletAddress: "0x1111111111111111111111111111111111111111",
        chainId: 84532,
        registryAddress: "0x2222222222222222222222222222222222222222",
        tokenId: "7",
      },
      signer: { signMessage: vi.fn().mockResolvedValue("0xsigned") },
    });
    buildHeadersMock.mockResolvedValue({ "x-siwa-receipt": "receipt-1", signature: "sig1=:abc:" });
    resolveCoreDirMock.mockResolvedValue("/opt/techtree/core");
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const dispatchEngine = (report: unknown, exitCode = 0): FakeEngineChild => {
    const child = new FakeEngineChild();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        if (exitCode === 0) {
          child.stdout.write(`${JSON.stringify(report)}\n`);
        } else {
          child.stderr.write("engine failed\n");
        }
        child.emit("close", exitCode);
      });
      return child;
    });
    return child;
  };

  it("resolves the capsule set, spawns the engine, and reports the optimized skill", async () => {
    daemonCallMock.mockResolvedValue(capsuleListResponse);
    const child = dispatchEngine(engineReport);

    const { runTechtreeSkillsOptimize } = await import("../../src/commands/techtree-skills.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    const output = await captureOutput(() =>
      runTechtreeSkillsOptimize(parseCliArgs(optimizeArgs(workspace))),
    );

    expect(daemonCallMock).toHaveBeenCalledWith(
      "techtree.benchmarks.capsules.list",
      { limit: 200 },
      undefined,
    );

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(command).toBe("uv");
    expect(args).toEqual([
      "run",
      "--directory",
      "/opt/techtree/core",
      "python",
      "-m",
      "techtree_core.skillopt",
      "--config",
      "-",
    ]);
    expect(options.env.REGENT_TECHTREE_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(options.env.REGENT_TECHTREE_AGENT_HEADERS).toBe("{}");

    const engineConfig = JSON.parse(child.stdinChunks.join("")) as Record<string, unknown>;
    expect(engineConfig).toMatchObject({
      family_ref: "chem-synthesis",
      capsules: [
        { capsule_id: "bench_a", version_id: "benchv_a1" },
        { capsule_id: "bench_b", version_id: "benchv_b1" },
      ],
      val_fraction: 0.25,
      rounds: 4,
      budget_tokens: 1200,
      frozen_harness_base: { harness_id: "harness_123" },
      skill_slug: "chem-helper",
      skill_path: path.join(workspace, "SKILL.md"),
      workspace_root: path.join(workspace, ".skillopt", "runs"),
    });

    const printed = parsePrintedJson(output.stdout) as {
      data: Record<string, unknown> & { next_steps: string[] };
    };
    expect(printed.data.run_id).toBe("skillopt-run-1");
    expect(printed.data.improved).toBe(true);
    expect(printed.data.optimized_skill_path).toBe(path.join(workspace, "SKILL.optimized.md"));
    expect(printed.data.publish_intents).toEqual({
      skill_versions: [{ verdict: engineReport.steps[0].verdict }],
      null_results: [],
    });
    expect(printed.data.next_steps[0]).toContain("regents techtree autoskill publish skill");
    expect(fs.readFileSync(path.join(workspace, "SKILL.optimized.md"), "utf8")).toBe(
      engineReport.best_skill_md,
    );
  });

  it("keeps the skill document unchanged when no candidate is accepted", async () => {
    daemonCallMock.mockResolvedValue(capsuleListResponse);
    dispatchEngine({
      ...engineReport,
      improved: false,
      steps: [],
      publish_intents: { skill_versions: [], null_results: [] },
    });

    const { runTechtreeSkillsOptimize } = await import("../../src/commands/techtree-skills.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    const output = await captureOutput(() =>
      runTechtreeSkillsOptimize(parseCliArgs(optimizeArgs(workspace))),
    );

    const printed = parsePrintedJson(output.stdout) as { data: Record<string, unknown> };
    expect(printed.data.improved).toBe(false);
    expect(printed.data.optimized_skill_path).toBeUndefined();
    expect(fs.existsSync(path.join(workspace, "SKILL.optimized.md"))).toBe(false);
  });

  it("fails when the engine exits with a non-zero code", async () => {
    daemonCallMock.mockResolvedValue(capsuleListResponse);
    dispatchEngine(undefined, 3);

    const { runTechtreeSkillsOptimize } = await import("../../src/commands/techtree-skills.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    await expect(
      captureOutput(() => runTechtreeSkillsOptimize(parseCliArgs(optimizeArgs(workspace)))),
    ).rejects.toThrow("skill optimization engine exited with code 3");
  });

  it("rejects a val fraction outside (0, 1)", async () => {
    const { runTechtreeSkillsOptimize } = await import("../../src/commands/techtree-skills.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    const args = optimizeArgs(workspace).map((value) => (value === "0.25" ? "1.5" : value));
    await expect(runTechtreeSkillsOptimize(parseCliArgs(args))).rejects.toThrow(
      "invalid --val-fraction",
    );
    expect(daemonCallMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("requires SKILL.md in the workspace", async () => {
    fs.rmSync(path.join(workspace, "SKILL.md"));

    const { runTechtreeSkillsOptimize } = await import("../../src/commands/techtree-skills.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    await expect(runTechtreeSkillsOptimize(parseCliArgs(optimizeArgs(workspace)))).rejects.toThrow(
      "no SKILL.md found",
    );
  });

  it("fails when the capsule set has no matching capsules", async () => {
    daemonCallMock.mockResolvedValue({ data: [{ capsule_id: "bench_x", family_ref: "different" }] });

    const { runTechtreeSkillsOptimize } = await import("../../src/commands/techtree-skills.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    await expect(runTechtreeSkillsOptimize(parseCliArgs(optimizeArgs(workspace)))).rejects.toThrow(
      "no benchmark capsules found for capsule set chem-synthesis",
    );
  });

  it("fails when a capsule in the set has no published version", async () => {
    daemonCallMock.mockResolvedValue({
      data: [
        { capsule_id: "bench_a", family_ref: "chem-synthesis", current_version_id: "benchv_a1" },
        { capsule_id: "bench_b", family_ref: "chem-synthesis", current_version_id: null },
      ],
    });

    const { runTechtreeSkillsOptimize } = await import("../../src/commands/techtree-skills.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    await expect(runTechtreeSkillsOptimize(parseCliArgs(optimizeArgs(workspace)))).rejects.toThrow(
      "capsules without a published version: bench_b",
    );
  });

  it("fails when the capsule set is too small to split", async () => {
    daemonCallMock.mockResolvedValue({
      data: [
        { capsule_id: "bench_a", family_ref: "chem-synthesis", current_version_id: "benchv_a1" },
      ],
    });

    const { runTechtreeSkillsOptimize } = await import("../../src/commands/techtree-skills.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    await expect(runTechtreeSkillsOptimize(parseCliArgs(optimizeArgs(workspace)))).rejects.toThrow(
      "needs at least 2 capsules",
    );
  });
});

describe("skill-opt signing proxy", () => {
  it("re-signs and forwards skill-opt requests, passing the upstream response through", async () => {
    const signHeaders = vi.fn().mockResolvedValue({ signature: "sig1=:abc:" });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { run_id: "skillopt-run-1" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const { startSkillOptSigningProxy } = await import("../../src/commands/techtree-skills.js");
    const proxy = await startSkillOptSigningProxy({
      upstreamBaseUrl: "https://techtree.example",
      signHeaders,
      fetchImpl,
    });

    try {
      const body = JSON.stringify({ run_id: "skillopt-run-1" });
      const response = await fetch(`${proxy.baseUrl}/v1/agent/skill-opt/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ data: { run_id: "skillopt-run-1" } });
      expect(signHeaders).toHaveBeenCalledWith({
        method: "POST",
        path: "/v1/agent/skill-opt/runs",
        body,
      });
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://techtree.example/v1/agent/skill-opt/runs",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            signature: "sig1=:abc:",
            "content-type": "application/json",
          }),
          body,
        }),
      );
    } finally {
      await proxy.close();
    }
  });

  it("refuses requests outside the skill-opt agent surface", async () => {
    const signHeaders = vi.fn();
    const fetchImpl = vi.fn();

    const { startSkillOptSigningProxy } = await import("../../src/commands/techtree-skills.js");
    const proxy = await startSkillOptSigningProxy({
      upstreamBaseUrl: "https://techtree.example",
      signHeaders,
      fetchImpl,
    });

    try {
      const response = await fetch(`${proxy.baseUrl}/v1/tree/nodes`, {
        method: "POST",
        body: "{}",
      });
      expect(response.status).toBe(404);
      expect(signHeaders).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await proxy.close();
    }
  });

  it("returns 502 when forwarding fails", async () => {
    const signHeaders = vi.fn().mockResolvedValue({});
    const fetchImpl = vi.fn().mockRejectedValue(new Error("upstream unreachable"));

    const { startSkillOptSigningProxy } = await import("../../src/commands/techtree-skills.js");
    const proxy = await startSkillOptSigningProxy({
      upstreamBaseUrl: "https://techtree.example",
      signHeaders,
      fetchImpl,
    });

    try {
      const response = await fetch(`${proxy.baseUrl}/v1/agent/skill-opt/runs`, {
        method: "POST",
        body: "{}",
      });
      expect(response.status).toBe(502);
      const payload = (await response.json()) as { error: { message: string } };
      expect(payload.error.message).toBe("upstream unreachable");
    } finally {
      await proxy.close();
    }
  });
});
