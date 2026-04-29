import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCliEntrypoint } from "../../src/index.js";
import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const { buildAgentAuthHeadersMock } = vi.hoisted(() => ({
  buildAgentAuthHeadersMock: vi.fn(),
}));

vi.mock("../../src/commands/agent-auth.js", () => ({
  buildAgentAuthHeaders: buildAgentAuthHeadersMock,
}));

const TIMESTAMP = "2026-04-01T00:00:00.000Z";
const originalIsTTY = process.stdout.isTTY;

const setStdoutTty = (value: boolean): void => {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  });
};

const useHumanTerminal = (): void => {
  setStdoutTty(true);
  delete process.env.NO_COLOR;
  process.env.TERM = "xterm-256color";
};

const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");

const workItem = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 123,
  company_id: 123,
  title: "Review launch notes",
  description: "Check the public launch notes.",
  status: "open",
  priority: "normal",
  visibility: "operator",
  desired_runner_kind: null,
  assigned_worker_id: null,
  assigned_agent_profile_id: null,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
  ...overrides,
});

const runRecord = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 456,
  company_id: 123,
  work_item_id: 123,
  parent_run_id: null,
  root_run_id: null,
  worker_id: 789,
  runtime_profile_id: null,
  runner_kind: "openclaw_local_executor",
  status: "queued",
  visibility: "operator",
  summary: null,
  failure_reason: null,
  cost_usd: "0.00",
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
  ...overrides,
});

const agentProfile = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 321,
  company_id: 123,
  name: "OpenClaw desk",
  agent_kind: "openclaw",
  default_runner_kind: "openclaw_local_executor",
  status: "active",
  visibility: "operator",
  ...overrides,
});

const worker = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 789,
  company_id: 123,
  agent_profile_id: 321,
  runtime_profile_id: null,
  name: "OpenClaw desk",
  agent_kind: "openclaw",
  worker_role: "executor",
  execution_surface: "local_bridge",
  runner_kind: "openclaw_local_executor",
  billing_mode: "user_local",
  trust_scope: "local_user_controlled",
  reported_usage_policy: "self_reported",
  status: "active",
  last_heartbeat_at: null,
  ...overrides,
});

const relationship = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 654,
  company_id: 123,
  source_agent_profile_id: 321,
  target_agent_profile_id: 322,
  source_worker_id: null,
  target_worker_id: null,
  relationship_kind: "can_delegate_to",
  status: "active",
  max_parallel_runs: 1,
  ...overrides,
});

describe("work and agent platform commands", () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn<typeof fetch>();
  let homeDir = "";
  let sessionFile = "";
  let configPath = "";

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "regents-work-agent-home-"));
    sessionFile = path.join(homeDir, "platform-session.json");
    configPath = path.join(homeDir, "regent.config.json");
    process.env = { ...originalEnv, HOME: homeDir };
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(
      sessionFile,
      JSON.stringify(
        {
          version: 1,
          origin: "http://127.0.0.1:4010",
          cookie: "_platform_phx_key=session-cookie",
          csrfToken: "csrf-token",
          savedAt: "2026-04-01T00:00:00.000Z",
        },
        null,
        2,
      ),
    );
    writeInitialConfig(configPath, {
      auth: {
        audience: "platform",
        defaultChainId: 8453,
      },
      services: {
        siwa: {
          baseUrl: "http://127.0.0.1:4010",
          requestTimeoutMs: 1_000,
        },
        platform: {
          baseUrl: "http://127.0.0.1:4010",
          requestTimeoutMs: 1_000,
        },
        autolaunch: {
          baseUrl: "http://127.0.0.1:4010",
          requestTimeoutMs: 1_000,
        },
        techtree: {
          baseUrl: "http://127.0.0.1:4001",
          requestTimeoutMs: 1_000,
        },
      },
    });
    fetchMock.mockReset();
    buildAgentAuthHeadersMock.mockReset();
    buildAgentAuthHeadersMock.mockResolvedValue({
      "x-siwa-receipt": "receipt_123",
      signature: "sig1=:signed:",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
    setStdoutTty(Boolean(originalIsTTY));
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("creates work through the current company route", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, work_item: workItem() }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "work",
        "create",
        "--company-id",
        "company_123",
        "--title",
        "Review launch notes",
        "--description",
        "Check the public launch notes.",
        "--session-file",
        sessionFile,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/work-items",
    );
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get("x-csrf-token")).toBe("csrf-token");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        company_id: "company_123",
        title: "Review launch notes",
        description: "Check the public launch notes.",
      }),
    );
    expect(parsePrintedJson<{ result: { work_item: { id: number } } }>(output.stdout).result.work_item.id).toBe(123);
  });

  it("starts a run with the current run request shape", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, run: runRecord() }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "work",
        "run",
        "work_123",
        "--company-id",
        "company_123",
        "--runner",
        "openclaw_local_executor",
        "--worker-id",
        "worker_123",
        "--instructions",
        "Use the local workspace.",
        "--session-file",
        sessionFile,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/work-items/work_123/runs",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        company_id: "company_123",
        work_item_id: "work_123",
        runner_kind: "openclaw_local_executor",
        worker_id: "worker_123",
        instructions: "Use the local workspace.",
      }),
    );
    expect(parsePrintedJson<{ result: { run: { id: number } } }>(output.stdout).result.run.id).toBe(456);
  });

  it("renders a readable work run summary for human terminals", async () => {
    useHumanTerminal();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, run: runRecord() }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "work",
        "run",
        "123",
        "--company-id",
        "123",
        "--runner",
        "openclaw_local_executor",
        "--worker-id",
        "789",
        "--session-file",
        sessionFile,
      ]),
    );

    const visible = stripAnsi(output.stdout);

    expect(output.result).toBe(0);
    expect(visible).toContain("WORK STARTED");
    expect(visible).toContain("run id");
    expect(visible).toContain("456");
    expect(visible).toContain("regents work watch 456 --company-id 123");
  });

  it("keeps raw JSON output when script mode is requested on a human terminal", async () => {
    useHumanTerminal();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, work_item: workItem() }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "work",
        "create",
        "--company-id",
        "company_123",
        "--title",
        "Review launch notes",
        "--session-file",
        sessionFile,
        "--json",
      ]),
    );

    expect(output.result).toBe(0);
    expect(output.stdout).not.toContain("WORK CREATED");
    expect(parsePrintedJson<{ result: { work_item: { id: number } } }>(output.stdout).result.work_item.id).toBe(123);
  });

  it("connects OpenClaw as a local worker and writes the skill", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, agent_profile: agentProfile(), worker: worker() }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "agent",
        "connect",
        "openclaw",
        "--company-id",
        "company_123",
        "--role",
        "executor",
        "--name",
        "OpenClaw desk",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/workers",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        company_id: "company_123",
        agent_kind: "openclaw",
        worker_role: "executor",
        execution_surface: "local_bridge",
        runner_kind: "openclaw_local_executor",
        billing_mode: "user_local",
        trust_scope: "local_user_controlled",
        reported_usage_policy: "self_reported",
        display_name: "OpenClaw desk",
        endpoint_url: null,
      }),
    );
    const printed = parsePrintedJson<{ openclaw: { skillFile: string } }>(output.stdout);
    expect(printed.openclaw.skillFile).toBe(path.join(homeDir, ".openclaw", "skills", "regents-work", "SKILL.md"));
    expect(fs.readFileSync(printed.openclaw.skillFile, "utf8")).toContain(
      "Do not upload secrets, private memory, inbox content, calendar content, chat content",
    );
    expect(fs.readFileSync(printed.openclaw.skillFile, "utf8")).toContain("--worker-id 789");
  });

  it("connects Hermes through the local bridge and writes connector files", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          agent_profile: agentProfile({ agent_kind: "hermes", default_runner_kind: "hermes_local_manager" }),
          worker: worker({
            name: "Hermes desk",
            agent_kind: "hermes",
            worker_role: "manager",
            runner_kind: "hermes_local_manager",
          }),
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "agent",
        "connect",
        "hermes",
        "--company-id",
        "company_123",
        "--role",
        "manager",
        "--name",
        "Hermes desk",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        company_id: "company_123",
        agent_kind: "hermes",
        worker_role: "manager",
        execution_surface: "local_bridge",
        runner_kind: "hermes_local_manager",
        billing_mode: "user_local",
        trust_scope: "local_user_controlled",
        reported_usage_policy: "self_reported",
        display_name: "Hermes desk",
        endpoint_url: null,
      }),
    );

    const printed = parsePrintedJson<{ hermes: { configFile: string; skillFile: string } }>(output.stdout);
    expect(printed.hermes.configFile).toBe(path.join(homeDir, ".hermes", "connectors", "regents-work.json"));
    expect(printed.hermes.skillFile).toBe(path.join(homeDir, ".hermes", "skills", "regents-work", "SKILL.md"));
    expect(fs.readFileSync(printed.hermes.configFile, "utf8")).toContain('"worker_id": "789"');
    expect(fs.readFileSync(printed.hermes.skillFile, "utf8")).toContain("Do not upload secrets, private memory");
  });

  it("renders OpenClaw connection details for human terminals", async () => {
    useHumanTerminal();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, agent_profile: agentProfile(), worker: worker() }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "agent",
        "connect",
        "openclaw",
        "--company-id",
        "company_123",
        "--role",
        "executor",
        "--name",
        "OpenClaw desk",
        "--config",
        configPath,
      ]),
    );

    const visible = stripAnsi(output.stdout);

    expect(output.result).toBe(0);
    expect(visible).toContain("OPENCLAW CONNECTED");
    expect(visible).toContain("worker id");
    expect(visible).toContain("789");
    expect(visible).toContain(path.join(homeDir, ".openclaw", "skills", "regents-work", "SKILL.md"));
    expect(visible).toContain(
      "regents work run <work-id> --company-id 123 --runner openclaw_local_executor --worker-id 789",
    );
  });

  it("links a manager to an executor through the relationship route", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, relationship: relationship() }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "agent",
        "link",
        "--company-id",
        "company_123",
        "--manager-agent-id",
        "agent_manager",
        "--executor-agent-id",
        "agent_executor",
        "--relationship",
        "can_delegate_to",
        "--session-file",
        sessionFile,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/agents/agent_manager/relationships",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        company_id: "company_123",
        source_agent_profile_id: "agent_manager",
        target_agent_profile_id: "agent_executor",
        relationship_kind: "can_delegate_to",
        status: "active",
      }),
    );
    expect(parsePrintedJson<{ result: { relationship: { id: number } } }>(output.stdout).result.relationship.id).toBe(654);
  });

  it("links manager and executor workers through the relationship route", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          relationship: relationship({
            id: 655,
            source_agent_profile_id: null,
            target_agent_profile_id: null,
            source_worker_id: 789,
            target_worker_id: 790,
          }),
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "agent",
        "link",
        "--company-id",
        "company_123",
        "--manager-worker-id",
        "worker_manager",
        "--executor-worker-id",
        "worker_executor",
        "--relationship",
        "can_delegate_to",
        "--session-file",
        sessionFile,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/agents/worker_manager/relationships",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        company_id: "company_123",
        source_worker_id: "worker_manager",
        target_worker_id: "worker_executor",
        relationship_kind: "can_delegate_to",
        status: "active",
      }),
    );
    expect(parsePrintedJson<{ result: { relationship: { id: number } } }>(output.stdout).result.relationship.id).toBe(655);
  });

  it("watches run events through the current run events route", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          run_id: 456,
          events: [
            {
              id: 987,
              company_id: 123,
              run_id: 456,
              sequence: 1,
              kind: "queued",
              actor_kind: "worker",
              actor_id: "789",
              visibility: "operator",
              sensitivity: "normal",
              payload: {},
              occurred_at: TIMESTAMP,
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "work",
        "watch",
        "run_123",
        "--company-id",
        "company_123",
        "--once",
        "--session-file",
        sessionFile,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/runs/run_123/events",
    );
    expect(parsePrintedJson<{ result: { events: unknown[] } }>(output.stdout).result.events).toHaveLength(1);
  });

  it("keeps checking run events when asked to watch progress", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            run_id: 456,
            events: [{ id: 1, run_id: 456, sequence: 1, kind: "queued", payload: {}, occurred_at: TIMESTAMP }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            run_id: 456,
            events: [
              { id: 1, run_id: 456, sequence: 1, kind: "queued", payload: {}, occurred_at: TIMESTAMP },
              { id: 2, run_id: 456, sequence: 2, kind: "running", payload: {}, occurred_at: TIMESTAMP },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "work",
        "watch",
        "run_123",
        "--company-id",
        "company_123",
        "--max-polls",
        "2",
        "--poll-ms",
        "1",
        "--session-file",
        sessionFile,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/runs/run_123/events",
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/runs/run_123/events",
    ]);
    const lines = output.stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ command: "regents work watch", result: { events: [{ kind: "queued" }] } });
    expect(lines[1]).toMatchObject({ command: "regents work watch", result: { events: [{ kind: "queued" }, { kind: "running" }] } });
  });

  it("shows only new run updates in a terminal timeline", async () => {
    useHumanTerminal();
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            run_id: 456,
            events: [{ id: 1, run_id: 456, sequence: 1, kind: "queued", payload: {}, occurred_at: TIMESTAMP }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            run_id: 456,
            events: [
              { id: 1, run_id: 456, sequence: 1, kind: "queued", payload: {}, occurred_at: TIMESTAMP },
              { id: 2, run_id: 456, sequence: 2, kind: "running", payload: {}, occurred_at: TIMESTAMP },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "work",
        "watch",
        "run_123",
        "--company-id",
        "company_123",
        "--max-polls",
        "2",
        "--poll-ms",
        "1",
        "--session-file",
        sessionFile,
      ]),
    );

    const visible = stripAnsi(output.stdout);
    expect(output.result).toBe(0);
    expect(visible).toContain("UPDATE TIMELINE");
    expect(visible.match(/queued/g)).toHaveLength(1);
    expect(visible.match(/running/g)).toHaveLength(1);
  });

  it("lets a local worker claim work, record updates, upload approved artifacts, delegate, and complete", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, worker: worker() }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            assignments: [{ id: 11, company_id: 123, worker_id: 789, work_run_id: 456, status: "available" }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            assignment: { id: 11, company_id: 123, worker_id: 789, work_run_id: 456, status: "claimed" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, event: { id: 1 } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, artifact: { id: 2 } }), { status: 201 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, target_worker: worker({ id: 790 }), child_runs: [runRecord({ id: 457 })] }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            assignment: { id: 11, company_id: 123, worker_id: 789, work_run_id: 456, status: "completed" },
          }),
          { status: 200 },
        ),
      );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "work",
        "local-loop",
        "--company-id",
        "company_123",
        "--worker-id",
        "worker_123",
        "--once",
        "--artifact-title",
        "Approved note",
        "--artifact-body",
        "Only this approved note is uploaded.",
        "--delegate-runner",
        "codex_exec",
        "--delegate-title",
        "Review final answer",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/workers/worker_123/heartbeat",
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/workers/worker_123/assignments",
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/assignments/11/claim",
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/runs/456/events",
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/runs/456/artifacts",
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/runs/456/delegations",
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/assignments/11/complete",
    ]);
    expect(fetchMock.mock.calls[3]?.[1]?.body).toBe(
      JSON.stringify({
        company_id: "company_123",
        run_id: 456,
        kind: "local_worker_checked_assignment",
        payload: { worker_id: "worker_123" },
        visibility: "operator",
        sensitivity: "normal",
      }),
    );
    expect(fetchMock.mock.calls[4]?.[1]?.body).toBe(
      JSON.stringify({
        company_id: "company_123",
        run_id: 456,
        artifact_type: "note",
        title: "Approved note",
        body: "Only this approved note is uploaded.",
        visibility: "operator",
      }),
    );
    expect(fetchMock.mock.calls[5]?.[1]?.body).toBe(
      JSON.stringify({
        company_id: "company_123",
        run_id: 456,
        requested_runner_kind: "codex_exec",
        tasks: [{ title: "Review final answer" }],
      }),
    );
    expect(parsePrintedJson<{ ok: boolean; command: string }>(output.stdout)).toEqual({
      ok: true,
      command: "regents work local-loop",
    });
  });

  it("lists a manager execution pool through the current route", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          company_id: 123,
          workers: [
            worker(),
            worker({
              id: 790,
              name: "Hermes desk",
              agent_kind: "hermes",
              worker_role: "manager",
              runner_kind: "hermes_hosted_manager",
              billing_mode: "platform_hosted",
              trust_scope: "platform_hosted",
              reported_usage_policy: "platform_metered",
              last_heartbeat_at: TIMESTAMP,
            }),
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "agent",
        "execution-pool",
        "--company-id",
        "company_123",
        "--manager",
        "agent_manager",
        "--session-file",
        sessionFile,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4010/api/agent-platform/companies/company_123/rwr/agents/agent_manager/execution-pool",
    );
    expect(parsePrintedJson<{ result: { workers: unknown[] } }>(output.stdout).result.workers).toHaveLength(2);
  });

  it("renders the execution pool as a worker list for human terminals", async () => {
    useHumanTerminal();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          company_id: 123,
          workers: [worker(), worker({ id: 790, name: "Hermes desk", agent_kind: "hermes" })],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "agent",
        "execution-pool",
        "--company-id",
        "123",
        "--manager",
        "321",
        "--session-file",
        sessionFile,
      ]),
    );

    const visible = stripAnsi(output.stdout);

    expect(output.result).toBe(0);
    expect(visible).toContain("ASSIGNABLE WORKERS");
    expect(visible).toContain("WORKER LIST");
    expect(visible).toContain("OpenClaw desk");
    expect(visible).toContain("Hermes desk");
    expect(visible).toContain("regents work run <work-id> --company-id 123 --runner <runner> --worker-id <worker-id>");
  });
});
