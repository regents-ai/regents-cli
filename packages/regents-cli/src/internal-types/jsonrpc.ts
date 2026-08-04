import type { AppSiwaSession, SiwaSession, SiwaVerifyResponse } from "./auth.js";
import type {
  RegentAgentHarnessSummary,
  RegentAgentProfileSummary,
  RegentAgentStatus,
} from "./agent.js";
import type {
  DoctorReport,
  DoctorRunFullParams,
  DoctorRunParams,
  DoctorRunScopedParams,
} from "./doctor.js";
import type { GossipsubStatus } from "./gossipsub.js";
import type { RuntimeStatus } from "./runtime.js";
import type {
  X402DetailsResponse,
  X402FetchParams,
  X402FetchResponse,
  X402PrepareParams,
  X402PrepareResponse,
  X402QuoteParams,
  X402QuoteResponse,
  X402ReceiptGetParams,
  X402ReceiptGetResponse,
  X402RefundParams,
  X402RefundResponse,
  X402RequestInput,
} from "./x402.js";

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

export interface TechtreeForgeFamilyContract {
  schema_version: 1;
  family_id: "techtree.contract-drift-repair.v1";
  product_status: "planned";
  kind: "deterministic_contract_drift_repair";
  executor: "hermes";
  intervention: {
    artifact: "SKILL.md";
    changed_file_count: 1;
  };
  verifier: {
    protocol: "deterministic_contract_drift";
    protocol_version: 1;
  };
}

export interface TechtreeForgeFamilyValidationInput {
  family: TechtreeForgeFamilyContract;
  baseline: { files: { "SKILL.md": string } };
  candidate: { files: { "SKILL.md": string } };
}

export interface TechtreeForgeFamilyValidationResult {
  schema_version: 1;
  valid: true;
  family_id: "techtree.contract-drift-repair.v1";
  changed_files: ["SKILL.md"];
}

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
  | "techtree.forge.family.show"
  | "techtree.forge.family.validate"
  | "techtree.notebooks.init"
  | "techtree.notebooks.pair"
  | "x402.details"
  | "x402.quote"
  | "x402.prepare"
  | "x402.fetch"
  | "x402.refund"
  | "x402.receipts.get"
  | "gossipsub.status";

export interface NotebookWorkspaceActionResult {
  ok: true;
  workspace_path: string;
  notebook_path: string;
  manifest_path: string;
  next: string[];
}

export interface RegentRpcParamsMap {
  "runtime.ping": undefined;
  "runtime.status": undefined;
  "runtime.shutdown": undefined;
  "agent.init": undefined;
  "agent.status": undefined;
  "agent.profile.list": undefined;
  "agent.profile.show": { profile?: string };
  "agent.harness.list": undefined;
  "doctor.run": DoctorRunParams;
  "doctor.runScoped": DoctorRunScopedParams;
  "doctor.runFull": DoctorRunFullParams;
  "auth.siwa.login": {
    walletAddress?: `0x${string}`;
    chainId?: number;
    audience?: string;
  };
  "auth.siwa.logout": undefined;
  "auth.siwa.status": undefined;
  "techtree.forge.family.show": undefined;
  "techtree.forge.family.validate": { input: TechtreeForgeFamilyValidationInput };
  "techtree.notebooks.init": {
    workspace_path: string;
    kind: "paper" | "freeform";
    title: string;
    source?: string;
  };
  "techtree.notebooks.pair": { workspace_path: string };
  "x402.details": X402RequestInput;
  "x402.quote": X402QuoteParams;
  "x402.prepare": X402PrepareParams;
  "x402.fetch": X402FetchParams;
  "x402.refund": X402RefundParams;
  "x402.receipts.get": X402ReceiptGetParams;
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
    appSessions: AppSiwaSession[];
  };
  "techtree.forge.family.show": TechtreeForgeFamilyContract;
  "techtree.forge.family.validate": TechtreeForgeFamilyValidationResult;
  "techtree.notebooks.init": NotebookWorkspaceActionResult;
  "techtree.notebooks.pair": NotebookWorkspaceActionResult;
  "x402.details": X402DetailsResponse;
  "x402.quote": X402QuoteResponse;
  "x402.prepare": X402PrepareResponse;
  "x402.fetch": X402FetchResponse;
  "x402.refund": X402RefundResponse;
  "x402.receipts.get": X402ReceiptGetResponse;
  "gossipsub.status": GossipsubStatus;
}

export type RegentRpcParams<TMethod extends RegentRpcMethod> =
  RegentRpcParamsMap[TMethod];

export type RegentRpcResult<TMethod extends RegentRpcMethod> =
  RegentRpcResultMap[TMethod];
