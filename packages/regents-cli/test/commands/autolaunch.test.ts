import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCliEntrypoint } from "../../src/index.js";
import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const {
  writeContractMock,
  waitForReceiptMock,
  sendTransactionMock,
  safeInitMock,
  getSafeAddressFromDeploymentTxMock,
} = vi.hoisted(() => ({
  writeContractMock: vi.fn(),
  waitForReceiptMock: vi.fn(),
  sendTransactionMock: vi.fn(),
  safeInitMock: vi.fn(),
  getSafeAddressFromDeploymentTxMock: vi.fn(),
}));

const { buildAgentAuthHeadersMock } = vi.hoisted(() => ({
  buildAgentAuthHeadersMock: vi.fn(),
}));

vi.mock("../../src/commands/agent-auth.js", () => ({
  buildAgentAuthHeaders: buildAgentAuthHeadersMock,
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: (privateKey: string) => ({
    address:
      privateKey ===
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        ? "0x00000000000000000000000000000000000000aa"
        : "0x00000000000000000000000000000000000000bb",
    signMessage: async () => "0xsigned",
  }),
}));

vi.mock("viem/chains", () => ({
  base: { id: 8453, name: "Base" },
  baseSepolia: { id: 84532, name: "Base Sepolia" },
}));

vi.mock("viem", () => ({
  http: (url: string) => ({ url }),
  isAddress: (value: string) => /^0x[0-9a-fA-F]{40}$/u.test(value),
  isHex: (value: string) => /^0x[0-9a-fA-F]*$/u.test(value),
  createWalletClient: () => ({
    writeContract: writeContractMock,
    sendTransaction: sendTransactionMock,
  }),
  createPublicClient: () => ({
    waitForTransactionReceipt: waitForReceiptMock,
  }),
  parseEventLogs: () => [
    {
      args: {
        agentId: 42n,
      },
    },
  ],
}));

vi.mock("@safe-global/protocol-kit", () => ({
  __esModule: true,
  default: {
    init: safeInitMock,
  },
  getSafeAddressFromDeploymentTx: getSafeAddressFromDeploymentTxMock,
}));

describe("autolaunch CLI command group", () => {
  const expectedBaseUrl = "http://127.0.0.1:4010";
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn<typeof fetch>();
  const tempDirs: string[] = [];
  const expectedAgentWallet = "0x00000000000000000000000000000000000000aa";

  const createConfigPath = () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "regents-cli-autolaunch-"),
    );
    tempDirs.push(tempDir);

    const configPath = path.join(tempDir, "regent.config.json");
    writeInitialConfig(configPath);
    return configPath;
  };

  const assertLaunchRequestBody = (
    body: unknown,
    expected: Record<string, unknown>,
  ) => {
    const payload = JSON.parse(String(body)) as Record<string, unknown>;

    const containsLegacyLaunchField = (value: unknown): boolean => {
      if (!value || typeof value !== "object") {
        return false;
      }

      if (Array.isArray(value)) {
        return value.some(containsLegacyLaunchField);
      }

      return Object.entries(value as Record<string, unknown>).some(
        ([key, nested]) =>
          key.includes("treasury") ||
          key.includes("recovery") ||
          containsLegacyLaunchField(nested),
      );
    };

    expect(payload).toMatchObject(expected);
    expect(containsLegacyLaunchField(payload)).toBe(false);
  };

  const assertAgentAuthHeaders = (headers: Headers | undefined) => {
    expect(headers?.get("x-siwa-receipt")).toBe("receipt_123");
    expect(headers?.get("x-key-id")).toBe(expectedAgentWallet);
    expect(headers?.get("x-agent-wallet-address")).toBe(expectedAgentWallet);
    expect(headers?.get("x-agent-chain-id")).toBe("84532");
    expect(headers?.get("signature")).toBe("sig1=:ZmFrZQ==:");
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env = { ...originalEnv };
    delete process.env.AUTOLAUNCH_SESSION_COOKIE;
    delete process.env.AUTOLAUNCH_PRIVY_BEARER_TOKEN;
    delete process.env.AUTOLAUNCH_DISPLAY_NAME;
    delete process.env.AUTOLAUNCH_WALLET_ADDRESS;
    delete process.env.AUTOLAUNCH_AGENT_PRIVATE_KEY;
    delete process.env.BASE_SEPOLIA_RPC_URL;
    delete process.env.AUTOLAUNCH_ERC8004_SUBGRAPH_URL;
    delete process.env.AUTOLAUNCH_IDENTITY_REGISTRY_ADDRESS;
    fetchMock.mockReset();
    buildAgentAuthHeadersMock.mockReset();
    writeContractMock.mockReset();
    waitForReceiptMock.mockReset();
    sendTransactionMock.mockReset();
    safeInitMock.mockReset();
    getSafeAddressFromDeploymentTxMock.mockReset();

    sendTransactionMock.mockResolvedValue(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    waitForReceiptMock.mockResolvedValue({ logs: [] });
    getSafeAddressFromDeploymentTxMock.mockReturnValue(
      "0x4444444444444444444444444444444444444444",
    );
    process.env.AUTOLAUNCH_ERC8004_SUBGRAPH_URL =
      "https://erc8004.example/graphql";
    process.env.AUTOLAUNCH_IDENTITY_REGISTRY_ADDRESS =
      "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432";
    buildAgentAuthHeadersMock.mockResolvedValue({
      "x-siwa-receipt": "receipt_123",
      "x-key-id": expectedAgentWallet,
      "x-agent-wallet-address": expectedAgentWallet,
      "x-agent-chain-id": "84532",
      "signature-input":
        'sig1=("@method" "@path");created=1700000000;expires=1700000120;nonce="sig-nonce-fixed";keyid="0x00000000000000000000000000000000000000aa"',
      signature: "sig1=:ZmFrZQ==:",
    });
    safeInitMock.mockResolvedValue({
      getAddress: vi
        .fn()
        .mockResolvedValue("0x4444444444444444444444444444444444444444"),
      isSafeDeployed: vi.fn().mockResolvedValue(false),
      createSafeDeploymentTransaction: vi.fn().mockResolvedValue({
        to: "0x5555555555555555555555555555555555555555",
        data: "0xabcdef",
        value: "0",
      }),
      getContractVersion: vi.fn().mockReturnValue("1.4.1"),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("lists active auctions via regents autolaunch", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          items: [
            {
              id: "auc_1",
              agent_id: "84532:42",
              agent_name: "Atlas",
              symbol: "ATLAS",
              chain: "base-sepolia",
              chain_id: 84532,
              status: "active",
              bidders: 2,
              current_clearing_price: "1000000",
              total_bid_volume: "5000000",
              trust: {
                erc8004: {
                  connected: true,
                  token_id: "42",
                  chain_id: 84532,
                },
                ens: {
                  connected: true,
                  name: "atlas.eth",
                },
                world: {
                  connected: false,
                  network: "world",
                  human_id: null,
                  launch_count: 0,
                },
                x: {
                  connected: true,
                  handle: "atlas_agent",
                  profile_url: "https://x.com/atlas_agent",
                  verified_at: "2026-03-29T12:00:00Z",
                },
              },
            },
          ],
          generated_at: "2026-03-29T12:00:00Z",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "auctions",
        "list",
        "--status",
        "active",
        "--sort",
        "recently_launched",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/auctions?sort=recently_launched&status=active`,
    );
    expect(
      parsePrintedJson<{
        items: Array<{ id: string; trust: { x: { handle: string | null } } }>;
      }>(output.stdout),
    ).toMatchObject({
      items: [{ id: "auc_1", trust: { x: { handle: "atlas_agent" } } }],
    });
  });

  it("supports non-numeric agent ids for autolaunch agent show/readiness routes", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, agent: { id: "agent:alpha" } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, readiness: { ready: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const showOutput = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "agent", "agent:alpha"]),
    );
    const readinessOutput = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "agent", "readiness", "agent:alpha"]),
    );

    expect(showOutput.result).toBe(0);
    expect(readinessOutput.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/agents/agent%3Aalpha`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/agents/agent%3Aalpha/readiness`,
    );
    expect(parsePrintedJson<{ ok: boolean }>(showOutput.stdout)).toMatchObject({
      ok: true,
    });
    expect(
      parsePrintedJson<{ ok: boolean }>(readinessOutput.stdout),
    ).toMatchObject({ ok: true });
  });

  it("plans an ENS link through the shared autolaunch API", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          plan: { verify_status: "ens_record_missing" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "ens",
        "plan",
        "--ens",
        "vitalik.eth",
        "--identity",
        "1:42",
        "--include-reverse",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/ens/link/plan`,
    );
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      ens_name: "vitalik.eth",
      identity_id: "1:42",
      include_reverse: true,
    });
    expect(
      parsePrintedJson<{ ok: boolean; plan: { verify_status: string } }>(
        output.stdout,
      ),
    ).toEqual({
      ok: true,
      plan: { verify_status: "ens_record_missing" },
    });
  });

  it("passes through the optional reputation prompt on launch preview", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          reputation_prompt: {
            prompt:
              "To improve agent token reputation, you can optionally link an ENS name and/or connect to a human's World ID.",
            warning:
              "You can skip this, though the token launch may be less trusted until these links are added.",
            skip_label: "Skip for now",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "launch",
        "preview",
        "--agent",
        "1:42",
        "--chain-id",
        "84532",
        "--name",
        "Atlas Coin",
        "--symbol",
        "ATLAS",
        "--minimum-raise-usdc",
        "10000",
        "--agent-safe-address",
        "0x1111111111111111111111111111111111111111",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/launch/preview`,
    );
    const [, previewRequest] = fetchMock.mock.calls[0] ?? [];
    assertLaunchRequestBody(previewRequest?.body, {
      agent_id: "1:42",
      chain_id: 84532,
      token_name: "Atlas Coin",
      token_symbol: "ATLAS",
      agent_safe_address: "0x1111111111111111111111111111111111111111",
      minimum_raise_usdc: "10000",
    });
    expect(
      parsePrintedJson<{ reputation_prompt: { skip_label: string } }>(
        output.stdout,
      ),
    ).toMatchObject({
      reputation_prompt: {
        skip_label: "Skip for now",
      },
    });
  });

  it("passes through the launch create body with the agent safe address", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          launch: { job_id: "job_alpha" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "launch",
        "create",
        "--agent",
        "1:42",
        "--chain-id",
        "84532",
        "--name",
        "Atlas Coin",
        "--symbol",
        "ATLAS",
        "--minimum-raise-usdc",
        "10000",
        "--agent-safe-address",
        "0x1111111111111111111111111111111111111111",
        "--wallet-address",
        "0x2222222222222222222222222222222222222222",
        "--nonce",
        "nonce_alpha",
        "--message",
        "message_alpha",
        "--signature",
        "signature_alpha",
        "--issued-at",
        "2026-03-29T12:00:00Z",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/launch/jobs`,
    );
    const [, createRequest] = fetchMock.mock.calls[0] ?? [];
    assertLaunchRequestBody(createRequest?.body, {
      agent_id: "1:42",
      chain_id: 84532,
      token_name: "Atlas Coin",
      token_symbol: "ATLAS",
      agent_safe_address: "0x1111111111111111111111111111111111111111",
      minimum_raise_usdc: "10000",
      wallet_address: "0x2222222222222222222222222222222222222222",
      nonce: "nonce_alpha",
      message: "message_alpha",
      signature: "signature_alpha",
      issued_at: "2026-03-29T12:00:00Z",
    });
  });

  it("prepares bidirectional ENS link transactions through autolaunch", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          prepared: {
            ensip25: { tx: { to: "0xresolver" } },
            erc8004: { tx: { to: "0xregistry" } },
            reverse: { tx: { to: "0xreverse" } },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "ens",
        "prepare-bidirectional",
        "--ens",
        "vitalik.eth",
        "--chain-id",
        "84532",
        "--agent-id",
        "42",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/ens/link/prepare-bidirectional`,
    );
    expect(
      parsePrintedJson<{
        ok: boolean;
        prepared: { ensip25: { tx: { to: string } } };
      }>(output.stdout),
    ).toMatchObject({
      ok: true,
      prepared: {
        ensip25: { tx: { to: "0xresolver" } },
      },
    });
  });

  it("shows subject revenue state through the shared autolaunch API", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          subject: {
            subject_id: "0xabc",
            splitter_address: "0x9999999999999999999999999999999999999999",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "subjects", "show", "0xabc"]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/subjects/0xabc`,
    );
    expect(
      parsePrintedJson<{ subject: { subject_id: string } }>(output.stdout),
    ).toMatchObject({
      subject: { subject_id: "0xabc" },
    });
  });

  it("prepares strategy migration through the contracts API", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          prepared: {
            resource: "strategy",
            action: "migrate",
            tx_request: { data: "0x8fd3ab80" },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "strategy",
        "migrate",
        "--job",
        "job_123",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/contracts/jobs/job_123/strategy/migrate/prepare`,
    );
    expect(
      parsePrintedJson<{ prepared: { action: string } }>(output.stdout),
    ).toMatchObject({
      prepared: { action: "migrate" },
    });
  });

  it("prepares factory authorized creator changes through the contracts API", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          prepared: {
            resource: "revenue_share_factory",
            action: "set_authorized_creator",
            tx_request: { data: "0xe1434f4e" },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "factory",
        "revenue-share",
        "set-authorized-creator",
        "--account",
        "0x00000000000000000000000000000000000000aa",
        "--enabled",
        "true",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/contracts/admin/revenue_share_factory/set_authorized_creator/prepare`,
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      account: "0x00000000000000000000000000000000000000aa",
      enabled: "true",
    });
    expect(
      parsePrintedJson<{ prepared: { resource: string } }>(output.stdout),
    ).toMatchObject({
      prepared: { resource: "revenue_share_factory" },
    });
  });

  it("lists ERC-8004 identities for a wallet owner", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              agents: [
                {
                  chainId: "84532",
                  agentId: "77",
                  owner: "0x00000000000000000000000000000000000000aa",
                  operators: [],
                  agentWallet: null,
                  registrationFile: { name: "Owned Agent", active: true },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { agents: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { agents: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "identities",
        "list",
        "--chain",
        "base-sepolia",
        "--owner",
        "0x00000000000000000000000000000000000000aa",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      parsePrintedJson<{ launchable: Array<{ agent_id: string }> }>(
        output.stdout,
      ),
    ).toMatchObject({
      ok: true,
      chain_id: 84532,
      owner_address: "0x00000000000000000000000000000000000000aa",
      launchable: [{ agent_id: "84532:77" }],
    });
  });

  it("lists ERC-8004 identities through the techtree namespace", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              agents: [
                {
                  chainId: "84532",
                  agentId: "88",
                  owner: "0x00000000000000000000000000000000000000aa",
                  operators: [],
                  agentWallet: null,
                  registrationFile: { name: "Techtree Agent", active: true },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { agents: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { agents: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "techtree",
        "identities",
        "list",
        "--chain",
        "base-sepolia",
        "--owner",
        "0x00000000000000000000000000000000000000aa",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      parsePrintedJson<{ launchable: Array<{ agent_id: string }> }>(
        output.stdout,
      ),
    ).toMatchObject({
      ok: true,
      chain_id: 84532,
      owner_address: "0x00000000000000000000000000000000000000aa",
      launchable: [{ agent_id: "84532:88" }],
    });
  });

  it("mints an ERC-8004 identity and reports the new agent id", async () => {
    process.env.AUTOLAUNCH_AGENT_PRIVATE_KEY =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.sepolia.example";
    writeContractMock.mockResolvedValue("0xfeed");
    waitForReceiptMock.mockResolvedValue({
      blockNumber: 123n,
      logs: [],
    });
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "identities",
        "mint",
        "--chain",
        "base-sepolia",
        "--agent-uri",
        "https://agents.example/alpha.json",
      ]),
    );

    expect(output.result).toBe(0);
    expect(writeContractMock).toHaveBeenCalledTimes(1);
    expect(
      parsePrintedJson<{ agent_id: string | null; chain_id: number }>(
        output.stdout,
      ),
    ).toMatchObject({
      ok: true,
      chain_id: 84532,
      agent_id: "84532:42",
      owner_address: "0x00000000000000000000000000000000000000aa",
      agent_uri: "https://agents.example/alpha.json",
    });
  });

  it("mints an ERC-8004 identity through the techtree namespace", async () => {
    process.env.AUTOLAUNCH_AGENT_PRIVATE_KEY =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.sepolia.example";
    writeContractMock.mockResolvedValue("0xbeef");
    waitForReceiptMock.mockResolvedValue({
      blockNumber: 456n,
      logs: [],
    });
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "techtree",
        "identities",
        "mint",
        "--chain",
        "base-sepolia",
      ]),
    );

    expect(output.result).toBe(0);
    expect(writeContractMock).toHaveBeenCalledTimes(1);
    expect(
      parsePrintedJson<{ agent_id: string | null; chain_id: number }>(
        output.stdout,
      ),
    ).toMatchObject({
      ok: true,
      chain_id: 84532,
      agent_id: "84532:42",
      owner_address: "0x00000000000000000000000000000000000000aa",
      agent_uri: null,
    });
  });

  it("maps Base-family chain names to chain ids and signs launch preview requests", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, preview: { launch_ready: true } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "launch",
        "preview",
        "--agent",
        "ag_123",
        "--chain",
        "base-sepolia",
        "--name",
        "Agent Coin",
        "--symbol",
        "AGENT",
        "--minimum-raise-usdc",
        "2500",
        "--agent-safe-address",
        "0x0000000000000000000000000000000000000001",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    assertAgentAuthHeaders(requestInit?.headers as Headers);
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      agent_id: "ag_123",
      chain_id: 84532,
      token_name: "Agent Coin",
      token_symbol: "AGENT",
    });
  });

  it("rejects non-positive interval values for autolaunch jobs watch", async () => {
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "jobs",
        "watch",
        "job_123",
        "--interval",
        "0",
      ]),
    );

    expect(output.result).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      parsePrintedJson<{ error: { message: string } }>(output.stderr),
    ).toEqual({
      error: {
        message: "--interval must be a positive number",
      },
    });
  });

  it("rejects autolaunch job watch requests without a signed-in session", async () => {
    buildAgentAuthHeadersMock.mockRejectedValueOnce(
      new Error("Run `regents identity ensure` before using this command."),
    );
    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "jobs", "watch", "job_123"]),
    );

    expect(output.result).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(output.stderr).toContain(
      "Run `regents identity ensure` before using this command.",
    );
  });

  it("attaches signed agent auth headers when watching an autolaunch job", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          job: { job_id: "job_123", status: "ready" },
          auction: { auction_id: "auc_123" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "jobs", "watch", "job_123"]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/launch/jobs/job_123`,
    );
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    assertAgentAuthHeaders(requestInit?.headers as Headers);
    expect(
      parsePrintedJson<{ job: { job_id: string; status: string } }>(
        output.stdout,
      ),
    ).toMatchObject({
      job: { job_id: "job_123", status: "ready" },
    });
  });

  it("guides a prelaunch wizard flow and saves the local plan", async () => {
    const configPath = createConfigPath();

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            plan: {
              plan_id: "plan_alpha",
              state: "draft",
              agent_id: "84532:42",
              metadata_draft: { title: "Atlas Launch" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            asset: {
              asset_id: "asset_alpha",
              public_url: "/prelaunch-assets/asset_alpha.png",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            plan: {
              plan_id: "plan_alpha",
              state: "draft",
              metadata_draft: {
                title: "Atlas Launch",
                image_url: "/prelaunch-assets/asset_alpha.png",
                image_asset_id: "asset_alpha",
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
            plan: {
              plan_id: "plan_alpha",
              state: "launchable",
              validation_summary: { launchable: true },
            },
            validation: { launchable: true, blockers: [], warnings: [] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "prelaunch",
        "wizard",
        "--config",
        configPath,
        "--agent",
        "84532:42",
        "--name",
        "Atlas Coin",
        "--symbol",
        "ATLAS",
        "--minimum-raise-usdc",
        "10000",
        "--agent-safe-address",
        "0x1111111111111111111111111111111111111111",
        "--title",
        "Atlas Launch",
        "--description",
        "Prepare the Atlas coin launch.",
        "--image-url",
        "https://cdn.example/atlas.png",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/prelaunch/plans`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/prelaunch/assets`,
    );
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/prelaunch/plans/plan_alpha/validate`,
    );
    assertLaunchRequestBody(fetchMock.mock.calls[0]?.[1]?.body, {
      agent_id: "84532:42",
      token_name: "Atlas Coin",
      token_symbol: "ATLAS",
      minimum_raise_usdc: "10000",
      agent_safe_address: "0x1111111111111111111111111111111111111111",
      metadata_draft: {
        title: "Atlas Launch",
        description: "Prepare the Atlas coin launch.",
      },
    });

    const localPlan = JSON.parse(
      fs.readFileSync(
        path.join(
          path.dirname(configPath),
          "state",
          "autolaunch-plans",
          "plan_alpha.json",
        ),
        "utf8",
      ),
    ) as { plan_id: string; remote_plan: { state: string } };

    expect(localPlan.plan_id).toBe("plan_alpha");
    expect(localPlan.remote_plan.state).toBe("launchable");
    expect(
      parsePrintedJson<{ validation: { launchable: boolean } }>(output.stdout),
    ).toMatchObject({
      validation: { launchable: true },
    });
  });

  it("guides Safe setup and lets the operator wait for the website wallet", async () => {
    const configPath = createConfigPath();
    process.env.REGENT_WALLET_PRIVATE_KEY =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "safe",
        "wizard",
        "--config",
        configPath,
        "--backup-signer-address",
        "0x3333333333333333333333333333333333333333",
        "--wait-for-website-wallet",
      ]),
    );

    expect(output.result).toBe(0);
    expect(parsePrintedJson(output.stdout)).toMatchObject({
      ok: true,
      status: "waiting_for_website_wallet",
      launch_ready: false,
      threshold: "2-of-3",
      agent_safe_address: null,
      signers: {
        agent: {
          address: "0x00000000000000000000000000000000000000aa",
          source: "config",
        },
        website: {
          address: null,
          source: "missing",
        },
        backup: {
          address: "0x3333333333333333333333333333333333333333",
          source: "flag",
        },
      },
    });
  });

  it("guides Safe setup when all three signers and the Safe are ready", async () => {
    const configPath = createConfigPath();
    process.env.REGENT_WALLET_PRIVATE_KEY =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.AUTOLAUNCH_WALLET_ADDRESS =
      "0x2222222222222222222222222222222222222222";
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "safe",
        "wizard",
        "--config",
        configPath,
        "--backup-signer-address",
        "0x3333333333333333333333333333333333333333",
        "--agent-safe-address",
        "0x4444444444444444444444444444444444444444",
      ]),
    );

    expect(output.result).toBe(0);
    expect(parsePrintedJson(output.stdout)).toMatchObject({
      ok: true,
      status: "ready_for_launch",
      launch_ready: true,
      threshold: "2-of-3",
      agent_safe_address: "0x4444444444444444444444444444444444444444",
      signers: {
        agent: {
          address: "0x00000000000000000000000000000000000000aa",
          source: "config",
        },
        website: {
          address: "0x2222222222222222222222222222222222222222",
          source: "env",
        },
        backup: {
          address: "0x3333333333333333333333333333333333333333",
          source: "flag",
        },
      },
    });
  });

  it("creates a Safe on Base Sepolia through the autolaunch CLI", async () => {
    const configPath = createConfigPath();
    process.env.REGENT_WALLET_PRIVATE_KEY =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.AUTOLAUNCH_WALLET_ADDRESS =
      "0x2222222222222222222222222222222222222222";
    process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.sepolia.example";
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "safe",
        "create",
        "--config",
        configPath,
        "--backup-signer-address",
        "0x3333333333333333333333333333333333333333",
        "--salt-nonce",
        "12345",
      ]),
    );

    expect(output.result).toBe(0);
    expect(safeInitMock).toHaveBeenCalledWith({
      provider: "https://rpc.sepolia.example",
      signer:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      predictedSafe: {
        safeAccountConfig: {
          owners: [
            "0x00000000000000000000000000000000000000aa",
            "0x2222222222222222222222222222222222222222",
            "0x3333333333333333333333333333333333333333",
          ],
          threshold: 2,
        },
        safeDeploymentConfig: {
          saltNonce: "12345",
        },
      },
    });
    expect(sendTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "0x5555555555555555555555555555555555555555",
        data: "0xabcdef",
        value: 0n,
      }),
    );
    expect(parsePrintedJson(output.stdout)).toMatchObject({
      ok: true,
      status: "created",
      network: "base-sepolia",
      chain_id: 84532,
      threshold: "2-of-3",
      safe_address: "0x4444444444444444444444444444444444444444",
      deployment_tx_hash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("returns the existing Safe address if that Safe is already deployed", async () => {
    const configPath = createConfigPath();
    process.env.REGENT_WALLET_PRIVATE_KEY =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.AUTOLAUNCH_WALLET_ADDRESS =
      "0x2222222222222222222222222222222222222222";
    process.env.BASE_SEPOLIA_RPC_URL = "https://rpc.sepolia.example";

    safeInitMock.mockResolvedValueOnce({
      getAddress: vi
        .fn()
        .mockResolvedValue("0x4444444444444444444444444444444444444444"),
      isSafeDeployed: vi.fn().mockResolvedValue(true),
      createSafeDeploymentTransaction: vi.fn(),
      getContractVersion: vi.fn().mockReturnValue("1.4.1"),
    });
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "safe",
        "create",
        "--config",
        configPath,
        "--backup-signer-address",
        "0x3333333333333333333333333333333333333333",
        "--salt-nonce",
        "12345",
      ]),
    );

    expect(output.result).toBe(0);
    expect(sendTransactionMock).not.toHaveBeenCalled();
    expect(parsePrintedJson(output.stdout)).toMatchObject({
      ok: true,
      status: "already_deployed",
      safe_address: "0x4444444444444444444444444444444444444444",
      deployment_tx_hash: null,
    });
  });

  it("tells the launch wizard to use the Safe wizard first when no Safe is provided", async () => {
    const configPath = createConfigPath();
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "prelaunch",
        "wizard",
        "--config",
        configPath,
        "--agent",
        "84532:42",
        "--name",
        "Atlas Coin",
        "--symbol",
        "ATLAS",
        "--minimum-raise-usdc",
        "10000",
      ]),
    );

    expect(output.result).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      parsePrintedJson<{ error: { message: string } }>(output.stderr),
    ).toEqual({
      error: {
        message:
          "Agent Safe is required. Run `regents autolaunch safe wizard` first, then rerun with --agent-safe-address <safe>.",
      },
    });
  });

  it("runs a launch from a saved plan and watches the job once", async () => {
    const configPath = createConfigPath();
    process.env.REGENT_WALLET_PRIVATE_KEY =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const planDir = path.join(
      path.dirname(configPath),
      "state",
      "autolaunch-plans",
    );
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(
      path.join(planDir, "plan_alpha.json"),
      `${JSON.stringify({
        plan_id: "plan_alpha",
        saved_at: "2026-03-27T00:00:00Z",
        remote_plan: {
          plan_id: "plan_alpha",
          fallback_operator_wallet:
            "0x00000000000000000000000000000000000000aa",
        },
      })}\n`,
      "utf8",
    );

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            plan: {
              plan_id: "plan_alpha",
              fallback_operator_wallet:
                "0x00000000000000000000000000000000000000aa",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            plan: { plan_id: "plan_alpha", state: "launchable" },
            validation: { launchable: true },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { nonce: "nonce_alpha" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            plan: {
              plan_id: "plan_alpha",
              state: "launched",
              launch_job_id: "job_alpha",
            },
            launch: { job_id: "job_alpha" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            job: { job_id: "job_alpha", status: "ready" },
            auction: { auction_id: "auc_alpha" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "launch",
        "run",
        "--config",
        configPath,
        "--plan",
        "plan_alpha",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/prelaunch/plans/plan_alpha`,
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/siwa/nonce`,
    );
    const siwaNonceRequest = fetchMock.mock.calls[2]?.[1];
    expect(JSON.parse(String(siwaNonceRequest?.body))).toEqual({
      wallet_address: "0x00000000000000000000000000000000000000aa",
      chain_id: 84532,
      audience: "autolaunch",
    });
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/prelaunch/plans/plan_alpha/launch`,
    );
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/launch/jobs/job_alpha`,
    );
    expect(
      parsePrintedJson<{ job: { job_id: string; status: string } }>(
        output.stdout,
      ),
    ).toMatchObject({
      job: { job_id: "job_alpha", status: "ready" },
    });
  });

  it("shows lifecycle monitor, finalize, and vesting status through the new golden path", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            job: { job_id: "job_alpha", status: "ready" },
            recommended_action: "migrate",
            migrate_ready: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            recommended_action: "migrate",
            prepared: {
              action: "migrate",
              tx_request: { data: "0x8fd3ab80" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            job_id: "job_alpha",
            vesting_wallet_address:
              "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            release_ready: true,
            releasable_launch_token: 25,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const monitorOutput = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "launch",
        "monitor",
        "--job",
        "job_alpha",
      ]),
    );
    const finalizeOutput = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "launch",
        "finalize",
        "--job",
        "job_alpha",
      ]),
    );
    const vestingOutput = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "vesting",
        "status",
        "--job",
        "job_alpha",
      ]),
    );

    expect(monitorOutput.result).toBe(0);
    expect(finalizeOutput.result).toBe(0);
    expect(vestingOutput.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/lifecycle/jobs/job_alpha`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/lifecycle/jobs/job_alpha/finalize/prepare`,
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/lifecycle/jobs/job_alpha/vesting`,
    );
    expect(
      parsePrintedJson<{ recommended_action: string }>(monitorOutput.stdout),
    ).toMatchObject({
      recommended_action: "migrate",
    });
    expect(
      parsePrintedJson<{ prepared: { action: string } }>(finalizeOutput.stdout),
    ).toMatchObject({
      prepared: { action: "migrate" },
    });
    expect(
      parsePrintedJson<{ release_ready: boolean }>(vestingOutput.stdout),
    ).toMatchObject({
      release_ready: true,
    });
  });
});
