import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const { requestMock, pollUntilCompletionMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  pollUntilCompletionMock: vi.fn(),
}));

describe("agentbook CLI command group", () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    process.env = { ...originalEnv };
    fetchMock.mockReset();
    requestMock.mockReset();
    pollUntilCompletionMock.mockReset();

    requestMock.mockReturnValue({
      preset: () => ({
        connectorURI: "worldapp://verify/session",
        pollUntilCompletion: pollUntilCompletionMock,
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it("creates an agentbook session and prints a deep link", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          session: {
            session_id: "sess_1",
            frontend_request: {
              app_id: "app_test",
              action: "agentbook-registration",
              rp_context: { nonce: "n", created_at: 1, expires_at: 2, signature: "0xsig" },
              allow_legacy_proofs: true,
              signal: "0xsignal",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { runAgentbookRegister, legacyWorldIdKitLoader } = await import(
      "../../src/commands/agentbook.js"
    );
    const { parseCliArgs } = await import("../../src/parse.js");
    vi.spyOn(legacyWorldIdKitLoader, "load").mockResolvedValue({
      IDKit: {
        request: requestMock,
      },
      orbLegacy: ({ signal }: { signal: string }) => ({ signal }),
    });

    const output = await captureOutput(() =>
      runAgentbookRegister(
        parseCliArgs([
        "agentbook",
        "register",
        "0x1111111111111111111111111111111111111111",
        "--network",
        "world",
        ]),
      ),
    );

    expect(output.result).toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4000/api/agentbook/sessions");
    expect(parsePrintedJson<{ session: { connector_uri: string } }>(output.stdout)).toMatchObject({
      ok: true,
      session: {
        connector_uri: "worldapp://verify/session",
      },
    });
  }, 15_000);

  it("watches a verification to proof completion and returns manual fallback payload", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            session: {
              session_id: "sess_watch",
              frontend_request: {
                app_id: "app_test",
                action: "agentbook-registration",
                rp_context: { nonce: "n", created_at: 1, expires_at: 2, signature: "0xsig" },
                allow_legacy_proofs: true,
                signal: "0xsignal",
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
              status: "proof_ready",
              tx_request: { to: "0xabc" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    pollUntilCompletionMock.mockResolvedValue({
      success: true,
      result: {
        merkle_root: "0x01",
        nullifier_hash: "0x02",
        proof: Array.from({ length: 8 }, (_, index) => `0x${index + 1}`),
      },
    });

    const { runAgentbookRegister, legacyWorldIdKitLoader } = await import(
      "../../src/commands/agentbook.js"
    );
    const { parseCliArgs } = await import("../../src/parse.js");
    vi.spyOn(legacyWorldIdKitLoader, "load").mockResolvedValue({
      IDKit: {
        request: requestMock,
      },
      orbLegacy: ({ signal }: { signal: string }) => ({ signal }),
    });

    const output = await captureOutput(() =>
      runAgentbookRegister(
        parseCliArgs([
        "agentbook",
        "register",
        "0x1111111111111111111111111111111111111111",
        "--network",
        "world",
        "--watch",
        "--manual",
        ]),
      ),
    );

    expect(output.result).toBeUndefined();
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:4000/api/agentbook/sessions/sess_watch/submit",
    );
    expect(parsePrintedJson<{ session: { status: string; tx_request: { to: string } } }>(output.stdout)).toMatchObject({
      ok: true,
      session: { status: "proof_ready", tx_request: { to: "0xabc" } },
      connector_uri: "worldapp://verify/session",
    });
  }, 15_000);

  it("looks up human-backed status", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { registered: true, human_id: "0x1234", network: "world" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { runAgentbookLookup } = await import("../../src/commands/agentbook.js");
    const { parseCliArgs } = await import("../../src/parse.js");
    const output = await captureOutput(() =>
      runAgentbookLookup(
        parseCliArgs([
        "agentbook",
        "lookup",
        "--address",
        "0x1111111111111111111111111111111111111111",
        "--network",
        "world",
        ]),
      ),
    );

    expect(output.result).toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4000/api/agentbook/lookup?agent_address=0x1111111111111111111111111111111111111111&network=world",
    );
    expect(parsePrintedJson<{ result: { human_id: string } }>(output.stdout)).toMatchObject({
      ok: true,
      result: { human_id: "0x1234" },
    });
  }, 15_000);

  it("forwards low-level header verification to autolaunch", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { valid: true, recovered_address: "0x1111111111111111111111111111111111111111" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { runAgentbookVerifyHeader } = await import("../../src/commands/agentbook.js");
    const { parseCliArgs } = await import("../../src/parse.js");
    const output = await captureOutput(() =>
      runAgentbookVerifyHeader(
        parseCliArgs([
        "agentbook",
        "verify-header",
        "--header",
        "ZmFrZQ==",
        "--resource-uri",
        "https://autolaunch.sh/api/agentbook/verify",
        ]),
      ),
    );

    expect(output.result).toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4000/api/agentbook/verify");
    expect(parsePrintedJson<{ result: { valid: boolean } }>(output.stdout)).toMatchObject({
      ok: true,
      result: { valid: true },
    });
  }, 15_000);

  it("rejects non-positive interval values for sessions watch", async () => {
    const { runAgentbookSessionsWatch } = await import("../../src/commands/agentbook.js");
    const { parseCliArgs } = await import("../../src/parse.js");

    await expect(
      runAgentbookSessionsWatch(
        parseCliArgs([
          "agentbook",
          "sessions",
          "watch",
          "sess_1",
          "--interval",
          "0",
        ]),
      ),
    ).rejects.toThrow("--interval must be a positive number");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
