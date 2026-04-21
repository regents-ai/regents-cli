import type {
  SiwaNonceRequest,
  SiwaNonceResponse,
  SiwaVerifyRequest,
  SiwaVerifyResponse,
} from "../../internal-types/index.js";

import { AuthError, TechtreeApiError } from "../errors.js";
import { parseTechtreeErrorResponse } from "./api-errors.js";

const DEFAULT_DOMAIN = "regent.cx";
const DEFAULT_URI = "https://regent.cx/v1/agent/siwa/verify";
const DEFAULT_STATEMENT = "Sign in to Regents CLI.";

export function buildSiwaMessage(input: {
  domain: string;
  uri: string;
  walletAddress: string;
  chainId: number;
  nonce: string;
  issuedAt?: string;
  statement?: string;
}): string {
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const statement = input.statement ?? DEFAULT_STATEMENT;

  return [
    `${input.domain} wants you to sign in with your Ethereum account:`,
    input.walletAddress,
    "",
    statement,
    "",
    `URI: ${input.uri}`,
    "Version: 1",
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

const ensureOkEnvelope = <T extends { ok?: unknown; code?: unknown; data?: unknown }>(
  value: unknown,
  expectedCode: string,
): T => {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { ok?: unknown }).ok !== true ||
    (value as { code?: unknown }).code !== expectedCode
  ) {
    throw new AuthError("siwa_invalid_response", "SIWA endpoint returned an unexpected success envelope");
  }

  return value as T;
};

export class SiwaClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
  }

  async requestNonce(input: SiwaNonceRequest): Promise<SiwaNonceResponse> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/v1/agent/siwa/nonce`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      throw await parseTechtreeErrorResponse(res);
    }

    const payload = ensureOkEnvelope<SiwaNonceResponse>(await res.json(), "nonce_issued");
    return payload;
  }

  async verify(input: SiwaVerifyRequest): Promise<SiwaVerifyResponse> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/v1/agent/siwa/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      throw await parseTechtreeErrorResponse(res);
    }

    const payload = ensureOkEnvelope<SiwaVerifyResponse>(await res.json(), "siwa_verified");
    return payload;
  }

  static defaultMessageInput(input: {
    walletAddress: string;
    chainId: number;
    nonce: string;
    issuedAt?: string;
    statement?: string;
  }): string {
    return buildSiwaMessage({
      domain: DEFAULT_DOMAIN,
      uri: DEFAULT_URI,
      walletAddress: input.walletAddress,
      chainId: input.chainId,
      nonce: input.nonce,
      issuedAt: input.issuedAt,
      statement: input.statement,
    });
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new TechtreeApiError(`request to ${url} timed out`, {
          code: "siwa_timeout",
          cause: error,
        });
      }

      throw new TechtreeApiError(`request to ${url} failed`, {
        code: "siwa_request_failed",
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
