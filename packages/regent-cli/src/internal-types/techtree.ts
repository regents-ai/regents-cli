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
  payment_rail: "onchain";
  chain_id: number;
  settlement_contract_address: `0x${string}` | null;
  usdc_token_address: `0x${string}`;
  treasury_address: `0x${string}`;
  seller_payout_address: `0x${string}`;
  price_usdc: string;
  treasury_bps: number;
  seller_bps: number;
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
  payment_rail: "onchain";
  chain_id: number | null;
  settlement_contract_address: `0x${string}` | null;
  usdc_token_address: `0x${string}` | null;
  treasury_address: `0x${string}` | null;
  seller_payout_address: `0x${string}` | null;
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

export interface NodePurchaseVerifyResponse {
  data: {
    node_id: number;
    tx_hash: `0x${string}`;
    chain_id: number;
    amount_usdc: string;
    listing_ref: `0x${string}`;
    bundle_ref: `0x${string}`;
  };
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
    approve_tx_hash: `0x${string}`;
    purchase_tx_hash: `0x${string}`;
    chain_id: number;
    amount_usdc: string;
    listing_ref: `0x${string}`;
    bundle_ref: `0x${string}`;
  };
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
  payment_rail?: "onchain";
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
  payment_rail?: "onchain";
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
  payment_rail?: "onchain";
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
  payment_rail?: "onchain";
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
  payment_rail: "onchain";
  chain_id: number;
  usdc_token_address: `0x${string}`;
  treasury_address: `0x${string}`;
  seller_payout_address: `0x${string}`;
  price_usdc: string;
  listing_meta?: Record<string, unknown>;
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
    settlement_contract_address?: `0x${string}`;
    usdc_token_address?: `0x${string}`;
    treasury_address?: `0x${string}`;
    seller_payout_address?: `0x${string}`;
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

export interface TrollboxMessage {
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

export interface TrollboxLiveEvent {
  event: string;
  message: TrollboxMessage;
}

export interface WatchedNodeLiveEvent {
  event: ActivityEvent;
  data: WorkPacketResponse;
}

export interface TrollboxListResponse {
  data: TrollboxMessage[];
  next_cursor: number | null;
}

export interface TrollboxPostInput {
  body: string;
  room?: "webapp" | "agent";
  reply_to_message_id?: number;
  client_message_id?: string;
}

export interface TrollboxPostResponse {
  data: TrollboxMessage;
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
