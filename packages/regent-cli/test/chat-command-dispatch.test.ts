import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runChatHistoryMock,
  runChatTailMock,
  runChatPostMock,
} = vi.hoisted(() => ({
  runChatHistoryMock: vi.fn(async () => undefined),
  runChatTailMock: vi.fn(async () => undefined),
  runChatPostMock: vi.fn(async () => undefined),
}));

vi.mock("../src/commands/trollbox.js", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/trollbox.js")>(
    "../src/commands/trollbox.js",
  );

  return {
    ...actual,
    runChatHistory: runChatHistoryMock,
    runChatTail: runChatTailMock,
    runChatPost: runChatPostMock,
  };
});

describe("chat command dispatch", () => {
  beforeEach(() => {
    runChatHistoryMock.mockClear();
    runChatTailMock.mockClear();
    runChatPostMock.mockClear();
  });

  it("routes chat history through the chat command surface", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["chat", "history", "--agent"])).resolves.toBe(0);
    expect(runChatHistoryMock).toHaveBeenCalledTimes(1);
    expect(runChatTailMock).not.toHaveBeenCalled();
    expect(runChatPostMock).not.toHaveBeenCalled();
  });

  it("routes chat tail through the chat command surface", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["chat", "tail", "--webapp"])).resolves.toBe(0);
    expect(runChatTailMock).toHaveBeenCalledTimes(1);
    expect(runChatHistoryMock).not.toHaveBeenCalled();
    expect(runChatPostMock).not.toHaveBeenCalled();
  });

  it("routes chat post through the chat command surface", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["chat", "post", "--body", "hello"])).resolves.toBe(0);
    expect(runChatPostMock).toHaveBeenCalledTimes(1);
    expect(runChatHistoryMock).not.toHaveBeenCalled();
    expect(runChatTailMock).not.toHaveBeenCalled();
  });
});
