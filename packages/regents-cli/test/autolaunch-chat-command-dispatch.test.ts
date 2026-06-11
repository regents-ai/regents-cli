import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runAutolaunchChatListMock,
  runAutolaunchChatReadMock,
  runAutolaunchChatSendMock,
  runAutolaunchChatJoinMock,
  runAutolaunchDmMock,
  runAutolaunchDmListMock,
} = vi.hoisted(() => ({
  runAutolaunchChatListMock: vi.fn(async () => undefined),
  runAutolaunchChatReadMock: vi.fn(async () => undefined),
  runAutolaunchChatSendMock: vi.fn(async () => undefined),
  runAutolaunchChatJoinMock: vi.fn(async () => undefined),
  runAutolaunchDmMock: vi.fn(async () => undefined),
  runAutolaunchDmListMock: vi.fn(async () => undefined),
}));

vi.mock("../src/commands/autolaunch/chat.js", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/autolaunch/chat.js")>(
    "../src/commands/autolaunch/chat.js",
  );

  return {
    ...actual,
    runAutolaunchChatList: runAutolaunchChatListMock,
    runAutolaunchChatRead: runAutolaunchChatReadMock,
    runAutolaunchChatSend: runAutolaunchChatSendMock,
    runAutolaunchChatJoin: runAutolaunchChatJoinMock,
    runAutolaunchDm: runAutolaunchDmMock,
    runAutolaunchDmList: runAutolaunchDmListMock,
  };
});

const SUBJECT_ID = `0x${"1a".repeat(32)}`;

describe("autolaunch chat command dispatch", () => {
  beforeEach(() => {
    runAutolaunchChatListMock.mockClear();
    runAutolaunchChatReadMock.mockClear();
    runAutolaunchChatSendMock.mockClear();
    runAutolaunchChatJoinMock.mockClear();
    runAutolaunchDmMock.mockClear();
    runAutolaunchDmListMock.mockClear();
  });

  it("routes autolaunch chat list", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["autolaunch", "chat", "list"])).resolves.toBe(0);
    expect(runAutolaunchChatListMock).toHaveBeenCalledTimes(1);
    expect(runAutolaunchChatReadMock).not.toHaveBeenCalled();
  });

  it("routes autolaunch chat read with a scope", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["autolaunch", "chat", "read", "system", "--limit", "5"])).resolves.toBe(0);
    expect(runAutolaunchChatReadMock).toHaveBeenCalledTimes(1);
    expect(runAutolaunchChatListMock).not.toHaveBeenCalled();
  });

  it("routes autolaunch chat send with a scope", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(
      runCliEntrypoint(["autolaunch", "chat", "send", "topic:cca", "--message", "hello"]),
    ).resolves.toBe(0);
    expect(runAutolaunchChatSendMock).toHaveBeenCalledTimes(1);
  });

  it("routes autolaunch chat join with a subject id", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["autolaunch", "chat", "join", SUBJECT_ID])).resolves.toBe(0);
    expect(runAutolaunchChatJoinMock).toHaveBeenCalledTimes(1);
  });

  it("routes autolaunch dm with a target", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["autolaunch", "dm", SUBJECT_ID, "--message", "hi"])).resolves.toBe(0);
    expect(runAutolaunchDmMock).toHaveBeenCalledTimes(1);
    expect(runAutolaunchDmListMock).not.toHaveBeenCalled();
  });

  it("routes autolaunch dm list to the list handler, not the dm target handler", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["autolaunch", "dm", "list"])).resolves.toBe(0);
    expect(runAutolaunchDmListMock).toHaveBeenCalledTimes(1);
    expect(runAutolaunchDmMock).not.toHaveBeenCalled();
  });
});
