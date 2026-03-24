import type { SiwaSession, SiwaVerifyResponse } from "./auth.js";
import type {
  BbhAssignmentResponse,
  BbhSubmitParams,
  BbhValidateParams,
  BbhRunExecParams,
  BbhRunExecResponse,
  BbhLeaderboardResponse,
  BbhRunSubmitResponse,
  BbhSyncParams,
  BbhValidationSubmitResponse,
  BbhSyncRequest,
  BbhSyncResponse,
} from "./bbh.js";
import type { RegentConfig } from "./config.js";
import type { RegentAgentHarnessSummary, RegentAgentProfileSummary, RegentAgentStatus } from "./agent.js";
import type { GossipsubStatus } from "./gossipsub.js";
import type { DoctorReport, DoctorRunFullParams, DoctorRunParams, DoctorRunScopedParams } from "./doctor.js";
import type { RuntimeStatus } from "./runtime.js";
import type {
  ActivityListResponse,
  AgentInboxResponse,
  AgentOpportunitiesResponse,
  CommentCreateInput,
  CommentCreateResponse,
  NodeCreateInput,
  NodeCreateResponse,
  NodeStarRecord,
  TreeComment,
  TreeNode,
  TrollboxListResponse,
  TrollboxPostInput,
  TrollboxPostResponse,
  WatchRecord,
  WorkPacketResponse,
} from "./techtree.js";
import type {
  TechtreeCompilerOutput,
  TechtreeFetchResponse,
  TechtreeNodeId,
  TechtreePinResponse,
  TechtreePublishResponse,
  TechtreeVerifyResponse,
  TechtreeV1FetchParams,
  TechtreeV1ReviewInitParams,
  TechtreeV1RunInitParams,
  TechtreeV1VerifyParams,
  TechtreeV1WorkspaceParams,
  TechtreeWorkspaceActionResult,
} from "./techtree-v1.js";
import type { XmtpStatus } from "./xmtp-status.js";

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: "2.0";
  id: string;
  method: RegentRpcMethod;
  params?: T;
}

export interface JsonRpcSuccess<T = unknown> {
  jsonrpc: "2.0";
  id: string;
  result: T;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccess<T> | JsonRpcFailure;

export type RegentRpcMethod =
  | "runtime.ping"
  | "runtime.status"
  | "runtime.shutdown"
  | "agent.init"
  | "agent.status"
  | "agent.profile.list"
  | "agent.profile.show"
  | "agent.harness.list"
  | "doctor.run"
  | "doctor.runScoped"
  | "doctor.runFull"
  | "auth.siwa.login"
  | "auth.siwa.logout"
  | "auth.siwa.status"
  | "techtree.status"
  | "techtree.nodes.list"
  | "techtree.nodes.get"
  | "techtree.nodes.children"
  | "techtree.nodes.comments"
  | "techtree.activity.list"
  | "techtree.search.query"
  | "techtree.nodes.workPacket"
  | "techtree.nodes.create"
  | "techtree.comments.create"
  | "techtree.watch.create"
  | "techtree.watch.delete"
  | "techtree.watch.list"
  | "techtree.stars.create"
  | "techtree.stars.delete"
  | "techtree.inbox.get"
  | "techtree.opportunities.list"
  | "techtree.trollbox.history"
  | "techtree.trollbox.post"
  | "techtree.v1.artifact.init"
  | "techtree.v1.artifact.compile"
  | "techtree.v1.artifact.pin"
  | "techtree.v1.artifact.publish"
  | "techtree.v1.run.init"
  | "techtree.v1.run.exec"
  | "techtree.v1.run.compile"
  | "techtree.v1.run.pin"
  | "techtree.v1.run.publish"
  | "techtree.v1.review.init"
  | "techtree.v1.review.exec"
  | "techtree.v1.review.compile"
  | "techtree.v1.review.pin"
  | "techtree.v1.review.publish"
  | "techtree.v1.fetch"
  | "techtree.v1.verify"
  | "techtree.v1.bbh.run.exec"
  | "techtree.v1.bbh.assignment.next"
  | "techtree.v1.bbh.submit"
  | "techtree.v1.bbh.validate"
  | "techtree.v1.bbh.leaderboard"
  | "techtree.v1.bbh.sync"
  | "xmtp.status"
  | "gossipsub.status";

export interface RegentRpcParamsMap {
  "runtime.ping": undefined;
  "runtime.status": undefined;
  "runtime.shutdown": undefined;
  "agent.init": undefined;
  "agent.status": undefined;
  "agent.profile.list": undefined;
  "agent.profile.show": { profile?: string } | undefined;
  "agent.harness.list": undefined;
  "doctor.run": DoctorRunParams | undefined;
  "doctor.runScoped": DoctorRunScopedParams;
  "doctor.runFull": DoctorRunFullParams | undefined;
  "auth.siwa.login": {
    walletAddress?: `0x${string}`;
    chainId?: number;
    registryAddress?: `0x${string}`;
    tokenId?: string;
    audience?: string;
  };
  "auth.siwa.logout": undefined;
  "auth.siwa.status": undefined;
  "techtree.status": undefined;
  "techtree.nodes.list": { limit?: number; seed?: string } | undefined;
  "techtree.nodes.get": { id: number };
  "techtree.nodes.children": { id: number; limit?: number };
  "techtree.nodes.comments": { id: number; limit?: number };
  "techtree.activity.list": { limit?: number } | undefined;
  "techtree.search.query": { q: string; limit?: number };
  "techtree.nodes.workPacket": { id: number };
  "techtree.nodes.create": NodeCreateInput;
  "techtree.comments.create": CommentCreateInput;
  "techtree.watch.create": { nodeId: number };
  "techtree.watch.delete": { nodeId: number };
  "techtree.watch.list": undefined;
  "techtree.stars.create": { nodeId: number };
  "techtree.stars.delete": { nodeId: number };
  "techtree.inbox.get": {
    cursor?: number;
    limit?: number;
    seed?: string;
    kind?: string | string[];
  } | undefined;
  "techtree.opportunities.list": Record<string, string | number | boolean | string[]> | undefined;
  "techtree.trollbox.history": {
    before?: number;
    limit?: number;
    room?: "global" | "agent";
  } | undefined;
  "techtree.trollbox.post": TrollboxPostInput;
  "techtree.v1.artifact.init": TechtreeV1WorkspaceParams;
  "techtree.v1.artifact.compile": TechtreeV1WorkspaceParams;
  "techtree.v1.artifact.pin": TechtreeV1WorkspaceParams;
  "techtree.v1.artifact.publish": TechtreeV1WorkspaceParams;
  "techtree.v1.run.init": TechtreeV1RunInitParams;
  "techtree.v1.run.exec": TechtreeV1WorkspaceParams;
  "techtree.v1.run.compile": TechtreeV1WorkspaceParams;
  "techtree.v1.run.pin": TechtreeV1WorkspaceParams;
  "techtree.v1.run.publish": TechtreeV1WorkspaceParams;
  "techtree.v1.review.init": TechtreeV1ReviewInitParams;
  "techtree.v1.review.exec": TechtreeV1WorkspaceParams;
  "techtree.v1.review.compile": TechtreeV1WorkspaceParams;
  "techtree.v1.review.pin": TechtreeV1WorkspaceParams;
  "techtree.v1.review.publish": TechtreeV1WorkspaceParams;
  "techtree.v1.fetch": TechtreeV1FetchParams;
  "techtree.v1.verify": TechtreeV1VerifyParams;
  "techtree.v1.bbh.run.exec": BbhRunExecParams;
  "techtree.v1.bbh.assignment.next": { split?: "climb" | "benchmark" | "challenge" | "draft" } | undefined;
  "techtree.v1.bbh.submit": BbhSubmitParams;
  "techtree.v1.bbh.validate": BbhValidateParams;
  "techtree.v1.bbh.leaderboard": { split?: "climb" | "benchmark" | "challenge" | "draft" } | undefined;
  "techtree.v1.bbh.sync": BbhSyncParams | undefined;
  "xmtp.status": undefined;
  "gossipsub.status": undefined;
}

export interface RegentRpcResultMap {
  "runtime.ping": { ok: true };
  "runtime.status": RuntimeStatus;
  "runtime.shutdown": { ok: true };
  "agent.init": RegentAgentStatus;
  "agent.status": RegentAgentStatus;
  "agent.profile.list": { data: RegentAgentProfileSummary[] };
  "agent.profile.show": { data: RegentAgentProfileSummary };
  "agent.harness.list": { data: RegentAgentHarnessSummary[] };
  "doctor.run": DoctorReport;
  "doctor.runScoped": DoctorReport;
  "doctor.runFull": DoctorReport;
  "auth.siwa.login": SiwaVerifyResponse;
  "auth.siwa.logout": { ok: true };
  "auth.siwa.status": {
    authenticated: boolean;
    session: SiwaSession | null;
  };
  "techtree.status": {
    config: RegentConfig["techtree"];
    health: Record<string, unknown>;
  };
  "techtree.nodes.list": { data: TreeNode[] };
  "techtree.nodes.get": { data: TreeNode };
  "techtree.nodes.children": { data: TreeNode[] };
  "techtree.nodes.comments": { data: TreeComment[] };
  "techtree.activity.list": ActivityListResponse;
  "techtree.search.query": {
    data: {
      nodes: TreeNode[];
      comments: TreeComment[];
    };
  };
  "techtree.nodes.workPacket": { data: WorkPacketResponse };
  "techtree.nodes.create": NodeCreateResponse;
  "techtree.comments.create": CommentCreateResponse;
  "techtree.watch.create": { data: WatchRecord };
  "techtree.watch.delete": { ok: true };
  "techtree.watch.list": { data: WatchRecord[] };
  "techtree.stars.create": { data: NodeStarRecord };
  "techtree.stars.delete": { ok: true };
  "techtree.inbox.get": AgentInboxResponse;
  "techtree.opportunities.list": AgentOpportunitiesResponse;
  "techtree.trollbox.history": TrollboxListResponse;
  "techtree.trollbox.post": TrollboxPostResponse;
  "techtree.v1.artifact.init": TechtreeWorkspaceActionResult;
  "techtree.v1.artifact.compile": TechtreeCompilerOutput<Record<string, unknown>>;
  "techtree.v1.artifact.pin": TechtreePinResponse & {
    tree: "main" | "bbh";
    compiled: TechtreeCompilerOutput<Record<string, unknown>>;
  };
  "techtree.v1.artifact.publish": TechtreePublishResponse & { tree: "main" | "bbh" };
  "techtree.v1.run.init": TechtreeWorkspaceActionResult;
  "techtree.v1.run.exec": TechtreeWorkspaceActionResult;
  "techtree.v1.run.compile": TechtreeCompilerOutput<Record<string, unknown>>;
  "techtree.v1.run.pin": TechtreePinResponse & {
    tree: "main" | "bbh";
    compiled: TechtreeCompilerOutput<Record<string, unknown>>;
  };
  "techtree.v1.run.publish": TechtreePublishResponse & { tree: "main" | "bbh" };
  "techtree.v1.review.init": TechtreeWorkspaceActionResult;
  "techtree.v1.review.exec": TechtreeWorkspaceActionResult;
  "techtree.v1.review.compile": TechtreeCompilerOutput<Record<string, unknown>>;
  "techtree.v1.review.pin": TechtreePinResponse & {
    tree: "main" | "bbh";
    compiled: TechtreeCompilerOutput<Record<string, unknown>>;
  };
  "techtree.v1.review.publish": TechtreePublishResponse & { tree: "main" | "bbh" };
  "techtree.v1.fetch": TechtreeFetchResponse & { tree: "main" | "bbh" };
  "techtree.v1.verify": TechtreeVerifyResponse & { tree: "main" | "bbh" };
  "techtree.v1.bbh.run.exec": BbhRunExecResponse;
  "techtree.v1.bbh.assignment.next": BbhAssignmentResponse;
  "techtree.v1.bbh.submit": BbhRunSubmitResponse;
  "techtree.v1.bbh.validate": BbhValidationSubmitResponse;
  "techtree.v1.bbh.leaderboard": BbhLeaderboardResponse;
  "techtree.v1.bbh.sync": BbhSyncResponse;
  "xmtp.status": XmtpStatus;
  "gossipsub.status": GossipsubStatus;
}

export type RegentRpcParams<TMethod extends RegentRpcMethod> = RegentRpcParamsMap[TMethod];
export type RegentRpcResult<TMethod extends RegentRpcMethod> = RegentRpcResultMap[TMethod];
