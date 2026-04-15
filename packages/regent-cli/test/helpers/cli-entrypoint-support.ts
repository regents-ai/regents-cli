import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

export const TEST_WALLET = "0x1111111111111111111111111111111111111111";
export const TEST_REGISTRY = "0x2222222222222222222222222222222222222222";

const cliMocks = vi.hoisted(() => ({
  daemonCallMock: vi.fn(),
  runDoctorMock: vi.fn(),
  runScopedDoctorMock: vi.fn(),
  runFullDoctorMock: vi.fn(),
  initializeXmtpMock: vi.fn(),
  getXmtpStatusMock: vi.fn(),
  resolveXmtpInboxIdMock: vi.fn(),
  resolveXmtpIdentifierMock: vi.fn(),
  ensureXmtpPolicyFileMock: vi.fn(),
  openXmtpPolicyInEditorMock: vi.fn(),
  testXmtpDmMock: vi.fn(),
  listXmtpGroupsMock: vi.fn(),
  createXmtpGroupMock: vi.fn(),
  addXmtpGroupMembersMock: vi.fn(),
  removeXmtpGroupMembersMock: vi.fn(),
  listXmtpGroupMembersMock: vi.fn(),
  getXmtpGroupPermissionsMock: vi.fn(),
  updateXmtpGroupPermissionMock: vi.fn(),
  listXmtpGroupAdminsMock: vi.fn(),
  listXmtpGroupSuperAdminsMock: vi.fn(),
  addXmtpGroupAdminMock: vi.fn(),
  removeXmtpGroupAdminMock: vi.fn(),
  addXmtpGroupSuperAdminMock: vi.fn(),
  removeXmtpGroupSuperAdminMock: vi.fn(),
  revokeAllOtherXmtpInstallationsMock: vi.fn(),
  rotateXmtpDbKeyMock: vi.fn(),
  rotateXmtpWalletMock: vi.fn(),
  runTechtreeCoreJsonMock: vi.fn(),
  loadTechtreeRuntimeClientMock: vi.fn(),
  techtreeRuntimeClientMock: {
    fetchNode: vi.fn(),
    pinNode: vi.fn(),
    publishNode: vi.fn(),
  },
}));

vi.mock("../../src/daemon-client.js", () => ({
  daemonCall: cliMocks.daemonCallMock,
}));

export const {
  daemonCallMock,
  runDoctorMock,
  runScopedDoctorMock,
  runFullDoctorMock,
  initializeXmtpMock,
  getXmtpStatusMock,
  resolveXmtpInboxIdMock,
  resolveXmtpIdentifierMock,
  ensureXmtpPolicyFileMock,
  openXmtpPolicyInEditorMock,
  testXmtpDmMock,
  listXmtpGroupsMock,
  createXmtpGroupMock,
  addXmtpGroupMembersMock,
  removeXmtpGroupMembersMock,
  listXmtpGroupMembersMock,
  getXmtpGroupPermissionsMock,
  updateXmtpGroupPermissionMock,
  listXmtpGroupAdminsMock,
  listXmtpGroupSuperAdminsMock,
  addXmtpGroupAdminMock,
  removeXmtpGroupAdminMock,
  addXmtpGroupSuperAdminMock,
  removeXmtpGroupSuperAdminMock,
  revokeAllOtherXmtpInstallationsMock,
  rotateXmtpDbKeyMock,
  rotateXmtpWalletMock,
  runTechtreeCoreJsonMock,
  loadTechtreeRuntimeClientMock,
  techtreeRuntimeClientMock,
} = cliMocks;

export interface CommandCase {
  name: string;
  args: string[];
  expected: unknown;
}

export interface CliEntrypointHarness {
  readonly tempDir: string;
  readonly configPath: string;
  readonly runCliEntrypoint: typeof import("../../src/index.js").runCliEntrypoint;
}

const doctorReport = (mode: "default" | "scoped" | "full", scope?: string) => ({
  ok: true,
  mode,
  ...(scope ? { scope } : {}),
  summary: { ok: 1, warn: 0, fail: 0, skip: 0 },
  checks: [],
  nextSteps: [],
  generatedAt: "2026-03-11T00:00:00.000Z",
});

const resolveRunMetadataResponse = (metadata: Record<string, unknown>) => {
  const executorHarness =
    metadata.executor_harness && typeof metadata.executor_harness === "object"
      ? (metadata.executor_harness as Record<string, unknown>)
      : {};
  const origin =
    metadata.origin && typeof metadata.origin === "object"
      ? (metadata.origin as Record<string, unknown>)
      : {};

  return {
    resolved_at: "2026-03-20T00:00:00.000Z",
    executor_harness: {
      kind: String(executorHarness.kind ?? "custom"),
      profile: String(executorHarness.profile ?? "owner"),
      entrypoint:
        executorHarness.entrypoint === undefined ? null : (executorHarness.entrypoint as string | null),
    },
    origin: {
      kind: String(origin.kind ?? "local"),
      transport: origin.transport === undefined ? null : (origin.transport as string | null),
      session_id: origin.session_id === undefined ? null : (origin.session_id as string | null),
      trigger_ref: origin.trigger_ref === undefined ? null : (origin.trigger_ref as string | null),
    },
    executor_harness_kind: String(executorHarness.kind ?? "custom"),
    executor_harness_profile: String(executorHarness.profile ?? "owner"),
    origin_session_id: origin.session_id === undefined ? null : (origin.session_id as string | null),
  };
};

const defaultAgentState = () => ({
  initializedAt: "2026-03-20T00:00:00.000Z",
  resolved_at: "2026-03-20T00:00:00.000Z",
  executor_harness: {
    kind: "custom",
    profile: "owner",
    entrypoint: "regent agent init",
  },
  origin: {
    kind: "local",
    transport: "api",
    session_id: null,
    trigger_ref: "regent agent init",
  },
  executor_harness_kind: "custom",
  executor_harness_profile: "owner",
  origin_session_id: null,
});

const agentProfileSummary = (name: string, active: boolean) => ({
  name,
  kind: name === "owner" || name === "public" || name === "group" ? name : "custom",
  label:
    name === "owner"
      ? "Owner agent profile"
      : name === "public"
        ? "Public agent profile"
        : name === "group"
          ? "Group agent profile"
          : "Custom agent profile",
  active,
  executor_harness_kind: "custom",
  executor_harness_profile: name,
  origin_session_id: null,
  executor_harness: {
    kind: "custom",
    profile: name,
    entrypoint: "regent agent init",
  },
  origin: {
    kind: "local",
    transport: "api",
    session_id: null,
    trigger_ref: "regent agent init",
  },
});

const agentHarnessSummary = (kind: string, active: boolean, profile = "owner") => ({
  name: kind,
  kind,
  label:
    kind === "openclaw"
      ? "OpenClaw executor harness"
      : kind === "hermes"
        ? "Hermes executor harness"
        : kind === "claude_code"
          ? "Claude Code executor harness"
          : "Custom executor harness",
  active,
  executor_harness_kind: kind,
  executor_harness_profile: profile,
  origin_session_id: null,
  executor_harness: {
    kind,
    profile,
    entrypoint: "regent agent init",
  },
  origin: {
    kind: "local",
    transport: "api",
    session_id: null,
    trigger_ref: "regent agent init",
  },
});

const defaultDaemonResponse = async (method: string, params?: unknown) => {
  if (method === "xmtp.status") {
    throw new Error("daemon unavailable");
  }

  if (method.startsWith("techtree.v1.")) {
    const payload = (params ?? {}) as Record<string, unknown>;
    const tree = (payload.tree as string | undefined) ?? "main";
    const workspacePath =
      typeof payload.workspace_path === "string" ? payload.workspace_path : path.resolve("workspace");
    const nodeId =
      typeof payload.node_id === "string"
        ? payload.node_id
        : (`0x${method.replace(/\W/g, "").padEnd(64, "0").slice(0, 64)}` as `0x${string}`);

    if (method === "techtree.v1.bbh.run.exec") {
      const split = (payload.split as string | undefined) ?? "climb";
      const assignmentPolicy = split === "climb" ? "auto" : "auto_or_select";
      const metadata = payload.metadata && typeof payload.metadata === "object"
        ? resolveRunMetadataResponse(payload.metadata as Record<string, unknown>)
        : undefined;
      return {
        ok: true,
        entrypoint: "bbh.run.exec",
        workspace_path: workspacePath,
        assignment_ref: "asg_test",
        split,
        run_id: "run_test",
        capsule_id: "capsule_test",
        genome_id: "gen_test",
        files: [
          "genome.source.yaml",
          "run.source.yaml",
          "task.json",
          "protocol.md",
          "rubric.json",
          "analysis.py",
          "outputs/verdict.json",
        ],
        capsule: {
          capsule_id: "capsule_test",
          provider: "bbh_train",
          provider_ref: "provider/capsule_test",
          family_ref: null,
          instance_ref: "capsule_test",
          split,
          language: "python",
          mode: "fixed",
          assignment_policy: assignmentPolicy,
          title: "Test capsule",
          hypothesis: "Hypothesis",
          protocol_md: "Protocol",
          rubric_json: {},
          task_json: {},
          data_files: [],
          artifact_source: null,
        },
        ...(metadata ? { resolved_metadata: metadata } : {}),
      };
    }

    if (method === "techtree.v1.bbh.run.solve") {
      return {
        ok: true,
        entrypoint: "bbh.run.solve",
        workspace_path: workspacePath,
        run_id: "run_test",
        agent: String(payload.agent ?? "hermes"),
        produced_files: ["analysis.py", "final_answer.md", "outputs/verdict.json", "outputs/run.log"],
        verdict_summary: {
          decision: "support",
          raw_score: 0.8,
          normalized_score: 0.9,
        },
      };
    }

    if (method === "techtree.v1.bbh.notebook.pair") {
      return {
        ok: true,
        entrypoint: "bbh.notebook.pair",
        workspace_path: workspacePath,
        notebook_path: path.join(workspacePath, "analysis.py"),
        launch_argv: ["uvx", "marimo", "edit", "analysis.py"],
        marimo_pair: {
          skill_name: "marimo-pair",
          installed: true,
          scopes: ["project"],
          agents: ["OpenClaw"],
          install_commands: [
            "npx skills add marimo-team/marimo-pair",
            "npx skills upgrade marimo-team/marimo-pair",
            "uvx deno -A npm:skills add marimo-team/marimo-pair",
          ],
        },
        instructions: {
          recommended_default: "Use the Techtree CLI skill with an OpenAI plan on GPT-5.4 high effort.",
          techtree_skill: "techtree-bbh-workspace",
          hermes_prompt: "Use the installed skills `techtree-bbh-workspace` and `marimo-pair`.",
          openclaw_prompt: "Use the installed skills `techtree-bbh-workspace` and `marimo-pair`.",
          next_regent_commands: [
            `regent techtree bbh submit ${workspacePath}`,
            `regent techtree bbh validate ${workspacePath}`,
          ],
        },
      };
    }

    if (method === "techtree.v1.bbh.capsules.list") {
      const split = (payload.split as string | undefined) ?? "climb";
      return {
        data: [
          {
            capsule_id: "capsule_test",
            split,
            title: "Test capsule",
            hypothesis: "Hypothesis",
            provider: "bbh_train",
            provider_ref: "provider/capsule_test",
            assignment_policy: split === "climb" ? "auto" : "auto_or_select",
            published_at: "2026-03-20T00:00:00Z",
          },
        ],
      };
    }

    if (method === "techtree.v1.bbh.capsules.get") {
      return {
        data: {
          capsule_id: String(payload.capsule_id ?? "capsule_test"),
          split: "benchmark",
          title: "Benchmark capsule",
          hypothesis: "Hypothesis",
          provider: "bbh",
          provider_ref: "provider/capsule_test",
          assignment_policy: "auto_or_select",
          published_at: "2026-03-20T00:00:00Z",
          family_ref: "family_test",
          instance_ref: "instance_test",
          language: "python",
          mode: "family",
          task_summary: { objective: "benchmark" },
          rubric_summary: { criteria: [] },
          data_manifest: [
            {
              path: "data/example.txt",
              sha256: `sha256:${"33".repeat(32)}`,
              bytes: 12,
            },
          ],
          artifact_source: { schema_version: "techtree.bbh.artifact-source.v1" },
        },
      };
    }

    if (method === "techtree.v1.bbh.draft.init") {
      return {
        ok: true,
        tree: "bbh",
        entrypoint: "bbh.draft.init",
        workspace_path: workspacePath,
        files: [
          "notebook.py",
          "hypothesis.md",
          "protocol.md",
          "rubric.json",
          "capsule.source.yaml",
          "genome/recommended.source.yaml",
          "genome/notes.md",
        ],
      };
    }

    if (method === "techtree.v1.bbh.draft.create" || method === "techtree.v1.bbh.draft.apply" || method === "techtree.v1.bbh.draft.ready") {
      return {
        data: {
          capsule: {
            capsule_id: "capsule_draft_test",
            title: String(payload.title ?? "Draft capsule"),
            split: "draft",
            workflow_state: method === "techtree.v1.bbh.draft.ready" ? "review_ready" : "authoring",
            owner_wallet_address: TEST_WALLET,
            source_node_id: 42,
          },
          workspace: {
            notebook_py: "print('draft')\n",
            hypothesis_md: "Hypothesis",
            protocol_md: "Protocol",
            rubric_json: {},
            capsule_source: {},
            recommended_genome_source: {},
            genome_notes_md: "",
          },
        },
      };
    }

    if (method === "techtree.v1.bbh.draft.list") {
      return {
        data: [
          {
            capsule_id: "capsule_draft_test",
            title: "Draft capsule",
            split: "draft",
            workflow_state: "authoring",
            owner_wallet_address: TEST_WALLET,
            source_node_id: 42,
          },
        ],
      };
    }

    if (method === "techtree.v1.bbh.draft.pull") {
      return {
        ok: true,
        entrypoint: "bbh.draft.pull",
        workspace_path: workspacePath,
        capsule_id: String(payload.capsule_id ?? "capsule_draft_test"),
        files: [
          "notebook.py",
          "hypothesis.md",
          "protocol.md",
          "rubric.json",
          "capsule.source.yaml",
          "genome/recommended.source.yaml",
          "genome/notes.md",
        ],
        capsule: {
          capsule_id: String(payload.capsule_id ?? "capsule_draft_test"),
          title: "Draft capsule",
          split: "draft",
          workflow_state: "authoring",
          owner_wallet_address: TEST_WALLET,
          source_node_id: 42,
        },
      };
    }

    if (method === "techtree.v1.bbh.draft.propose") {
      return {
        data: {
          proposal: {
            proposal_id: "proposal_test",
            capsule_id: String(payload.capsule_id ?? "capsule_draft_test"),
            proposer_wallet_address: TEST_WALLET,
            summary: String(payload.summary ?? "summary"),
            workspace_manifest_hash: `sha256:${"55".repeat(32)}`,
            status: "open",
          },
        },
      };
    }

    if (method === "techtree.v1.bbh.draft.proposals") {
      return {
        data: [
          {
            proposal_id: "proposal_test",
            capsule_id: String(payload.capsule_id ?? "capsule_draft_test"),
            proposer_wallet_address: TEST_WALLET,
            summary: "summary",
            workspace_manifest_hash: `sha256:${"55".repeat(32)}`,
            status: "open",
          },
        ],
      };
    }

    if (method === "techtree.v1.bbh.genome.init") {
      return {
        ok: true,
        entrypoint: "bbh.genome.init",
        workspace_path: workspacePath,
        files: [
          "genome/baseline.source.yaml",
          "genome/candidate.source.yaml",
          "genome/recommended.source.yaml",
          "genome/program.md",
          "genome/notes.md",
          "genome/experiments.jsonl",
          "genome/scoreboard.json",
        ],
        baseline_genome_id: "gen_baseline",
        evaluation_scope: {
          split: "climb",
          sample_size: 3,
        },
      };
    }

    if (method === "techtree.v1.bbh.genome.score") {
      return {
        ok: true,
        entrypoint: "bbh.genome.score",
        workspace_path: workspacePath,
        scoreboard: {
          schema_version: "techtree.bbh.genome-scoreboard.v1",
          budget: 6,
          evaluation_scope: { split: "climb", sample_size: 3 },
          baseline_genome_id: "gen_baseline",
          candidate_genome_id: "gen_candidate",
          recommended_genome_id: "gen_candidate",
          best_score: 0.82,
          completed_trials: 1,
          pending_trials: 0,
          trials: [],
          last_updated_at: "2026-03-20T00:00:00Z",
        },
      };
    }

    if (method === "techtree.v1.bbh.genome.improve") {
      return {
        ok: true,
        entrypoint: "bbh.genome.improve",
        workspace_path: workspacePath,
        scoreboard: {
          schema_version: "techtree.bbh.genome-scoreboard.v1",
          budget: 6,
          evaluation_scope: { split: "climb", sample_size: 3 },
          baseline_genome_id: "gen_baseline",
          candidate_genome_id: "gen_candidate",
          recommended_genome_id: "gen_candidate",
          best_score: 0.82,
          completed_trials: 1,
          pending_trials: 1,
          trials: [],
          last_updated_at: "2026-03-20T00:00:00Z",
        },
        next_trial_id: "mutation_trial_test",
        recommended_genome_id: "gen_candidate",
      };
    }

    if (method === "techtree.v1.bbh.genome.propose") {
      return {
        data: {
          proposal: {
            proposal_id: "proposal_test",
            capsule_id: String(payload.capsule_id ?? "capsule_draft_test"),
            proposer_wallet_address: TEST_WALLET,
            summary: String(payload.summary ?? "summary"),
            workspace_manifest_hash: `sha256:${"66".repeat(32)}`,
            status: "open",
          },
        },
      };
    }

    if (method === "techtree.v1.bbh.submit") {
      return {
        data: {
          run_id: "run_test",
          status: "completed",
          score: {
            raw: 3,
            normalized: 0.75,
          },
          validation_state: "validation_pending",
          public_run_path: "/bbh/runs/run_test",
        },
      };
    }

    if (method === "techtree.v1.bbh.validate") {
      return {
        data: {
          validation_id: "val_test",
          run_id: "run_test",
          result: "confirmed",
        },
      };
    }

    if (method === "techtree.v1.bbh.leaderboard") {
      return {
        data: {
          benchmark: "bbh_py",
          split: (payload.split as string | undefined) ?? "benchmark",
          generated_at: "2026-03-20T00:00:00Z",
          entries: [],
        },
      };
    }

    if (method === "techtree.v1.bbh.sync") {
      return {
        data: {
          runs: [],
        },
      };
    }

    if (method === "techtree.v1.reviewer.orcid.link") {
      return {
        data: {
          request_id: "orcid_req_test",
          state: payload.request_id ? "authenticated" : "pending",
          start_url: "https://example.com/orcid/start",
          reviewer: {
            wallet_address: TEST_WALLET,
            orcid_id: "0000-0000-0000-0001",
            orcid_auth_kind: "oauth_authenticated",
            vetting_status: "pending",
            domain_tags: ["scrna-seq"],
            payout_wallet: TEST_WALLET,
          },
        },
      };
    }

    if (method === "techtree.v1.reviewer.apply" || method === "techtree.v1.reviewer.status") {
      return {
        data: {
          wallet_address: TEST_WALLET,
          orcid_id: "0000-0000-0000-0001",
          orcid_auth_kind: "oauth_authenticated",
          vetting_status: "pending",
          domain_tags: Array.isArray(payload.domain_tags) ? payload.domain_tags : ["scrna-seq"],
          payout_wallet: TEST_WALLET,
          experience_summary: payload.experience_summary ?? null,
        },
      };
    }

    if (method === "techtree.v1.review.list") {
      return {
        data: [
          {
            request_id: "review_req_test",
            capsule_id: "capsule_draft_test",
            review_kind: payload.kind ?? "certification",
            visibility: "public_claim",
            state: "open",
          },
        ],
      };
    }

    if (method === "techtree.v1.review.claim") {
      return {
        data: {
          request_id: String(payload.request_id ?? "review_req_test"),
          capsule_id: "capsule_draft_test",
          review_kind: "certification",
          visibility: "public_claim",
          state: "claimed",
          claimed_by_wallet: TEST_WALLET,
        },
      };
    }

    if (method === "techtree.v1.review.pull") {
      return {
        ok: true,
        entrypoint: "bbh.review.pull",
        workspace_path: workspacePath,
        request_id: String(payload.request_id ?? "review_req_test"),
        capsule_id: "capsule_draft_test",
        files: [
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
        ],
        review: {
          request_id: String(payload.request_id ?? "review_req_test"),
          capsule_id: "capsule_draft_test",
          review_kind: "certification",
          visibility: "public_claim",
          state: "claimed",
        },
      };
    }

    if (method === "techtree.v1.review.submit") {
      return {
        data: {
          submission: {
            submission_id: "review_sub_test",
            request_id: "review_req_test",
            capsule_id: "capsule_draft_test",
            reviewer_wallet: TEST_WALLET,
            checklist_json: {},
            suggested_edits_json: {},
            decision: "approve",
            summary_md: "Looks good",
            review_node_id: "0xreview0000000000000000000000000000000000000000000000000000000000",
          },
        },
      };
    }

    if (method === "techtree.v1.certificate.verify") {
      return {
        data: {
          capsule_id: String(payload.capsule_id ?? "capsule_draft_test"),
          status: "active",
          certificate_review_id: "0xreview0000000000000000000000000000000000000000000000000000000000",
          scope: "publication",
        },
      };
    }

    if (method.endsWith(".init") || method.endsWith(".exec")) {
      const metadata = payload.metadata && typeof payload.metadata === "object" ? (payload.metadata as Record<string, unknown>) : undefined;
      return {
        ok: true,
        tree,
        entrypoint: method.replace("techtree.v1.", ""),
        input: payload,
        workspace_path: workspacePath,
        ...(metadata
          ? {
              resolved_metadata: resolveRunMetadataResponse(metadata),
            }
          : {}),
      };
    }

    if (method.endsWith(".compile")) {
      const kind = method.includes(".artifact.") ? "artifact" : method.includes(".run.") ? "run" : "review";
      const distPath = path.join(workspacePath, "dist");
      return {
        ok: true,
        entrypoint: method.replace("techtree.v1.", ""),
        input: payload,
        workspace_path: workspacePath,
        dist_path: distPath,
        manifest_path: path.join(distPath, `${kind}.manifest.json`),
        payload_index_path: path.join(distPath, "payload.index.json"),
        node_header_path: path.join(distPath, "node-header.json"),
        checksums_path: path.join(distPath, "checksums.txt"),
        node_id: `0x${kind.padEnd(64, "0")}`,
        manifest_hash: `sha256:${"11".repeat(32)}`,
        payload_hash: `sha256:${"22".repeat(32)}`,
        node_header: {
          id: `0x${kind.padEnd(64, "0")}`,
          subjectId: `0x${"33".repeat(32)}`,
          auxId: `0x${"44".repeat(32)}`,
          payloadHash: `sha256:${"22".repeat(32)}`,
          nodeType: kind === "artifact" ? 1 : kind === "run" ? 2 : 3,
          schemaVersion: 1,
          flags: 0,
          author: TEST_WALLET,
        },
        payload_index: {
          schema_version: "techtree.payload-index.v1",
          node_type: kind,
          files: [],
          external_blobs: [],
        },
      };
    }

    if (method.endsWith(".pin")) {
      const kind = method.includes(".artifact.") ? "artifact" : method.includes(".run.") ? "run" : "review";
      return {
        ok: true,
        tree,
        node_id: `0x${kind.padEnd(64, "0")}`,
        manifest_cid: `bafy-${kind}-manifest`,
        payload_cid: `bafy-${kind}-payload`,
        compiled: {
          dist_path: path.join(workspacePath, "dist"),
          node_header: {
            nodeType: kind === "artifact" ? 1 : kind === "run" ? 2 : 3,
          },
        },
      };
    }

    if (method.endsWith(".publish")) {
      const kind = method.includes(".artifact.") ? "artifact" : method.includes(".run.") ? "run" : "review";
      return {
        ok: true,
        tree,
        node_id: `0x${kind.padEnd(64, "0")}`,
        manifest_cid: `bafy-${kind}-manifest`,
        payload_cid: `bafy-${kind}-payload`,
        tx_hash: `0x${"ab".repeat(32)}`,
      };
    }

    if (method === "techtree.v1.fetch") {
      return {
        ok: true,
        tree,
        node_id: nodeId,
        node_type: "artifact",
        manifest_cid: "bafy-fetch-manifest",
        payload_cid: "bafy-fetch-payload",
        verified: true,
      };
    }

    if (method === "techtree.v1.verify") {
      return {
        ok: true,
        tree,
        node_id: nodeId,
        verified: true,
        payload_hash: `sha256:${"22".repeat(32)}`,
        header_matches: true,
        details: {
          node_id: nodeId,
        },
      };
    }

  }

  if (method === "techtree.autoskill.notebook.pair") {
    const payload = (params ?? {}) as Record<string, unknown>;
    const workspacePath =
      typeof payload.workspace_path === "string" ? payload.workspace_path : path.resolve("workspace");

    return {
      ok: true,
      entrypoint: "autoskill.notebook.pair",
      workspace_path: workspacePath,
      workspace_kind: "skill",
      notebook_path: path.join(workspacePath, "session.marimo.py"),
      launch_argv: ["uvx", "marimo", "edit", "session.marimo.py"],
      marimo_pair: {
        skill_name: "marimo-pair",
        installed: true,
        scopes: ["project"],
        agents: ["OpenClaw"],
        install_commands: [
          "npx skills add marimo-team/marimo-pair",
          "npx skills upgrade marimo-team/marimo-pair",
          "uvx deno -A npm:skills add marimo-team/marimo-pair",
        ],
      },
      instructions: {
        recommended_default: "Use the Techtree CLI skill with an OpenAI plan on GPT-5.4 high effort.",
        techtree_skill: "techtree-autoskill-workspace",
        hermes_prompt: "Use the installed skills `techtree-autoskill-workspace` and `marimo-pair`.",
        openclaw_prompt: "Use the installed skills `techtree-autoskill-workspace` and `marimo-pair`.",
        next_regent_commands: [`regent techtree autoskill publish skill ${workspacePath}`],
      },
    };
  }

  if (method === "agent.init" || method === "agent.status") {
    return {
      initialized: true,
      state: defaultAgentState(),
      identity: {
        walletAddress: TEST_WALLET,
        chainId: 11155111,
        registryAddress: TEST_REGISTRY,
        tokenId: "99",
      },
      currentProfile: agentProfileSummary("owner", true),
      currentHarness: agentHarnessSummary("custom", true, "owner"),
      currentOrigin: defaultAgentState().origin,
      profiles: [
        agentProfileSummary("owner", true),
        agentProfileSummary("public", false),
        agentProfileSummary("group", false),
        agentProfileSummary("custom", false),
      ],
      harnesses: [
        agentHarnessSummary("openclaw", false),
        agentHarnessSummary("hermes", false),
        agentHarnessSummary("claude_code", false),
        agentHarnessSummary("custom", true, "owner"),
      ],
      resolvedMetadata: resolveRunMetadataResponse({
        executor_harness: defaultAgentState().executor_harness,
        origin: defaultAgentState().origin,
      }),
    };
  }

  if (method === "agent.profile.list") {
    return {
      data: [
        agentProfileSummary("owner", true),
        agentProfileSummary("public", false),
        agentProfileSummary("group", false),
        agentProfileSummary("custom", false),
      ],
    };
  }

  if (method === "agent.profile.show") {
    const profileName = typeof params === "object" && params && typeof (params as Record<string, unknown>).profile === "string"
      ? String((params as Record<string, unknown>).profile)
      : "owner";

    return {
      data: agentProfileSummary(profileName, true),
    };
  }

  if (method === "agent.harness.list") {
    return {
      data: [
        agentHarnessSummary("openclaw", false),
        agentHarnessSummary("hermes", false),
        agentHarnessSummary("claude_code", false),
        agentHarnessSummary("custom", true, "owner"),
      ],
    };
  }

  return params === undefined ? { method } : { method, params };
};

export function setupCliEntrypointHarness(): CliEntrypointHarness {
  let tempDir = "";
  let configPath = "";
  let runCliEntrypoint!: typeof import("../../src/index.js").runCliEntrypoint;

  beforeAll(async () => {
    vi.doMock("../../src/internal-runtime/index.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/internal-runtime/index.js")>("../../src/internal-runtime/index.js");

      return {
        ...actual,
        runDoctor: runDoctorMock,
        runScopedDoctor: runScopedDoctorMock,
        runFullDoctor: runFullDoctorMock,
        initializeXmtp: initializeXmtpMock,
        getXmtpStatus: getXmtpStatusMock,
        resolveXmtpInboxId: resolveXmtpInboxIdMock,
        resolveXmtpIdentifier: resolveXmtpIdentifierMock,
        ensureXmtpPolicyFile: ensureXmtpPolicyFileMock,
        openXmtpPolicyInEditor: openXmtpPolicyInEditorMock,
        testXmtpDm: testXmtpDmMock,
        listXmtpGroups: listXmtpGroupsMock,
        createXmtpGroup: createXmtpGroupMock,
        addXmtpGroupMembers: addXmtpGroupMembersMock,
        removeXmtpGroupMembers: removeXmtpGroupMembersMock,
        listXmtpGroupMembers: listXmtpGroupMembersMock,
        getXmtpGroupPermissions: getXmtpGroupPermissionsMock,
        updateXmtpGroupPermission: updateXmtpGroupPermissionMock,
        listXmtpGroupAdmins: listXmtpGroupAdminsMock,
        listXmtpGroupSuperAdmins: listXmtpGroupSuperAdminsMock,
        addXmtpGroupAdmin: addXmtpGroupAdminMock,
        removeXmtpGroupAdmin: removeXmtpGroupAdminMock,
        addXmtpGroupSuperAdmin: addXmtpGroupSuperAdminMock,
        removeXmtpGroupSuperAdmin: removeXmtpGroupSuperAdminMock,
        revokeAllOtherXmtpInstallations: revokeAllOtherXmtpInstallationsMock,
        rotateXmtpDbKey: rotateXmtpDbKeyMock,
        rotateXmtpWallet: rotateXmtpWalletMock,
        runTechtreeCoreJson: runTechtreeCoreJsonMock,
        loadTechtreeRuntimeClient: loadTechtreeRuntimeClientMock,
      };
    });

    vi.resetModules();
    ({ runCliEntrypoint } = await import("../../src/index.js"));
  });

  afterAll(() => {
    vi.doUnmock("../../src/internal-runtime/index.js");
    vi.resetModules();
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-cli-dispatch-"));
    configPath = path.join(tempDir, "regent.config.json");

    daemonCallMock.mockReset();
    daemonCallMock.mockImplementation(defaultDaemonResponse);

    runDoctorMock.mockReset();
    runDoctorMock.mockImplementation(async () => doctorReport("default"));

    runScopedDoctorMock.mockReset();
    runScopedDoctorMock.mockImplementation(async (params?: { scope?: string }) =>
      doctorReport("scoped", params?.scope),
    );

    runFullDoctorMock.mockReset();
    runFullDoctorMock.mockImplementation(async () => doctorReport("full"));

    initializeXmtpMock.mockReset();
    initializeXmtpMock.mockImplementation(async (_config, resolvedConfigPath: string) => ({
      configPath: resolvedConfigPath,
      enabled: true,
      env: "production",
      dbPath: path.join(tempDir, "xmtp", "production", "client.db"),
      dbEncryptionKeyPath: path.join(tempDir, "xmtp", "production", "db.key"),
      walletKeyPath: path.join(tempDir, "xmtp", "production", "wallet.key"),
      publicPolicyPath: path.join(tempDir, "policies", "xmtp-public.md"),
      ownerInboxIds: [],
      trustedInboxIds: [],
      profiles: {
        owner: "full",
        public: "messaging",
        group: "messaging",
      },
      createdWalletKey: true,
      createdDbEncryptionKey: true,
      createdPolicyFile: true,
      client: {
        address: TEST_WALLET,
        inboxId: "owner-inbox",
        installationId: "installation-1",
        isRegistered: true,
        appVersion: "xmtp-cli/0.2.0",
        libxmtpVersion: "1.9.1",
      },
    }));

    getXmtpStatusMock.mockReset();
    getXmtpStatusMock.mockImplementation(
      async (xmtpConfig: {
        enabled: boolean;
        env: string;
        dbPath: string;
        walletKeyPath: string;
        dbEncryptionKeyPath: string;
        publicPolicyPath: string;
        ownerInboxIds: string[];
        trustedInboxIds: string[];
        profiles: Record<string, string>;
      }) => ({
        enabled: xmtpConfig.enabled,
        status: xmtpConfig.enabled ? "stopped" : "disabled",
        configured: true,
        connected: false,
        ready: xmtpConfig.enabled,
        started: false,
        env: xmtpConfig.env,
        dbPath: xmtpConfig.dbPath,
        walletKeyPath: xmtpConfig.walletKeyPath,
        dbEncryptionKeyPath: xmtpConfig.dbEncryptionKeyPath,
        publicPolicyPath: xmtpConfig.publicPolicyPath,
        ownerInboxIds: [...xmtpConfig.ownerInboxIds],
        trustedInboxIds: [...xmtpConfig.trustedInboxIds],
        profiles: { ...xmtpConfig.profiles },
        note: "XMTP identity is initialized and ready",
        lastError: null,
        recentErrors: [],
        recentConversations: [],
        metrics: {
          startedAt: null,
          stoppedAt: null,
          lastSyncAt: null,
          lastMessageAt: null,
          receivedMessages: 0,
          sentMessages: 0,
          sendFailures: 0,
          groupsCreated: 0,
          membersAdded: 0,
          installationsRevoked: 0,
          walletRotations: 0,
          dbKeyRotations: 0,
          restarts: 0,
        },
        routeState: xmtpConfig.enabled ? "blocked" : "disabled",
        client: {
          address: TEST_WALLET,
          inboxId: "owner-inbox",
          installationId: "installation-1",
          isRegistered: true,
        },
      }),
    );

    resolveXmtpInboxIdMock.mockReset();
    resolveXmtpInboxIdMock.mockResolvedValue("owner-inbox");
    resolveXmtpIdentifierMock.mockReset();
    resolveXmtpIdentifierMock.mockResolvedValue("owner-inbox");

    ensureXmtpPolicyFileMock.mockReset();
    ensureXmtpPolicyFileMock.mockImplementation((xmtpConfig: { publicPolicyPath: string }) => ({
      created: !fs.existsSync(xmtpConfig.publicPolicyPath),
      path: xmtpConfig.publicPolicyPath,
    }));

    openXmtpPolicyInEditorMock.mockReset();
    openXmtpPolicyInEditorMock.mockReturnValue({
      opened: false,
      editor: null,
    });

    testXmtpDmMock.mockReset();
    testXmtpDmMock.mockResolvedValue({
      ok: true,
      to: TEST_WALLET,
      conversationId: "dm-1",
      messageId: "message-1",
      text: "hello",
    });

    listXmtpGroupsMock.mockReset();
    listXmtpGroupsMock.mockResolvedValue({
      ok: true,
      conversations: [{ id: "group-1", type: "group", name: "Reviewers" }],
    });

    createXmtpGroupMock.mockReset();
    createXmtpGroupMock.mockResolvedValue({
      ok: true,
      id: "group-1",
      name: "Reviewers",
      description: "Team review room",
      imageUrl: null,
      memberCount: 2,
      members: [{ inboxId: "member-1" }, { inboxId: "member-2" }],
    });

    addXmtpGroupMembersMock.mockReset();
    addXmtpGroupMembersMock.mockResolvedValue({
      ok: true,
      conversationId: "group-1",
      addedMembers: ["0x3333333333333333333333333333333333333333"],
      count: 1,
    });

    removeXmtpGroupMembersMock.mockReset();
    removeXmtpGroupMembersMock.mockResolvedValue({
      ok: true,
      conversationId: "group-1",
      removedMembers: ["0x3333333333333333333333333333333333333333"],
      count: 1,
    });

    listXmtpGroupMembersMock.mockReset();
    listXmtpGroupMembersMock.mockResolvedValue({
      ok: true,
      conversationId: "group-1",
      members: [
        {
          inboxId: "member-1",
          accountIdentifiers: ["0x3333333333333333333333333333333333333333"],
          installationIds: ["install-1"],
          permissionLevel: "member",
          consentState: "allowed",
        },
      ],
      count: 1,
    });

    getXmtpGroupPermissionsMock.mockReset();
    getXmtpGroupPermissionsMock.mockResolvedValue({
      ok: true,
      conversationId: "group-1",
      permissions: {
        policyType: "custom",
        policySet: {
          addMemberPolicy: "admin",
        },
      },
    });

    updateXmtpGroupPermissionMock.mockReset();
    updateXmtpGroupPermissionMock.mockResolvedValue({
      ok: true,
      conversationId: "group-1",
      permissionType: "add-member",
      policy: "admin",
      metadataField: null,
    });

    listXmtpGroupAdminsMock.mockReset();
    listXmtpGroupAdminsMock.mockResolvedValue({
      ok: true,
      conversationId: "group-1",
      items: ["admin-inbox"],
      count: 1,
    });

    listXmtpGroupSuperAdminsMock.mockReset();
    listXmtpGroupSuperAdminsMock.mockResolvedValue({
      ok: true,
      conversationId: "group-1",
      items: ["super-admin-inbox"],
      count: 1,
    });

    addXmtpGroupAdminMock.mockReset();
    addXmtpGroupAdminMock.mockResolvedValue({
      ok: true,
      conversationId: "group-1",
      inboxId: "owner-inbox",
      message: "Member promoted to admin",
    });

    removeXmtpGroupAdminMock.mockReset();
    removeXmtpGroupAdminMock.mockResolvedValue({
      ok: true,
      conversationId: "group-1",
      inboxId: "owner-inbox",
      message: "Admin demoted to member",
    });

    addXmtpGroupSuperAdminMock.mockReset();
    addXmtpGroupSuperAdminMock.mockResolvedValue({
      ok: true,
      conversationId: "group-1",
      inboxId: "owner-inbox",
      message: "Member promoted to super admin",
    });

    removeXmtpGroupSuperAdminMock.mockReset();
    removeXmtpGroupSuperAdminMock.mockResolvedValue({
      ok: true,
      conversationId: "group-1",
      inboxId: "owner-inbox",
      message: "Super admin demoted to member",
    });

    revokeAllOtherXmtpInstallationsMock.mockReset();
    revokeAllOtherXmtpInstallationsMock.mockResolvedValue({
      ok: true,
      currentInstallationId: "installation-1",
      inboxId: "owner-inbox",
      message: "All other installations have been revoked. Only this installation remains authorized.",
    });

    rotateXmtpDbKeyMock.mockReset();
    rotateXmtpDbKeyMock.mockResolvedValue({
      ok: true,
      kind: "db-key",
      dbPath: path.join(tempDir, "xmtp", "production", "client.db"),
      walletKeyPath: path.join(tempDir, "xmtp", "production", "wallet.key"),
      dbEncryptionKeyPath: path.join(tempDir, "xmtp", "production", "db.key"),
      removedDatabase: true,
    });

    rotateXmtpWalletMock.mockReset();
    rotateXmtpWalletMock.mockResolvedValue({
      ok: true,
      kind: "wallet",
      dbPath: path.join(tempDir, "xmtp", "production", "client.db"),
      walletKeyPath: path.join(tempDir, "xmtp", "production", "wallet.key"),
      dbEncryptionKeyPath: path.join(tempDir, "xmtp", "production", "db.key"),
      removedDatabase: true,
    });

    runTechtreeCoreJsonMock.mockReset();
    runTechtreeCoreJsonMock.mockImplementation(async (entrypoint: string, input?: unknown) => {
      if (entrypoint.endsWith(".compile")) {
        const workspacePath =
          typeof input === "object" && input && "workspace_path" in input
            ? String((input as { workspace_path?: unknown }).workspace_path ?? tempDir)
            : tempDir;
        const distPath = path.join(workspacePath, "dist");

        return {
          ok: true,
          entrypoint,
          input,
          workspace_path: workspacePath,
          dist_path: distPath,
          manifest_path: path.join(distPath, `${entrypoint.split(".")[0]}.manifest.json`),
          payload_index_path: path.join(distPath, "payload.index.json"),
          node_header_path: path.join(distPath, "node-header.json"),
          checksums_path: path.join(distPath, "checksums.txt"),
          node_id: `0x${entrypoint.replace(".", "").padEnd(64, "0").slice(0, 64)}`,
          manifest_hash: `sha256:${"11".repeat(32)}`,
          payload_hash: `sha256:${"22".repeat(32)}`,
          node_header: {
            id: `0x${entrypoint.replace(".", "").padEnd(64, "0").slice(0, 64)}`,
            subjectId: `0x${"33".repeat(32)}`,
            auxId: `0x${"44".repeat(32)}`,
            payloadHash: `sha256:${"22".repeat(32)}`,
            nodeType: entrypoint.startsWith("artifact") ? 1 : entrypoint.startsWith("run") ? 2 : 3,
            schemaVersion: 1,
            flags: 0,
            author: TEST_WALLET,
          },
          payload_index: {
            schema_version: "techtree.payload-index.v1",
            node_type: entrypoint.startsWith("artifact")
              ? "artifact"
              : entrypoint.startsWith("run")
                ? "run"
                : "review",
            files: [],
            external_blobs: [],
          },
        };
      }

      return {
        ok: true,
        entrypoint,
        input,
      };
    });

    loadTechtreeRuntimeClientMock.mockReset();
    loadTechtreeRuntimeClientMock.mockReturnValue(techtreeRuntimeClientMock);

    techtreeRuntimeClientMock.fetchNode.mockReset();
    techtreeRuntimeClientMock.fetchNode.mockImplementation(async (input: { node_id: string }) => ({
      ok: true,
      node_id: input.node_id,
      node_type: "artifact",
      manifest_cid: "bafy-fetch-manifest",
      payload_cid: "bafy-fetch-payload",
      verified: true,
    }));
    techtreeRuntimeClientMock.pinNode.mockReset();
    techtreeRuntimeClientMock.pinNode.mockImplementation(async (input: { node_type: string }) => ({
      ok: true,
      node_id: `0x${input.node_type.padEnd(64, "0")}` as `0x${string}`,
      manifest_cid: `bafy-${input.node_type}-manifest`,
      payload_cid: `bafy-${input.node_type}-payload`,
    }));
    techtreeRuntimeClientMock.publishNode.mockReset();
    techtreeRuntimeClientMock.publishNode.mockImplementation(
      async (input: { node_type: string; manifest_cid: string; payload_cid: string }) => ({
        ok: true,
        node_id: `0x${input.node_type.padEnd(64, "0")}` as `0x${string}`,
        manifest_cid: input.manifest_cid,
        payload_cid: input.payload_cid,
        tx_hash: `0x${"ab".repeat(32)}` as `0x${string}`,
      }),
    );
  });

  afterEach(() => {
    daemonCallMock.mockClear();
    runDoctorMock.mockClear();
    runScopedDoctorMock.mockClear();
    runFullDoctorMock.mockClear();
    initializeXmtpMock.mockClear();
    getXmtpStatusMock.mockClear();
    resolveXmtpInboxIdMock.mockClear();
    resolveXmtpIdentifierMock.mockClear();
    ensureXmtpPolicyFileMock.mockClear();
    openXmtpPolicyInEditorMock.mockClear();
    testXmtpDmMock.mockClear();
    listXmtpGroupsMock.mockClear();
    createXmtpGroupMock.mockClear();
    addXmtpGroupMembersMock.mockClear();
    removeXmtpGroupMembersMock.mockClear();
    listXmtpGroupMembersMock.mockClear();
    getXmtpGroupPermissionsMock.mockClear();
    updateXmtpGroupPermissionMock.mockClear();
    listXmtpGroupAdminsMock.mockClear();
    listXmtpGroupSuperAdminsMock.mockClear();
    addXmtpGroupAdminMock.mockClear();
    removeXmtpGroupAdminMock.mockClear();
    addXmtpGroupSuperAdminMock.mockClear();
    removeXmtpGroupSuperAdminMock.mockClear();
    revokeAllOtherXmtpInstallationsMock.mockClear();
    rotateXmtpDbKeyMock.mockClear();
    rotateXmtpWalletMock.mockClear();
    runTechtreeCoreJsonMock.mockClear();
    loadTechtreeRuntimeClientMock.mockClear();
    techtreeRuntimeClientMock.fetchNode.mockClear();
    techtreeRuntimeClientMock.pinNode.mockClear();
    techtreeRuntimeClientMock.publishNode.mockClear();
  });

  return {
    get tempDir() {
      return tempDir;
    },
    get configPath() {
      return configPath;
    },
    get runCliEntrypoint() {
      return runCliEntrypoint;
    },
  };
}
