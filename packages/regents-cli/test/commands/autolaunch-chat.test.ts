import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCliEntrypoint } from "../../src/index.js";
import { writeInitialConfig } from "../../src/internal-runtime/config.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const { buildAgentAuthHeadersMock, loadAgentAuthStateMock, requireAgentAuthStateMock } = vi.hoisted(() => ({
  buildAgentAuthHeadersMock: vi.fn(),
  loadAgentAuthStateMock: vi.fn(),
  requireAgentAuthStateMock: vi.fn(),
}));

const { sendXmtpConversationTextMock, sendXmtpDmMock, listXmtpDmsMock } = vi.hoisted(() => ({
  sendXmtpConversationTextMock: vi.fn(),
  sendXmtpDmMock: vi.fn(),
  listXmtpDmsMock: vi.fn(),
}));

vi.mock("../../src/commands/agent-auth.js", () => ({
  buildAgentAuthHeaders: buildAgentAuthHeadersMock,
  loadAgentAuthState: loadAgentAuthStateMock,
  requireAgentAuthState: requireAgentAuthStateMock,
}));

vi.mock("../../src/internal-runtime/xmtp/conversations.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/internal-runtime/xmtp/conversations.js")>(
    "../../src/internal-runtime/xmtp/conversations.js",
  );

  return {
    ...actual,
    sendXmtpConversationText: sendXmtpConversationTextMock,
    sendXmtpDm: sendXmtpDmMock,
    listXmtpDms: listXmtpDmsMock,
  };
});

const SUBJECT_ID = `0x${"1a".repeat(32)}`;
const TOKEN_SCOPE = `token:${SUBJECT_ID}`;
const CREATOR_WALLET = "0x00000000000000000000000000000000000000cc";

describe("autolaunch chat CLI commands", () => {
  const expectedBaseUrl = "http://127.0.0.1:4010";
  const fetchMock = vi.fn<typeof fetch>();
  const tempDirs: string[] = [];

  const createConfigPath = () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "regents-cli-autolaunch-chat-"));
    tempDirs.push(tempDir);

    const configPath = path.join(tempDir, "regent.config.json");
    writeInitialConfig(configPath);
    return configPath;
  };

  const jsonResponse = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });

  const channelsPayload = () => ({
    data: [
      { scope: "system", kind: "system", name: "System", status: "active", last_message_at: null },
      { scope: TOKEN_SCOPE, kind: "token", name: "Token channel", status: "active", last_message_at: null },
    ],
  });

  const assertAgentAuthHeaders = (headers: Headers | undefined) => {
    expect(headers?.get("x-siwa-receipt")).toBe("receipt_123");
    expect(headers?.get("signature")).toBe("sig1=:ZmFrZQ==:");
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    buildAgentAuthHeadersMock.mockReset();
    loadAgentAuthStateMock.mockReset();
    requireAgentAuthStateMock.mockReset();
    sendXmtpConversationTextMock.mockReset();
    sendXmtpDmMock.mockReset();
    listXmtpDmsMock.mockReset();

    buildAgentAuthHeadersMock.mockResolvedValue({
      "x-siwa-receipt": "receipt_123",
      signature: "sig1=:ZmFrZQ==:",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("lists chat channels without agent auth", async () => {
    const configPath = createConfigPath();
    fetchMock.mockResolvedValueOnce(jsonResponse(channelsPayload()));

    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "chat", "list", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/v1/chat/channels`);
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect((requestInit?.headers as Headers).get("x-siwa-receipt")).toBeNull();
    expect(buildAgentAuthHeadersMock).not.toHaveBeenCalled();
    expect(parsePrintedJson(output.stdout)).toEqual(channelsPayload());
  });

  it("reads a scope with cursor pagination flags", async () => {
    const configPath = createConfigPath();
    const payload = {
      data: [{ id: 7, scope: "system", body: "hello" }],
      pagination: { limit: 5, next_cursor: null },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "chat",
        "read",
        "system",
        "--before",
        "10",
        "--limit",
        "5",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/chat/messages?scope=system&before=10&limit=5`,
    );
    expect(parsePrintedJson(output.stdout)).toEqual(payload);
  });

  it("sends to a channel scope over the agent HTTP route", async () => {
    const configPath = createConfigPath();
    const payload = { data: { id: 8, scope: "topic:cca", body: "Auction opens at noon" } };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload, 201));

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "chat",
        "send",
        "topic:cca",
        "--message",
        "Auction opens at noon",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/chat/messages?scope=${encodeURIComponent("topic:cca")}`,
    );
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestInit?.method).toBe("POST");
    assertAgentAuthHeaders(requestInit?.headers as Headers);
    expect(JSON.parse(String(requestInit?.body))).toEqual({ body: "Auction opens at noon" });
    expect(sendXmtpConversationTextMock).not.toHaveBeenCalled();
    expect(parsePrintedJson(output.stdout)).toEqual(payload);
  });

  it("sends to a token scope over the agent HTTP route", async () => {
    const configPath = createConfigPath();
    const payload = { data: { id: 9, scope: TOKEN_SCOPE, body: "hi room" } };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload, 201));

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "chat",
        "send",
        TOKEN_SCOPE,
        "--message",
        "hi room",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${expectedBaseUrl}/v1/agent/chat/messages?scope=${encodeURIComponent(TOKEN_SCOPE)}`,
    );
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestInit?.method).toBe("POST");
    assertAgentAuthHeaders(requestInit?.headers as Headers);
    expect(JSON.parse(String(requestInit?.body))).toEqual({ body: "hi room" });
    expect(sendXmtpConversationTextMock).not.toHaveBeenCalled();
    expect(parsePrintedJson(output.stdout)).toEqual(payload);
  });

  it("DMs a subject creator wallet resolved from the revenue subject", async () => {
    const configPath = createConfigPath();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, subject: { subject_id: SUBJECT_ID, creator_address: CREATOR_WALLET } }),
    );
    sendXmtpDmMock.mockResolvedValueOnce({
      ok: true,
      to: CREATOR_WALLET,
      conversationId: "dm_1",
      messageId: "msg_1",
      text: "Question about your token",
    });

    const output = await captureOutput(() =>
      runCliEntrypoint([
        "autolaunch",
        "dm",
        SUBJECT_ID,
        "--message",
        "Question about your token",
        "--config",
        configPath,
      ]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${expectedBaseUrl}/v1/app/subjects/${SUBJECT_ID}`);
    expect(sendXmtpDmMock).toHaveBeenCalledTimes(1);
    expect(sendXmtpDmMock.mock.calls[0]?.[1]).toBe(CREATOR_WALLET);
    expect(sendXmtpDmMock.mock.calls[0]?.[2]).toBe("Question about your token");
    expect(parsePrintedJson(output.stdout)).toMatchObject({ ok: true, to: CREATOR_WALLET });
  });

  it("fails the DM when the revenue subject has no creator wallet", async () => {
    const configPath = createConfigPath();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, subject: { subject_id: SUBJECT_ID, creator_address: null } }),
    );

    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "dm", SUBJECT_ID, "--message", "hello", "--config", configPath]),
    );

    expect(output.result).toBe(1);
    expect(sendXmtpDmMock).not.toHaveBeenCalled();
    expect(output.stderr).toContain("no creator wallet to DM");
  });

  it("DMs a wallet address directly without resolving a subject", async () => {
    const configPath = createConfigPath();
    sendXmtpDmMock.mockResolvedValueOnce({
      ok: true,
      to: CREATOR_WALLET,
      conversationId: "dm_1",
      messageId: "msg_1",
      text: "hello",
    });

    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "dm", CREATOR_WALLET, "--message", "hello", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendXmtpDmMock).toHaveBeenCalledTimes(1);
    expect(sendXmtpDmMock.mock.calls[0]?.[1]).toBe(CREATOR_WALLET);
  });

  it("rejects DM targets that are neither subject ids nor wallet addresses", async () => {
    const configPath = createConfigPath();

    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "dm", "not-a-target", "--message", "hello", "--config", configPath]),
    );

    expect(output.result).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendXmtpDmMock).not.toHaveBeenCalled();
    expect(output.stderr).toContain("invalid DM target");
  });

  it("lists local XMTP DMs with the sync flag", async () => {
    const configPath = createConfigPath();
    listXmtpDmsMock.mockResolvedValueOnce({ ok: true, conversations: [] });

    const output = await captureOutput(() =>
      runCliEntrypoint(["autolaunch", "dm", "list", "--sync", "--config", configPath]),
    );

    expect(output.result).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(listXmtpDmsMock).toHaveBeenCalledTimes(1);
    expect(listXmtpDmsMock.mock.calls[0]?.[1]).toEqual({ sync: true });
    expect(parsePrintedJson(output.stdout)).toEqual({ ok: true, conversations: [] });
  });
});
