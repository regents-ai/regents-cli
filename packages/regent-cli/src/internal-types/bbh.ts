export type BbhSplit = "climb" | "benchmark" | "challenge" | "draft";
export type BbhLane = BbhSplit;
export type BbhHarnessType = "openclaw" | "hermes" | "claude_code" | "custom";
export type BbhAssignmentPolicy = "public_next" | "operator_assigned" | "validator_assigned" | "draft_only";
export type BbhKeepDecision = "keep" | "discard" | "pending";
export type BbhRunStatus = "created" | "running" | "completed" | "failed";
export type BbhValidationRole = "official" | "community";
export type BbhReviewMethod = "replay" | "manual" | "replication";
export type BbhReviewResult = "confirmed" | "rejected" | "mixed" | "needs_revision";

export interface BbhDataFile {
  name: string;
  content: string;
}

export interface BbhCapsule {
  capsule_id: string;
  provider: "bbh" | "bbh_train" | "techtree";
  provider_ref: string;
  family_ref?: string | null;
  instance_ref?: string | null;
  split: BbhSplit;
  language: "python";
  mode: "fixed" | "family";
  assignment_policy: BbhAssignmentPolicy;
  title: string;
  hypothesis: string;
  protocol_md: string;
  rubric_json: Record<string, unknown>;
  task_json: Record<string, unknown>;
  data_files: BbhDataFile[];
  artifact_source?: Record<string, unknown> | null;
}

export interface BbhAssignmentResponse {
  data: {
    assignment_ref: string;
    split: BbhSplit;
    capsule: BbhCapsule;
  };
}

export interface BbhRunExecParams {
  workspace_path?: string | null;
  split?: "climb" | "benchmark" | "challenge";
  metadata?: import("./agent.js").RegentRunMetadata | null;
  genome?: Partial<BbhGenomeSource> | null;
}

export interface BbhRunExecResponse {
  ok: true;
  entrypoint: "bbh.run.exec";
  workspace_path: string;
  assignment_ref: string;
  split: BbhSplit;
  run_id: string;
  capsule_id: string;
  genome_id: string;
  files: string[];
  capsule: BbhCapsule;
  resolved_metadata?: import("./agent.js").RegentResolvedRunMetadata | null;
}

export interface BbhGenomeSource {
  schema_version: "techtree.bbh.genome-source.v1";
  genome_id?: string;
  label?: string | null;
  parent_genome_ref?: string | null;
  model_id: string;
  harness_type: BbhHarnessType;
  harness_version: string;
  prompt_pack_version: string;
  skill_pack_version: string;
  tool_profile: string;
  runtime_image: string;
  helper_code_hash?: string | null;
  data_profile?: string | null;
  axes?: Record<string, unknown>;
  notes?: string | null;
}

export interface BbhRunSource {
  schema_version: "techtree.bbh.run-source.v1";
  artifact_ref: string;
  executor: {
    type: "genome" | "actor" | "system";
    id?: string | null;
    harness: BbhHarnessType;
    harness_version: string;
    profile?: string | null;
  };
  instance: {
    instance_ref: string;
    family_ref?: string | null;
    seed?: number | string | null;
  };
  origin?: {
    workload: "bbh";
    transport: "local" | "xmtp" | "gossipsub" | "api";
    trigger: "manual" | "assignment" | "validator" | "automation";
  };
  paths?: {
    analysis_path?: string;
    verdict_path?: string;
    final_answer_path?: string | null;
    report_path?: string | null;
    log_path?: string | null;
    genome_path?: string | null;
  };
  status?: BbhRunStatus;
  score?: {
    raw: number;
    normalized: number;
    scorer_version?: string | null;
  } | null;
  bbh: {
    split: BbhSplit;
    genome_ref: string;
    provider: "bbh" | "bbh_train" | "techtree";
    assignment_ref?: string | null;
    keep_decision?: BbhKeepDecision;
    parent_genome_ref?: string | null;
    child_genome_ref?: string | null;
    notes?: string | null;
  };
  notes?: string | null;
}

export interface BbhReviewSource {
  schema_version: "techtree.bbh.review-source.v1";
  target: { type: "run"; id: string };
  kind: "validation";
  method: BbhReviewMethod;
  result: BbhReviewResult;
  summary: string;
  evidence?: Array<{
    kind: "file" | "run" | "note" | "external";
    ref: string;
    hash?: string | null;
    note?: string | null;
  }>;
  paths?: {
    replication_workspace?: string | null;
    verdict_path?: string | null;
    report_path?: string | null;
    log_path?: string | null;
  };
  bbh: {
    role: BbhValidationRole;
    reproduced_raw_score?: number | null;
    reproduced_normalized_score?: number | null;
    raw_abs_tolerance?: number;
    scorer_version?: string | null;
    assignment_ref?: string | null;
  };
  notes?: string | null;
}

export interface BbhWorkspaceBundle {
  task_json: Record<string, unknown>;
  protocol_md: string;
  rubric_json: Record<string, unknown>;
  analysis_py: string;
  verdict_json: Record<string, unknown>;
  final_answer_md?: string | null;
  report_html?: string | null;
  run_log?: string | null;
}

export interface BbhRunSubmitRequest {
  run_id: string;
  capsule_id: string;
  assignment_ref?: string | null;
  artifact_source?: Record<string, unknown> | null;
  genome_source: BbhGenomeSource;
  run_source: BbhRunSource;
  workspace: BbhWorkspaceBundle;
}

export interface BbhSubmitParams {
  workspace_path: string;
}

export interface BbhRunSubmitResponse {
  data: {
    run_id: string;
    status: string;
    score: {
      raw: number | null;
      normalized: number | null;
    };
    validation_state: string;
    public_run_path: string;
  };
}

export interface BbhValidationSubmitRequest {
  validation_id: string;
  run_id: string;
  review_source: BbhReviewSource;
  workspace?: {
    verdict_json?: Record<string, unknown> | null;
    report_html?: string | null;
    run_log?: string | null;
  };
}

export interface BbhValidateParams {
  workspace_path: string;
  run_id?: string | null;
}

export interface BbhValidationSubmitResponse {
  data: {
    validation_id: string;
    run_id: string;
    result: string;
  };
}

export interface BbhSyncRequest {
  run_ids: string[];
}

export interface BbhSyncParams {
  workspace_root?: string | null;
}

export interface BbhSyncResponse {
  data: {
    runs: Array<{
      run_id: string;
      status: string;
      raw_score: number | null;
      normalized_score: number | null;
      validation_status: string | null;
    }>;
  };
}

export interface BbhLeaderboardEntry {
  rank: number;
  genome_id: string;
  name: string;
  score_percent: number;
  final_objective_hit_rate: number;
  validated_runs: number;
  reproducibility_rate: number;
  median_latency_sec: number | null;
  median_cost_usd: number | null;
  harness_type?: string;
  model_id?: string;
  updated_at?: string;
}

export interface BbhLeaderboardResponse {
  data: {
    benchmark: "bbh_py";
    split: BbhSplit | "benchmark";
    generated_at: string;
    entries: BbhLeaderboardEntry[];
  };
}

export interface BbhRunDetailResponse {
  data: {
    run: Record<string, unknown>;
    capsule: Record<string, unknown>;
    genome: Record<string, unknown>;
    validations: Record<string, unknown>[];
  };
}

export interface BbhGenomeDetailResponse {
  data: {
    genome: Record<string, unknown>;
    runs: Record<string, unknown>[];
  };
}
