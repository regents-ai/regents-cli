import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildBbhValidationRequest, loadBbhRunSubmitRequest, materializeBbhWorkspace } from "../../src/internal-runtime/workloads/bbh.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bbh-workload-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("BBH workload lanes", () => {
  it("materializes artifact.source.yaml with a public BBH lane that submit accepts", async () => {
    const workspaceRoot = await makeTempDir();
    const response = await materializeBbhWorkspace(
      {
        nextBbhAssignment: async () => ({
          data: {
            assignment_ref: "asg_climb",
            split: "climb",
            capsule: {
              capsule_id: "capsule_climb",
              provider: "bbh_train",
              provider_ref: "provider/climb",
              family_ref: null,
              instance_ref: "capsule_climb",
              split: "climb",
              language: "python",
              mode: "fixed",
              assignment_policy: "public_next",
              title: "Climb capsule",
              hypothesis: "Climb test capsule",
              protocol_md: "1. Run it",
              rubric_json: { items: [] },
              task_json: { capsule_id: "capsule_climb" },
              data_files: [],
              artifact_source: {
                schema_version: "techtree.bbh.artifact-source.v1",
              },
            },
          },
        }),
      } as any,
      {
        workloads: {
          bbh: {
            workspaceRoot,
          },
        },
      } as any,
      {
        workspace_path: path.join(workspaceRoot, "climb-run"),
        split: "climb",
      },
      {
        resolved_at: "2026-03-21T00:00:00.000Z",
        executor_harness: { kind: "hermes", profile: "bbh", entrypoint: "hermes" },
        origin: { kind: "local", transport: "api", session_id: null, trigger_ref: null },
        executor_harness_kind: "hermes",
        executor_harness_profile: "bbh",
        origin_session_id: null,
      },
    );

    const artifactSource = JSON.parse(
      await fs.readFile(path.join(response.workspace_path, "artifact.source.yaml"), "utf8"),
    ) as Record<string, any>;

    expect(artifactSource.bbh.split).toBe("climb");

    const submitRequest = await loadBbhRunSubmitRequest(response.workspace_path);
    expect(submitRequest.artifact_source?.bbh?.split).toBe("climb");
    expect(submitRequest.run_source.bbh.split).toBe("climb");
  });

  it("materializes challenge workspaces with the public challenge lane", async () => {
    const workspaceRoot = await makeTempDir();
    const response = await materializeBbhWorkspace(
      {
        nextBbhAssignment: async () => ({
          data: {
            assignment_ref: "asg_challenge",
            split: "challenge",
            capsule: {
              capsule_id: "capsule_challenge",
              provider: "techtree",
              provider_ref: "provider/challenge",
              family_ref: "family_challenge",
              instance_ref: null,
              split: "challenge",
              language: "python",
              mode: "family",
              assignment_policy: "operator_assigned",
              title: "Challenge capsule",
              hypothesis: "Fresh challenge",
              protocol_md: "1. Run it",
              rubric_json: { items: [] },
              task_json: { capsule_id: "capsule_challenge" },
              data_files: [],
              artifact_source: null,
            },
          },
        }),
      } as any,
      {
        workloads: {
          bbh: {
            workspaceRoot: workspaceRoot,
          },
        },
      } as any,
      {
        workspace_path: path.join(workspaceRoot, "challenge-run"),
        split: "challenge",
      },
      {
        resolved_at: "2026-03-21T00:00:00.000Z",
        executor_harness: { kind: "openclaw", profile: "bbh", entrypoint: null },
        origin: { kind: "local", transport: "api", session_id: null, trigger_ref: null },
        executor_harness_kind: "openclaw",
        executor_harness_profile: "bbh",
        origin_session_id: null,
      },
    );

    expect(response.split).toBe("challenge");

    const runSource = JSON.parse(
      await fs.readFile(path.join(response.workspace_path, "run.source.yaml"), "utf8"),
    ) as Record<string, any>;

    expect(runSource.bbh.split).toBe("challenge");
    expect(runSource.origin.trigger).toBe("validator");
  });

  it("rejects legacy non-public split values before submit", async () => {
    const workspaceRoot = await makeTempDir();
    const workspacePath = path.join(workspaceRoot, "legacy-run");
    await fs.mkdir(path.join(workspacePath, "outputs"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, "artifact.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.artifact-source.v1",
        bbh: {
          split: "climb",
          provider: "bbh_train",
          provider_ref: "provider/legacy",
          family_ref: null,
          instance_ref: "capsule_1",
          assignment_policy: "public_next",
          mode: "fixed",
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspacePath, "genome.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.genome-source.v1",
        model_id: "gpt-test",
        harness_type: "hermes",
        harness_version: "1.0.0",
        prompt_pack_version: "bbh-v0.1",
        skill_pack_version: "techtree-bbh-v0.1",
        tool_profile: "bbh",
        runtime_image: "local",
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspacePath, "artifact.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.artifact-source.v1",
        bbh: {
          split: "climb",
          provider: "bbh_train",
          provider_ref: "provider/climb",
          family_ref: null,
          instance_ref: "capsule_1",
          assignment_policy: "public_next",
          mode: "fixed",
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspacePath, "run.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.run-source.v1",
        artifact_ref: "capsule_1",
        executor: { type: "genome", id: "gen_1", harness: "hermes", harness_version: "1.0.0" },
        instance: { instance_ref: "capsule_1" },
        status: "completed",
        score: { raw: 1, normalized: 0.1 },
        bbh: { split: "train", genome_ref: "gen_1", provider: "bbh_train" },
      }),
      "utf8",
    );
    await fs.writeFile(path.join(workspacePath, "task.json"), JSON.stringify({}), "utf8");
    await fs.writeFile(path.join(workspacePath, "rubric.json"), JSON.stringify({}), "utf8");
    await fs.writeFile(path.join(workspacePath, "analysis.py"), "print('ok')\n", "utf8");
    await fs.writeFile(path.join(workspacePath, "protocol.md"), "1. Run it\n", "utf8");
    await fs.writeFile(path.join(workspacePath, "final_answer.md"), "", "utf8");
    await fs.writeFile(
      path.join(workspacePath, "outputs", "verdict.json"),
      JSON.stringify({ metrics: { raw_score: 1, normalized_score: 0.1 } }),
      "utf8",
    );

    await expect(loadBbhRunSubmitRequest(workspacePath)).rejects.toThrow(
      /public BBH lanes: climb, benchmark, challenge, or draft/,
    );
  });

  it("rejects benchmark or challenge runs without an assignment reference before submit", async () => {
    const workspaceRoot = await makeTempDir();
    const workspacePath = path.join(workspaceRoot, "missing-assignment-run");
    await fs.mkdir(path.join(workspacePath, "outputs"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, "artifact.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.artifact-source.v1",
        bbh: {
          split: "benchmark",
          provider: "bbh",
          provider_ref: "provider/benchmark",
          family_ref: null,
          instance_ref: "capsule_1",
          assignment_policy: "validator_assigned",
          mode: "fixed",
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspacePath, "genome.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.genome-source.v1",
        model_id: "gpt-test",
        harness_type: "hermes",
        harness_version: "1.0.0",
        prompt_pack_version: "bbh-v0.1",
        skill_pack_version: "techtree-bbh-v0.1",
        tool_profile: "bbh",
        runtime_image: "local",
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspacePath, "artifact.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.artifact-source.v1",
        bbh: {
          split: "climb",
          provider: "bbh_train",
          provider_ref: "provider/climb",
          family_ref: null,
          instance_ref: "capsule_1",
          assignment_policy: "public_next",
          mode: "fixed",
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspacePath, "run.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.run-source.v1",
        artifact_ref: "capsule_1",
        executor: { type: "genome", id: "gen_1", harness: "hermes", harness_version: "1.0.0" },
        instance: { instance_ref: "capsule_1" },
        status: "completed",
        score: { raw: 1, normalized: 0.1 },
        bbh: { split: "benchmark", genome_ref: "gen_1", provider: "bbh" },
      }),
      "utf8",
    );
    await fs.writeFile(path.join(workspacePath, "task.json"), JSON.stringify({}), "utf8");
    await fs.writeFile(path.join(workspacePath, "rubric.json"), JSON.stringify({}), "utf8");
    await fs.writeFile(path.join(workspacePath, "analysis.py"), "print('ok')\n", "utf8");
    await fs.writeFile(path.join(workspacePath, "protocol.md"), "1. Run it\n", "utf8");
    await fs.writeFile(path.join(workspacePath, "final_answer.md"), "", "utf8");
    await fs.writeFile(
      path.join(workspacePath, "outputs", "verdict.json"),
      JSON.stringify({ metrics: { raw_score: 1, normalized_score: 0.1 } }),
      "utf8",
    );

    await expect(loadBbhRunSubmitRequest(workspacePath)).rejects.toThrow(
      "benchmark and challenge runs require assignment_ref in run.source.yaml",
    );
  });

  it("rejects invalid schema versions and missing files with clear local errors", async () => {
    const workspaceRoot = await makeTempDir();
    const workspacePath = path.join(workspaceRoot, "invalid-files-run");
    await fs.mkdir(path.join(workspacePath, "outputs"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, "artifact.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.artifact-source.v0",
        bbh: {
          split: "climb",
          provider: "bbh_train",
          provider_ref: "provider/climb",
          family_ref: null,
          instance_ref: "capsule_1",
          assignment_policy: "public_next",
          mode: "fixed",
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspacePath, "genome.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.genome-source.v0",
        model_id: "gpt-test",
        harness_type: "hermes",
        harness_version: "1.0.0",
        prompt_pack_version: "bbh-v0.1",
        skill_pack_version: "techtree-bbh-v0.1",
        tool_profile: "bbh",
        runtime_image: "local",
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspacePath, "run.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.run-source.v1",
        artifact_ref: "capsule_1",
        executor: { type: "genome", id: "gen_1", harness: "hermes", harness_version: "1.0.0" },
        instance: { instance_ref: "capsule_1" },
        status: "completed",
        score: { raw: 1, normalized: 0.1 },
        bbh: { split: "climb", genome_ref: "gen_1", provider: "bbh_train" },
      }),
      "utf8",
    );
    await fs.writeFile(path.join(workspacePath, "task.json"), JSON.stringify({}), "utf8");
    await fs.writeFile(path.join(workspacePath, "rubric.json"), JSON.stringify({}), "utf8");
    await fs.writeFile(path.join(workspacePath, "analysis.py"), "print('ok')\n", "utf8");
    await fs.writeFile(path.join(workspacePath, "protocol.md"), "1. Run it\n", "utf8");
    await fs.writeFile(path.join(workspacePath, "final_answer.md"), "", "utf8");
    await fs.writeFile(
      path.join(workspacePath, "outputs", "verdict.json"),
      JSON.stringify({ metrics: { raw_score: 1, normalized_score: 0.1 } }),
      "utf8",
    );

    await expect(loadBbhRunSubmitRequest(workspacePath)).rejects.toThrow(
      "genome.source.yaml must declare techtree.bbh.genome-source.v1",
    );

    await fs.writeFile(
      path.join(workspacePath, "genome.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.genome-source.v1",
        model_id: "gpt-test",
        harness_type: "hermes",
        harness_version: "1.0.0",
        prompt_pack_version: "bbh-v0.1",
        skill_pack_version: "techtree-bbh-v0.1",
        tool_profile: "bbh",
        runtime_image: "local",
      }),
      "utf8",
    );

    await expect(loadBbhRunSubmitRequest(workspacePath)).rejects.toThrow(
      "artifact.source.yaml must declare techtree.bbh.artifact-source.v1",
    );

    await fs.writeFile(
      path.join(workspacePath, "artifact.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.artifact-source.v1",
        bbh: {
          split: "climb",
          provider: "bbh_train",
          provider_ref: "provider/climb",
          family_ref: null,
          instance_ref: "capsule_1",
          assignment_policy: "public_next",
          mode: "fixed",
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspacePath, "run.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.run-source.v0",
        artifact_ref: "capsule_1",
        executor: { type: "genome", id: "gen_1", harness: "hermes", harness_version: "1.0.0" },
        instance: { instance_ref: "capsule_1" },
        status: "completed",
        score: { raw: 1, normalized: 0.1 },
        bbh: { split: "climb", genome_ref: "gen_1", provider: "bbh_train" },
      }),
      "utf8",
    );

    await expect(loadBbhRunSubmitRequest(workspacePath)).rejects.toThrow(
      "run.source.yaml must declare techtree.bbh.run-source.v1",
    );

    await fs.writeFile(
      path.join(workspacePath, "run.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.run-source.v1",
        artifact_ref: "capsule_1",
        executor: { type: "genome", id: "gen_1", harness: "hermes", harness_version: "1.0.0" },
        instance: { instance_ref: "capsule_1" },
        status: "completed",
        score: { raw: 1, normalized: 0.1 },
        bbh: { split: "climb", genome_ref: "gen_1", provider: "bbh_train" },
      }),
      "utf8",
    );

    await fs.rm(path.join(workspacePath, "artifact.source.yaml"));
    await expect(loadBbhRunSubmitRequest(workspacePath)).rejects.toThrow(
      "missing required file: artifact.source.yaml",
    );
  });

  it("writes replay validation files that pass the local review contract checks", async () => {
    const workspaceRoot = await makeTempDir();
    const workspacePath = path.join(workspaceRoot, "validated-run");
    await fs.mkdir(path.join(workspacePath, "outputs"), { recursive: true });
    await fs.writeFile(
      path.join(workspacePath, "artifact.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.artifact-source.v1",
        bbh: {
          split: "benchmark",
          provider: "bbh",
          provider_ref: "provider/benchmark",
          family_ref: null,
          instance_ref: "capsule_1",
          assignment_policy: "validator_assigned",
          mode: "fixed",
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspacePath, "genome.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.genome-source.v1",
        model_id: "gpt-test",
        harness_type: "hermes",
        harness_version: "1.0.0",
        prompt_pack_version: "bbh-v0.1",
        skill_pack_version: "techtree-bbh-v0.1",
        tool_profile: "bbh",
        runtime_image: "local",
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(workspacePath, "run.source.yaml"),
      JSON.stringify({
        schema_version: "techtree.bbh.run-source.v1",
        artifact_ref: "capsule_1",
        executor: { type: "genome", id: "gen_1", harness: "hermes", harness_version: "1.0.0" },
        instance: { instance_ref: "capsule_1" },
        status: "completed",
        score: { raw: 5, normalized: 0.5 },
        bbh: {
          split: "benchmark",
          genome_ref: "gen_1",
          provider: "bbh",
          assignment_ref: "asg_1",
        },
      }),
      "utf8",
    );
    await fs.writeFile(path.join(workspacePath, "task.json"), JSON.stringify({}), "utf8");
    await fs.writeFile(path.join(workspacePath, "rubric.json"), JSON.stringify({}), "utf8");
    await fs.writeFile(path.join(workspacePath, "analysis.py"), "print('ok')\n", "utf8");
    await fs.writeFile(path.join(workspacePath, "protocol.md"), "1. Run it\n", "utf8");
    await fs.writeFile(path.join(workspacePath, "final_answer.md"), "", "utf8");
    await fs.writeFile(
      path.join(workspacePath, "outputs", "verdict.json"),
      JSON.stringify({ metrics: { raw_score: 5, normalized_score: 0.5 } }),
      "utf8",
    );

    const validation = await buildBbhValidationRequest(workspacePath, "run_1");
    expect(validation.review_source.method).toBe("replay");
    expect(validation.review_source.bbh.role).toBe("official");
    expect(validation.review_source.bbh.reproduced_raw_score).toBe(5);
  });
});
