import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runChatboxHistoryMock,
  runChatboxTailMock,
  runChatboxPostMock,
} = vi.hoisted(() => ({
  runChatboxHistoryMock: vi.fn(async () => undefined),
  runChatboxTailMock: vi.fn(async () => undefined),
  runChatboxPostMock: vi.fn(async () => undefined),
}));

vi.mock("../src/commands/chatbox.js", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/chatbox.js")>(
    "../src/commands/chatbox.js",
  );

  return {
    ...actual,
    runChatboxHistory: runChatboxHistoryMock,
    runChatboxTail: runChatboxTailMock,
    runChatboxPost: runChatboxPostMock,
  };
});

describe("chatbox command dispatch", () => {
  beforeEach(() => {
    runChatboxHistoryMock.mockClear();
    runChatboxTailMock.mockClear();
    runChatboxPostMock.mockClear();
  });

  it("routes chatbox history through the chatbox command surface", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["chatbox", "history", "--agent"])).resolves.toBe(0);
    expect(runChatboxHistoryMock).toHaveBeenCalledTimes(1);
    expect(runChatboxTailMock).not.toHaveBeenCalled();
    expect(runChatboxPostMock).not.toHaveBeenCalled();
  });

  it("routes chatbox tail through the chatbox command surface", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["chatbox", "tail", "--webapp"])).resolves.toBe(0);
    expect(runChatboxTailMock).toHaveBeenCalledTimes(1);
    expect(runChatboxHistoryMock).not.toHaveBeenCalled();
    expect(runChatboxPostMock).not.toHaveBeenCalled();
  });

  it("routes chatbox post through the chatbox command surface", async () => {
    const { runCliEntrypoint } = await import("../src/index.js");

    await expect(runCliEntrypoint(["chatbox", "post", "--body", "hello"])).resolves.toBe(0);
    expect(runChatboxPostMock).toHaveBeenCalledTimes(1);
    expect(runChatboxHistoryMock).not.toHaveBeenCalled();
    expect(runChatboxTailMock).not.toHaveBeenCalled();
  });
});
