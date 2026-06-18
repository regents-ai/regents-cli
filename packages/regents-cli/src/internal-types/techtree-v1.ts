export type TechtreeNodeId = `0x${string}`;
export type TechtreeSha256 = `sha256:${string}`;

export type TechtreeNodeType = "artifact" | "run" | "review";
export type TechtreeHeaderNodeType = 1 | 2 | 3;
export type TechtreeSourceKind = "paper" | "dataset" | "code" | "website" | "artifact" | "other";
export type TechtreeRuntimeNetworkPolicy = "none" | "declared";
export type TechtreeRuntimeFilesystemPolicy = "read_only" | "workspace_write";
export type TechtreeRuntimeSecretsPolicy = "forbidden" | "declared";
export type TechtreeEvalMode = "fixed" | "family";
export type TechtreeReviewTargetType = "artifact" | "run";
export type TechtreeReviewKind = "validation" | "challenge";
export type TechtreeRunHarnessKind = "openclaw" | "hermes" | "claude_code" | "custom";
export type TechtreeRunOriginKind =
  | "local"
  | "gossipsub"
  | "api"
  | "watched_node"
  | "scheduled"
  | "other";
export type TechtreeRunOriginTransport = "gossipsub" | "api" | "other";
export type TechtreeReviewMethod =
  | "replay"
  | "replication"
  | "manual"
  | "provenance"
  | "lineage"
  | "license"
  | "policy"
  | "other";
export type TechtreeReviewScopeLevel =
  | "whole"
  | "claim"
  | "eval"
  | "output"
  | "provenance"
  | "license"
  | "section";
export type TechtreeReviewResult = "confirmed" | "rejected" | "mixed" | "needs_revision";
export type TechtreeFindingSeverity = "info" | "warning" | "error";
export type TechtreeFileRole =
  | "notebook"
  | "lockfile"
  | "eval"
  | "output"
  | "verdict"
  | "log"
  | "attachment"
  | "manifest"
  | "bundle"
  | "other";

export interface TechtreeFileEntry {
  path: string;
  sha256: string;
  size: number;
  media_type: string;
  role: TechtreeFileRole;
}

export interface TechtreePayloadIndex {
  schema_version: "techtree.payload-index.v1";
  node_type: TechtreeNodeType;
  files: TechtreeFileEntry[];
  external_blobs: Array<{
    path: string;
    sha256: string;
    size: number;
    media_type: string;
    role: TechtreeFileRole;
  }>;
}

export interface TechtreeArtifactParentRef {
  artifact_id: TechtreeNodeId;
  relation: "revision" | "fork" | "derivative" | "reference";
  note?: string | null;
}

export interface TechtreeArtifactSourceManifest {
  schema_version: "techtree.artifact-source.v1";
  title: string;
  summary: string;
  parents?: TechtreeArtifactParentRef[];
  notebook: {
    entrypoint: string;
    include: string[];
    exclude?: string[];
    marimo_version?: string | null;
  };
  env: {
    lockfile_path?: string | null;
    image?: string | null;
    system: {
      python: string;
      platform: string;
    };
    runtime_policy: {
      network: TechtreeRuntimeNetworkPolicy;
      filesystem: TechtreeRuntimeFilesystemPolicy;
      secrets: TechtreeRuntimeSecretsPolicy;
      gpu: boolean;
    };
    external_resources: string[];
  };
  provenance?: {
    source_repo?: string | null;
    source_commit?: string | null;
    build_attestation_files?: string[];
  };
  claims?: Array<{ text: string }>;
  notes?: string | null;
  sources?: Array<{
    kind: TechtreeSourceKind;
    ref: string;
    license?: string | null;
    note?: string | null;
  }>;
  licenses?: {
    notebook?: string | null;
    data?: string | null;
    outputs?: string | null;
  };
  eval?: TechtreeArtifactEvalSource | null;
}

export interface TechtreeArtifactEvalSource {
  mode: TechtreeEvalMode;
  instance?: {
    seed: number;
    instance_id?: string | null;
    params: Record<string, unknown>;
  };
  protocol?: {
    entrypoint: string;
    allowed_tools: string[];
    max_runtime_s?: number | null;
    max_tokens?: number | null;
    output_contract?: {
      required_files?: string[];
      required_keys?: string[];
    };
  };
  rubric?: {
    scorer: string;
    primary_metric: string;
    secondary_metrics?: string[];
    score_range?: {
      min: number;
      max: number;
    };
    aggregation?: "deterministic" | "mean" | "custom";
    pass_rule?: string | null;
  };
  generator?: {
    entrypoint: string;
    seed_type?: "uint64" | string;
    determinism?: "seed_only" | "seed_plus_params";
    params_schema?: string | null;
  };
  hidden_eval_commitment?: TechtreeSha256 | `sha256:${string}`;
}

export interface TechtreeArtifactManifest extends Omit<TechtreeArtifactSourceManifest, "schema_version"> {
  schema_version: "techtree.artifact-manifest.v1";
  kind: "notebook" | "capsule";
  payload_hash: TechtreeSha256;
}

export interface TechtreeRunHarnessRef {
  kind: TechtreeRunHarnessKind;
  profile: string;
  entrypoint?: string | null;
}

export interface TechtreeRunOrigin {
  kind: TechtreeRunOriginKind;
  transport?: TechtreeRunOriginTransport | null;
  session_id?: string | null;
  trigger_ref?: string | null;
}

export interface TechtreeRunSourceManifest {
  schema_version: "techtree.run-source.v1";
  artifact_id: TechtreeNodeId;
  executor: {
    type: "genome" | "actor" | "system";
    id: string;
    version_ref?: string | null;
    harness?: TechtreeRunHarnessRef | null;
  };
  origin?: TechtreeRunOrigin | null;
  instance?: {
    seed?: number | null;
    instance_id?: string | null;
    params: Record<string, unknown>;
  };
  execution: {
    output_dir: string;
    allow_resume: boolean;
  };
}

export interface TechtreeRunManifest {
  schema_version: "techtree.run-manifest.v1";
  artifact_id: TechtreeNodeId;
  executor: {
    type: "genome" | "actor" | "system";
    id: string;
    version_ref?: string | null;
    harness?: TechtreeRunHarnessRef | null;
  };
  origin?: TechtreeRunOrigin | null;
  instance?: {
    seed?: number | null;
    instance_id?: string | null;
    params: Record<string, unknown>;
  };
  status: "planned" | "queued" | "running" | "completed" | "failed" | "cancelled";
  env_observed?: {
    image?: string | null;
    python?: string | null;
    platform?: string | null;
  };
  outputs?: {
    files?: TechtreeFileEntry[];
    primary_output?: string | null;
    verdict_ref?: string | null;
    log_ref?: string | null;
  };
  metrics?: {
    score?: number | null;
    values?: Record<string, number | string | boolean>;
  };
  run_provenance?: {
    runner_id?: string | null;
    attestation_files?: string[];
  };
  payload_hash: TechtreeSha256;
}

export interface TechtreeReviewSourceManifest {
  schema_version: "techtree.review-source.v1";
  target: {
    type: TechtreeReviewTargetType;
    id: TechtreeNodeId;
  };
  kind: TechtreeReviewKind;
  method: TechtreeReviewMethod;
  scope: {
    level: TechtreeReviewScopeLevel;
    path?: string | null;
  };
  result: TechtreeReviewResult;
  summary: string;
  findings?: Array<{
    code: string;
    severity: TechtreeFindingSeverity;
    message: string;
  }>;
  evidence?: {
    refs?: Array<{
      kind: TechtreeNodeType;
      ref: TechtreeNodeId;
      note?: string | null;
    }>;
    attachments?: {
      include?: string[];
      exclude?: string[];
    };
  };
}

export interface TechtreeReviewManifest {
  schema_version: "techtree.review-manifest.v1";
  target: {
    type: TechtreeReviewTargetType;
    id: TechtreeNodeId;
  };
  kind: TechtreeReviewKind;
  method: TechtreeReviewMethod;
  scope: {
    level: TechtreeReviewScopeLevel;
    path?: string | null;
  };
  result: TechtreeReviewResult;
  summary: string;
  findings?: Array<{
    code: string;
    severity: TechtreeFindingSeverity;
    message: string;
  }>;
  evidence?: {
    refs?: Array<{
      kind: TechtreeNodeType;
      ref: TechtreeNodeId;
      note?: string | null;
    }>;
    attachments?: TechtreeFileEntry[];
  };
  review_provenance?: {
    reviewer_id?: string | null;
    attestation_files?: string[];
  };
  payload_hash: TechtreeSha256;
}

export interface TechtreeNodeHeaderV1 {
  id: TechtreeNodeId;
  subjectId: TechtreeNodeId;
  auxId: TechtreeNodeId;
  payloadHash: TechtreeSha256;
  nodeType: TechtreeHeaderNodeType;
  schemaVersion: 1;
  flags: number;
  author: `0x${string}`;
}

export interface TechtreeCompilerOutput<TManifest> {
  workspace_path: string;
  dist_path: string;
  manifest_path: string;
  payload_index_path: string;
  node_header_path: string;
  checksums_path: string;
  node_id: TechtreeNodeId;
  manifest_hash: TechtreeSha256;
  payload_hash: TechtreeSha256;
  manifest: TManifest;
  payload_index: TechtreePayloadIndex;
  node_header: TechtreeNodeHeaderV1;
  resolved_metadata?: import("./agent.js").RegentResolvedRunMetadata | null;
}

export interface TechtreeFetchRequest {
  node_id: TechtreeNodeId;
  materialize_to?: string | null;
}

export interface TechtreeFetchResponse {
  ok: true;
  node_id: TechtreeNodeId;
  node_type: TechtreeNodeType;
  manifest_cid?: string | null;
  payload_cid?: string | null;
  manifest?: TechtreeArtifactManifest | TechtreeRunManifest | TechtreeReviewManifest;
  payload_index?: TechtreePayloadIndex;
  node_header?: TechtreeNodeHeaderV1;
  materialized_to?: string | null;
  verified?: boolean;
}

export interface TechtreePublishRequest {
  node_type: TechtreeNodeType;
  workspace_path: string;
  dist_path?: string | null;
  header: TechtreeNodeHeaderV1;
  manifest: Record<string, unknown>;
  payload_index: TechtreePayloadIndex;
}

export interface TechtreePublishResponse {
  ok: true;
  node_id: TechtreeNodeId;
  manifest_cid: string | null;
  payload_cid: string | null;
  tx_hash?: `0x${string}` | null;
}

export interface TechtreeVerifyRequest {
  node_id: TechtreeNodeId;
  workspace_path?: string | null;
  fetched?: TechtreeFetchResponse | null;
}

export interface TechtreeVerifyResponse {
  ok: true;
  node_id: TechtreeNodeId;
  verified: boolean;
  manifest_hash?: TechtreeSha256 | null;
  payload_hash?: TechtreeSha256 | null;
  header_matches?: boolean;
  details?: Record<string, unknown>;
}

export type TechtreeTreeName = "main" | "bbh";

export interface TechtreeWorkspaceActionResult {
  ok: true;
  tree: TechtreeTreeName;
  entrypoint: string;
  workspace_path: string;
  input?: Record<string, unknown>;
  resolved_metadata?: import("./agent.js").RegentResolvedRunMetadata | null;
  [key: string]: unknown;
}

export interface TechtreeV1WorkspaceParams {
  tree: TechtreeTreeName;
  workspace_path: string;
  metadata?: import("./agent.js").RegentRunMetadata | null;
}

export interface TechtreeV1RunInitParams extends TechtreeV1WorkspaceParams {
  artifact_id: TechtreeNodeId;
}

export interface TechtreeV1ReviewInitParams extends TechtreeV1WorkspaceParams {
  target_id: TechtreeNodeId;
}

export interface TechtreeV1FetchParams {
  tree: TechtreeTreeName;
  node_id: TechtreeNodeId;
  workspace_path?: string | null;
}

export interface TechtreeV1VerifyParams extends TechtreeV1FetchParams {}

export interface TechtreeV1BbhDraftInitParams {
  workspace_path: string;
}

export interface TechtreeV1BbhDraftCreateParams {
  workspace_path: string;
  title: string;
  seed?: string | null;
  parent_id?: number | null;
}

export interface TechtreeV1BbhDraftListParams {
  owner_wallet_address?: `0x${string}` | null;
}

export interface TechtreeV1BbhDraftPullParams {
  capsule_id: string;
  workspace_path: string;
}

export interface TechtreeV1BbhDraftProposalSubmitParams {
  workspace_path: string;
  capsule_id: string;
  summary: string;
}

export interface TechtreeV1BbhDraftApplyParams {
  capsule_id: string;
  proposal_id: string;
}

export interface TechtreeV1BbhDraftReadyParams {
  capsule_id: string;
}

export interface TechtreeV1BbhCapsulesListParams {
  split?: "climb" | "benchmark" | "challenge" | null;
}

export interface TechtreeV1BbhCapsulesGetParams {
  capsule_id: string;
}

export interface TechtreeV1ReviewerOrcidLinkParams {
  request_id?: string | null;
}

export interface TechtreeV1ReviewerApplyParams {
  domain_tags: string[];
  payout_wallet?: `0x${string}` | null;
  experience_summary?: string | null;
}

export interface TechtreeV1ReviewListParams {
  kind?: "design" | "genome" | "certification" | null;
}

export interface TechtreeV1ReviewClaimParams {
  request_id: string;
}

export interface TechtreeV1ReviewPullParams {
  request_id: string;
  workspace_path: string;
}

export interface TechtreeV1ReviewSubmitParams {
  workspace_path: string;
}

export interface TechtreeV1CertificateVerifyParams {
  capsule_id: string;
}

export interface TechtreeV1BbhLeaderboardEntry {
  node_id: TechtreeNodeId;
  artifact_id: TechtreeNodeId;
  fingerprint: string | null;
  display_name: string;
  score: number | null;
  score_label: string;
  review_result: string;
  reproducible: boolean;
  review_count: number;
  updated_at: string | null;
}

export interface TechtreeV1BbhLeaderboardResponse {
  tree: "bbh";
  split: "climb" | "benchmark" | "challenge" | "draft";
  generated_at: string;
  entries: TechtreeV1BbhLeaderboardEntry[];
}

export interface TechtreeV1BbhSyncResponse {
  tree: "bbh";
  synced_at: string;
  runs: number;
  reviews: number;
  leaderboard_entries: number;
}
