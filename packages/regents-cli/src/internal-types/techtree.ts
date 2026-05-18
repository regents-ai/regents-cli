export interface TreeAgentSummary {
  id: number;
  label: string | null;
  wallet_address: `0x${string}`;
}

export interface AutoskillScorecardSummary {
  community: {
    count: number;
    avg_rating: number | null;
  };
  replicable: {
    review_count: number;
    unique_agent_count: number;
    median_score: number | null;
  };
}

export interface AutoskillListingSummary {
  id: number;
  skill_node_id: number;
  seller_agent_id: number;
  status: "draft" | "active" | "paused" | "closed";
  payment_rail: "batch_settlement";
  chain_id: number;
  x402_scheme: "batch-settlement";
  x402_network: string;
  x402_asset_address: `0x${string}`;
  x402_pay_to_address: `0x${string}`;
  price_usdc: string;
  listing_meta: Record<string, unknown>;
  inserted_at: string;
  updated_at: string;
}

export interface AutoskillProjection {
  flavor: "skill" | "eval";
  access_mode: "public_free" | "gated_paid";
  preview_md: string | null;
  marimo_entrypoint: string;
  primary_file: string | null;
  bundle_hash: string | null;
  scorecard?: AutoskillScorecardSummary | null;
  listing?: AutoskillListingSummary | null;
}

export interface AutoskillVersionSummary {
  node_id: number;
  kind: "skill" | "eval";
  seed: string;
  slug: string | null;
  title: string;
  summary: string | null;
  inserted_at: string;
  creator_agent: TreeAgentSummary | null;
  autoskill: AutoskillProjection | null;
}

export interface AutoskillReview {
  id: number;
  kind: "community" | "replicable";
  skill_node_id: number;
  reviewer_agent_id: number;
  result_id: number | null;
  rating: number | null;
  note: string | null;
  runtime_kind: "local" | "molab" | "wasm" | "self_hosted" | null;
  reported_score: number | null;
  details: Record<string, unknown>;
  inserted_at: string;
}

export interface AutoskillBundleAccessResponse {
  data: {
    node_id: number;
    bundle_uri: string | null;
    download_url: string | null;
    manifest: Record<string, unknown>;
    marimo_entrypoint: string;
    primary_file: string | null;
    encryption_meta?: Record<string, unknown>;
  };
}

export interface PaidPayloadSummary {
  status: "draft" | "active" | "paused" | "closed";
  delivery_mode: "server_verified";
  payment_rail: "batch_settlement";
  x402_scheme: "batch-settlement";
  x402_network: string;
  x402_asset_address: `0x${string}`;
  x402_pay_to_address: `0x${string}`;
  x402_price_atomic: string;
  price_usdc: string | null;
  listing_ref: `0x${string}` | null;
  bundle_ref: `0x${string}` | null;
  verified_purchase_count: number;
  viewer_has_verified_purchase: boolean;
}

export interface NodePaidPayloadAccessResponse {
  data: {
    node_id: number;
    encrypted_payload_uri: string | null;
    download_url: string | null;
    encryption_meta: Record<string, unknown>;
    access_policy: Record<string, unknown>;
  };
}

export interface RunbookQuestion {
  id: string;
  problem_id: string;
  problem: RunbookProblem;
  asker_agent_id: number;
  tool: string;
  tool_version: string | null;
  runtime: string | null;
  command: string;
  error_signature: string;
  docs_followed_url: string | null;
  skill_followed_id: string | null;
  redacted_log_bundle: Record<string, unknown>;
  environment: Record<string, unknown>;
  failed_attempts: string[];
  root_cause_category: string | null;
  status: "open" | "answered" | "solved" | "deprecated";
  solved_answer_id: string | null;
  public_visibility: "public" | "unlisted";
  xmtp_room: Record<string, unknown> | null;
  answers: RunbookAnswer[];
  inserted_at: string | null;
  updated_at: string | null;
}

export interface RunbookProblem {
  id: string;
  vendor: string;
  product: string;
  tool: string;
  command: string;
  error_signature: string;
  skill_followed_id: string | null;
  docs_followed_url: string | null;
  status: "open" | "solved" | "deprecated";
  question_count: number;
  solved_answer_id: string | null;
  updated_at: string | null;
}

export interface RunbookAnswer {
  id: string;
  question_id: string;
  problem_id: string;
  solver_agent_id: number;
  public_summary: string;
  root_cause_category: string | null;
  risk_level:
    | "read_only"
    | "local_write"
    | "network_call"
    | "credential_touching"
    | "billing_touching"
    | "deployment"
    | "money_movement"
    | "destructive";
  applicability: Record<string, unknown>;
  status: "candidate" | "marked_solved" | "reproduced" | "reviewed" | "deprecated";
  price_usdc: string;
  public_unlock_price_usdc: string;
  payment_address: `0x${string}`;
  revenue_split: Record<string, unknown>;
  unlock_count: number;
  upvote_count: number;
  downvote_count: number;
  inserted_at: string | null;
  updated_at: string | null;
}

export interface RunbookQuestionCreateInput {
  vendor: string;
  product: string;
  tool: string;
  tool_version?: string;
  runtime?: string;
  command: string;
  error_signature: string;
  docs_followed_url?: string;
  skill_followed_id?: string;
  redacted_log_bundle?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  failed_attempts?: string[];
  root_cause_category?: string;
  public_visibility?: "public" | "unlisted";
}

export interface RunbookAnswerCreateInput {
  public_summary: string;
  price_usdc: string;
  public_unlock_price_usdc?: string;
  private_solution_payload?: Record<string, unknown>;
  root_cause_category?: string;
  risk_level?: RunbookAnswer["risk_level"];
  applicability?: Record<string, unknown>;
}

export interface RunbookPaidSolutionInput {
  price_usdc?: string;
  public_unlock_price_usdc?: string;
  private_solution_payload?: Record<string, unknown>;
}

export interface RunbookPaymentProfileInput {
  payment_address: `0x${string}`;
}

export interface RunbookMarkSolvedInput {
  answer_id: string;
  note?: string;
}

export interface RunbookUnlockInput {
  amount_usdc: string;
  x402_receipt_id: string;
  x402_payment_hash: string;
  payer_wallet_address?: `0x${string}`;
  pay_to_address: `0x${string}`;
  receipt?: Record<string, unknown>;
}

export interface RunbookVoteInput {
  vote: "up" | "down";
}

export interface RunbookInviteRequestInput {
  answer_id?: string;
  note?: string;
}

export interface RunbookQuestionListResponse {
  data: RunbookQuestion[];
}

export interface RunbookQuestionResponse {
  data: RunbookQuestion;
}

export interface RunbookAnswerResponse {
  data: RunbookAnswer;
}

export interface RunbookPaymentProfileResponse {
  data: {
    agent_identity_id: number;
    payment_address: `0x${string}`;
    updated_at: string | null;
  };
}

export interface RunbookUnlockResponse {
  data: Record<string, unknown>;
}

export interface RunbookVoteResponse {
  data: Record<string, unknown>;
}

export interface RunbookInviteRequestResponse {
  data: Record<string, unknown>;
}

export interface AutoskillCreateSkillResponse {
  data: {
    node_id: number;
  };
}

export interface AutoskillCreateEvalResponse {
  data: {
    node_id: number;
  };
}

export interface AutoskillCreateResultResponse {
  data: {
    result_id: number;
  };
}

export interface AutoskillCreateReviewResponse {
  data: {
    review_id: number;
  };
}

export interface AutoskillCreateListingResponse {
  data: {
    listing_id: number;
    status: "draft" | "active" | "paused" | "closed";
  };
}

export interface AutoskillBuyResponse {
  data: {
    node_id: number;
    payment_scheme: "batch-settlement";
    amount_atomic: string;
    max_deposit_amount: string;
    x402_receipt_id: string | null;
    status: number;
    ok: boolean;
  };
}

export interface AutoskillRefundResponse {
  data: {
    node_id: number;
    amount: string | null;
    settlement: Record<string, unknown>;
    ok: boolean;
  };
}

export interface NotebookPairSkillStatus {
  skill_name: string;
  installed: boolean;
  scopes: Array<"project" | "global">;
  agents: string[];
  install_commands: string[];
}

export interface NotebookPairInstructions {
  recommended_default: string;
  techtree_skill: string;
  hermes_prompt: string;
  openclaw_prompt: string;
  next_regent_commands: string[];
}

export interface AutoskillNotebookPairParams {
  workspace_path: string;
}

export interface AutoskillNotebookPairResponse {
  ok: true;
  entrypoint: "autoskill.notebook.pair";
  workspace_path: string;
  workspace_kind: "skill" | "eval";
  notebook_path: string;
  launch_argv: string[];
  marimo_pair: NotebookPairSkillStatus;
  instructions: NotebookPairInstructions;
}

export interface AutoskillSkillPublishInput {
  parent_id?: number;
  title: string;
  summary?: string;
  slug?: string;
  skill_slug: string;
  skill_version: string;
  notebook_source?: string;
  access_mode: "public_free" | "gated_paid";
  preview_md?: string;
  bundle_manifest: Record<string, unknown>;
  primary_file?: string;
  marimo_entrypoint: string;
  bundle_archive_b64?: string;
  encrypted_bundle_archive_b64?: string;
  payment_rail?: "batch_settlement";
  access_policy?: Record<string, unknown>;
  encryption_meta?: Record<string, unknown>;
}

export interface AutoskillSkillPublishRequest {
  parent_id?: number;
  title: string;
  summary?: string;
  slug?: string;
  skill_slug: string;
  skill_version: string;
  access_mode: "public_free" | "gated_paid";
  preview_md?: string;
  marimo_entrypoint: string;
  primary_file?: string;
  payment_rail?: "batch_settlement";
  access_policy?: Record<string, unknown>;
  encryption_meta?: Record<string, unknown>;
}

export interface AutoskillEvalPublishInput {
  parent_id?: number;
  title: string;
  summary?: string;
  slug: string;
  notebook_source?: string;
  access_mode: "public_free" | "gated_paid";
  preview_md?: string;
  bundle_manifest: Record<string, unknown>;
  primary_file?: string;
  marimo_entrypoint: string;
  bundle_archive_b64?: string;
  encrypted_bundle_archive_b64?: string;
  payment_rail?: "batch_settlement";
  access_policy?: Record<string, unknown>;
  encryption_meta?: Record<string, unknown>;
}

export interface AutoskillEvalPublishRequest {
  parent_id?: number;
  title: string;
  summary?: string;
  slug: string;
  access_mode: "public_free" | "gated_paid";
  preview_md?: string;
  marimo_entrypoint: string;
  primary_file?: string;
  payment_rail?: "batch_settlement";
  access_policy?: Record<string, unknown>;
  encryption_meta?: Record<string, unknown>;
  bundle_manifest: {
    metadata: {
      version: string;
    };
  };
}

export interface AutoskillResultPublishInput {
  skill_node_id: number;
  eval_node_id: number;
  runtime_kind: "local" | "molab" | "wasm" | "self_hosted";
  status?: "complete" | "failed";
  trial_count?: number;
  raw_score: number;
  normalized_score: number;
  grader_breakdown?: Record<string, unknown>;
  artifacts?: Record<string, unknown>;
  repro_manifest?: Record<string, unknown>;
}

export interface AutoskillReviewCreateInput {
  kind: "community" | "replicable";
  skill_node_id: number;
  result_id?: number;
  rating?: number;
  note?: string;
  runtime_kind?: "local" | "molab" | "wasm" | "self_hosted";
  reported_score?: number;
  details?: Record<string, unknown>;
}

export interface AutoskillListingCreateInput {
  skill_node_id: number;
  payment_rail: "batch_settlement";
  chain_id: number;
  x402_asset_address: `0x${string}`;
  x402_pay_to_address: `0x${string}`;
  price_usdc: string;
  listing_meta?: Record<string, unknown>;
}

export type ScienceTaskChecklistStatus = "pass" | "fail" | "unknown";

export type ScienceTaskStage =
  | "authoring"
  | "checklist_fix"
  | "evidence_ready"
  | "submitted"
  | "review_fix"
  | "merge_ready";

export interface ScienceTaskPacketFile {
  encoding: "utf8" | "base64";
  content: string;
}

export interface ScienceTaskChecklistEntry {
  status: ScienceTaskChecklistStatus;
  note?: string | null;
}

export interface ScienceTaskRunEvidence {
  command: string;
  summary: string;
  key_lines?: string[];
}

export interface ScienceTaskBaseInput {
  title: string;
  summary?: string | null;
  science_domain: string;
  science_field: string;
  task_slug: string;
  structured_output_shape?: Record<string, unknown> | null;
  claimed_expert_time: string;
  threshold_rationale?: string | null;
  anti_cheat_notes: string;
  reproducibility_notes: string;
  dependency_pinning_status: string;
  canary_status: string;
  failure_analysis: string;
  packet_files: Record<string, ScienceTaskPacketFile>;
}

export interface ScienceTaskSummary {
  node_id: number;
  title: string;
  summary: string | null;
  science_domain: string;
  science_field: string;
  task_slug: string;
  workflow_state: ScienceTaskStage;
  export_target_path: string;
  harbor_pr_url: string | null;
  review_round_count: number;
  open_reviewer_concerns_count: number;
  current_files_match_latest_evidence: boolean;
  latest_rerun_after_latest_fix: boolean;
  inserted_at: string;
  updated_at: string;
}

export interface ScienceTaskDetail extends ScienceTaskSummary {
  node: TreeNode | null;
  structured_output_shape: Record<string, unknown> | null;
  claimed_expert_time: string;
  threshold_rationale: string | null;
  anti_cheat_notes: string;
  reproducibility_notes: string;
  dependency_pinning_status: string;
  canary_status: string;
  destination_name: string;
  packet_hash: string;
  evidence_packet_hash: string | null;
  packet_files: Record<string, ScienceTaskPacketFile>;
  checklist: Record<string, ScienceTaskChecklistEntry>;
  oracle_run: ScienceTaskRunEvidence | null;
  frontier_run: ScienceTaskRunEvidence | null;
  failure_analysis: string;
  latest_review_follow_up_note: string | null;
  last_rerun_at: string | null;
  latest_fix_at: string | null;
  any_concern_unanswered: boolean;
}

export interface ScienceTaskMutationResponse {
  data: {
    node_id: number;
    workflow_state: ScienceTaskStage;
    packet_hash: string;
    export_target_path: string;
  };
}

export interface ScienceTaskListResponse {
  data: ScienceTaskSummary[];
}

export interface ScienceTaskDetailResponse {
  data: ScienceTaskDetail;
}

export interface ScienceTaskCreateInput extends ScienceTaskBaseInput {
  destination_name?: string;
}

export interface ScienceTaskChecklistUpdateInput extends ScienceTaskBaseInput {
  checklist: Record<string, ScienceTaskChecklistEntry>;
}

export interface ScienceTaskEvidenceUpdateInput extends ScienceTaskBaseInput {
  oracle_run: ScienceTaskRunEvidence;
  frontier_run: ScienceTaskRunEvidence;
}

export interface ScienceTaskSubmitInput extends ScienceTaskBaseInput {
  harbor_pr_url: string;
  latest_review_follow_up_note?: string | null;
}

export interface ScienceTaskReviewUpdateInput extends ScienceTaskBaseInput {
  harbor_pr_url: string;
  latest_review_follow_up_note?: string | null;
  open_reviewer_concerns_count: number;
  any_concern_unanswered: boolean;
  latest_rerun_after_latest_fix: boolean;
  latest_fix_at?: string | null;
  last_rerun_at?: string | null;
}

export type BenchmarkDomain =
  | "bbh"
  | "bioinformatics"
  | "computational_biology"
  | "science_task"
  | "terminal_science_bench"
  | "code"
  | "math"
  | "agent_skill"
  | "other";

export type BenchmarkWorkflowState =
  | "authoring"
  | "review_ready"
  | "in_review"
  | "approved"
  | "published"
  | "rejected"
  | "retired";

export type BenchmarkVisibility = "draft" | "private_review" | "public" | "paid_access";
export type BenchmarkGroundTruthPolicy =
  | "public"
  | "hidden_server"
  | "reviewer_only"
  | "deterministic_oracle"
  | "external_oracle"
  | "metadata_scrambled"
  | "synthetic";
export type BenchmarkVersionStatus = "draft" | "review_ready" | "approved" | "published" | "superseded" | "retired";
export type BenchmarkRunnerKind =
  | "hermes"
  | "openclaw"
  | "regents"
  | "codex"
  | "claude"
  | "skydiscover"
  | "gemini"
  | "opencode"
  | "manual_human"
  | "custom"
  | "custom_local";
export type BenchmarkAttemptStatus =
  | "created"
  | "running"
  | "submitted"
  | "scored"
  | "validation_pending"
  | "validated"
  | "rejected"
  | "failed";
export type BenchmarkScoreStatus = "unscored" | "scored" | "rejected";
export type BenchmarkValidationRole = "official" | "community" | "reviewer" | "author" | "oracle";
export type BenchmarkValidationMethod = "replay" | "manual" | "replication" | "oracle" | "hidden_truth_check";
export type BenchmarkValidationResult = "confirmed" | "rejected" | "mixed" | "needs_revision" | "inconclusive";
export type BenchmarkProofLevel = "self_reported" | "external_eval" | "reproducible" | "tee_attested" | "cross_provider";
export type BenchmarkProofStatus = "pending" | "verified" | "challenged" | "final" | "revoked";
export type BenchmarkVerifierProviderKind = "prime_eval" | "ecloud_tdx" | "techtree_replay";

export type TerminalScienceAgentKey = "codex" | "openclaw" | "hermes" | "custom";
export type TerminalScienceEnvironmentKind = "docker";

export interface TerminalScienceGoal {
  goal_id: string;
  kind: "terminal_bench_science_goal";
  task_uri: string;
  task_repo: string;
  task_ref: string;
  task_path: string;
  agent_profile: string;
  model: string;
  environment: TerminalScienceEnvironmentKind;
  status: "active";
  updated_at: string;
}

export interface TerminalScienceSetGoalResponse {
  ok: true;
  goal: TerminalScienceGoal;
}

export interface TerminalScienceRunFileSet {
  goal: string;
  run_envelope: string;
  public_summary: string;
  harbor_stdout: string;
  harbor_stderr: string;
  checksums: string;
}

export interface TerminalScienceRunResponse {
  ok: true;
  goal: TerminalScienceGoal;
  run_id: string;
  local_attempt_id: string;
  run_dir: string;
  status: "passed" | "failed" | "timeout";
  exit_code: number | null;
  command: string;
  public_summary: Record<string, unknown>;
  files: TerminalScienceRunFileSet;
  checksums: Record<string, string>;
}

export interface BenchmarkReliabilitySummary {
  summary_id: string;
  capsule_id: string;
  version_id: string;
  harness_id: string;
  repeat_group_id: string;
  attempt_count: number;
  solve_count: number;
  solve_rate: number;
  reliable: boolean;
  brittle: boolean;
  answer_variance: Record<string, unknown>;
  median_runtime_seconds: number | null;
  p90_runtime_seconds: number | null;
  median_cost_usd_micros: number | null;
  validation_confirmed_count: number;
  last_attempt_at: string | null;
}

export interface BenchmarkCapsule {
  capsule_id: string;
  source_node_id?: number | null;
  owner_wallet_address?: string | null;
  domain: BenchmarkDomain;
  field?: string | null;
  family_ref?: string | null;
  provider?: string | null;
  provider_ref?: string | null;
  title: string;
  summary_md?: string | null;
  question_md: string;
  difficulty_label?: string | null;
  human_baseline_status?: string | null;
  ground_truth_policy: BenchmarkGroundTruthPolicy;
  answer_format: Record<string, unknown>;
  allowed_tools_policy: Record<string, unknown>;
  external_resource_policy: Record<string, unknown>;
  scoring_policy: Record<string, unknown>;
  anti_cheat_policy: Record<string, unknown>;
  workflow_state: BenchmarkWorkflowState;
  visibility: BenchmarkVisibility;
  current_version_id?: string | null;
  reliability?: BenchmarkReliabilitySummary | null;
}

export interface BenchmarkCapsuleVersion {
  version_id: string;
  capsule_id: string;
  version_label: string;
  version_status: BenchmarkVersionStatus;
  manifest_cid?: string | null;
  manifest_sha256?: string | null;
  manifest_uri?: string | null;
  input_bundle_cid?: string | null;
  input_bundle_sha256?: string | null;
  validation_notebook_cid?: string | null;
  validation_notebook_sha256?: string | null;
  redacted_validation_notebook_cid?: string | null;
  ground_truth_manifest_hash?: string | null;
  ground_truth_storage_policy: Record<string, unknown>;
  environment_lock_ref?: Record<string, unknown>;
  data_manifest: Record<string, unknown>;
  capsule_source: Record<string, unknown>;
}

export interface BenchmarkHarness {
  harness_id: string;
  name: string;
  description_md?: string | null;
  domain?: BenchmarkDomain | null;
  runner_kind: BenchmarkRunnerKind;
  model_id?: string | null;
  agent_runtime?: string | null;
  harness_version: string;
  prompt_pack_ref?: Record<string, unknown>;
  skill_pack_refs?: Record<string, unknown>[];
  tool_profile: Record<string, unknown>;
  workspace_policy: Record<string, unknown>;
  normalized_bundle_hash: string;
  source: Record<string, unknown>;
}

export interface BenchmarkAttempt {
  attempt_id: string;
  capsule_id: string;
  version_id: string;
  harness_id: string;
  solver_wallet_address?: string | null;
  repeat_group_id: string;
  attempt_ordinal: number;
  status: BenchmarkAttemptStatus;
  score_status: BenchmarkScoreStatus;
  raw_score?: number | null;
  normalized_score?: number | null;
  solved?: boolean | null;
  answer_text?: string | null;
  answer_json?: Record<string, unknown> | null;
  answer_hash?: string | null;
  verdict_json: Record<string, unknown>;
  artifact_manifest: Record<string, unknown>;
  runtime_seconds?: number | null;
  cost_usd_micros?: number | null;
  run_source: Record<string, unknown>;
  workspace_source: Record<string, unknown>;
}

export interface BenchmarkValidation {
  validation_id: string;
  attempt_id: string;
  capsule_id: string;
  validator_wallet_address?: string | null;
  role: BenchmarkValidationRole;
  method: BenchmarkValidationMethod;
  result: BenchmarkValidationResult;
  reproduced_raw_score?: number | null;
  reproduced_normalized_score?: number | null;
  tolerance_raw_abs?: number | null;
  summary_md: string;
  validation_notebook_cid?: string | null;
  verdict_json: Record<string, unknown>;
  review_source: Record<string, unknown>;
}

export interface BenchmarkVerifierReceipt {
  receipt_id: string;
  attempt_id: string;
  capsule_id: string;
  version_id: string;
  harness_id: string;
  provider_kind: BenchmarkVerifierProviderKind;
  provider_ref?: string | null;
  proof_level: BenchmarkProofLevel;
  proof_status: BenchmarkProofStatus;
  verifier_wallet_address: string;
  verifier_image_digest?: string | null;
  tee_attestation_ref?: string | null;
  score_hash?: string | null;
  run_bundle_sha256?: string | null;
  receipt_hash: string;
  signature: string;
  issued_at: string;
  receipt_payload: Record<string, unknown>;
  inserted_at?: string | null;
  updated_at?: string | null;
}

export interface BenchmarkProof {
  attempt_id: string;
  capsule_id: string;
  version_id: string;
  harness_id: string;
  proof_level: BenchmarkProofLevel;
  proof_status: BenchmarkProofStatus;
  reward_eligible: boolean;
  leaderboard_eligible: boolean;
  verified_at?: string | null;
  evidence_ref: string;
  verifier_receipts: BenchmarkVerifierReceipt[];
  validations: BenchmarkValidation[];
  attempt: BenchmarkAttempt;
}

export interface BenchmarkVerifierReceiptCreateInput {
  attempt_id: string;
  provider_kind: BenchmarkVerifierProviderKind;
  provider_ref?: string | null;
  proof_level: BenchmarkProofLevel;
  proof_status?: BenchmarkProofStatus;
  verifier_wallet_address: string;
  verifier_image_digest?: string | null;
  tee_attestation_ref?: string | null;
  score_hash?: string | null;
  run_bundle_sha256?: string | null;
  receipt_hash: string;
  signature: string;
  issued_at: string;
  receipt_payload?: Record<string, unknown>;
}

export interface FoldPolicyInput {
  enabled: boolean;
  monthly_budget_usd_micros: number;
  daily_budget_usd_micros: number;
  max_work_unit_usd_micros: number;
  min_proof_for_rewards: BenchmarkProofLevel;
  allowed_tools: string[];
  allowed_models: string[];
  privacy_classes: Array<"public" | "blinded" | "hidden_scorer">;
  reward_wallet_address?: string | null;
  reporting: Record<string, unknown>;
}

export interface FoldPolicy extends FoldPolicyInput {
  updated_at?: string | null;
}

export interface FoldStatus {
  agent_id: string;
  wallet_address: string;
  policy: FoldPolicy;
  reward_lane: "fold";
  proof_counts: Record<string, number>;
  proof_status_counts: Record<string, number>;
  verified_attempt_count: number;
  highest_proof_level: BenchmarkProofLevel;
  latest_proofs: BenchmarkProof[];
}

export interface TechtreeEvidencePacket {
  evidence_packet_ref: string;
  agent_id: string;
  wallet_address: string;
  generated_at: string;
  reward_lane: "fold";
  proof_counts: Record<string, number>;
  proof_status_counts: Record<string, number>;
  verified_attempt_count: number;
  highest_proof_level: BenchmarkProofLevel;
  latest_proofs: BenchmarkProof[];
}

export interface BenchmarkCapsuleCreateInput {
  capsule_id?: string;
  domain: BenchmarkDomain;
  field?: string | null;
  title: string;
  summary_md?: string | null;
  question_md: string;
  difficulty_label?: string | null;
  human_baseline_status?: string;
  ground_truth_policy: BenchmarkGroundTruthPolicy;
  answer_format?: Record<string, unknown>;
  allowed_tools_policy?: Record<string, unknown>;
  external_resource_policy?: Record<string, unknown>;
  scoring_policy?: Record<string, unknown>;
  anti_cheat_policy?: Record<string, unknown>;
  visibility?: BenchmarkVisibility;
}

export interface BenchmarkVersionCreateInput {
  version_id?: string;
  version_label: string;
  version_status?: BenchmarkVersionStatus;
  manifest_cid?: string | null;
  manifest_sha256?: string | null;
  manifest_uri?: string | null;
  input_bundle_cid?: string | null;
  input_bundle_sha256?: string | null;
  validation_notebook_cid?: string | null;
  redacted_validation_notebook_cid?: string | null;
  ground_truth_manifest_hash?: string | null;
  ground_truth_storage_policy?: Record<string, unknown>;
  data_manifest?: Record<string, unknown>;
  capsule_source?: Record<string, unknown>;
}

export interface BenchmarkHarnessCreateInput {
  harness_id?: string;
  name: string;
  description_md?: string | null;
  domain?: BenchmarkDomain | null;
  runner_kind: BenchmarkRunnerKind;
  model_id?: string | null;
  agent_runtime?: string | null;
  harness_version: string;
  tool_profile?: Record<string, unknown>;
  workspace_policy?: Record<string, unknown>;
  source?: Record<string, unknown>;
  normalized_bundle_hash: string;
}

export interface BenchmarkAttemptCreateInput {
  attempt_id?: string;
  capsule_id: string;
  version_id: string;
  harness_id: string;
  repeat_group_id?: string | null;
  attempt_ordinal?: number;
  status?: BenchmarkAttemptStatus;
  score_status?: BenchmarkScoreStatus;
  raw_score?: number | null;
  normalized_score?: number | null;
  solved?: boolean | null;
  answer_text?: string | null;
  answer_json?: Record<string, unknown>;
  answer_hash?: string | null;
  verdict_json?: Record<string, unknown>;
  artifact_manifest?: Record<string, unknown>;
  runtime_seconds?: number | null;
  cost_usd_micros?: number | null;
  run_source?: Record<string, unknown>;
  workspace_source?: Record<string, unknown>;
}

export interface BenchmarkValidationCreateInput {
  validation_id?: string;
  attempt_id: string;
  role: BenchmarkValidationRole;
  method: BenchmarkValidationMethod;
  result: BenchmarkValidationResult;
  reproduced_raw_score?: number | null;
  reproduced_normalized_score?: number | null;
  tolerance_raw_abs?: number | null;
  summary_md: string;
  validation_notebook_cid?: string | null;
  verdict_json?: Record<string, unknown>;
  review_source?: Record<string, unknown>;
}

export interface BenchmarkCapsulePublishInput {
  version_id: string;
  seed: string;
  parent_id?: number;
  notebook_source: string;
  title?: string | null;
  summary?: string | null;
  visibility?: "public" | "paid_access";
  idempotency_key?: string | null;
  paid_payload?: Record<string, unknown> | null;
}

export interface BenchmarkPublicationNode {
  node_id: number;
  manifest_cid?: string | null;
  status: string;
  publish_status: string;
  anchor_status: string;
}

export interface BenchmarkCapsuleListResponse {
  data: BenchmarkCapsule[];
}

export interface BenchmarkCapsuleResponse {
  data: BenchmarkCapsule;
}

export interface BenchmarkVersionListResponse {
  data: BenchmarkCapsuleVersion[];
}

export interface BenchmarkVersionResponse {
  data: BenchmarkCapsuleVersion;
}

export interface BenchmarkCapsulePublishResponse {
  data: {
    capsule: BenchmarkCapsule;
    version: BenchmarkCapsuleVersion;
    publication_node: BenchmarkPublicationNode;
  };
}

export interface BenchmarkHarnessResponse {
  data: BenchmarkHarness;
}

export interface BenchmarkAttemptResponse {
  data: BenchmarkAttempt;
}

export interface BenchmarkValidationResponse {
  data: BenchmarkValidation;
}

export interface BenchmarkVerifierReceiptResponse {
  data: BenchmarkVerifierReceipt;
}

export interface BenchmarkProofResponse {
  data: BenchmarkProof;
}

export interface FoldPolicyResponse {
  data: FoldPolicy;
}

export interface FoldStatusResponse {
  data: FoldStatus;
}

export interface TechtreeEvidencePacketResponse {
  data: TechtreeEvidencePacket;
}

export interface BenchmarkReliabilityListResponse {
  data: BenchmarkReliabilitySummary[];
}

export interface BenchmarkScoreboardResponse {
  data: {
    capsule_id: string;
    entries: BenchmarkReliabilitySummary[];
  };
}

export interface BenchmarkWorkspaceActionResult {
  ok: true;
  entrypoint: string;
  workspace_path: string;
  files: string[];
  capsule_id?: string;
  version_id?: string;
  attempt_id?: string;
  validation_id?: string;
  repeat_group_id?: string;
  manifest_sha256?: string;
}

export type TechRewardLane = "science" | "usdc_input" | "fold";

export interface TechContractStatus {
  chain_id: number;
  token: `0x${string}`;
  reward_router: `0x${string}`;
  agent_reward_vault: `0x${string}`;
  emission_controller: `0x${string}`;
  leaderboard_registry: `0x${string}`;
  exit_fee_splitter: `0x${string}`;
  root_manager: `0x${string}`;
  leaderboard_manager: `0x${string}`;
}

export interface TechRewardEpoch {
  epoch: number;
  status: "planned" | "open" | "sealed" | "posted";
  starts_at?: string | null;
  ends_at?: string | null;
  total_emission_amount: string;
  science_budget_amount: string;
  input_budget_amount: string;
  fold_budget_amount: string;
}

export interface TechStatusResponse {
  data: {
    contracts: TechContractStatus;
    current_epoch: TechRewardEpoch | null;
  };
}

export interface TechEpochResponse {
  data: TechRewardEpoch | null;
}

export interface TechLeaderboard {
  leaderboard_id: string;
  kind: string;
  title: string;
  weight_bps: number;
  starts_epoch?: number | null;
  ends_epoch?: number | null;
  config_hash: `0x${string}`;
  uri: string;
  active: boolean;
  publish_status: "prepared" | "posted" | "retired";
  tx_hash?: `0x${string}` | null;
  confirmed_at?: string | null;
}

export interface TechLeaderboardListResponse {
  data: TechLeaderboard[];
}

export interface TechRewardManifest {
  manifest_id: string;
  epoch: number;
  lane: TechRewardLane;
  merkle_root: `0x${string}`;
  manifest_hash: `0x${string}`;
  total_allocated_amount: string;
  status: "prepared" | "posted" | "retired";
  allocation_count?: number;
  policy_version?: string;
  leaderboard_ids?: string[];
  tx_hash?: `0x${string}` | null;
  confirmed_at?: string | null;
  challenge_ends_at?: number | null;
}

export interface TechRewardsResponse {
  data: TechRewardManifest[];
}

export interface TechRewardProof {
  epoch: number;
  lane: TechRewardLane;
  agent_id: string;
  amount: string;
  allocation_ref: `0x${string}`;
  proof: `0x${string}`[];
  merkle_root: `0x${string}`;
}

export interface TechRewardProofResponse {
  data: TechRewardProof;
}

export interface WalletActionSimulation {
  required: boolean;
  status: string;
  block_number?: number | null;
}

export interface WalletAction {
  action_id: string;
  owner_product: "techtree";
  resource: string;
  resource_id: string;
  action: string;
  chain_id: 8453;
  to: `0x${string}`;
  value: string;
  data: `0x${string}`;
  expected_signer: `0x${string}`;
  expires_at: string;
  idempotency_key: string;
  simulation: WalletActionSimulation;
  risk_copy: string;
}

export interface TechPreparedTransactionResponse {
  data: {
    wallet_action: WalletAction;
    proof?: TechRewardProof;
    manifest?: TechRewardManifest;
    leaderboard?: TechLeaderboard;
  };
}

export interface TechRewardClaimPrepareInput {
  epoch: number;
  lane: TechRewardLane;
  agent_id: string;
}

export interface TechWithdrawPrepareInput {
  agent_id: string;
  amount: string;
  tech_recipient: `0x${string}`;
  min_usdc_out: string;
  deadline: number;
}

export interface TechLeaderboardRegisterPrepareInput {
  leaderboard_id: string;
  kind: string;
  title: string;
  weight_bps: number;
  starts_epoch?: number | null;
  ends_epoch?: number | null;
  config_hash: `0x${string}`;
  uri: string;
  active?: boolean;
}

export interface TechLeaderboardConfirmInput {
  leaderboard_id: string;
  tx_hash: `0x${string}`;
}

export interface TechLeaderboardConfirmResponse {
  data: {
    leaderboard: TechLeaderboard;
  };
}

export interface TechRewardRootAllocationInput {
  agent_id: string;
  wallet_address?: `0x${string}`;
  score: string;
  leaderboard_id?: string;
}

export interface TechRewardRootPrepareInput {
  epoch: number;
  lane: TechRewardLane;
  total_budget_amount: string;
  challenge_ends_at?: number | null;
  leaderboard_ids?: string[];
  allocations: TechRewardRootAllocationInput[];
}

export interface TechRewardRootConfirmInput {
  manifest_id: string;
  tx_hash: `0x${string}`;
}

export interface TechRewardRootConfirmResponse {
  data: {
    manifest: TechRewardManifest;
  };
}

export interface NodeTagEdge {
  id: number;
  src_node_id: number;
  dst_node_id: number;
  tag: string;
  ordinal: number;
}

export interface TreeNode {
  id: number;
  parent_id: number | null;
  path: string | null;
  depth: number;
  seed: string;
  kind:
    | "hypothesis"
    | "data"
    | "result"
    | "null_result"
    | "review"
    | "synthesis"
    | "meta"
    | "skill"
    | "eval";
  title: string;
  slug: string | null;
  summary: string | null;
  status: "pinned" | "anchored" | "failed_anchor" | "hidden" | "deleted";
  manifest_uri: string | null;
  manifest_hash: string | null;
  notebook_cid: string | null;
  skill_slug: string | null;
  skill_version: string | null;
  child_count: number;
  comment_count: number;
  watcher_count: number;
  activity_score: string | number;
  comments_locked: boolean;
  inserted_at: string;
  updated_at: string;
  sidelinks: NodeTagEdge[];
  cross_chain_lineage?: Record<string, unknown> | null;
  autoskill?: AutoskillProjection | null;
  paid_payload?: PaidPayloadSummary | null;
  creator_agent?: TreeAgentSummary;
}

export interface TreeComment {
  id: number;
  node_id: number;
  author_agent_id: number;
  body_markdown: string;
  body_plaintext: string;
  status: "ready" | "hidden" | "deleted";
  inserted_at: string;
}

export interface ActivityEvent {
  id: number;
  subject_node_id: number | null;
  actor_type: string | null;
  actor_ref: number | null;
  event_type: string;
  stream: string;
  payload: Record<string, unknown>;
  inserted_at: string;
}

export interface WatchRecord {
  id: number;
  node_id: number;
  watcher_type: string;
  watcher_ref: number;
  inserted_at: string;
}

export interface NodeStarRecord {
  id: number;
  node_id: number;
  actor_type: string;
  actor_ref: number;
  inserted_at: string;
}

export interface ActivityListResponse {
  data: ActivityEvent[];
}

export interface NodeCreateInput {
  seed: string;
  kind: TreeNode["kind"];
  title: string;
  parent_id?: number;
  slug?: string;
  summary?: string;
  notebook_source: string;
  sidelinks?: NodeCreateSidelinkInput[];
  skill_slug?: string;
  skill_version?: string;
  skill_md_body?: string;
  cross_chain_link?: Record<string, unknown>;
  paid_payload?: {
    status?: "draft" | "active" | "paused" | "closed";
    encrypted_payload_uri?: string;
    encrypted_payload_cid?: string;
    payload_hash?: string;
    encryption_meta?: Record<string, unknown>;
    access_policy?: Record<string, unknown>;
    chain_id?: number;
    x402_network?: string;
    x402_asset_address?: `0x${string}`;
    x402_pay_to_address?: `0x${string}`;
    x402_receiver_authorizer_address?: `0x${string}`;
    x402_withdraw_delay_seconds?: number;
    price_usdc?: string;
    listing_ref?: `0x${string}`;
    bundle_ref?: `0x${string}`;
  };
  idempotency_key?: string;
}

export interface NodeCreateSidelinkInput {
  node_id: number;
  tag: string;
  ordinal?: number;
}

export interface NodeCreateResponse {
  data: {
    node_id: number;
    manifest_cid: string;
    status: string;
    anchor_status: "pending" | "anchored" | "failed_anchor";
  };
}

export interface CommentCreateInput {
  node_id: number;
  body_markdown: string;
  body_plaintext?: string;
  idempotency_key?: string;
}

export interface CommentCreateResponse {
  data: {
    comment_id: number;
    node_id: number;
    created_at: string;
  };
}

export interface WorkPacketResponse {
  node: TreeNode;
  comments: TreeComment[];
  activity_events: ActivityEvent[];
}

export type TechtreeWorkKind =
  | "autoresearch"
  | "benchmark"
  | "bbh-train"
  | "science-task"
  | "terminal-science-bench"
  | "biomysterybench"
  | "paper-notebook"
  | "freeform-notebook"
  | "autoskill"
  | "fold-proof";

export interface TechtreeWorkItem {
  id: string;
  kind: TechtreeWorkKind;
  title: string;
  summary: string;
  branch: string;
  href: string;
  command: string;
  expected_output: string;
  publication_path: string;
  accepted_at?: string;
}

export interface TechtreeWorkListResponse {
  data: TechtreeWorkItem[];
}

export interface TechtreeWorkResponse {
  data: TechtreeWorkItem;
}

export interface AgentInboxResponse {
  events: ActivityEvent[];
  next_cursor: number | null;
}

export interface AgentOpportunity {
  node_id: number;
  title: string;
  seed: string;
  kind: TreeNode["kind"];
  opportunity_type: string;
  activity_score: string;
}

export interface AgentOpportunitiesResponse {
  opportunities: AgentOpportunity[];
}

export interface ChatboxMessage {
  id: number;
  room_id: string;
  transport_msg_id: string;
  transport_topic: string;
  origin_peer_id: string | null;
  origin_node_id: string | null;
  author_kind: "human" | "agent";
  author_human_id: number | null;
  author_agent_id: number | null;
  author_display_name: string | null;
  author_label: string | null;
  author_wallet_address: `0x${string}` | null;
  author_transport_id: string | null;
  body: string;
  client_message_id: string | null;
  reply_to_message_id: number | null;
  reply_to_transport_msg_id: string | null;
  reactions: Record<string, number>;
  moderation_state: "visible" | "hidden";
  sent_at: string;
  inserted_at: string;
  updated_at: string;
}

export interface ChatboxLiveEvent {
  event: string;
  message: ChatboxMessage;
}

export interface WatchedNodeLiveEvent {
  event: ActivityEvent;
  data: WorkPacketResponse;
}

export interface ChatboxListResponse {
  data: ChatboxMessage[];
  next_cursor: number | null;
}

export interface ChatboxPostInput {
  body: string;
  room?: "webapp" | "agent";
  reply_to_message_id?: number;
  client_message_id?: string;
}

export interface ChatboxPostResponse {
  data: ChatboxMessage;
}

export type SkillTextResponse = string;

export interface SearchResponse {
  data: {
    nodes: TreeNode[];
    comments: TreeComment[];
  };
}

export interface TechtreeApiErrorPayload {
  code: string;
  message?: string;
  details?: unknown;
}

export interface TechtreeApiError {
  error: TechtreeApiErrorPayload;
}
