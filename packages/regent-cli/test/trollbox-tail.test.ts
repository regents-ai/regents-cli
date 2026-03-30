import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeSocket extends EventEmitter {
  ended = false;
  destroyed = false;
  encoding: string | null = null;
  writes: string[] = [];

  setEncoding(encoding: string): this {
    this.encoding = encoding;
    return this;
  }

  write(chunk: string): this {
    this.writes.push(chunk);
    return this;
  }

  end(): this {
    this.ended = true;
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }
}

const daemonCallMock = vi.fn();
const createConnectionMock = vi.fn();

vi.mock("../src/daemon-client.js", () => ({
  daemonCall: daemonCallMock,
}));

vi.mock("node:net", () => ({
  default: {
    createConnection: createConnectionMock,
  },
}));

const { runTrollboxTail } = await import("../src/commands/trollbox.js");

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

describe("trollbox tail", () => {
  beforeEach(() => {
    daemonCallMock.mockReset();
    createConnectionMock.mockReset();
  });

  it("prints newline-delimited live events from the daemon-owned relay socket", async () => {
    const socket = new FakeSocket();
    createConnectionMock.mockImplementationOnce((socketPath: string) => {
      expect(socketPath).toBe("/tmp/runtime.trollbox.sock");

      queueMicrotask(() => {
        socket.emit("connect");
        socket.emit(
          "data",
          `${JSON.stringify({
            event: "message.created",
            message: { id: 1, body: "first event" },
          })}\n`,
        );
        socket.emit(
          "data",
          `${JSON.stringify({
            event: "reaction.updated",
            message: { id: 1, body: "first event", reactions: { ":+1:": 1 } },
          })}\n`,
        );
        socket.emit("close");
      });

      return socket;
    });

    daemonCallMock.mockResolvedValue({
      enabled: true,
      eventSocketPath: "/tmp/runtime.trollbox.sock",
    });

    const output = await captureOutput(async () => runTrollboxTail(undefined, "/tmp/regent.config.json"));

    expect(output.stderr).toBe("");
    expect(socket.encoding).toBe("utf8");
    expect(socket.writes).toEqual([`${JSON.stringify({ room: "webapp" })}\n`]);
    expect(socket.ended).toBe(true);
    expect(socket.destroyed).toBe(true);

    expect(output.stdout).toBe(
      `${JSON.stringify(
        {
          event: "message.created",
          message: { id: 1, body: "first event" },
        },
        null,
        2,
      )}\n${JSON.stringify(
        {
          event: "reaction.updated",
          message: { id: 1, body: "first event", reactions: { ":+1:": 1 } },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("fails fast when the runtime reports that transport is disabled", async () => {
    daemonCallMock.mockResolvedValue({
      enabled: false,
      eventSocketPath: null,
    });

    await expect(runTrollboxTail(undefined, "/tmp/regent.config.json")).rejects.toThrow(
      "trollbox transport is disabled in config",
    );
    expect(createConnectionMock).not.toHaveBeenCalled();
  });

  it("sends agent room subscription when --agent is provided", async () => {
    const socket = new FakeSocket();
    createConnectionMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        socket.emit("connect");
        socket.emit("close");
      });
      return socket;
    });

    daemonCallMock.mockResolvedValue({
      enabled: true,
      eventSocketPath: "/tmp/runtime.trollbox.sock",
    });

    const output = await captureOutput(async () =>
      runTrollboxTail(
        {
          raw: ["chat", "tail", "--agent"],
          positionals: ["chat", "tail"],
          flags: new Map([["agent", true]]),
        },
        "/tmp/regent.config.json",
      ),
    );

    expect(output.stderr).toBe("");
    expect(socket.writes).toEqual([`${JSON.stringify({ room: "agent" })}\n`]);
  });

  it("rejects removed --room usage before connecting", async () => {
    await expect(
      runTrollboxTail(
        {
          raw: ["trollbox", "tail", "--room", "invalid"],
          positionals: ["trollbox", "tail"],
          flags: new Map([["room", "invalid"]]),
        },
        "/tmp/regent.config.json",
      ),
    ).rejects.toThrow("`--room` was removed; use `--agent` or `--webapp`");

    expect(daemonCallMock).not.toHaveBeenCalled();
    expect(createConnectionMock).not.toHaveBeenCalled();
  });
});
