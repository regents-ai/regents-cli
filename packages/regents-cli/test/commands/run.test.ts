import { afterEach, describe, expect, it } from "vitest";

import { pluginRuntimeCapabilities, renderRuntimeRunScreen } from "../../src/commands/run.js";

const originalNoColor = process.env.NO_COLOR;
const originalTerm = process.env.TERM;
const originalIsTTY = process.stdout.isTTY;
const originalColumns = process.stdout.columns;

const setStdoutTty = (value: boolean): void => {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  });
};

const setStdoutColumns = (value: number | undefined): void => {
  Object.defineProperty(process.stdout, "columns", {
    configurable: true,
    value,
  });
};

const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");

afterEach(() => {
  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = originalNoColor;
  }

  if (originalTerm === undefined) {
    delete process.env.TERM;
  } else {
    process.env.TERM = originalTerm;
  }

  setStdoutTty(Boolean(originalIsTTY));
  setStdoutColumns(originalColumns);
});

describe("regents run presenter", () => {
  it("reports Hermes and OpenClaw plugin readiness separately", () => {
    expect(pluginRuntimeCapabilities({
      ok: true,
      selectedRuntime: "auto",
      runtimes: [
        {
          runtime: "hermes",
          installed: true,
          pluginPath: "/Users/example/.hermes/plugins/regent",
          skillsPath: "/Users/example/.hermes/plugins/regent/skills",
        },
        {
          runtime: "openclaw",
          installed: false,
          pluginPath: "/Users/example/.openclaw/plugins/regent",
          skillsPath: "/Users/example/.openclaw/plugins/regent/skills",
        },
      ],
    })).toEqual([
      {
        state: "ready",
        label: "Hermes Regent tools installed",
        detail: "Hermes can see Regent tools at /Users/example/.hermes/plugins/regent.",
      },
      {
        state: "waiting",
        label: "OpenClaw Regent tools missing",
        detail: "Run regents plugin install --runtime openclaw. Checked /Users/example/.openclaw/plugins/regent.",
      },
    ]);
  });

  it("explains what local Regent access makes available", () => {
    setStdoutTty(true);
    setStdoutColumns(88);
    delete process.env.NO_COLOR;
    process.env.TERM = "xterm-256color";

    const output = stripAnsi(
      renderRuntimeRunScreen({
        ok: true,
        configPath: "/tmp/regent/config.json",
        socketPath: "/tmp/regent/run/regent.sock",
        stateDir: "/tmp/regent/state",
        services: {
          siwa: "https://siwa.example",
          techtree: "https://techtree.example",
          platform: "https://platform.example",
          autolaunch: "https://autolaunch.example",
        },
        capabilities: [
          {
            state: "ready",
            label: "Regent is running locally",
            detail: "Keep this terminal open.",
          },
          {
            state: "waiting",
            label: "Agent identity checked",
            detail: "Run regents identity ensure after Regent is running.",
          },
          {
            state: "off",
            label: "XMTP listener checked",
            detail: "XMTP listener is off in config.",
          },
        ],
        nextCommands: [
          {
            label: "Shared services sign-in",
            command: "regents auth login --audience regent-services",
            when: "prepare shared Regent actions.",
          },
          {
            label: "Techtree search",
            command: "regents techtree search --query <query>",
            when: "search Techtree.",
          },
        ],
        safetyNotes: [
          "It does not start hosted Regent.",
          "It does not move funds.",
        ],
        mode: "local_runtime",
        fold: null,
        agenticWallet: {
          required: false,
          whenNeeded: "Only paid x402 spend and earn flows need Agentic Wallet.",
        },
        autolaunch: {
          state: "locked",
          reason: "Techtree evidence is an input to readiness; it does not approve a launch by itself.",
        },
      }),
    );

    expect(output).toContain("REGENT IS RUNNING");
    expect(output).toContain("Keep this terminal open. Use another terminal for Regent commands.");
    expect(output).toContain("WHAT IS READY");
    expect(output).toContain("Agent identity checked");
    expect(output).toContain("RUN THESE IN ANOTHER TERMINAL");
    expect(output).toContain("regents auth login --audience regent-services");
    expect(output).toContain("regents techtree search --query <query>");
    expect(output).toContain("It does not start hosted Regent.");
    expect(output).toContain("It does not move funds.");
    expect(output).not.toContain("local runtime");
  });
});
