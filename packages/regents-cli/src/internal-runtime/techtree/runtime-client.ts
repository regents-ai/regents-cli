import fs from "node:fs/promises";
import path from "node:path";

import type {
  BbhLeaderboardResponse,
  RegentConfig,
  TechtreeFetchRequest,
  TechtreeFetchResponse,
  TechtreePinRequest,
  TechtreePinResponse,
  TechtreePublishRequest,
  TechtreePublishResponse,
} from "../../internal-types/index.js";

import { loadConfig } from "../config.js";
import { TechtreeApiError } from "../errors.js";
import { ProductHttpError, requestProductResponse } from "../product-http-client.js";
import { parseTechtreeErrorResponse } from "./api-errors.js";

type NodeApiResponse = {
  data: {
    id: string;
    node_type: "artifact" | "run" | "review";
    manifest_cid?: string | null;
    payload_cid?: string | null;
    manifest?: Record<string, unknown>;
    payload_index?: Record<string, unknown>;
    header?: Record<string, unknown>;
  };
};

const jsonRequestInit = (method: "GET" | "POST", body?: unknown): RequestInit => {
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  return {
    method,
    headers: serializedBody === undefined ? undefined : { "content-type": "application/json" },
    ...(serializedBody === undefined ? {} : { body: serializedBody }),
  };
};

const materializeNode = async (
  materializeTo: string,
  nodeType: "artifact" | "run" | "review",
  manifest: Record<string, unknown>,
  payloadIndex: Record<string, unknown>,
  header: Record<string, unknown>,
): Promise<string> => {
  const workspacePath = path.resolve(materializeTo);
  const distPath = path.join(workspacePath, "dist");
  await fs.mkdir(distPath, { recursive: true });
  await fs.writeFile(
    path.join(distPath, `${nodeType}.manifest.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(distPath, "payload.index.json"),
    `${JSON.stringify(payloadIndex, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(distPath, "node-header.json"),
    `${JSON.stringify(header, null, 2)}\n`,
    "utf8",
  );
  return workspacePath;
};

export class TechtreeRuntimeClient {
  readonly baseUrl: string;
  readonly requestTimeoutMs: number;
  readonly config?: RegentConfig;

  constructor(args: { baseUrl: string; requestTimeoutMs: number; config?: RegentConfig }) {
    this.baseUrl = args.baseUrl.replace(/\/+$/, "");
    this.requestTimeoutMs = args.requestTimeoutMs;
    this.config = args.config;
  }

  private async requestJson<TResponse>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<TResponse> {
    const init = jsonRequestInit(method, body);

    try {
      const { response } = await requestProductResponse({
        service: "techtree",
        method,
        path,
        config: this.config,
        commandName: "regents techtree runtime",
        timeoutMs: this.requestTimeoutMs,
        headers: init.headers,
        body: init.body ?? null,
        baseUrlOverride: this.baseUrl,
      });
      if (!response.ok) {
        throw await parseTechtreeErrorResponse(response);
      }

      if (response.status === 204) {
        return undefined as TResponse;
      }

      return (await response.json()) as TResponse;
    } catch (error) {
      if (error instanceof TechtreeApiError) {
        throw error;
      }

      if (error instanceof ProductHttpError && error.timedOut) {
        throw new TechtreeApiError(`Techtree runtime request timed out after ${this.requestTimeoutMs}ms`, {
          code: "techtree_runtime_timeout",
          cause: error,
        });
      }

      throw new TechtreeApiError("Techtree runtime request failed", {
        code: "techtree_runtime_request_failed",
        cause: error,
      });
    }
  }

  async fetchNode(input: TechtreeFetchRequest): Promise<TechtreeFetchResponse> {
    const response = await this.requestJson<NodeApiResponse>("GET", `/v1/runtime/nodes/${encodeURIComponent(input.node_id)}`);
    const data = response.data;
    const materializedTo =
      input.materialize_to && data.manifest && data.payload_index && data.header
        ? await materializeNode(input.materialize_to, data.node_type, data.manifest, data.payload_index, data.header)
        : null;

    return {
      ok: true,
      node_id: data.id as TechtreeFetchResponse["node_id"],
      node_type: data.node_type,
      manifest_cid: data.manifest_cid ?? null,
      payload_cid: data.payload_cid ?? null,
      manifest: data.manifest as TechtreeFetchResponse["manifest"],
      payload_index: data.payload_index as TechtreeFetchResponse["payload_index"],
      node_header: data.header as TechtreeFetchResponse["node_header"],
      materialized_to: materializedTo,
      verified: data.manifest !== undefined && data.payload_index !== undefined && data.header !== undefined,
    };
  }

  async pinNode(input: TechtreePinRequest): Promise<TechtreePinResponse> {
    const response = await this.requestJson<{
      data: {
        node_id: string;
        manifest_cid: string;
        payload_cid: string;
      };
    }>("POST", "/v1/agent/runtime/pin", {
      path: input.dist_path ?? input.workspace_path,
      node_type: input.node_type,
    });

    return {
      ok: true,
      node_id: response.data.node_id as TechtreePinResponse["node_id"],
      manifest_cid: response.data.manifest_cid,
      payload_cid: response.data.payload_cid,
    };
  }

  async publishNode(input: TechtreePublishRequest): Promise<TechtreePublishResponse> {
    const response = await this.requestJson<NodeApiResponse>("POST", "/v1/agent/runtime/publish/submit", {
      path: input.dist_path ?? input.workspace_path,
      node_type: input.node_type,
      manifest_cid: input.manifest_cid,
      payload_cid: input.payload_cid,
      header: {
        id: input.header.id,
        subject_id: input.header.subjectId,
        aux_id: input.header.auxId,
        payload_hash: input.header.payloadHash,
        node_type: input.header.nodeType,
        schema_version: input.header.schemaVersion,
        flags: input.header.flags,
        author: input.header.author,
      },
    });

    return {
      ok: true,
      node_id: response.data.id as TechtreePublishResponse["node_id"],
      manifest_cid: response.data.manifest_cid ?? input.manifest_cid,
      payload_cid: response.data.payload_cid ?? input.payload_cid,
      tx_hash: null,
    };
  }

  async getBbhLeaderboard(params?: {
    split?: "climb" | "benchmark" | "challenge" | "draft";
  }): Promise<BbhLeaderboardResponse> {
    const query = params?.split ? `?split=${encodeURIComponent(params.split)}` : "";
    return this.requestJson<BbhLeaderboardResponse>("GET", `/v1/bbh/leaderboard${query}`);
  }
}

export const loadTechtreeRuntimeClient = (configPath?: string): TechtreeRuntimeClient => {
  const config = loadConfig(configPath);
  return new TechtreeRuntimeClient({
    baseUrl: config.services.techtree.baseUrl,
    requestTimeoutMs: config.services.techtree.requestTimeoutMs,
    config,
  });
};
