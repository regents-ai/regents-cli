import { randomUUID } from "node:crypto";

import { appendStructuredLog } from "./structured-log.js";
import { loadConfig } from "./config.js";
import type { RegentConfig } from "../internal-types/config.js";

export type ProductServiceName = "siwa" | "platform" | "autolaunch" | "techtree";
export type ProductHttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
type ProductHttpHeaders = ConstructorParameters<typeof Headers>[0];
type ProductHttpBody = NonNullable<Parameters<typeof fetch>[1]> extends { readonly body?: infer Body } ? Body : never;

export interface ProductHttpRequestOptions {
  readonly service: ProductServiceName;
  readonly method: ProductHttpMethod;
  readonly path: string;
  readonly configPath?: string;
  readonly config?: RegentConfig;
  readonly commandName?: string;
  readonly chainId?: number;
  readonly timeoutMs?: number;
  readonly headers?: ProductHttpHeaders;
  readonly body?: ProductHttpBody | null;
  readonly baseUrlOverride?: string;
  readonly signal?: AbortSignal | null;
}

export interface ProductHttpResponse {
  readonly response: Response;
  readonly requestId: string;
}

export class ProductHttpError extends Error {
  readonly service: ProductServiceName;
  readonly status: number;
  readonly path: string;
  readonly requestId: string;
  readonly timedOut: boolean;

  constructor(args: {
    service: ProductServiceName;
    status: number;
    path: string;
    requestId: string;
    message: string;
    timedOut?: boolean;
  }) {
    super(args.message);
    this.name = "ProductHttpError";
    this.service = args.service;
    this.status = args.status;
    this.path = args.path;
    this.requestId = args.requestId;
    this.timedOut = args.timedOut === true;
  }
}

export const productBaseUrl = (
  config: RegentConfig,
  service: ProductServiceName,
  baseUrlOverride?: string,
): string => {
  if (baseUrlOverride) {
    return baseUrlOverride.replace(/\/+$/u, "");
  }

  if (service === "platform" && process.env.REGENT_PLATFORM_ORIGIN) {
    return process.env.REGENT_PLATFORM_ORIGIN.replace(/\/+$/u, "");
  }

  if (service === "autolaunch" && process.env.AUTOLAUNCH_BASE_URL) {
    return process.env.AUTOLAUNCH_BASE_URL.replace(/\/+$/u, "");
  }

  return config.services[service].baseUrl.replace(/\/+$/u, "");
};

export const requestProductResponse = async (
  options: ProductHttpRequestOptions,
): Promise<ProductHttpResponse> => {
  const config = options.config ?? loadConfig(options.configPath);
  const requestId = randomUUID();
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? config.services[options.service].requestTimeoutMs;
  const controller = new AbortController();
  const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  const externalSignal = options.signal ?? undefined;
  const forwardAbort = (): void => controller.abort();
  const headers = new Headers(options.headers);

  headers.set("x-request-id", requestId);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  try {
    const response = await fetch(`${productBaseUrl(config, options.service, options.baseUrlOverride)}${options.path}`, {
      method: options.method,
      headers,
      body: options.body,
      signal: controller.signal,
    });

    appendStructuredLog(config, {
      timestamp: new Date().toISOString(),
      level: response.ok ? "info" : "error",
      event: "product_http_request",
      command: options.commandName,
      service: options.service,
      method: options.method,
      path: options.path,
      status: response.status,
      ok: response.ok,
      requestId,
      durationMs: Math.round(performance.now() - started),
      chainId: options.chainId,
      redacted: true,
    });

    return { response, requestId };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    const message =
      timedOut
        ? `Regent ${options.service} request timed out after ${timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : "Regent request failed.";

    appendStructuredLog(config, {
      timestamp: new Date().toISOString(),
      level: "error",
      event: "product_http_request",
      command: options.commandName,
      service: options.service,
      method: options.method,
      path: options.path,
      ok: false,
      requestId,
      durationMs: Math.round(performance.now() - started),
      chainId: options.chainId,
      error: message,
      redacted: true,
    });

    throw new ProductHttpError({
      service: options.service,
      status: 0,
      path: options.path,
      requestId,
      message,
      timedOut,
    });
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener("abort", forwardAbort);
    }
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};
