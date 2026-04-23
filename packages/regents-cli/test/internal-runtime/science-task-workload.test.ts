import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  handleTechtreeScienceTasksExport,
  handleTechtreeScienceTasksInit,
  handleTechtreeScienceTasksReviewUpdate,
  handleTechtreeScienceTasksSubmit,
} from "../../src/internal-runtime/handlers/techtree.js";
import {
  initScienceTaskWorkspace,
  loadScienceTaskChecklistPayload,
  loadScienceTaskEvidencePayload,
  readScienceTaskWorkspaceMetadata,
  writeScienceTaskWorkspaceMetadata,
} from "../../src/internal-runtime/workloads/science-tasks.js";

const tempRoots: string[] = [];

const makeTempDir = async (prefix: string): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

describe("science-task workspace flows", () => {
  it("initializes a workspace and stores the linked Techtree task id", async () => {
    const workspace = await makeTempDir("science-task-init-");

    const result = await handleTechtreeScienceTasksInit(
      {
        techtree: {
          createScienceTask: async () => ({
            data: {
              node_id: 777,
              workflow_state: "authoring",
              packet_hash: "sha256:init-777",
              export_target_path: "tasks/life-sciences/biology/cell-atlas-benchmark",
            },
          }),
        },
      } as any,
      {
        workspace_path: workspace,
        title: "Cell atlas benchmark",
        science_domain: "life-sciences",
        science_field: "biology",
        task_slug: "cell-atlas-benchmark",
        claimed_expert_time: "2 hours",
      },
    );

    const metadata = await readScienceTaskWorkspaceMetadata(workspace);

    expect(result.node_id).toBe(777);
    expect(result.files).toContain("instruction.md");
    expect(result.files).toContain("science-task.json");
    expect(metadata.node_id).toBe(777);
    expect(metadata.task_slug).toBe("cell-atlas-benchmark");
  });

  it("fails clearly when checklist or evidence payloads are incomplete", async () => {
    const checklistWorkspace = await makeTempDir("science-task-checklist-");
    await initScienceTaskWorkspace(checklistWorkspace, {
      title: "Checklist task",
      science_domain: "life-sciences",
      science_field: "biology",
      task_slug: "checklist-task",
    });

    await expect(loadScienceTaskChecklistPayload(checklistWorkspace)).rejects.toThrow(
      "science task workspace is not linked to a Techtree task yet",
    );

    const evidenceWorkspace = await makeTempDir("science-task-evidence-");
    await initScienceTaskWorkspace(evidenceWorkspace, {
      title: "Evidence task",
      science_domain: "life-sciences",
      science_field: "biology",
      task_slug: "evidence-task",
    });

    const metadata = await readScienceTaskWorkspaceMetadata(evidenceWorkspace);
    await writeScienceTaskWorkspaceMetadata(evidenceWorkspace, {
      ...metadata,
      node_id: 902,
    });

    await expect(loadScienceTaskEvidencePayload(evidenceWorkspace)).rejects.toThrow(
      "science task workspace is missing oracle or frontier evidence",
    );
  });

  it("exports the task packet into the expected folder layout", async () => {
    const workspace = await makeTempDir("science-task-export-");
    const outputPath = path.join(workspace, "dist", "manual-export");

    await initScienceTaskWorkspace(workspace, {
      title: "Export task",
      science_domain: "life-sciences",
      science_field: "biology",
      task_slug: "export-task",
    });

    const metadata = await readScienceTaskWorkspaceMetadata(workspace);
    await writeScienceTaskWorkspaceMetadata(workspace, {
      ...metadata,
      node_id: 903,
    });

    const result = await handleTechtreeScienceTasksExport(
      {
        techtree: {
          getScienceTask: async () => ({
            data: {
              node_id: 903,
              title: "Export task",
              summary: "Export summary",
              science_domain: "life-sciences",
              science_field: "biology",
              task_slug: "export-task",
              workflow_state: "submitted",
              export_target_path: "tasks/life-sciences/biology/export-task",
              harbor_pr_url: "https://harbor.example/pr/903",
              review_round_count: 1,
              open_reviewer_concerns_count: 0,
              current_files_match_latest_evidence: true,
              latest_rerun_after_latest_fix: true,
              inserted_at: "2026-04-20T00:00:00.000Z",
              updated_at: "2026-04-20T00:00:00.000Z",
              node: null,
              structured_output_shape: null,
              claimed_expert_time: "2 hours",
              threshold_rationale: "Thresholds are documented.",
              anti_cheat_notes: "Hidden answers stay outside the packet.",
              reproducibility_notes: "Pinned dependencies keep reruns stable.",
              dependency_pinning_status: "Pinned",
              canary_status: "Present",
              destination_name: "harbor",
              packet_hash: "sha256:packet-903",
              evidence_packet_hash: "sha256:evidence-903",
              packet_files: {
                "instruction.md": {
                  encoding: "utf8",
                  content: "# Export task\n",
                },
                "tests/test_task.py": {
                  encoding: "utf8",
                  content: "def test_task():\n    assert True\n",
                },
              },
              checklist: {
                instruction_and_tests_match: {
                  status: "pass",
                },
              },
              oracle_run: {
                command: "uv run oracle",
                summary: "Oracle passes",
              },
              frontier_run: {
                command: "uv run frontier",
                summary: "Frontier misses one required field",
              },
              failure_analysis: "Frontier misses one required field.",
              latest_review_follow_up_note: "Ready for merge",
              last_rerun_at: "2026-04-20T13:00:00.000Z",
              latest_fix_at: "2026-04-20T12:00:00.000Z",
              any_concern_unanswered: false,
            },
          }),
        },
      } as any,
      {
        workspace_path: workspace,
        output_path: outputPath,
      },
    );

    expect(result.output_path).toBe(outputPath);
    expect(result.files).toContain("instruction.md");
    expect(result.files).toContain("tests/test_task.py");
    expect(result.files).toContain("techtree-review-sheet.md");
    expect(result.files).toContain("techtree-evidence.md");
    expect(await fs.readFile(path.join(outputPath, "instruction.md"), "utf8")).toContain("Export task");
    expect(await fs.readFile(path.join(outputPath, "techtree-submission-checklist.md"), "utf8")).toContain(
      "https://harbor.example/pr/903",
    );
  });

  it("persists review metadata after submit and review-update", async () => {
    const workspace = await makeTempDir("science-task-review-");

    await initScienceTaskWorkspace(workspace, {
      title: "Review task",
      science_domain: "life-sciences",
      science_field: "biology",
      task_slug: "review-task",
    });

    const metadata = await readScienceTaskWorkspaceMetadata(workspace);
    await writeScienceTaskWorkspaceMetadata(workspace, {
      ...metadata,
      node_id: 904,
    });

    await handleTechtreeScienceTasksSubmit(
      {
        techtree: {
          submitScienceTask: async () => ({
            data: {
              node_id: 904,
              workflow_state: "submitted",
              packet_hash: "sha256:submit-904",
              export_target_path: "tasks/life-sciences/biology/review-task",
            },
          }),
          reviewUpdateScienceTask: async () => ({
            data: {
              node_id: 904,
              workflow_state: "merge_ready",
              packet_hash: "sha256:review-904",
              export_target_path: "tasks/life-sciences/biology/review-task",
            },
          }),
        },
      } as any,
      {
        workspace_path: workspace,
        harbor_pr_url: "https://harbor.example/pr/904",
        latest_review_follow_up_note: "Sent back after submit",
      },
    );

    await handleTechtreeScienceTasksReviewUpdate(
      {
        techtree: {
          submitScienceTask: async () => ({
            data: {
              node_id: 904,
              workflow_state: "submitted",
              packet_hash: "sha256:submit-904",
              export_target_path: "tasks/life-sciences/biology/review-task",
            },
          }),
          reviewUpdateScienceTask: async () => ({
            data: {
              node_id: 904,
              workflow_state: "merge_ready",
              packet_hash: "sha256:review-904",
              export_target_path: "tasks/life-sciences/biology/review-task",
            },
          }),
        },
      } as any,
      {
        workspace_path: workspace,
        harbor_pr_url: "https://harbor.example/pr/904",
        latest_review_follow_up_note: "All reviewer comments addressed",
        open_reviewer_concerns_count: 0,
        any_concern_unanswered: false,
        latest_rerun_after_latest_fix: true,
        latest_fix_at: "2026-04-20T12:00:00.000Z",
        last_rerun_at: "2026-04-20T13:00:00.000Z",
      },
    );

    const persisted = await readScienceTaskWorkspaceMetadata(workspace);

    expect(persisted.harbor_pr_url).toBe("https://harbor.example/pr/904");
    expect(persisted.latest_review_follow_up_note).toBe("All reviewer comments addressed");
    expect(persisted.open_reviewer_concerns_count).toBe(0);
    expect(persisted.any_concern_unanswered).toBe(false);
    expect(persisted.latest_rerun_after_latest_fix).toBe(true);
    expect(persisted.latest_fix_at).toBe("2026-04-20T12:00:00.000Z");
    expect(persisted.last_rerun_at).toBe("2026-04-20T13:00:00.000Z");
  });
});
