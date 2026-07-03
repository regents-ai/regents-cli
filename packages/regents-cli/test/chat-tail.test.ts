import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestProductResponseMock } = vi.hoisted(() => ({
  requestProductResponseMock: vi.fn(),
}));

vi.mock("../src/internal-runtime/product-http-client.js", async () => {
  const actual = await vi.importActual<typeof import("../src/internal-runtime/product-http-client.js")>(
    "../src/internal-runtime/product-http-client.js",
  );

  return {
    ...actual,
    requestProductResponse: requestProductResponseMock,
  };
});

const { tailAutolaunchChatScopes, tailChatScopes } = await import("../src/commands/chat.js");

const streamResponse = (lines: readonly unknown[], status = 200): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status,
    headers: { "content-type": "application/x-ndjson" },
  });
};

const captureOutput = async (run: () => Promise<unknown>): Promise<{
  stdout: string;
  stderr: string;
  result?: unknown;
  error?: unknown;
}> => {
  let stdout = "";
  let stderr = "";
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;

  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    const result = await run();
    return { stdout, stderr, result };
  } catch (error) {
    return { stdout, stderr, error };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
};

describe("chat tail", () => {
  beforeEach(() => {
    requestProductResponseMock.mockReset();
  });

  it("prints newline-delimited live events from the Techtree HTTP stream", async () => {
    requestProductResponseMock.mockResolvedValueOnce({
      requestId: "req-1",
      response: streamResponse([
        { event: "ready", scopes: ["system"] },
        {
          event: "message.created",
          message: { id: 1, scope: "system", body: "first event" },
        },
        { event: "heartbeat", scope: "system" },
        {
          event: "reaction.updated",
          message: { id: 1, scope: "system", body: "first event", reactions: { ":+1:": 1 } },
        },
      ]),
    });

    const output = await captureOutput(async () => tailChatScopes(["system"], null, "/tmp/regent.config.json"));

    expect(output.stderr).toBe("");
    expect(requestProductResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "techtree",
        method: "GET",
        path: "/api/techtree/v1/chat/stream?scopes=system",
        configPath: "/tmp/regent.config.json",
        timeoutMs: 0,
      }),
    );
    expect(output.stdout).toBe(
      `${JSON.stringify({
        event: "message.created",
        message: { id: 1, scope: "system", body: "first event" },
      })}\n${JSON.stringify({
        event: "reaction.updated",
        message: { id: 1, scope: "system", body: "first event", reactions: { ":+1:": 1 } },
      })}\n`,
    );
  });

  it("subscribes Autolaunch tail to the requested HTTP stream scopes", async () => {
    requestProductResponseMock.mockResolvedValueOnce({
      requestId: "req-2",
      response: streamResponse([]),
    });

    const output = await captureOutput(async () =>
      tailAutolaunchChatScopes(["topic:auctions", "token:abc"], null, "/tmp/regent.config.json"),
    );

    expect(output.stderr).toBe("");
    expect(requestProductResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "autolaunch",
        method: "GET",
        path: "/api/autolaunch/v1/chat/stream?scopes=topic%3Aauctions%2Ctoken%3Aabc",
        configPath: "/tmp/regent.config.json",
        timeoutMs: 0,
      }),
    );
  });

  it("honors --json on a human terminal instead of the chat panel", async () => {
    const events = [
      { event: "ready", scopes: ["system"] },
      {
        event: "message.created",
        message: { id: 7, scope: "system", body: "tty json event" },
      },
    ];
    requestProductResponseMock.mockResolvedValueOnce({
      requestId: "req-tty-json",
      response: streamResponse(events),
    });

    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const previousTerm = process.env.TERM;
    const previousNoColor = process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.TERM = "xterm-256color";
    delete process.env.NO_COLOR;

    try {
      const output = await captureOutput(async () =>
        tailChatScopes(["system"], null, "/tmp/regent.config.json", true),
      );

      expect(output.stderr).toBe("");
      expect(output.stdout).toBe(
        `${JSON.stringify({
          event: "message.created",
          message: { id: 7, scope: "system", body: "tty json event" },
        })}\n`,
      );
    } finally {
      if (isTTY) {
        Object.defineProperty(process.stdout, "isTTY", isTTY);
      } else {
        delete (process.stdout as unknown as Record<string, unknown>).isTTY;
      }
      process.env.TERM = previousTerm;
      if (previousNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previousNoColor;
      }
    }
  });

  it("keeps the human chat panel on a terminal without --json", async () => {
    requestProductResponseMock.mockResolvedValueOnce({
      requestId: "req-tty-human",
      response: streamResponse([{ event: "ready", scopes: ["system"] }]),
    });

    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const previousTerm = process.env.TERM;
    const previousNoColor = process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    process.env.TERM = "xterm-256color";
    delete process.env.NO_COLOR;

    try {
      const output = await captureOutput(async () =>
        tailChatScopes(["system"], null, "/tmp/regent.config.json"),
      );

      expect(output.stdout).toContain("CHAT LISTENING");
    } finally {
      if (isTTY) {
        Object.defineProperty(process.stdout, "isTTY", isTTY);
      } else {
        delete (process.stdout as unknown as Record<string, unknown>).isTTY;
      }
      process.env.TERM = previousTerm;
      if (previousNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previousNoColor;
      }
    }
  });

  it("surfaces HTTP stream failures", async () => {
    requestProductResponseMock.mockResolvedValueOnce({
      requestId: "req-3",
      response: new Response(
        JSON.stringify({ error: { code: "too_many_chat_scopes", message: "Choose fewer rooms." } }),
        {
          status: 422,
          headers: { "content-type": "application/json" },
        },
      ),
    });

    await expect(tailChatScopes(["system"], null, "/tmp/regent.config.json")).rejects.toThrow(
      "Choose fewer rooms.",
    );
  });
});
