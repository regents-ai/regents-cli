import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureOutput, parsePrintedJson } from "../helpers/output.js";

describe("regent-staking CLI command group", () => {
  const expectedBaseUrl = "http://127.0.0.1:4010";
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env = { ...originalEnv };
    delete process.env.AUTOLAUNCH_SESSION_COOKIE;
    delete process.env.AUTOLAUNCH_PRIVY_BEARER_TOKEN;
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it("shows the regent staking overview", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, chain_id: 8453, treasury_residual_usdc: "150" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() => runCliEntrypoint(["regent-staking", "show"]));

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/api/regent/staking`);
    expect(parsePrintedJson<{ chain_id: number }>(output.stdout)).toMatchObject({ chain_id: 8453 });
  });

  it("shows a specific account", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, wallet_address: "0xabc", wallet_claimable_usdc: "12" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint(["regent-staking", "account", "0xabc"]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/api/regent/staking/account/0xabc`);
    expect(parsePrintedJson<{ wallet_address: string }>(output.stdout)).toMatchObject({
      wallet_address: "0xabc",
    });
  });

  it("requires a session for direct stake calls", async () => {
    const { runCliEntrypoint } = await import("../../src/index.js");

    const output = await captureOutput(() =>
      runCliEntrypoint(["regent-staking", "stake", "--amount", "1.5"]),
    );

    expect(output.result).toBe(1);
    expect(output.stderr).toContain(
      "This command requires an authenticated session. Set AUTOLAUNCH_SESSION_COOKIE or AUTOLAUNCH_PRIVY_BEARER_TOKEN.",
    );
  });

  it("builds the direct stake request when a session is present", async () => {
    process.env.AUTOLAUNCH_SESSION_COOKIE = "_autolaunch_key=abc";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, tx_request: { data: "0x7acb7757" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() =>
      runCliEntrypoint(["regent-staking", "stake", "--amount", "1.5"]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/api/regent/staking/stake`);
    expect(parsePrintedJson<{ tx_request: { data: string } }>(output.stdout)).toMatchObject({
      tx_request: { data: "0x7acb7757" },
    });
  });

  it("claims USDC through the user wallet flow", async () => {
    process.env.AUTOLAUNCH_SESSION_COOKIE = "_autolaunch_key=abc";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, tx_request: { data: "0x42852610" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { runCliEntrypoint } = await import("../../src/index.js");
    const output = await captureOutput(() => runCliEntrypoint(["regent-staking", "claim-usdc"]));

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/api/regent/staking/claim-usdc`);
    expect(parsePrintedJson<{ tx_request: { data: string } }>(output.stdout)).toMatchObject({
      tx_request: { data: "0x42852610" },
    });
  });
});
