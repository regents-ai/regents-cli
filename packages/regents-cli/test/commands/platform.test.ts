import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCliEntrypoint } from "../../src/index.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

describe("platform CLI command group", () => {
  // Only mutate individual keys on process.env: replacing the whole object
  // detaches it from the real environment, and os.homedir() would keep
  // returning the real home directory instead of the per-test temp HOME.
  let originalHome: string | undefined;
  const fetchMock = vi.fn<typeof fetch>();
  let homeDir = "";
  let sessionFile = "";

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "regents-platform-home-"));
    sessionFile = path.join(homeDir, "platform-session.json");
    originalHome = process.env.HOME;
    process.env.HOME = homeDir;
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const writeSession = (origin = "http://127.0.0.1:4010") => {
    fs.writeFileSync(
      sessionFile,
      JSON.stringify(
        {
          version: 1,
          origin,
          cookie: "_platform_phx_key=session-cookie",
          csrfToken: "csrf-token",
          savedAt: "2026-04-01T00:00:00.000Z",
        },
        null,
        2,
      ),
    );
  };

  it("signs in with a Privy identity token and saves the platform session", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, csrf_token: "csrf-token" }), {
          status: 200,
          headers: { "content-type": "application/json", "set-cookie": "_platform_phx_key=bootstrap; path=/" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, authenticated: true }), {
          status: 200,
          headers: { "content-type": "application/json", "set-cookie": "_platform_phx_key=session-cookie; path=/" },
        }),
      );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "platform",
        "auth",
        "login",
        "--origin",
        "http://127.0.0.1:4010",
        "--session-file",
        sessionFile,
        "--identity-token",
        "privy-token",
        "--display-name",
        "Regent Operator",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4010/api/auth/privy/csrf");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:4010/api/auth/privy/session");
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Headers).get("authorization")).toBe("Bearer privy-token");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ display_name: "Regent Operator" }));
    expect(parsePrintedJson<{ ok: boolean; profile: { authenticated: boolean } }>(output.stdout)).toMatchObject({
      ok: true,
      profile: { authenticated: true },
    });
    expect(JSON.parse(fs.readFileSync(sessionFile, "utf8"))).toMatchObject({
      origin: "http://127.0.0.1:4010",
      cookie: "_platform_phx_key=session-cookie",
      csrfToken: "csrf-token",
    });
  });

  it("reads the saved platform auth status", async () => {
    writeSession();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, authenticated: true, claimed_names: [], agents: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "platform",
        "auth",
        "status",
        "--origin",
        "http://127.0.0.1:4010",
        "--session-file",
        sessionFile,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4010/api/auth/privy/profile");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("cookie")).toBe("_platform_phx_key=session-cookie");
    expect(parsePrintedJson<{ profile: { authenticated: boolean } }>(output.stdout)).toMatchObject({
      profile: { authenticated: true },
    });
  });

  it("reads the Platform formation doctor", async () => {
    writeSession();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, status: "blocked", blockers: [{ reason: "billing_needed" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "platform",
        "formation",
        "doctor",
        "--origin",
        "http://127.0.0.1:4010",
        "--session-file",
        sessionFile,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4010/api/agent-platform/formation/doctor");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("cookie")).toBe("_platform_phx_key=session-cookie");
    expect(parsePrintedJson<{ command: string; doctor: { status: string } }>(output.stdout)).toMatchObject({
      command: "regents platform formation doctor",
      doctor: { status: "blocked" },
    });
  });

  it("reads the Platform projection", async () => {
    writeSession();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, agent_id: "agent_123", companies: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "platform",
        "projection",
        "--origin",
        "http://127.0.0.1:4010",
        "--session-file",
        sessionFile,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4010/api/agent-platform/projection");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("cookie")).toBe("_platform_phx_key=session-cookie");
    expect(parsePrintedJson<{ command: string; projection: { agent_id: string } }>(output.stdout)).toMatchObject({
      command: "regents platform projection",
      projection: { agent_id: "agent_123" },
    });
  });

  it("saves Platform billing spend controls in cents", async () => {
    writeSession();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          billing_account: { runtime_monthly_limit_usd_cents: 10_000 },
          usage: { runtime_monthly_remaining_usd_cents: 10_000 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "platform",
        "billing",
        "spend-controls",
        "set",
        "--origin",
        "http://127.0.0.1:4010",
        "--session-file",
        sessionFile,
        "--runtime-monthly-limit-usd",
        "100",
        "--model-usage-monthly-limit-usd",
        "50",
        "--runtime-auto-topup-enabled",
        "--runtime-auto-topup-amount-usd",
        "25",
        "--runtime-auto-topup-threshold-usd",
        "10",
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4010/api/agent-platform/billing/spend-controls");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("x-csrf-token")).toBe("csrf-token");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        runtimeMonthlyLimitUsdCents: 10_000,
        llmMonthlyLimitUsdCents: 5_000,
        runtimeAutoTopupEnabled: true,
        runtimeAutoTopupAmountUsdCents: 2_500,
        runtimeAutoTopupThresholdUsdCents: 1_000,
      }),
    );
    expect(parsePrintedJson<{ command: string; billing: { ok: boolean } }>(output.stdout)).toMatchObject({
      command: "regents platform billing spend-controls set",
      billing: { ok: true },
    });
  });

});
