import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCliEntrypoint } from "../../src/index.js";
import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import { parseCliArgs } from "../../src/parse.js";
import { writeFakeCdp } from "../support/fake-cdp.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const TEST_WALLET = "0x1111111111111111111111111111111111111111";
const TEST_REGISTRY = "0x2222222222222222222222222222222222222222";
const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("agentbook CLI command group", () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn<typeof fetch>();
  let tempDir = "";
  let configPath = "";

  const writeAgentAuthState = () => {
    writeInitialConfig(configPath);
    const receiptPath = path.join(tempDir, ".regent", "identity", "receipt-v1.json");
    const statePath = path.join(tempDir, "state", "runtime-state.json");
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      receiptPath,
      JSON.stringify(
        {
          version: 1,
          regent_base_url: "http://127.0.0.1:4000",
          network: "base-sepolia",
          provider: "coinbase-cdp",
          address: TEST_WALLET,
          agent_id: 99,
          agent_registry: TEST_REGISTRY,
          signer_type: "evm_personal_sign",
          verified: "onchain",
          receipt: "identity-receipt",
          receipt_issued_at: "2026-04-01T00:00:00.000Z",
          receipt_expires_at: "2999-01-01T00:00:00.000Z",
          cached_at: "2026-04-01T00:00:00.000Z",
          wallet_hint: "main",
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          agent: {
            walletAddress: TEST_WALLET,
            chainId: 84532,
            registryAddress: TEST_REGISTRY,
            tokenId: "99",
            label: "Coinbase wallet",
          },
          siwa: {
            walletAddress: TEST_WALLET,
            chainId: 84532,
            nonce: "agentbook-login-nonce",
            keyId: TEST_WALLET.toLowerCase(),
            receipt: "agentbook-receipt",
            receiptExpiresAt: "2999-01-01T00:00:00.000Z",
            audience: "techtree",
            registryAddress: TEST_REGISTRY,
            tokenId: "99",
          },
        },
        null,
        2,
      ),
    );
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-agentbook-"));
    configPath = path.join(tempDir, "regent.config.json");
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(os, "homedir").mockReturnValue(tempDir);
    process.env = { ...originalEnv };
    process.env.HOME = tempDir;
    process.env.PATH = `${writeFakeCdp(tempDir, {
      accounts: [{ name: "main", address: TEST_WALLET }],
    })}:${originalEnv.PATH ?? ""}`;
    process.env.CDP_KEY_ID = "test-key";
    process.env.CDP_KEY_SECRET = "test-secret";
    process.env.CDP_WALLET_SECRET = "test-wallet-secret";
    process.env.REGENT_WALLET_PRIVATE_KEY = TEST_PRIVATE_KEY;
    delete process.env.PLATFORM_PHX_BASE_URL;
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("starts a hosted trust approval in Platform", async () => {
    writeAgentAuthState();

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          session: {
            session_id: "sess_1",
            status: "pending",
            approval_url: "https://platform.regents.sh/app/trust?session_id=sess_1&token=tok_1",
            wallet_address: TEST_WALLET,
            chain_id: 84532,
            registry_address: TEST_REGISTRY,
            token_id: "99",
            network: "world",
            source: "regents-cli",
            expires_at: "2026-04-21T20:00:00Z",
            connector_uri: null,
            deep_link_uri: null,
            error_text: null,
            frontend_request: {
              app_id: "app_test",
              action: "agentbook-registration",
              signal: "0xfeed",
              rp_context: {
                rp_id: "app_test",
                nonce: "nonce-123",
                created_at: 1_712_000_000,
                expires_at: 1_712_000_300,
                signature: "0xsig",
              },
              allow_legacy_proofs: false,
            },
            tx_request: null,
            trust: {
              connected: false,
              world_human_id: null,
              unique_agent_count: 0,
              connected_at: null,
              source: null,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint(["agentbook", "register", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4000/api/agentbook/sessions");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)["x-siwa-receipt"]).toBe(
      "agentbook-receipt",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ source: "regents-cli" });
    expect(parsePrintedJson<{ session: { approval_url: string } }>(output.stdout)).toMatchObject({
      session: { approval_url: "https://platform.regents.sh/app/trust?session_id=sess_1&token=tok_1" },
    });
  });

  it("watches a hosted trust session and saves the human-backed trust on the local identity", async () => {
    writeAgentAuthState();

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            session: {
              session_id: "sess_1",
              status: "pending",
              approval_url: "https://platform.regents.sh/app/trust?session_id=sess_1&token=tok_1",
              wallet_address: TEST_WALLET,
              chain_id: 84532,
              registry_address: TEST_REGISTRY,
              token_id: "99",
              network: "world",
              source: "regents-cli",
              expires_at: "2026-04-21T20:00:00Z",
              connector_uri: null,
              deep_link_uri: null,
              error_text: null,
              frontend_request: null,
              tx_request: null,
              trust: {
                connected: false,
                world_human_id: null,
                unique_agent_count: 0,
                connected_at: null,
                source: null,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            session: {
              session_id: "sess_1",
              status: "proof_ready",
              approval_url: null,
              wallet_address: TEST_WALLET,
              chain_id: 84532,
              registry_address: TEST_REGISTRY,
              token_id: "99",
              network: "world",
              source: "regents-cli",
              expires_at: "2026-04-21T20:00:00Z",
              connector_uri: null,
              deep_link_uri: null,
              error_text: "waiting on registration",
              frontend_request: null,
              tx_request: null,
              trust: {
                connected: false,
                world_human_id: null,
                unique_agent_count: 0,
                connected_at: null,
                source: null,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            session: {
              session_id: "sess_1",
              status: "registered",
              approval_url: null,
              wallet_address: TEST_WALLET,
              chain_id: 84532,
              registry_address: TEST_REGISTRY,
              token_id: "99",
              network: "world",
              source: "regents-cli",
              expires_at: "2026-04-21T20:00:00Z",
              connector_uri: null,
              deep_link_uri: null,
              error_text: null,
              frontend_request: null,
              tx_request: null,
              trust: {
                connected: true,
                world_human_id: "0x1234",
                unique_agent_count: 2,
                connected_at: "2026-04-21T19:40:00Z",
                source: "regents-cli",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const output = await captureOutput(() =>
      runCliEntrypoint(["agentbook", "register", "--watch", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:4000/api/agentbook/sessions/sess_1");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("http://127.0.0.1:4000/api/agentbook/sessions/sess_1");
    expect(parsePrintedJson<{ session: { status: string; trust: { unique_agent_count: number } } }>(output.stdout))
      .toMatchObject({
        session: {
          status: "registered",
          trust: { unique_agent_count: 2 },
        },
      });

    const receipt = JSON.parse(
      fs.readFileSync(path.join(tempDir, ".regent", "identity", "receipt-v1.json"), "utf8"),
    ) as {
      world?: {
        human_id: string;
        connected_at: string;
        source: string;
        platform_session_id: string;
      };
    };

    expect(receipt.world).toEqual({
      human_id: "0x1234",
      connected_at: "2026-04-21T19:40:00Z",
      source: "regents-cli",
      platform_session_id: "sess_1",
    });
  });

  it("looks up the saved trust summary for the current Regent identity", async () => {
    writeAgentAuthState();

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            wallet_address: TEST_WALLET,
            chain_id: 84532,
            registry_address: TEST_REGISTRY,
            token_id: "99",
            connected: true,
            world_human_id: "0x1234",
            unique_agent_count: 2,
            connected_at: "2026-04-21T19:40:00Z",
            source: "regents-cli",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint(["agentbook", "lookup", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4000/api/agentbook/lookup");
    expect(parsePrintedJson<{ result: { world_human_id: string; unique_agent_count: number } }>(output.stdout))
      .toMatchObject({
        result: {
          world_human_id: "0x1234",
          unique_agent_count: 2,
        },
      });
  });

  it("looks up trust with the signed agent session even when the local receipt file is missing", async () => {
    writeAgentAuthState();
    fs.rmSync(path.join(tempDir, ".regent", "identity", "receipt-v1.json"));

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            wallet_address: TEST_WALLET,
            chain_id: 84532,
            registry_address: TEST_REGISTRY,
            token_id: "99",
            connected: false,
            world_human_id: null,
            unique_agent_count: 0,
            connected_at: null,
            source: null,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint(["agentbook", "lookup", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4000/api/agentbook/lookup");
  });

  it("rejects non-positive interval values for sessions watch", async () => {
    writeAgentAuthState();
    const { runAgentbookSessionsWatch } = await import("../../src/commands/agentbook.js");

    await expect(
      runAgentbookSessionsWatch(
        parseCliArgs(["agentbook", "sessions", "watch", "sess_1", "--interval", "0"]),
        configPath,
      ),
    ).rejects.toThrow("--interval must be a positive number");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
