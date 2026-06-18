export type BbhSplit = "climb" | "benchmark" | "challenge" | "draft";
export type BbhLane = BbhSplit;
export type BbhHarnessType = "openclaw" | "hermes" | "claude_code" | "custom";
export type BbhAssignmentPolicy = "auto" | "select" | "auto_or_select" | "operator";
export type BbhKeepDecision = "keep" | "discard" | "pending";
export type BbhRunStatus = "created" | "running" | "completed" | "failed";
export type BbhValidationRole = "official" | "community";
export type BbhReviewMethod = "replay" | "manual" | "replication";
export type BbhReviewResult = "confirmed" | "rejected" | "mixed" | "needs_revision";
export type BbhCapsuleWorkflowState = "authoring" | "review_ready" | "in_review" | "approved" | "rejected" | "published";
export type BbhCertificateStatus = "none" | "pending" | "active" | "expired" | "revoked";
export type BbhDraftProposalStatus = "open" | "accepted" | "rejected";
export type BbhReviewerOrcidAuthKind = "oauth_authenticated" | "self_attested";
export type BbhReviewerVettingStatus = "pending" | "approved" | "rejected";
export type BbhOrcidLinkState = "pending" | "authenticated" | "expired" | "timed_out";
export type BbhReviewRequestKind = "design" | "genome" | "certification";
export type BbhReviewRequestVisibility = "private" | "public_claim";
export type BbhReviewRequestState = "open" | "claimed" | "submitted" | "closed";
export type BbhReviewDecision = "approve" | "approve_with_edits" | "changes_requested" | "reject";
export type BbhSolveSolverKind = "hermes" | "openclaw" | "skydiscover";

export interface BbhDataFile {
  name: string;
  content: string;
}

export interface BbhExecutionDefaults {
  solver: {
    kind: BbhSolveSolverKind;
    entrypoint?: string | null;
    search_algorithm?: string | null;
  };
  evaluator: {
    kind: "hypotest";
    dataset_ref: string;
    benchmark_ref?: string | null;
    scorer_version: string;
  };
  workspace: {
    analysis_path?: string;
    verdict_path?: string;
    final_answer_path?: string | null;
    report_path?: string | null;
    log_path?: string | null;
    genome_path?: string | null;
    search_config_path?: string | null;
    evaluator_path?: string | null;
    seed_program_path?: string | null;
    best_program_path?: string | null;
    search_summary_path?: string | null;
    evaluator_artifacts_path?: string | null;
    checkpoint_pointer_path?: string | null;
    best_solution_patch_path?: string | null;
    search_log_path?: string | null;
  };
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
  execution_defaults?: BbhExecutionDefaults | null;
}

export interface BbhCertificateSummary {
  capsule_id: string;
  status: BbhCertificateStatus;
  certificate_review_id?: string | null;
  scope?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
  reviewer_wallet?: `0x${string}` | null;
}

export interface BbhCapsuleSummary {
  capsule_id: string;
  split: BbhSplit;
  title: string;
  hypothesis: string;
  provider: BbhCapsule["provider"];
  provider_ref: string;
  assignment_policy: BbhAssignmentPolicy;
  published_at?: string | null;
}

export interface BbhCapsuleDetail extends BbhCapsuleSummary {
  family_ref?: string | null;
  instance_ref?: string | null;
  language: BbhCapsule["language"];
  mode: BbhCapsule["mode"];
  task_summary?: Record<string, unknown> | null;
  rubric_summary?: Record<string, unknown> | null;
  data_manifest?: Array<{
    path: string;
    sha256: string;
    bytes: number;
  }>;
  artifact_source?: Record<string, unknown> | null;
  execution_defaults?: BbhExecutionDefaults | null;
}

export interface BbhCapsuleListResponse {
  data: BbhCapsuleSummary[];
}

export interface BbhCapsuleGetResponse {
  data: BbhCapsuleDetail;
}

export interface BbhDraftWorkspaceBundle {
  notebook_py: string;
  hypothesis_md: string;
  protocol_md: string;
  rubric_json: Record<string, unknown>;
  capsule_source: Record<string, unknown>;
  recommended_genome_source?: Record<string, unknown> | null;
  genome_notes_md?: string | null;
}

export interface BbhDraftCapsule {
  capsule_id: string;
  title: string;
  split: "draft";
  workflow_state: BbhCapsuleWorkflowState;
  owner_wallet_address: `0x${string}`;
  source_node_id?: number | null;
  seed?: string | null;
  parent_id?: number | null;
  inserted_at?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
  hypothesis?: string | null;
  protocol_md?: string | null;
  rubric_json?: Record<string, unknown> | null;
  capsule_source?: Record<string, unknown> | null;
  recommended_genome_source?: Record<string, unknown> | null;
  genome_notes_md?: string | null;
  certificate?: BbhCertificateSummary | null;
}

export interface BbhDraftCreateRequest {
  title: string;
  seed?: string | null;
  parent_id?: number | null;
  workspace: BbhDraftWorkspaceBundle;
}

export interface BbhDraftCreateParams {
  workspace_path: string;
  title: string;
  seed?: string | null;
  parent_id?: number | null;
}

export interface BbhDraftGetResponse {
  data: {
    capsule: BbhDraftCapsule;
    workspace: BbhDraftWorkspaceBundle;
  };
}

export interface BbhDraftListResponse {
  data: BbhDraftCapsule[];
}

export interface BbhDraftPullParams {
  capsule_id: string;
  workspace_path: string;
}

export interface BbhDraftPullResponse {
  ok: true;
  entrypoint: "bbh.draft.pull";
  workspace_path: string;
  capsule_id: string;
  files: string[];
  capsule: BbhDraftCapsule;
}

export interface BbhDraftProposal {
  proposal_id: string;
  capsule_id: string;
  proposer_wallet_address: `0x${string}`;
  summary: string;
  patch_json?: Record<string, unknown> | null;
  workspace_manifest_hash: string;
  status: BbhDraftProposalStatus;
  inserted_at?: string | null;
  updated_at?: string | null;
}

export interface BbhDraftProposalSubmitRequest {
  summary: string;
  workspace: BbhDraftWorkspaceBundle;
  workspace_manifest_hash: string;
}

export interface BbhDraftProposalSubmitParams {
  workspace_path: string;
  capsule_id: string;
  summary: string;
}

export interface BbhDraftProposalListResponse {
  data: BbhDraftProposal[];
}

export interface BbhDraftProposalSubmitResponse {
  data: {
    proposal: BbhDraftProposal;
  };
}

export interface BbhDraftApplyParams {
  capsule_id: string;
  proposal_id: string;
}

export interface BbhDraftReadyParams {
  capsule_id: string;
}

export interface BbhReviewerProfile {
  wallet_address: `0x${string}`;
  orcid_id?: string | null;
  orcid_auth_kind?: BbhReviewerOrcidAuthKind | null;
  orcid_name?: string | null;
  vetting_status: BbhReviewerVettingStatus;
  domain_tags: string[];
  payout_wallet?: `0x${string}` | null;
  experience_summary?: string | null;
  vetted_by?: `0x${string}` | null;
  vetted_at?: string | null;
}

export interface BbhReviewerApplyParams {
  domain_tags: string[];
  payout_wallet?: `0x${string}` | null;
  experience_summary?: string | null;
}

export interface BbhReviewerApplyRequest extends BbhReviewerApplyParams {}

export interface BbhReviewerStatusResponse {
  data: BbhReviewerProfile;
}

export interface BbhReviewerApplyResponse {
  data: BbhReviewerProfile;
}

export interface BbhReviewerOrcidLinkParams {
  request_id?: string | null;
}

export interface BbhReviewerOrcidLinkResponse {
  data: {
    request_id: string;
    state: BbhOrcidLinkState;
    start_url?: string | null;
    reviewer?: BbhReviewerProfile | null;
  };
}

export interface BbhReviewRequest {
  request_id: string;
  capsule_id: string;
  review_kind: BbhReviewRequestKind;
  visibility: BbhReviewRequestVisibility;
  state: BbhReviewRequestState;
  capsule_title?: string | null;
  claimed_by_wallet?: `0x${string}` | null;
  fee_quote_usdc?: string | null;
  holdback_usdc?: string | null;
  due_at?: string | null;
  inserted_at?: string | null;
  updated_at?: string | null;
}

export interface BbhReviewListParams {
  kind?: BbhReviewRequestKind | null;
}

export interface BbhReviewListResponse {
  data: BbhReviewRequest[];
}

export interface BbhReviewPacket {
  request: BbhReviewRequest;
  capsule: BbhDraftCapsule;
  workspace: BbhDraftWorkspaceBundle;
  prior_proposals: BbhDraftProposal[];
  evidence_pack_summary?: Record<string, unknown> | null;
  checklist_template: Record<string, unknown>;
  certificate_payload?: Record<string, unknown> | null;
}

export interface BbhReviewPacketResponse {
  data: BbhReviewPacket;
}

export interface BbhReviewPullParams {
  request_id: string;
  workspace_path: string;
}

export interface BbhReviewPullResponse {
  ok: true;
  entrypoint: "bbh.review.pull";
  workspace_path: string;
  request_id: string;
  capsule_id: string;
  files: string[];
  review: BbhReviewRequest;
}

export interface BbhReviewSubmission {
  submission_id: string;
  request_id: string;
  capsule_id: string;
  reviewer_wallet: `0x${string}`;
  checklist_json: Record<string, unknown>;
  suggested_edits_json: Record<string, unknown>;
  decision: BbhReviewDecision;
  summary_md: string;
  genome_recommendation_source?: Record<string, unknown> | null;
  review_node_id?: string | null;
  inserted_at?: string | null;
  updated_at?: string | null;
}

export interface BbhReviewSubmitRequest {
  request_id: string;
  capsule_id: string;
  checklist_json: Record<string, unknown>;
  suggested_edits_json: Record<string, unknown>;
  decision: BbhReviewDecision;
  summary_md: string;
  genome_recommendation_source?: Record<string, unknown> | null;
  certificate_payload?: Record<string, unknown> | null;
}

export interface BbhReviewSubmitParams {
  workspace_path: string;
}

export interface BbhReviewSubmitResponse {
  data: {
    submission: BbhReviewSubmission;
  };
}

export interface BbhCertificateVerifyParams {
  capsule_id: string;
}

export interface BbhCertificateVerifyResponse {
  data: BbhCertificateSummary;
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
  capsule_id?: string | null;
  metadata?: import("./agent.js").RegentRunMetadata | null;
  genome?: Partial<BbhGenomeSource> | null;
  genome_path?: string | null;
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

export interface BbhGenomeImproverScope {
  capsule_ids?: string[];
  split?: "climb" | "benchmark" | "challenge";
  sample_size?: number;
}

export interface BbhGenomeImproverProgram {
  budget?: number;
  evaluation_scope?: BbhGenomeImproverScope;
  search?: {
    model_id?: string[];
    harness_type?: BbhHarnessType[];
    harness_version?: string[];
    prompt_pack_version?: string[];
    skill_pack_version?: string[];
    tool_profile?: string[];
    runtime_image?: string[];
    data_profile?: string[];
    axes?: Array<Record<string, unknown>>;
  };
}

export interface BbhGenomeRecommendationSource {
  schema_version: "techtree.bbh.genome-recommendation.v1";
  recommended_genome_id: string | null;
  baseline_genome_id?: string | null;
  improver_kind?: "autoagent-style";
  evaluation_scope?: BbhGenomeImproverScope | null;
  trial_count?: number;
  best_score?: number | null;
  notes?: string[];
  genome_source?: BbhGenomeSource | null;
}

export interface BbhGenomeImproverTrial {
  trial_id: string;
  genome_id: string;
  status: "pending" | "partial" | "completed";
  kind: "baseline" | "candidate" | "mutation";
  workspace_path: string;
  completed_runs: number;
  total_runs: number;
  mean_normalized_score: number | null;
}

export interface BbhGenomeImproverScoreboard {
  schema_version: "techtree.bbh.genome-scoreboard.v1";
  budget: number;
  evaluation_scope: BbhGenomeImproverScope;
  baseline_genome_id: string;
  candidate_genome_id: string;
  recommended_genome_id: string | null;
  best_score: number | null;
  completed_trials: number;
  pending_trials: number;
  trials: BbhGenomeImproverTrial[];
  last_updated_at: string;
}

export interface BbhGenomeInitParams {
  workspace_path: string;
  budget?: number;
  split?: "climb" | "benchmark" | "challenge";
  sample_size?: number;
  capsule_ids?: string[] | null;
  metadata?: import("./agent.js").RegentRunMetadata | null;
  genome?: Partial<BbhGenomeSource> | null;
}

export interface BbhGenomeScoreParams {
  workspace_path: string;
  metadata?: import("./agent.js").RegentRunMetadata | null;
}

export interface BbhGenomeImproveParams {
  workspace_path: string;
  metadata?: import("./agent.js").RegentRunMetadata | null;
}

export interface BbhGenomeProposeParams {
  workspace_path: string;
  capsule_id: string;
  summary?: string | null;
}

export interface BbhGenomeInitResponse {
  ok: true;
  entrypoint: "bbh.genome.init";
  workspace_path: string;
  files: string[];
  baseline_genome_id: string;
  evaluation_scope: BbhGenomeImproverScope;
}

export interface BbhGenomeScoreResponse {
  ok: true;
  entrypoint: "bbh.genome.score";
  workspace_path: string;
  scoreboard: BbhGenomeImproverScoreboard;
}

export interface BbhGenomeImproveResponse {
  ok: true;
  entrypoint: "bbh.genome.improve";
  workspace_path: string;
  scoreboard: BbhGenomeImproverScoreboard;
  next_trial_id: string | null;
  recommended_genome_id: string | null;
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
  solver: {
    kind: BbhSolveSolverKind;
    entrypoint?: string | null;
  };
  search?: {
    algorithm: string;
    budget?: number | null;
    checkpoint_ref?: string | null;
    summary?: {
      best_score: number;
      best_iteration: number;
      iterations_requested: number;
      iterations_completed: number;
      total_evaluations: number;
      elapsed_ms: number;
      checkpoint_ref?: string | null;
      artifact_keys?: string[] | null;
    } | null;
  } | null;
  evaluator: {
    kind: "hypotest";
    dataset_ref: string;
    benchmark_ref?: string | null;
    scorer_version: string;
  };
  instance: {
    instance_ref: string;
    family_ref?: string | null;
    seed?: number | string | null;
  };
  origin?: {
    workload: "bbh";
    transport: "local" | "gossipsub" | "api";
    trigger: "manual" | "assignment" | "validator" | "automation";
  };
  paths?: {
    analysis_path?: string;
    verdict_path?: string;
    final_answer_path?: string | null;
    report_path?: string | null;
    log_path?: string | null;
    genome_path?: string | null;
    search_config_path?: string | null;
    evaluator_path?: string | null;
    seed_program_path?: string | null;
    best_program_path?: string | null;
    search_summary_path?: string | null;
    evaluator_artifacts_path?: string | null;
    checkpoint_pointer_path?: string | null;
    best_solution_patch_path?: string | null;
    search_log_path?: string | null;
  };
  status?: BbhRunStatus;
  score?: {
    raw: number;
    normalized: number;
    scorer_version?: string | null;
  } | null;
  artifact_manifest?: Array<{
    path: string;
    kind: "workspace_file" | "generated_output" | "report" | "checkpoint_pointer" | "data_file";
    sha256: string;
    size_bytes?: number | null;
    required_for_validation?: boolean | null;
  }>;
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
    evaluator_kind?: string | null;
    dataset_ref?: string | null;
    assignment_ref?: string | null;
    submitted_program_sha256?: string | null;
    reproduced_program_sha256?: string | null;
    score_match?: boolean | null;
    artifact_match?: boolean | null;
  };
  notes?: string | null;
}

export interface BbhWorkspaceBundle {
  task_json: Record<string, unknown>;
  protocol_md: string;
  rubric_json: Record<string, unknown>;
  analysis_py: string;
  verdict_json: Record<string, unknown>;
  search_summary_json?: Record<string, unknown> | null;
  search_log?: string | null;
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

export interface BbhRunSolveParams {
  workspace_path: string;
  solver: BbhSolveSolverKind;
  timeout_seconds?: number | null;
  metadata?: import("./agent.js").RegentRunMetadata | null;
}

export interface BbhRunSolveVerdictSummary {
  decision: string;
  raw_score: number | null;
  normalized_score: number | null;
}

export interface BbhRunSolveResponse {
  ok: true;
  entrypoint: "bbh.run.solve";
  workspace_path: string;
  run_id: string;
  solver: BbhSolveSolverKind;
  produced_files: string[];
  verdict_summary: BbhRunSolveVerdictSummary;
}

export interface BbhNotebookPairParams {
  workspace_path: string;
}

export interface BbhNotebookPairResponse {
  ok: true;
  entrypoint: "bbh.notebook.pair";
  workspace_path: string;
  notebook_path: string;
  launch_argv: string[];
  marimo_pair: import("./techtree.js").NotebookPairSkillStatus;
  instructions: import("./techtree.js").NotebookPairInstructions;
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
    search_summary_json?: Record<string, unknown> | null;
    search_log?: string | null;
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
