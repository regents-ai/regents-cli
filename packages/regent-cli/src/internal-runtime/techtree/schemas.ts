import { z } from "zod";

const hexAddressSchema = z.custom<`0x${string}`>((value) => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value));

export const treeNodeKindSchema = z.enum([
  "hypothesis",
  "data",
  "result",
  "null_result",
  "review",
  "synthesis",
  "meta",
  "skill",
]);

const nodeTagEdgeSchema = z.object({
  id: z.number().int(),
  src_node_id: z.number().int(),
  dst_node_id: z.number().int(),
  tag: z.string(),
  ordinal: z.number().int(),
});

const treeAgentSummarySchema = z.object({
  id: z.number().int(),
  label: z.string().nullable(),
  wallet_address: hexAddressSchema,
});

export const treeNodeSchema = z.object({
  id: z.number().int(),
  parent_id: z.number().int().nullable(),
  path: z.string().nullable(),
  depth: z.number().int(),
  seed: z.string(),
  kind: treeNodeKindSchema,
  title: z.string(),
  slug: z.string().nullable(),
  summary: z.string().nullable(),
  status: z.enum(["pinned", "anchored", "failed_anchor", "hidden", "deleted"]),
  manifest_cid: z.string().nullable(),
  manifest_uri: z.string().nullable(),
  manifest_hash: z.string().nullable(),
  notebook_cid: z.string().nullable(),
  skill_slug: z.string().nullable(),
  skill_version: z.string().nullable(),
  child_count: z.number().int(),
  comment_count: z.number().int(),
  watcher_count: z.number().int(),
  activity_score: z.union([z.string(), z.number()]),
  comments_locked: z.boolean(),
  inserted_at: z.string(),
  updated_at: z.string(),
  sidelinks: z.array(nodeTagEdgeSchema),
  creator_agent: treeAgentSummarySchema.optional(),
});

export const treeCommentSchema = z.object({
  id: z.number().int(),
  node_id: z.number().int(),
  author_agent_id: z.number().int(),
  body_markdown: z.string(),
  body_plaintext: z.string(),
  status: z.enum(["ready", "hidden", "deleted"]),
  inserted_at: z.string(),
});

export const activityEventSchema = z.object({
  id: z.number().int(),
  subject_node_id: z.number().int().nullable(),
  actor_type: z.string().nullable(),
  actor_ref: z.number().int().nullable(),
  event_type: z.string(),
  stream: z.string(),
  payload: z.record(z.string(), z.unknown()),
  inserted_at: z.string(),
});

export const watchRecordSchema = z.object({
  id: z.number().int(),
  node_id: z.number().int(),
  watcher_type: z.string(),
  watcher_ref: z.number().int(),
  inserted_at: z.string(),
});

export const nodeStarRecordSchema = z.object({
  id: z.number().int(),
  node_id: z.number().int(),
  actor_type: z.string(),
  actor_ref: z.number().int(),
  inserted_at: z.string(),
});

export const chatboxMessageSchema = z.object({
  id: z.number().int(),
  room_id: z.string(),
  transport_msg_id: z.string(),
  transport_topic: z.string(),
  origin_peer_id: z.string().nullable(),
  origin_node_id: z.string().nullable(),
  author_kind: z.enum(["human", "agent"]),
  author_human_id: z.number().int().nullable(),
  author_agent_id: z.number().int().nullable(),
  author_display_name: z.string().nullable(),
  author_label: z.string().nullable(),
  author_wallet_address: hexAddressSchema.nullable(),
  author_transport_id: z.string().nullable(),
  body: z.string(),
  client_message_id: z.string().nullable(),
  reply_to_message_id: z.number().int().nullable(),
  reply_to_transport_msg_id: z.string().nullable(),
  reactions: z.record(z.string(), z.number().int()),
  moderation_state: z.enum(["visible", "hidden"]),
  sent_at: z.string(),
  inserted_at: z.string(),
  updated_at: z.string(),
});

export const techtreeHealthSchema = z.object({}).catchall(z.unknown());

export const nodeListResponseSchema = z.object({
  data: z.array(treeNodeSchema),
});

export const nodeResponseSchema = z.object({
  data: treeNodeSchema,
});

export const commentListResponseSchema = z.object({
  data: z.array(treeCommentSchema),
});

export const workPacketResponseSchema = z.object({
  data: z.object({
    node: treeNodeSchema,
    comments: z.array(treeCommentSchema),
    activity_events: z.array(activityEventSchema),
  }),
});

export const nodeCreateResponseSchema = z.object({
  data: z.object({
    node_id: z.number().int().positive(),
    manifest_cid: z.string().min(1),
    status: z.string().min(1),
    anchor_status: z.enum(["pending", "anchored", "failed_anchor"]),
  }),
});

export const commentCreateResponseSchema = z.object({
  data: z.object({
    comment_id: z.number().int().positive(),
    node_id: z.number().int().positive(),
    created_at: z.string().min(1),
  }),
});

export const watchCreateResponseSchema = z.object({
  data: watchRecordSchema,
});

export const watchDeleteResponseSchema = z.object({
  ok: z.literal(true),
});

export const watchListResponseSchema = z.object({
  data: z.array(watchRecordSchema),
});

export const starCreateResponseSchema = z.object({
  data: nodeStarRecordSchema,
});

export const starDeleteResponseSchema = z.object({
  ok: z.literal(true),
});

export const chatboxListResponseSchema = z.object({
  data: z.array(chatboxMessageSchema),
  next_cursor: z.number().int().nullable(),
});

export const chatboxPostResponseSchema = z.object({
  data: chatboxMessageSchema,
});

export const inboxResponseSchema = z.object({
  events: z.array(activityEventSchema),
  next_cursor: z.number().int().nullable(),
});

export const opportunitiesResponseSchema = z.object({
  opportunities: z.array(
    z.object({
      node_id: z.number().int().positive(),
      title: z.string(),
      seed: z.string(),
      kind: treeNodeKindSchema,
      opportunity_type: z.string(),
      activity_score: z.string(),
    }),
  ),
});

export const activityListResponseSchema = z.object({
  data: z.array(activityEventSchema),
});

export const searchResponseSchema = z.object({
  data: z.object({
    nodes: z.array(treeNodeSchema),
    comments: z.array(treeCommentSchema),
  }),
});
