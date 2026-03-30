import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const { writeContractMock, waitForReceiptMock } = vi.hoisted(() => ({
  writeContractMock: vi.fn(),
  waitForReceiptMock: vi.fn(),
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: (privateKey: string) => ({
    address:
      privateKey === "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        ? "0x00000000000000000000000000000000000000aa"
        : "0x00000000000000000000000000000000000000bb",
    signMessage: async () => "0xsigned",
  }),
}));

vi.mock("viem/chains", () => ({
  mainnet: { id: 1, name: "Ethereum" },
  sepolia: { id: 11155111, name: "Sepolia" },
}));

vi.mock("viem", () => ({
  http: (url: string) => ({ url }),
  createWalletClient: () => ({
    writeContract: writeContractMock,
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

describe("autolaunch CLI command group", () => {
  const expectedBaseUrl = "http://127.0.0.1:4010";
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn<typeof fetch>();
  const tempDirs: string[] = [];

  const createConfigPath = () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regent-cli-autolaunch-"));
    tempDirs.push(tempDir);

    const configPath = path.join(tempDir, "regent.config.json");
    writeInitialConfig(configPath);
    return configPath;
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env = { ...originalEnv };
    delete process.env.AUTOLAUNCH_SESSION_COOKIE;
    delete process.env.AUTOLAUNCH_PRIVY_BEARER_TOKEN;
    delete process.env.AUTOLAUNCH_DISPLAY_NAME;
    delete process.env.AUTOLAUNCH_WALLET_ADDRESS;
    delete process.env.AUTOLAUNCH_AGENT_PRIVATE_KEY;
    delete process.env.ETH_SEPOLIA_RPC_URL;
    fetchMock.mockReset();
    writeContractMock.mockReset();
    waitForReceiptMock.mockReset();
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

  it("lists active auctions via regent autolaunch", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, items: [{ auction_id: "auc_1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { runCliEntrypoint } = await import("../../src/index.js");
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
      `${expectedBaseUrl}/api/auctions?sort=recently_launched&status=active`,
    );
    expect(parsePrintedJson<{ ok: boolean }>(output.stdout)).toEqual({
      ok: true,
      items: [{ auction_id: "auc_1" }],
    });
  });

  it("supports non-numeric agent ids for autolaunch agent show/readiness routes", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, agent: { id: "agent:alpha" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, readiness: { ready: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const { runCliEntrypoint } = await import("../../src/index.js");
    const showOutput = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "agent", "agent:alpha"]),
    );
    const readinessOutput = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "agent", "readiness", "agent:alpha"]),
    );

    expect(showOutput.result).toBe(0);
    expect(readinessOutput.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/api/agents/agent%3Aalpha`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${expectedBaseUrl}/api/agents/agent%3Aalpha/readiness`,
    );
    expect(parsePrintedJson<{ ok: boolean }>(showOutput.stdout)).toMatchObject({ ok: true });
    expect(parsePrintedJson<{ ok: boolean }>(readinessOutput.stdout)).toMatchObject({ ok: true });
  });

  it("plans an ENS link through the shared autolaunch API", async () => {
    process.env.AUTOLAUNCH_SESSION_COOKIE = "_autolaunch_key=abc";

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, plan: { verify_status: "ens_record_missing" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { runCliEntrypoint } = await import("../../src/index.js");
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/api/ens/link/plan`);
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      ens_name: "vitalik.eth",
      identity_id: "1:42",
      include_reverse: true,
    });
    expect(parsePrintedJson<{ ok: boolean; plan: { verify_status: string } }>(output.stdout)).toEqual({
      ok: true,
      plan: { verify_status: "ens_record_missing" },
    });
  });

  it("passes through the optional reputation prompt on launch preview", async () => {
    process.env.AUTOLAUNCH_SESSION_COOKIE = "_autolaunch_key=abc";

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

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "launch",
        "preview",
        "--agent",
        "1:42",
        "--chain-id",
        "11155111",
        "--name",
        "Atlas Coin",
        "--symbol",
        "ATLAS",
        "--treasury-address",
        "0x1111111111111111111111111111111111111111",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/api/launch/preview`);
    expect(
      parsePrintedJson<{ reputation_prompt: { skip_label: string } }>(output.stdout),
    ).toMatchObject({
      reputation_prompt: {
        skip_label: "Skip for now",
      },
    });
  });

  it("prepares bidirectional ENS link transactions through autolaunch", async () => {
    process.env.AUTOLAUNCH_SESSION_COOKIE = "_autolaunch_key=abc";

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

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "ens",
        "prepare-bidirectional",
        "--ens",
        "vitalik.eth",
        "--chain-id",
        "11155111",
        "--agent-id",
        "42",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/api/ens/link/prepare-bidirectional`,
    );
    expect(parsePrintedJson<{ ok: boolean; prepared: { ensip25: { tx: { to: string } } } }>(output.stdout)).toMatchObject({
      ok: true,
      prepared: {
        ensip25: { tx: { to: "0xresolver" } },
      },
    });
  });

  it("shows subject revenue state through the shared autolaunch API", async () => {
    process.env.AUTOLAUNCH_SESSION_COOKIE = "_autolaunch_key=abc";

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          subject: { subject_id: "0xabc", splitter_address: "0x9999999999999999999999999999999999999999" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "subjects", "show", "0xabc"]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/api/subjects/0xabc`);
    expect(parsePrintedJson<{ subject: { subject_id: string } }>(output.stdout)).toMatchObject({
      subject: { subject_id: "0xabc" },
    });
  });

  it("prepares strategy migration through the contracts API", async () => {
    process.env.AUTOLAUNCH_SESSION_COOKIE = "_autolaunch_key=abc";

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

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "strategy", "migrate", "--job", "job_123"]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/api/contracts/jobs/job_123/strategy/migrate/prepare`,
    );
    expect(parsePrintedJson<{ prepared: { action: string } }>(output.stdout)).toMatchObject({
      prepared: { action: "migrate" },
    });
  });

  it("prepares factory authorized creator changes through the contracts API", async () => {
    process.env.AUTOLAUNCH_SESSION_COOKIE = "_autolaunch_key=abc";

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

    const { runCliEntrypoint } = await import("../../src/index.js");
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
      `${expectedBaseUrl}/api/contracts/admin/revenue_share_factory/set_authorized_creator/prepare`,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      account: "0x00000000000000000000000000000000000000aa",
      enabled: "true",
    });
    expect(parsePrintedJson<{ prepared: { resource: string } }>(output.stdout)).toMatchObject({
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
                  chainId: "11155111",
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

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "identities",
        "list",
        "--chain",
        "sepolia",
        "--owner",
        "0x00000000000000000000000000000000000000aa",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(parsePrintedJson<{ launchable: Array<{ agent_id: string }> }>(output.stdout)).toMatchObject({
      ok: true,
      chain_id: 11155111,
      owner_address: "0x00000000000000000000000000000000000000aa",
      launchable: [{ agent_id: "11155111:77" }],
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
                  chainId: "11155111",
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

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "techtree",
        "identities",
        "list",
        "--chain",
        "sepolia",
        "--owner",
        "0x00000000000000000000000000000000000000aa",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(parsePrintedJson<{ launchable: Array<{ agent_id: string }> }>(output.stdout)).toMatchObject({
      ok: true,
      chain_id: 11155111,
      owner_address: "0x00000000000000000000000000000000000000aa",
      launchable: [{ agent_id: "11155111:88" }],
    });
  });

  it("mints an ERC-8004 identity and reports the new agent id", async () => {
    process.env.AUTOLAUNCH_AGENT_PRIVATE_KEY =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.ETH_SEPOLIA_RPC_URL = "https://rpc.sepolia.example";
    writeContractMock.mockResolvedValue("0xfeed");
    waitForReceiptMock.mockResolvedValue({
      blockNumber: 123n,
      logs: [],
    });

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "identities",
        "mint",
        "--chain",
        "sepolia",
        "--agent-uri",
        "https://agents.example/alpha.json",
      ]),
    );

    expect(output.result).toBe(0);
    expect(writeContractMock).toHaveBeenCalledTimes(1);
    expect(parsePrintedJson<{ agent_id: string | null; chain_id: number }>(output.stdout)).toMatchObject({
      ok: true,
      chain_id: 11155111,
      agent_id: "11155111:42",
      owner_address: "0x00000000000000000000000000000000000000aa",
      agent_uri: "https://agents.example/alpha.json",
    });
  });

  it("mints an ERC-8004 identity through the techtree namespace", async () => {
    process.env.AUTOLAUNCH_AGENT_PRIVATE_KEY =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.ETH_SEPOLIA_RPC_URL = "https://rpc.sepolia.example";
    writeContractMock.mockResolvedValue("0xbeef");
    waitForReceiptMock.mockResolvedValue({
      blockNumber: 456n,
      logs: [],
    });

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "techtree",
        "identities",
        "mint",
        "--chain",
        "sepolia",
      ]),
    );

    expect(output.result).toBe(0);
    expect(writeContractMock).toHaveBeenCalledTimes(1);
    expect(parsePrintedJson<{ agent_id: string | null; chain_id: number }>(output.stdout)).toMatchObject({
      ok: true,
      chain_id: 11155111,
      agent_id: "11155111:42",
      owner_address: "0x00000000000000000000000000000000000000aa",
      agent_uri: null,
    });
  });

  it("maps ethereum sepolia chain names to chain ids and uses session cookie", async () => {
    process.env.AUTOLAUNCH_SESSION_COOKIE = "_autolaunch_key=abc";

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, preview: { launch_ready: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "launch",
        "preview",
        "--agent",
        "ag_123",
        "--chain",
        "ethereum-sepolia",
        "--name",
        "Agent Coin",
        "--symbol",
        "AGENT",
        "--treasury-address",
        "0x0000000000000000000000000000000000000001",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect((requestInit?.headers as Headers).get("cookie")).toBe("_autolaunch_key=abc");
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      agent_id: "ag_123",
      chain_id: "11155111",
      token_name: "Agent Coin",
      token_symbol: "AGENT",
    });
  });

  it("exchanges a Privy bearer token for a session before calling mine bids", async () => {
    process.env.AUTOLAUNCH_PRIVY_BEARER_TOKEN = "privy-token";
    process.env.AUTOLAUNCH_DISPLAY_NAME = "Operator";
    process.env.AUTOLAUNCH_WALLET_ADDRESS = "0x00000000000000000000000000000000000000aa";

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": "_autolaunch_key=session123; Path=/; HttpOnly",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "bids", "mine", "--status", "active"]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/api/auth/privy/session`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${expectedBaseUrl}/api/me/bids?status=active`,
    );
    const secondRequest = fetchMock.mock.calls[1]?.[1];
    expect((secondRequest?.headers as Headers).get("cookie")).toBe("_autolaunch_key=session123");
    expect(parsePrintedJson<{ ok: boolean; items: unknown[] }>(output.stdout)).toEqual({
      ok: true,
      items: [],
    });
  });

  it("rejects non-positive interval values for autolaunch jobs watch", async () => {
    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "jobs", "watch", "job_123", "--interval", "0"]),
    );

    expect(output.result).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(parsePrintedJson<{ error: { message: string } }>(output.stderr)).toEqual({
      error: {
        message: "--interval must be a positive number",
      },
    });
  });

  it("guides a prelaunch wizard flow and saves the local plan", async () => {
    const configPath = createConfigPath();
    process.env.AUTOLAUNCH_SESSION_COOKIE = "_autolaunch_key=abc";

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            plan: {
              plan_id: "plan_alpha",
              state: "draft",
              agent_id: "11155111:42",
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

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "prelaunch",
        "wizard",
        "--config",
        configPath,
        "--agent",
        "11155111:42",
        "--name",
        "Atlas Coin",
        "--symbol",
        "ATLAS",
        "--treasury-safe-address",
        "0x1111111111111111111111111111111111111111",
        "--auction-proceeds-recipient",
        "0x2222222222222222222222222222222222222222",
        "--ethereum-revenue-treasury",
        "0x3333333333333333333333333333333333333333",
        "--backup-safe-address",
        "0x4444444444444444444444444444444444444444",
        "--title",
        "Atlas Launch",
        "--description",
        "Prepare the Atlas coin launch.",
        "--image-url",
        "https://cdn.example/atlas.png",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/api/prelaunch/plans`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${expectedBaseUrl}/api/prelaunch/assets`);
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      `${expectedBaseUrl}/api/prelaunch/plans/plan_alpha/validate`,
    );

    const localPlan = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(configPath), "state", "autolaunch-plans", "plan_alpha.json"),
        "utf8",
      ),
    ) as { plan_id: string; remote_plan: { state: string } };

    expect(localPlan.plan_id).toBe("plan_alpha");
    expect(localPlan.remote_plan.state).toBe("launchable");
    expect(parsePrintedJson<{ validation: { launchable: boolean } }>(output.stdout)).toMatchObject({
      validation: { launchable: true },
    });
  });

  it("runs a launch from a saved plan and watches the job once", async () => {
    const configPath = createConfigPath();
    process.env.AUTOLAUNCH_SESSION_COOKIE = "_autolaunch_key=abc";
    process.env.REGENT_WALLET_PRIVATE_KEY =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    const planDir = path.join(path.dirname(configPath), "state", "autolaunch-plans");
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(
      path.join(planDir, "plan_alpha.json"),
      `${JSON.stringify({
        plan_id: "plan_alpha",
        saved_at: "2026-03-27T00:00:00Z",
        remote_plan: {
          plan_id: "plan_alpha",
          fallback_operator_wallet: "0x00000000000000000000000000000000000000aa",
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
              fallback_operator_wallet: "0x00000000000000000000000000000000000000aa",
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
            plan: { plan_id: "plan_alpha", state: "launched", launch_job_id: "job_alpha" },
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

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "launch", "run", "--config", configPath, "--plan", "plan_alpha"]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/api/prelaunch/plans/plan_alpha`);
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`${expectedBaseUrl}/v1/agent/siwa/nonce`);
    expect(fetchMock.mock.calls[3]?.[0]).toBe(`${expectedBaseUrl}/api/prelaunch/plans/plan_alpha/launch`);
    expect(fetchMock.mock.calls[4]?.[0]).toBe(`${expectedBaseUrl}/api/launch/jobs/job_alpha`);
    expect(parsePrintedJson<{ job: { job_id: string; status: string } }>(output.stdout)).toMatchObject({
      job: { job_id: "job_alpha", status: "ready" },
    });
  });

  it("shows lifecycle monitor, finalize, and vesting status through the new golden path", async () => {
    process.env.AUTOLAUNCH_SESSION_COOKIE = "_autolaunch_key=abc";

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
            vesting_wallet_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            release_ready: true,
            releasable_launch_token: 25,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const { runCliEntrypoint } = await import("../../src/index.js");
    const monitorOutput = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "launch", "monitor", "--job", "job_alpha"]),
    );
    const finalizeOutput = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "launch", "finalize", "--job", "job_alpha"]),
    );
    const vestingOutput = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "vesting", "status", "--job", "job_alpha"]),
    );

    expect(monitorOutput.result).toBe(0);
    expect(finalizeOutput.result).toBe(0);
    expect(vestingOutput.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/api/lifecycle/jobs/job_alpha`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${expectedBaseUrl}/api/lifecycle/jobs/job_alpha/finalize/prepare`,
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`${expectedBaseUrl}/api/lifecycle/jobs/job_alpha/vesting`);
    expect(parsePrintedJson<{ recommended_action: string }>(monitorOutput.stdout)).toMatchObject({
      recommended_action: "migrate",
    });
    expect(parsePrintedJson<{ prepared: { action: string } }>(finalizeOutput.stdout)).toMatchObject({
      prepared: { action: "migrate" },
    });
    expect(parsePrintedJson<{ release_ready: boolean }>(vestingOutput.stdout)).toMatchObject({
      release_ready: true,
    });
  });
});
