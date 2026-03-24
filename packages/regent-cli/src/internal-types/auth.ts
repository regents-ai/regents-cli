import type { LocalAgentIdentity } from "./runtime.js";

export interface SiwaNonceRequest {
  kind: "nonce_request";
  walletAddress: `0x${string}`;
  chainId: number;
  audience: string;
}

export interface SiwaNonceResponse {
  ok: true;
  code: "nonce_issued";
  data: {
    nonce: string;
    walletAddress: `0x${string}`;
    chainId: number;
    expiresAt: string;
  };
  meta?: Record<string, unknown>;
}

export interface SiwaVerifyRequest {
  kind: "verify_request";
  walletAddress: `0x${string}`;
  chainId: number;
  nonce: string;
  message: string;
  signature: `0x${string}`;
  registryAddress?: `0x${string}`;
  tokenId?: string;
}

export interface SiwaVerifyResponse {
  ok: true;
  code: "siwa_verified";
  data: {
    verified: true;
    walletAddress: `0x${string}`;
    chainId: number;
    nonce: string;
    keyId: string;
    signatureScheme: "evm_personal_sign";
    receipt: string;
    receiptExpiresAt: string;
  };
  meta?: Record<string, unknown>;
}

export interface SiwaSession {
  walletAddress: `0x${string}`;
  chainId: number;
  nonce: string;
  keyId: string;
  receipt: string;
  receiptExpiresAt: string;
  audience: string;
  registryAddress?: `0x${string}`;
  tokenId?: string;
}

export type RequiredAgentIdentityField = "walletAddress" | "chainId" | "registryAddress" | "tokenId";

export interface AuthStatusResponse {
  authenticated: boolean;
  session: SiwaSession | null;
  agentIdentity: LocalAgentIdentity | null;
  protectedRoutesReady: boolean;
  missingIdentityFields: RequiredAgentIdentityField[];
}

export interface SignedAgentRequestHeaders {
  "x-siwa-receipt": string;
  "x-key-id": string;
  "x-timestamp": string;
  "signature-input": string;
  signature: string;
  "x-agent-wallet-address": `0x${string}`;
  "x-agent-chain-id": string;
  "x-agent-registry-address": `0x${string}`;
  "x-agent-token-id": string;
}
