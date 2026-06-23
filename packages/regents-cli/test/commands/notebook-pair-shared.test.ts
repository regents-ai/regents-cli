import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, isHumanTerminalMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  isHumanTerminalMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("../../src/printer.js", () => ({
  isHumanTerminal: isHumanTerminalMock,
}));

describe("notebook pair launcher", () => {
  let originalPlatformAccessToken: string | undefined;
  let originalWalletPrivateKey: string | undefined;
  let originalPath: string | undefined;

  beforeEach(() => {
    spawnMock.mockReset();
    isHumanTerminalMock.mockReset();
    isHumanTerminalMock.mockReturnValue(true);
    originalPlatformAccessToken = process.env.REGENT_PLATFORM_ACCESS_TOKEN;
    originalWalletPrivateKey = process.env.WALLET_PRIVATE_KEY;
    originalPath = process.env.PATH;
    delete process.env.REGENT_PLATFORM_ACCESS_TOKEN;
    delete process.env.WALLET_PRIVATE_KEY;
  });

  afterEach(() => {
    if (originalPlatformAccessToken === undefined) {
      delete process.env.REGENT_PLATFORM_ACCESS_TOKEN;
    } else {
      process.env.REGENT_PLATFORM_ACCESS_TOKEN = originalPlatformAccessToken;
    }

    if (originalWalletPrivateKey === undefined) {
      delete process.env.WALLET_PRIVATE_KEY;
    } else {
      process.env.WALLET_PRIVATE_KEY = originalWalletPrivateKey;
    }

    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  });

  it("spawns the notebook editor with argv tokens intact", async () => {
    const child = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === "close") {
          handler(0);
        }
        return child;
      }),
    };

    spawnMock.mockReturnValue(child as never);

    const { parseCliArgs } = await import("../../src/parse.js");
    const { maybeLaunchNotebook } = await import("../../src/commands/notebook-pair-shared.js");

    const args = parseCliArgs(["techtree", "bbh", "notebook", "pair", "workspace"]);
    await maybeLaunchNotebook(args, {
      workspace_path: "/tmp/workspace",
      launch_argv: ["uvx", "marimo", "edit", "notebook with space.py"],
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "uvx",
      ["marimo", "edit", "notebook with space.py"],
      expect.objectContaining({
        cwd: "/tmp/workspace",
        stdio: "inherit",
      }),
    );
    expect(child.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(child.on).toHaveBeenCalledWith("close", expect.any(Function));
  });

  it("does not pass wallet keys or service tokens to the notebook editor", async () => {
    process.env.REGENT_PLATFORM_ACCESS_TOKEN = "secret-access-token";
    process.env.WALLET_PRIVATE_KEY = "0xsecret";
    process.env.PATH = "/usr/bin";

    const child = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === "close") {
          handler(0);
        }
        return child;
      }),
    };

    spawnMock.mockReturnValue(child as never);

    const { parseCliArgs } = await import("../../src/parse.js");
    const { maybeLaunchNotebook } = await import("../../src/commands/notebook-pair-shared.js");

    const args = parseCliArgs(["techtree", "bbh", "notebook", "pair", "workspace"]);
    await maybeLaunchNotebook(args, {
      workspace_path: "/tmp/workspace",
      launch_argv: ["uvx", "marimo", "edit", "notebook.py"],
    });

    const options = spawnMock.mock.calls[0]?.[2] as { env?: NodeJS.ProcessEnv };
    expect(options.env?.PATH).toBe("/usr/bin");
    expect(options.env?.REGENT_PLATFORM_ACCESS_TOKEN).toBeUndefined();
    expect(options.env?.WALLET_PRIVATE_KEY).toBeUndefined();
  });

  it("stays quiet when --no-open is set", async () => {
    const { parseCliArgs } = await import("../../src/parse.js");
    const { maybeLaunchNotebook } = await import(
      "../../src/commands/notebook-pair-shared.js"
    );

    const args = parseCliArgs([
      "techtree",
      "bbh",
      "notebook",
      "pair",
      "workspace",
      "--no-open",
    ]);
    await maybeLaunchNotebook(args, {
      workspace_path: "/tmp/workspace",
      launch_argv: ["uvx", "marimo", "edit", "notebook with space.py"],
    });

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("stays quiet in a non-interactive terminal", async () => {
    isHumanTerminalMock.mockReturnValue(false);

    const { parseCliArgs } = await import("../../src/parse.js");
    const { maybeLaunchNotebook } = await import(
      "../../src/commands/notebook-pair-shared.js"
    );

    const args = parseCliArgs(["techtree", "bbh", "notebook", "pair", "workspace"]);
    await maybeLaunchNotebook(args, {
      workspace_path: "/tmp/workspace",
      launch_argv: ["uvx", "marimo", "edit", "notebook with space.py"],
    });

    expect(spawnMock).not.toHaveBeenCalled();
  });
});
