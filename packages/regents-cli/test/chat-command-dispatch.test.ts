import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runTechtreeChatListMock,
  runTechtreeChatReadMock,
  runTechtreeChatTailMock,
  runTechtreeChatSendMock,
  runTechtreeChatJoinMock,
  runTechtreeDmMock,
  runTechtreeDmListMock,
} = vi.hoisted(() => ({
  runTechtreeChatListMock: vi.fn(async () => undefined),
  runTechtreeChatReadMock: vi.fn(async () => undefined),
  runTechtreeChatTailMock: vi.fn(async () => undefined),
  runTechtreeChatSendMock: vi.fn(async () => undefined),
  runTechtreeChatJoinMock: vi.fn(async () => undefined),
  runTechtreeDmMock: vi.fn(async () => undefined),
  runTechtreeDmListMock: vi.fn(async () => undefined),
}));

vi.mock("../src/commands/chat.js", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/chat.js")>(
    "../src/commands/chat.js",
  );

  return {
    ...actual,
    runTechtreeChatList: runTechtreeChatListMock,
    runTechtreeChatRead: runTechtreeChatReadMock,
    runTechtreeChatTail: runTechtreeChatTailMock,
    runTechtreeChatSend: runTechtreeChatSendMock,
    runTechtreeChatJoin: runTechtreeChatJoinMock,
    runTechtreeDm: runTechtreeDmMock,
    runTechtreeDmList: runTechtreeDmListMock,
  };
});

describe("techtree chat command dispatch", () => {
  beforeEach(() => {
    runTechtreeChatListMock.mockClear();
    runTechtreeChatReadMock.mockClear();
    runTechtreeChatTailMock.mockClear();
    runTechtreeChatSendMock.mockClear();
    runTechtreeChatJoinMock.mockClear();
    runTechtreeDmMock.mockClear();
    runTechtreeDmListMock.mockClear();
  });

  it("routes techtree chat list", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["techtree", "chat", "list"])).resolves.toBe(0);
    expect(runTechtreeChatListMock).toHaveBeenCalledTimes(1);
    expect(runTechtreeChatReadMock).not.toHaveBeenCalled();
  });

  it("routes techtree chat read with a scope", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["techtree", "chat", "read", "system", "--limit", "5"])).resolves.toBe(0);
    expect(runTechtreeChatReadMock).toHaveBeenCalledTimes(1);
    expect(runTechtreeChatListMock).not.toHaveBeenCalled();
  });

  it("routes techtree chat tail with a scope", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["techtree", "chat", "tail", "topic:protein-folding"])).resolves.toBe(0);
    expect(runTechtreeChatTailMock).toHaveBeenCalledTimes(1);
  });

  it("routes techtree chat send with a scope", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(
      runCliEntrypoint(["techtree", "chat", "send", "system", "--message", "hello"]),
    ).resolves.toBe(0);
    expect(runTechtreeChatSendMock).toHaveBeenCalledTimes(1);
  });

  it("routes techtree chat join with a node id", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["techtree", "chat", "join", "123"])).resolves.toBe(0);
    expect(runTechtreeChatJoinMock).toHaveBeenCalledTimes(1);
  });

  it("routes techtree dm with a target", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["techtree", "dm", "123", "--message", "hi"])).resolves.toBe(0);
    expect(runTechtreeDmMock).toHaveBeenCalledTimes(1);
    expect(runTechtreeDmListMock).not.toHaveBeenCalled();
  });

  it("routes techtree dm list to the list handler, not the dm target handler", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["techtree", "dm", "list"])).resolves.toBe(0);
    expect(runTechtreeDmListMock).toHaveBeenCalledTimes(1);
    expect(runTechtreeDmMock).not.toHaveBeenCalled();
  });
});
