import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import type {
  ActivityEvent,
  AgentInboxResponse,
  AgentOpportunitiesResponse,
  CommentCreateResponse,
  NodeStarRecord,
  NodeCreateResponse,
  SiwaNonceResponse,
  SiwaVerifyResponse,
  TreeComment,
  TreeNode,
  WatchRecord,
  WorkPacketResponse,
} from "../packages/regent-cli/src/internal-types/index.js";

import {
  buildHttpSignatureSigningMessage,
  HTTP_SIGNATURE_COVERED_COMPONENTS,
  parseSignatureInputHeader,
} from "../packages/regent-cli/src/internal-runtime/techtree/signing.js";

const REQUIRED_AUTH_HEADERS = [
  "x-siwa-receipt",
  "x-key-id",
  "x-timestamp",
  "signature-input",
  "signature",
  "x-agent-wallet-address",
  "x-agent-chain-id",
  "x-agent-registry-address",
  "x-agent-token-id",
] as const;

const REQUIRED_SIGNATURE_COMPONENTS = [...HTTP_SIGNATURE_COVERED_COMPONENTS] as const;

const TEST_AGENT_WALLET = "0x1111111111111111111111111111111111111111" as const;
const TEST_AGENT_SUMMARY = {
  id: 1,
  label: "Contract test agent",
  wallet_address: TEST_AGENT_WALLET,
} as const;

export interface ForcedRouteResponse {
  statusCode: number;
  payload: unknown;
}

export interface TechtreeContractServerOptions {
  healthResponse?: ForcedRouteResponse;
  nonceResponse?: ForcedRouteResponse;
  verifyResponse?: ForcedRouteResponse;
  inboxResponse?: ForcedRouteResponse;
  opportunitiesResponse?: ForcedRouteResponse;
}

export interface ContractRequestRecord {
  method: string;
  pathname: string;
  search: string;
  headers: Record<string, string>;
  body: unknown;
}

interface IssuedNonceRecord {
  walletAddress: `0x${string}`;
  chainId: number;
  expiresAtUnixSeconds: number;
}

interface ReceiptClaims {
  walletAddress: `0x${string}`;
  chainId: number;
  registryAddress?: `0x${string}`;
  tokenId?: string;
  keyId: string;
  expiresAt: string;
}

interface BaseNodeRecord {
  id: number;
  seed: string;
  kind: TreeNode["kind"];
  title: string;
  status: TreeNode["status"];
  parent_id: number | null;
  notebook_source: string;
  summary: string | null;
  slug: string | null;
  sidelinks: Array<{
    node_id: number;
    tag: string;
    ordinal: number;
  }>;
}

const json = (res: http.ServerResponse, statusCode: number, payload: unknown): void => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(`${JSON.stringify(payload)}\n`);
};

const text = (res: http.ServerResponse, statusCode: number, payload: string): void => {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(payload);
};

const normalizeHeaders = (headers: http.IncomingHttpHeaders): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) => {
      if (value === undefined) {
        return [];
      }

      return [[key.toLowerCase(), Array.isArray(value) ? value.join(", ") : value]];
    }),
  );
};

const readJsonBody = async (req: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") {
    return undefined;
  }

  return JSON.parse(raw);
};

const createdAt = (): string => "2026-03-10T00:00:00.000Z";
const currentUnixSeconds = (): number => Math.floor(Date.now() / 1000);

const makeReceipt = (claims: ReceiptClaims): string => {
  return `receipt-valid.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}`;
};

const parseReceipt = (receipt: string): ReceiptClaims | null => {
  if (!receipt.startsWith("receipt-valid.")) {
    return null;
  }

  try {
    const encoded = receipt.slice("receipt-valid.".length);
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ReceiptClaims;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

export class TechtreeContractServer {
  readonly requests: ContractRequestRecord[] = [];
  readonly createdNodes = new Map<string, NodeCreateResponse>();
  readonly createdComments = new Map<string, CommentCreateResponse>();

  baseUrl = "";

  private readonly options: TechtreeContractServerOptions;

  private readonly liveNodes = new Map<number, BaseNodeRecord>([
    [
      1,
      {
        id: 1,
        seed: "ml",
        kind: "hypothesis",
        title: "Root node",
        status: "anchored",
        parent_id: null,
        notebook_source: "print('root')",
        summary: "A root node",
        slug: "root-node",
        sidelinks: [],
      },
    ],
    [
      2,
      {
        id: 2,
        seed: "ml",
        kind: "data",
        title: "Child node",
        status: "anchored",
        parent_id: 1,
        notebook_source: "print('child')",
        summary: "A child node",
        slug: "child-node",
        sidelinks: [],
      },
    ],
  ]);

  private readonly liveComments: TreeComment[] = [
    {
      id: 10,
      node_id: 1,
      author_agent_id: TEST_AGENT_SUMMARY.id,
      body_markdown: "Existing comment",
      body_plaintext: "Existing comment",
      status: "ready",
      inserted_at: createdAt(),
    },
  ];

  private readonly liveWatches = new Map<number, WatchRecord[]>();
  private readonly liveStars = new Map<number, NodeStarRecord[]>();
  private readonly liveActivityEvents: ActivityEvent[] = [
    {
      id: 2_001,
      subject_node_id: 1,
      actor_type: "agent",
      actor_ref: TEST_AGENT_SUMMARY.id,
      event_type: "comment_added",
      stream: "agent_inbox",
      payload: {
        seed: "ml",
        kind_filters: [],
      },
      inserted_at: createdAt(),
    },
  ];

  private nextNodeId = 100;
  private nextCommentId = 500;
  private nextWatchId = 800;
  private nextStarId = 900;
  private nextEventId = 2_002;
  private readonly issuedNonces = new Map<string, IssuedNonceRecord>();
  private readonly consumedEnvelopeNonces = new Set<string>();
  private server: http.Server | null = null;

  constructor(options: TechtreeContractServerOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      try {
        await this.handle(req, res);
      } catch (error) {
        json(res, 500, {
          error: {
            code: "contract_server_error",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });

    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");

    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    this.server = null;
  }

  protectedRequests(): ContractRequestRecord[] {
    return this.requests.filter((request) => request.pathname.startsWith("/v1/tree/") || request.pathname.startsWith("/v1/agent/"));
  }

  private materializeNode(record: BaseNodeRecord): TreeNode {
    return {
      id: record.id,
      parent_id: record.parent_id,
      path: record.parent_id === null ? `${record.id}` : `${record.parent_id}.${record.id}`,
      depth: record.parent_id === null ? 0 : 1,
      seed: record.seed,
      kind: record.kind,
      title: record.title,
      slug: record.slug,
      summary: record.summary,
      status: record.status,
      manifest_cid: `bafyregentmanifest${record.id}`,
      manifest_uri: null,
      manifest_hash: null,
      notebook_cid: `bafyregentnode${record.id}`,
      skill_slug: null,
      skill_version: null,
      child_count: [...this.liveNodes.values()].filter((node) => node.parent_id === record.id).length,
      comment_count: this.liveComments.filter((comment) => comment.node_id === record.id).length,
      watcher_count: this.liveWatches.get(record.id)?.length ?? 0,
      activity_score: "1.0",
      comments_locked: false,
      inserted_at: createdAt(),
      updated_at: createdAt(),
      sidelinks: record.sidelinks.map((edge, index) => ({
        id: record.id * 100 + index + 1,
        src_node_id: record.id,
        dst_node_id: edge.node_id,
        tag: edge.tag,
        ordinal: edge.ordinal,
      })),
      creator_agent: TEST_AGENT_SUMMARY,
    };
  }

  private makeActivityEvent(subjectNodeId: number, eventType: string, payload: Record<string, unknown>): ActivityEvent {
    const eventId = this.nextEventId;
    this.nextEventId += 1;

    return {
      id: eventId,
      subject_node_id: subjectNodeId,
      actor_type: "agent",
      actor_ref: TEST_AGENT_SUMMARY.id,
      event_type: eventType,
      stream: "agent_inbox",
      payload,
      inserted_at: createdAt(),
    };
  }

  private appendActivityEvent(subjectNodeId: number, eventType: string, payload: Record<string, unknown>): ActivityEvent {
    const event = this.makeActivityEvent(subjectNodeId, eventType, payload);
    this.liveActivityEvents.push(event);
    return event;
  }

  private currentWatchRecords(nodeId: number): WatchRecord[] {
    return this.liveWatches.get(nodeId) ?? [];
  }

  private handleInbox(requestUrl: URL): AgentInboxResponse {
    const cursorParam = Number.parseInt(requestUrl.searchParams.get("cursor") ?? "", 10);
    const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "50", 10);
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
    const hasCursor = Number.isSafeInteger(cursorParam) && cursorParam > 0;

    const filteredEvents = hasCursor
      ? this.liveActivityEvents.filter((event) => event.id > cursorParam)
      : this.liveActivityEvents;

    const events = hasCursor ? filteredEvents.slice(0, normalizedLimit) : filteredEvents.slice(-normalizedLimit);

    const nextCursor =
      events.length > 0
        ? events[events.length - 1]?.id ?? (hasCursor ? cursorParam : null)
        : hasCursor
          ? cursorParam
          : this.liveActivityEvents[this.liveActivityEvents.length - 1]?.id ?? null;

    return {
      events: events.map((event) => ({
        ...event,
        payload: {
          ...event.payload,
          seed: requestUrl.searchParams.get("seed") ?? "ml",
          kind_filters: requestUrl.searchParams.getAll("kind"),
        },
      })),
      next_cursor: nextCursor,
    };
  }

  private handleOpportunities(requestUrl: URL): AgentOpportunitiesResponse {
    const node = this.materializeNode(this.liveNodes.get(1) as BaseNodeRecord);
    return {
      opportunities: [
        {
          node_id: node.id,
          title: node.title,
          seed: node.seed,
          kind: node.kind,
          opportunity_type: requestUrl.searchParams.getAll("kind")[0] ?? "review",
          activity_score: String(node.activity_score),
        },
      ],
    };
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const requestUrl = new URL(req.url ?? "/", this.baseUrl || "http://127.0.0.1");
    const headers = normalizeHeaders(req.headers);
    const body = await readJsonBody(req);

    this.requests.push({
      method,
      pathname: requestUrl.pathname,
      search: requestUrl.search,
      headers,
      body,
    });

    if (method === "GET" && requestUrl.pathname === "/health") {
      if (this.options.healthResponse) {
        json(res, this.options.healthResponse.statusCode, this.options.healthResponse.payload);
        return;
      }

      json(res, 200, { ok: true, service: "techtree-contract-server" });
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/agent/siwa/nonce") {
      if (this.options.nonceResponse) {
        json(res, this.options.nonceResponse.statusCode, this.options.nonceResponse.payload);
        return;
      }

      const payload = body as { walletAddress?: `0x${string}`; chainId?: number };
      const walletAddress = payload.walletAddress ?? TEST_AGENT_WALLET;
      const chainId = payload.chainId ?? 11155111;
      const nonce = `nonce-${walletAddress}-${Date.now()}`;
      this.issuedNonces.set(nonce, {
        walletAddress,
        chainId,
        expiresAtUnixSeconds: currentUnixSeconds() + 300,
      });
      const response: SiwaNonceResponse = {
        ok: true,
        code: "nonce_issued",
        data: {
          nonce,
          walletAddress,
          chainId,
          expiresAt: "2999-01-01T00:00:00.000Z",
        },
      };
      json(res, 200, response);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/agent/siwa/verify") {
      if (this.options.verifyResponse) {
        json(res, this.options.verifyResponse.statusCode, this.options.verifyResponse.payload);
        return;
      }

      const payload = body as {
        walletAddress?: `0x${string}`;
        chainId?: number;
        nonce?: string;
        message?: string;
        signature?: `0x${string}`;
        registryAddress?: `0x${string}`;
        tokenId?: string;
      };

      const issues: string[] = [];
      if (!payload.walletAddress) {
        issues.push("walletAddress is required");
      }
      if (!Number.isSafeInteger(payload.chainId) || (payload.chainId ?? 0) <= 0) {
        issues.push("chainId must be a positive integer");
      }
      if (!payload.nonce) {
        issues.push("nonce is required");
      }
      if (!payload.message) {
        issues.push("message is required");
      }
      if (!payload.signature) {
        issues.push("signature is required");
      }

      const issuedNonce = payload.nonce ? this.issuedNonces.get(payload.nonce) : undefined;
      if (!issuedNonce) {
        issues.push("nonce was not issued");
      } else {
        if (issuedNonce.walletAddress.toLowerCase() !== payload.walletAddress?.toLowerCase()) {
          issues.push("nonce wallet binding mismatch");
        }
        if (issuedNonce.chainId !== payload.chainId) {
          issues.push("nonce chain binding mismatch");
        }
        if (issuedNonce.expiresAtUnixSeconds <= currentUnixSeconds()) {
          issues.push("nonce is expired");
        }
      }

      if (payload.message && payload.walletAddress && payload.chainId && payload.nonce) {
        if (!payload.message.includes(`${payload.walletAddress}\n`)) {
          issues.push("message does not include wallet address");
        }
        if (!payload.message.includes(`Chain ID: ${payload.chainId}`)) {
          issues.push("message does not include chain id");
        }
        if (!payload.message.includes(`Nonce: ${payload.nonce}`)) {
          issues.push("message does not include nonce");
        }
      }

      if (payload.signature && !/^0x[0-9a-fA-F]{130}$/.test(payload.signature)) {
        issues.push("signature is invalid");
      }

      if (issues.length > 0) {
        json(res, 422, {
          error: {
            code: "siwa_verify_invalid",
            message: "verify request failed validation",
            details: {
              issues,
            },
          },
        });
        return;
      }

      this.issuedNonces.delete(payload.nonce as string);
      const walletAddress = payload.walletAddress as `0x${string}`;
      const receiptClaims: ReceiptClaims = {
        walletAddress,
        chainId: payload.chainId as number,
        keyId: walletAddress.toLowerCase(),
        expiresAt: "2999-01-01T00:00:00.000Z",
        ...(payload.registryAddress ? { registryAddress: payload.registryAddress } : {}),
        ...(payload.tokenId ? { tokenId: payload.tokenId } : {}),
      };
      const response: SiwaVerifyResponse = {
        ok: true,
        code: "siwa_verified",
        data: {
          verified: true,
          walletAddress,
          chainId: payload.chainId as number,
          nonce: payload.nonce as string,
          keyId: walletAddress.toLowerCase(),
          signatureScheme: "evm_personal_sign",
          receipt: makeReceipt(receiptClaims),
          receiptExpiresAt: "2999-01-01T00:00:00.000Z",
        },
      };
      json(res, 200, response);
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/tree/nodes") {
      const seedFilter = requestUrl.searchParams.get("seed");
      const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "50", 10);
      const data = [...this.liveNodes.values()]
        .filter((node) => node.status === "anchored")
        .map((node) => this.materializeNode(node))
        .filter((node) => !seedFilter || node.seed === seedFilter)
        .slice(0, Number.isFinite(limit) ? limit : 50);
      json(res, 200, { data });
      return;
    }

    if (method === "GET" && /^\/v1\/tree\/nodes\/\d+$/.test(requestUrl.pathname)) {
      const nodeId = Number.parseInt(requestUrl.pathname.split("/").pop() ?? "0", 10);
      const node = this.liveNodes.get(nodeId);
      if (!node || (node.status !== "anchored" && node.status !== "pinned")) {
        json(res, 404, { error: { code: "node_not_found", message: "node not found" } });
        return;
      }

      json(res, 200, { data: this.materializeNode(node) });
      return;
    }

    if (method === "GET" && /^\/v1\/agent\/tree\/nodes\/\d+$/.test(requestUrl.pathname)) {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      const nodeId = Number.parseInt(requestUrl.pathname.split("/").pop() ?? "0", 10);
      const node = this.liveNodes.get(nodeId);
      if (!node) {
        json(res, 404, { error: { code: "node_not_found", message: "node not found" } });
        return;
      }

      json(res, 200, { data: this.materializeNode(node) });
      return;
    }

    if (method === "GET" && /^\/v1\/tree\/nodes\/\d+\/children$/.test(requestUrl.pathname)) {
      const nodeId = Number.parseInt(requestUrl.pathname.split("/")[4] ?? "0", 10);
      const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "50", 10);
      const data = [...this.liveNodes.values()]
        .filter(
          (node) => node.parent_id === nodeId && (node.status === "anchored" || node.status === "pinned"),
        )
        .map((node) => this.materializeNode(node))
        .slice(0, Number.isFinite(limit) ? limit : 50);
      json(res, 200, { data });
      return;
    }

    if (method === "GET" && /^\/v1\/agent\/tree\/nodes\/\d+\/children$/.test(requestUrl.pathname)) {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      const nodeId = Number.parseInt(requestUrl.pathname.split("/")[5] ?? "0", 10);
      const parent = this.liveNodes.get(nodeId);
      if (!parent) {
        json(res, 404, { error: { code: "node_not_found", message: "node not found" } });
        return;
      }

      const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "50", 10);
      const data = [...this.liveNodes.values()]
        .filter((node) => node.parent_id === nodeId)
        .map((node) => this.materializeNode(node))
        .slice(0, Number.isFinite(limit) ? limit : 50);
      json(res, 200, { data });
      return;
    }

    if (method === "GET" && /^\/v1\/tree\/nodes\/\d+\/comments$/.test(requestUrl.pathname)) {
      const nodeId = Number.parseInt(requestUrl.pathname.split("/")[4] ?? "0", 10);
      const node = this.liveNodes.get(nodeId);
      if (!node || (node.status !== "anchored" && node.status !== "pinned")) {
        json(res, 404, { error: { code: "node_not_found", message: "node not found" } });
        return;
      }

      const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "50", 10);
      const data = this.liveComments.filter((comment) => comment.node_id === nodeId).slice(0, Number.isFinite(limit) ? limit : 50);
      json(res, 200, { data });
      return;
    }

    if (method === "GET" && /^\/v1\/agent\/tree\/nodes\/\d+\/comments$/.test(requestUrl.pathname)) {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      const nodeId = Number.parseInt(requestUrl.pathname.split("/")[5] ?? "0", 10);
      const node = this.liveNodes.get(nodeId);
      if (!node) {
        json(res, 404, { error: { code: "node_not_found", message: "node not found" } });
        return;
      }

      const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "50", 10);
      const data = this.liveComments.filter((comment) => comment.node_id === nodeId).slice(0, Number.isFinite(limit) ? limit : 50);
      json(res, 200, { data });
      return;
    }

    if (method === "GET" && /^\/v1\/tree\/nodes\/\d+\/sidelinks$/.test(requestUrl.pathname)) {
      const nodeId = Number.parseInt(requestUrl.pathname.split("/")[4] ?? "0", 10);
      const node = this.liveNodes.get(nodeId);
      json(res, 200, { data: node ? this.materializeNode(node).sidelinks : [] });
      return;
    }

    if (method === "GET" && /^\/v1\/tree\/seeds\/[^/]+\/hot$/.test(requestUrl.pathname)) {
      const seed = decodeURIComponent(requestUrl.pathname.split("/")[4] ?? "");
      const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "50", 10);
      const data = [...this.liveNodes.values()]
        .filter((node) => node.status === "anchored")
        .map((node) => this.materializeNode(node))
        .filter((node) => node.seed === seed)
        .slice(0, Number.isFinite(limit) ? limit : 50);
      json(res, 200, { data });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/tree/activity") {
      const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "50", 10);
      const normalizedLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
      json(res, 200, {
        data: [
          this.makeActivityEvent(1, "node_created", { node_id: 1 }),
          this.makeActivityEvent(1, "comment_added", { node_id: 1, comment_id: 10 }),
        ].slice(0, normalizedLimit),
      });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/tree/search") {
      const query = (requestUrl.searchParams.get("q") ?? "").toLowerCase();
      const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "50", 10);
      const normalizedLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
      json(res, 200, {
        data: {
          nodes: [...this.liveNodes.values()]
            .filter((node) => node.status === "anchored")
            .map((node) => this.materializeNode(node))
            .filter((node) => query === "" || node.title.toLowerCase().includes(query))
            .slice(0, normalizedLimit),
          comments: this.liveComments
            .filter((comment) => (query === "" ? true : comment.body_markdown.toLowerCase().includes(query)))
            .slice(0, normalizedLimit),
        },
      });
      return;
    }

    if (method === "GET" && /^\/v1\/tree\/nodes\/\d+\/work-packet$/.test(requestUrl.pathname)) {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      const nodeId = Number.parseInt(requestUrl.pathname.split("/")[4] ?? "0", 10);
      const node = this.liveNodes.get(nodeId);
      if (!node) {
        json(res, 404, { error: { code: "node_not_found", message: "node not found" } });
        return;
      }

      const response: { data: WorkPacketResponse } = {
        data: {
          node: this.materializeNode(node),
          comments: this.liveComments.filter((comment) => comment.node_id === nodeId),
          activity_events: this.liveActivityEvents.filter((event) => event.subject_node_id === nodeId),
        },
      };
      json(res, 200, response);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/tree/nodes") {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      const payload = body as {
        seed: string;
        kind: TreeNode["kind"];
        title: string;
        parent_id: number;
        notebook_source: string;
        sidelinks?: Array<{
          node_id: number;
          tag?: string;
          ordinal?: number;
        }>;
        summary?: string;
        slug?: string;
        idempotency_key: string;
      };

      if (!Number.isSafeInteger(payload.parent_id) || payload.parent_id <= 0) {
        json(res, 422, { error: { code: "parent_id_required", message: "parent_id is required" } });
        return;
      }

      const parentNode = this.liveNodes.get(payload.parent_id);
      if (!parentNode) {
        json(res, 404, { error: { code: "parent_not_found", message: "parent node not found" } });
        return;
      }

      if (parentNode.status !== "anchored") {
        json(res, 422, { error: { code: "parent_not_anchored", message: "parent node must be anchored" } });
        return;
      }

      const existing = this.createdNodes.get(payload.idempotency_key);
      if (existing) {
        json(res, 200, existing);
        return;
      }

      const nodeId = this.nextNodeId;
      this.nextNodeId += 1;
      this.liveNodes.set(nodeId, {
        id: nodeId,
        seed: payload.seed,
        kind: payload.kind,
        title: payload.title,
        status: "pinned",
        parent_id: payload.parent_id,
        notebook_source: payload.notebook_source,
        summary: payload.summary ?? null,
        slug: payload.slug ?? null,
        sidelinks: (payload.sidelinks ?? []).slice(0, 4).map((entry, index) => ({
          node_id: entry.node_id,
          tag: entry.tag ?? "related",
          ordinal: entry.ordinal ?? index + 1,
        })),
      });

      const response: NodeCreateResponse = {
        data: {
          node_id: nodeId,
          manifest_cid: `bafyregent${nodeId}`,
          status: "pinned",
          anchor_status: "pending",
        },
      };

      this.createdNodes.set(payload.idempotency_key, response);
      json(res, 201, response);
      return;
    }

    if (method === "POST" && requestUrl.pathname === "/v1/tree/comments") {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      const payload = body as {
        node_id: number;
        body_markdown: string;
        body_plaintext?: string;
        idempotency_key: string;
      };

      if (!this.liveNodes.has(payload.node_id)) {
        json(res, 404, { error: { code: "node_not_found", message: "node not found" } });
        return;
      }

      const existing = this.createdComments.get(payload.idempotency_key);
      if (existing) {
        json(res, 200, existing);
        return;
      }

      const response: CommentCreateResponse = {
        data: {
          comment_id: this.nextCommentId,
          node_id: payload.node_id,
          created_at: createdAt(),
        },
      };

      this.nextCommentId += 1;
      this.createdComments.set(payload.idempotency_key, response);
      this.liveComments.push({
        id: response.data.comment_id,
        node_id: payload.node_id,
        author_agent_id: TEST_AGENT_SUMMARY.id,
        body_markdown: payload.body_markdown,
        body_plaintext: payload.body_plaintext ?? payload.body_markdown,
        status: "ready",
        inserted_at: response.data.created_at,
      });
      this.appendActivityEvent(payload.node_id, "node.comment_created", {
        comment_id: response.data.comment_id,
      });
      json(res, 201, response);
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/agent/watches") {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      json(res, 200, {
        data: [...this.liveWatches.values()].flat(),
      });
      return;
    }

    if (method === "POST" && /^\/v1\/tree\/nodes\/\d+\/watch$/.test(requestUrl.pathname)) {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      const nodeId = Number.parseInt(requestUrl.pathname.split("/")[4] ?? "0", 10);
      if (!this.liveNodes.has(nodeId)) {
        json(res, 404, { error: { code: "node_not_found", message: "node not found" } });
        return;
      }

      const existing = this.currentWatchRecords(nodeId)[0];

      if (existing) {
        json(res, 200, { data: existing });
        return;
      }

      const watchRecord: WatchRecord = {
        id: this.nextWatchId,
        node_id: nodeId,
        watcher_type: "agent",
        watcher_ref: TEST_AGENT_SUMMARY.id,
        inserted_at: createdAt(),
      };

      this.nextWatchId += 1;
      this.liveWatches.set(nodeId, [...this.currentWatchRecords(nodeId), watchRecord]);
      json(res, 200, { data: watchRecord });
      return;
    }

    if (method === "DELETE" && /^\/v1\/tree\/nodes\/\d+\/watch$/.test(requestUrl.pathname)) {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      const nodeId = Number.parseInt(requestUrl.pathname.split("/")[4] ?? "0", 10);
      if (!this.liveNodes.has(nodeId)) {
        json(res, 404, { error: { code: "node_not_found", message: "node not found" } });
        return;
      }

      this.liveWatches.delete(nodeId);
      json(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && /^\/v1\/tree\/nodes\/\d+\/star$/.test(requestUrl.pathname)) {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      const nodeId = Number.parseInt(requestUrl.pathname.split("/")[4] ?? "0", 10);
      const existing = (this.liveStars.get(nodeId) ?? [])[0];

      if (existing) {
        json(res, 200, { data: existing });
        return;
      }

      const starRecord: NodeStarRecord = {
        id: this.nextStarId,
        node_id: nodeId,
        actor_type: "agent",
        actor_ref: TEST_AGENT_SUMMARY.id,
        inserted_at: createdAt(),
      };

      this.nextStarId += 1;
      this.liveStars.set(nodeId, [starRecord]);
      this.appendActivityEvent(nodeId, "node.starred", {});
      json(res, 200, { data: starRecord });
      return;
    }

    if (method === "DELETE" && /^\/v1\/tree\/nodes\/\d+\/star$/.test(requestUrl.pathname)) {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      const nodeId = Number.parseInt(requestUrl.pathname.split("/")[4] ?? "0", 10);
      if ((this.liveStars.get(nodeId) ?? []).length > 0) {
        this.appendActivityEvent(nodeId, "node.unstarred", {});
      }
      this.liveStars.delete(nodeId);
      json(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/agent/inbox") {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      if (this.options.inboxResponse) {
        json(res, this.options.inboxResponse.statusCode, this.options.inboxResponse.payload);
        return;
      }

      json(res, 200, this.handleInbox(requestUrl));
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/v1/agent/opportunities") {
      if (!(await this.ensureProtectedHeaders(res, method, requestUrl.pathname, headers))) {
        return;
      }

      if (this.options.opportunitiesResponse) {
        json(
          res,
          this.options.opportunitiesResponse.statusCode,
          this.options.opportunitiesResponse.payload,
        );
        return;
      }

      json(res, 200, this.handleOpportunities(requestUrl));
      return;
    }

    if (method === "GET" && requestUrl.pathname === "/skills/test-skill/latest/skill.md") {
      text(res, 200, "# test-skill\n");
      return;
    }

    json(res, 404, {
      error: {
        code: "route_not_found",
        message: `${method} ${requestUrl.pathname} not implemented in test contract server`,
      },
    });
  }

  private async ensureProtectedHeaders(
    res: http.ServerResponse,
    method: string,
    path: string,
    headers: Record<string, string>,
  ): Promise<boolean> {
    const verification = await this.verifyHttpEnvelope(method, path, headers);
    if (verification.statusCode === 200 && verification.payload.ok === true && verification.payload.code === "http_envelope_valid") {
      return true;
    }

    json(res, verification.statusCode, {
      error: {
        code: verification.payload.code,
        message: verification.payload.message,
        ...(verification.payload.details === undefined ? {} : { details: verification.payload.details }),
      },
    });
    return false;
  }

  private async verifyHttpEnvelope(
    method: string,
    path: string,
    headers: Record<string, string>,
  ): Promise<{
    statusCode: number;
    payload:
      | { ok: true; code: "http_envelope_valid"; details: Record<string, unknown> }
      | { ok: false; code: "http_envelope_invalid"; message: string; details?: Record<string, unknown> };
  }> {
    for (const header of REQUIRED_AUTH_HEADERS) {
      if (!headers[header]) {
        return {
          statusCode: 401,
          payload: {
            ok: false,
            code: "http_envelope_invalid",
            message: `missing required header: ${header}`,
          },
        };
      }
    }

    const receiptClaims = parseReceipt(headers["x-siwa-receipt"] ?? "");
    if (!receiptClaims) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "invalid SIWA receipt",
        },
      };
    }

    const receiptExpiry = Date.parse(receiptClaims.expiresAt);
    if (!Number.isFinite(receiptExpiry) || receiptExpiry <= Date.now()) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "SIWA receipt is expired",
        },
      };
    }

    if (headers["x-key-id"] !== receiptClaims.keyId) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "x-key-id is not bound to the SIWA receipt",
        },
      };
    }

    if (headers["x-agent-wallet-address"]?.toLowerCase() !== receiptClaims.walletAddress.toLowerCase()) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "x-agent-wallet-address does not match the SIWA receipt binding",
        },
      };
    }

    if (headers["x-agent-chain-id"] !== String(receiptClaims.chainId)) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "x-agent-chain-id does not match the SIWA receipt binding",
        },
      };
    }

    if (receiptClaims.registryAddress && headers["x-agent-registry-address"]?.toLowerCase() !== receiptClaims.registryAddress.toLowerCase()) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "x-agent-registry-address does not match the SIWA receipt binding",
        },
      };
    }

    if (receiptClaims.tokenId && headers["x-agent-token-id"] !== receiptClaims.tokenId) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "x-agent-token-id does not match the SIWA receipt binding",
        },
      };
    }

    const parsedSignatureInput = parseSignatureInputHeader(headers["signature-input"] ?? "");
    if (!parsedSignatureInput || parsedSignatureInput.label !== "sig1") {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "signature-input is malformed",
        },
      };
    }

    for (const component of REQUIRED_SIGNATURE_COMPONENTS) {
      if (!parsedSignatureInput.coveredComponents.includes(component)) {
        return {
          statusCode: 401,
          payload: {
            ok: false,
            code: "http_envelope_invalid",
            message: `signature-input missing covered component: ${component}`,
          },
        };
      }
    }

    const created = parsedSignatureInput.params.created;
    const expires = parsedSignatureInput.params.expires;
    const nonce = parsedSignatureInput.params.nonce;
    const keyId = parsedSignatureInput.params.keyid;
    const timestamp = Number.parseInt(headers["x-timestamp"] ?? "", 10);
    if (
      created === undefined ||
      expires === undefined ||
      !nonce ||
      !keyId ||
      !Number.isFinite(timestamp)
    ) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "signature-input is missing replay-safety parameters",
        },
      };
    }

    if (created !== timestamp) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "signature-input created does not match x-timestamp",
        },
      };
    }

    if (keyId !== headers["x-key-id"]) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "signature-input keyid does not match x-key-id",
        },
      };
    }

    const nowUnix = currentUnixSeconds();
    if (expires <= created || expires <= nowUnix || Math.abs(nowUnix - created) > 300) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "signature timestamp is outside the accepted freshness window",
        },
      };
    }

    const replayKey = `${headers["x-key-id"]}:${nonce}`;
    if (this.consumedEnvelopeNonces.has(replayKey)) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "signature replay detected",
        },
      };
    }

    buildHttpSignatureSigningMessage({
      method,
      path,
      headers,
    });

    if (!/^0x[0-9a-fA-F]{130}$/.test(headers.signature ?? "")) {
      return {
        statusCode: 401,
        payload: {
          ok: false,
          code: "http_envelope_invalid",
          message: "signature verification failed",
        },
      };
    }

    this.consumedEnvelopeNonces.add(replayKey);
    return {
      statusCode: 200,
      payload: {
        ok: true,
        code: "http_envelope_valid",
        details: {
          walletAddress: receiptClaims.walletAddress,
          chainId: receiptClaims.chainId,
          registryAddress: receiptClaims.registryAddress,
          tokenId: receiptClaims.tokenId,
        },
      },
    };
  }
}
