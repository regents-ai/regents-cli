import type { RegentConfig } from "../../../internal-types/index.js";
import { TechtreeApiError } from "../../errors.js";
import type { SessionStore } from "../../store/session-store.js";
import type { StateStore } from "../../store/state-store.js";
import { parseTechtreeErrorResponse } from "../api-errors.js";
import { resolveAuthenticatedAgentSigningContext } from "../auth.js";
import { buildAuthenticatedFetchInit } from "../../siwa/request-builder.js";

export type TechtreeRequestMethod = "GET" | "POST" | "DELETE";
export type ExpectedDataType = "array" | "object" | "object-or-null";

export const withQuery = (
  path: string,
  params?: Record<string, string | number | boolean | string[] | undefined>,
): string => {
  const query = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(params ?? {})) {
    if (rawValue === undefined) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        query.append(key, value);
      }
      continue;
    }

    query.set(key, String(rawValue));
  }

  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
};

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TechtreeApiError(message, { code: "invalid_techtree_response", payload: value });
  }

  return value as Record<string, unknown>;
};

const hasDataArray = <T>(payload: Record<string, unknown>): { data: T[] } => {
  if (!Array.isArray(payload.data)) {
    throw new TechtreeApiError("expected Techtree response with data array", {
      code: "invalid_techtree_response",
      payload,
    });
  }

  return payload as { data: T[] };
};

const hasDataObject = <T>(payload: Record<string, unknown>): { data: T } => {
  if (!payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
    throw new TechtreeApiError("expected Techtree response with data object", {
      code: "invalid_techtree_response",
      payload,
    });
  }

  return payload as { data: T };
};

export class TechtreeRequestClient {
  readonly baseUrl: string;
  readonly config: RegentConfig;
  readonly requestTimeoutMs: number;
  readonly sessionStore: SessionStore;
  readonly stateStore: StateStore;

  constructor(args: {
    config: RegentConfig;
    baseUrl: string;
    requestTimeoutMs: number;
    sessionStore: SessionStore;
    stateStore: StateStore;
  }) {
    this.config = args.config;
    this.baseUrl = args.baseUrl.replace(/\/+$/, "");
    this.requestTimeoutMs = args.requestTimeoutMs;
    this.sessionStore = args.sessionStore;
    this.stateStore = args.stateStore;
  }

  hasAuthenticatedAgentContext(): boolean {
    const session = this.sessionStore.getSiwaSession();
    const identity = this.stateStore.read().agent;
    return !!session && !this.sessionStore.isReceiptExpired() && !!identity;
  }

  async getJson<T>(path: string, expectedDataType?: ExpectedDataType): Promise<T> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: "GET",
    });

    if (!res.ok) {
      throw await parseTechtreeErrorResponse(res);
    }

    const payload = asRecord(await res.json(), "expected JSON object response from Techtree");

    if (expectedDataType === "array") {
      return hasDataArray(payload) as T;
    }

    if (expectedDataType === "object" && "data" in payload) {
      return hasDataObject(payload) as T;
    }

    if (expectedDataType === "object-or-null" && "data" in payload) {
      return payload as T;
    }

    return payload as T;
  }

  async getText(path: string): Promise<string> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: "GET",
    });

    if (!res.ok) {
      throw await parseTechtreeErrorResponse(res);
    }

    return res.text();
  }

  async authedFetchJson<T>(
    method: TechtreeRequestMethod,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const result = await this.authedRequestJson<T>(method, path, body);
    return result.response;
  }

  async authedFetchJsonWithStatus<T>(
    method: TechtreeRequestMethod,
    path: string,
    body?: unknown,
  ): Promise<{ statusCode: number; response: T }> {
    return this.authedRequestJson<T>(method, path, body);
  }

  async buildAuthedRequestInit(
    method: TechtreeRequestMethod,
    path: string,
    body?: unknown,
  ): Promise<RequestInit> {
    const { session, identity, signer } = await resolveAuthenticatedAgentSigningContext(
      this.config,
      this.sessionStore,
      this.stateStore,
      this.requestTimeoutMs,
    );
    const { init } = await buildAuthenticatedFetchInit({
      method,
      path,
      body,
      session,
      agentIdentity: identity,
      signMessage: signer.signMessage,
    });

    return init;
  }

  async fetchExternalText(url: string): Promise<string> {
    const res = await this.fetchWithTimeout(url, { method: "GET" });

    if (!res.ok) {
      throw new TechtreeApiError(`request to ${url} failed with status ${res.status}`, {
        code: "techtree_request_failed",
        status: res.status,
      });
    }

    return res.text();
  }

  async fetchWithTimeout(
    url: string,
    init: RequestInit,
    options?: { timeoutMs?: number },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    const timeout =
      timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    const externalSignal = init.signal;
    const forwardAbort = (): void => controller.abort();

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", forwardAbort, { once: true });
      }
    }

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new TechtreeApiError(`request to ${url} timed out`, { code: "techtree_timeout", cause: error });
      }

      throw new TechtreeApiError(`request to ${url} failed`, { code: "techtree_request_failed", cause: error });
    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener("abort", forwardAbort);
      }
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private async authedRequestJson<T>(
    method: TechtreeRequestMethod,
    path: string,
    body?: unknown,
  ): Promise<{ statusCode: number; response: T }> {
    const finalInit = await this.buildAuthedRequestInit(method, path, body);
    const url = `${this.baseUrl}${path}`;
    const res = await this.fetchWithTimeout(url, finalInit);

    if (!res.ok) {
      throw await parseTechtreeErrorResponse(res);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new TechtreeApiError("expected JSON response from authenticated Techtree request", {
        code: "invalid_techtree_response",
        status: res.status,
      });
    }

    return {
      statusCode: res.status,
      response: (await res.json()) as T,
    };
  }
}
