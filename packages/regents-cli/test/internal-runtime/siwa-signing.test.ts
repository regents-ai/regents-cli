import { describe, expect, it } from "vitest";

import type { LocalAgentIdentity, SiwaSession } from "../../src/internal-types/index.js";

import {
  buildAuthenticatedFetchInit,
  buildProtectedAgentAuthDebugSnapshot,
} from "../../src/internal-runtime/siwa/request-builder.js";
import { buildSiwaMessage } from "../../src/internal-runtime/siwa/siwa.js";
import {
  coveredComponentsForAgentHeaders,
  buildHttpSignatureSigningMessage,
  buildSignatureInputString,
  buildSignedAgentHeaders,
  parseSignatureInputHeader,
} from "../../src/internal-runtime/siwa/signing.js";

describe("siwa message construction", () => {
  it("builds the expected SIWA message", () => {
    const message = buildSiwaMessage({
      domain: "regent.cx",
      uri: "https://regent.cx/login",
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 84532,
      registryAddress: "0x2222222222222222222222222222222222222222",
      tokenId: "99",
      nonce: "12345678deadbeef",
      issuedAt: "2026-03-10T00:00:00.000Z",
      statement: "Sign in to Regents CLI.",
    });

    expect(message).toBe(
      [
        "regent.cx wants you to sign in with your Agent account:",
        "0x1111111111111111111111111111111111111111",
        "",
        "Sign in to Regents CLI.",
        "",
        "URI: https://regent.cx/login",
        "Version: 1",
        "Agent ID: 99",
        "Agent Registry: eip155:84532:0x2222222222222222222222222222222222222222",
        "Chain ID: 84532",
        "Nonce: 12345678deadbeef",
        "Issued At: 2026-03-10T00:00:00.000Z",
      ].join("\n"),
    );
  });
});

describe("http signing", () => {
  it("formats signature-input exactly", () => {
    const signatureInput = buildSignatureInputString({
      coveredComponents: coveredComponentsForAgentHeaders({
        includeContentDigest: false,
      }),
      created: 1_700_000_000,
      expires: 1_700_000_120,
      nonce: "sig-nonce-fixed",
      keyId: "0xabc",
    });

    expect(signatureInput).toBe(
      'sig1=("@method" "@path" "x-siwa-receipt" "x-key-id" "x-timestamp" "x-agent-wallet-address" "x-agent-chain-id" "x-agent-registry-address" "x-agent-token-id");created=1700000000;expires=1700000120;nonce="sig-nonce-fixed";keyid="0xabc"',
    );
  });

  it("builds the canonical signing message", () => {
    const signingMessage = buildHttpSignatureSigningMessage({
      method: "POST",
      path: "/v1/tree/nodes",
      headers: {
        "x-siwa-receipt": "receipt-token",
        "x-key-id": "0xabc",
        "x-timestamp": "1700000000",
        "x-agent-wallet-address": "0x1111111111111111111111111111111111111111",
        "x-agent-chain-id": "84532",
        "x-agent-registry-address": "0x2222222222222222222222222222222222222222",
        "x-agent-token-id": "99",
        "signature-input":
          'sig1=("@method" "@path" "x-siwa-receipt" "x-key-id" "x-timestamp" "x-agent-wallet-address" "x-agent-chain-id" "x-agent-registry-address" "x-agent-token-id");created=1700000000;expires=1700000120;nonce="sig-nonce-fixed";keyid="0xabc"',
      },
    });

    expect(signingMessage).toBe(
      [
        '"@method": post',
        '"@path": /v1/tree/nodes',
        '"x-siwa-receipt": receipt-token',
        '"x-key-id": 0xabc',
        '"x-timestamp": 1700000000',
        '"x-agent-wallet-address": 0x1111111111111111111111111111111111111111',
        '"x-agent-chain-id": 84532',
        '"x-agent-registry-address": 0x2222222222222222222222222222222222222222',
        '"x-agent-token-id": 99',
        '"@signature-params": ("@method" "@path" "x-siwa-receipt" "x-key-id" "x-timestamp" "x-agent-wallet-address" "x-agent-chain-id" "x-agent-registry-address" "x-agent-token-id");created=1700000000;expires=1700000120;nonce="sig-nonce-fixed";keyid="0xabc"',
      ].join("\n"),
    );
  });

  it("keeps the query string in the signed path", () => {
    const signingMessage = buildHttpSignatureSigningMessage({
      method: "GET",
      path: "/v1/agent/agents?launchable=true",
      headers: {
        "x-siwa-receipt": "receipt-token",
        "x-key-id": "0xabc",
        "x-timestamp": "1700000000",
        "x-agent-wallet-address": "0x1111111111111111111111111111111111111111",
        "x-agent-chain-id": "84532",
        "x-agent-registry-address": "0x2222222222222222222222222222222222222222",
        "x-agent-token-id": "99",
        "signature-input":
          'sig1=("@method" "@path" "x-siwa-receipt" "x-key-id" "x-timestamp" "x-agent-wallet-address" "x-agent-chain-id" "x-agent-registry-address" "x-agent-token-id");created=1700000000;expires=1700000120;nonce="sig-nonce-fixed";keyid="0xabc"',
      },
    });

    expect(signingMessage).toContain('"@path": /v1/agent/agents?launchable=true');
  });

  it("parses the signature-input parameters used by sidecar verification", () => {
    const parsed = parseSignatureInputHeader(
      'sig1=("@method" "@path" "x-siwa-receipt" "x-key-id" "x-timestamp" "x-agent-wallet-address" "x-agent-chain-id" "x-agent-registry-address" "x-agent-token-id");created=1700000000;expires=1700000120;nonce="sig-nonce-fixed";keyid="0xabc"',
    );

    expect(parsed).toEqual({
      label: "sig1",
      coveredComponents: [
        "@method",
        "@path",
        "x-siwa-receipt",
        "x-key-id",
        "x-timestamp",
        "x-agent-wallet-address",
        "x-agent-chain-id",
        "x-agent-registry-address",
        "x-agent-token-id",
      ],
      params: {
        created: 1700000000,
        expires: 1700000120,
        nonce: "sig-nonce-fixed",
        keyid: "0xabc",
      },
    });
  });

  it("generates signed agent headers", async () => {
    const headers = await buildSignedAgentHeaders({
      method: "POST",
      path: "/v1/tree/nodes",
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 84532,
      registryAddress: "0x2222222222222222222222222222222222222222",
      tokenId: "99",
      receipt: "receipt-token",
      privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      nowUnixSeconds: 1_700_000_000,
      nonce: "sig-nonce-fixed",
    });

    expect(headers["x-key-id"]).toBe("0x1111111111111111111111111111111111111111");
    expect(headers["signature-input"]).toContain('nonce="sig-nonce-fixed"');
    expect(headers.signature).toMatch(/^sig1=:[A-Za-z0-9+/=]+:$/);
  });

  it("builds a stable protected auth debug snapshot", async () => {
    const session: SiwaSession = {
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 84532,
      nonce: "nonce-fixed",
      keyId: "0x1111111111111111111111111111111111111111",
      receipt: "receipt-token",
      receiptExpiresAt: "2999-01-01T00:00:00.000Z",
      audience: "techtree",
      registryAddress: "0x2222222222222222222222222222222222222222",
      tokenId: "99",
    };
    const agentIdentity: LocalAgentIdentity = {
      walletAddress: "0x1111111111111111111111111111111111111111",
      chainId: 84532,
      registryAddress: "0x2222222222222222222222222222222222222222",
      tokenId: "99",
    };

    const request = await buildAuthenticatedFetchInit({
      method: "POST",
      path: "/v1/tree/nodes",
      body: {
        seed: "ml",
        kind: "hypothesis",
        title: "Debug snapshot",
      },
      session,
      agentIdentity,
      privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    });

    expect(
      buildProtectedAgentAuthDebugSnapshot({
        method: "POST",
        signedPath: request.urlPath,
        finalUrl: "https://techtree.example/v1/tree/nodes",
        serializedJsonBody: request.serializedJsonBody,
        headers: request.init.headers,
      }),
    ).toMatchObject({
      method: "POST",
      signedPath: "/v1/tree/nodes",
      finalUrl: "https://techtree.example/v1/tree/nodes",
      serializedJsonBody: JSON.stringify({
        seed: "ml",
        kind: "hypothesis",
        title: "Debug snapshot",
      }),
      authHeaders: {
        "content-type": "application/json",
        "x-siwa-receipt": "receipt-token",
        "x-key-id": "0x1111111111111111111111111111111111111111",
        "x-agent-wallet-address": "0x1111111111111111111111111111111111111111",
        "x-agent-chain-id": "84532",
        "x-agent-registry-address": "0x2222222222222222222222222222222222222222",
        "x-agent-token-id": "99",
      },
    });
  });
});
