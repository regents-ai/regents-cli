import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCliArgs } from "../../src/parse.js";
import {
  runTechtreeInbox,
  runTechtreeOpportunities,
  runTechtreeWatchList,
} from "../../src/commands/techtree-watch.js";
import { captureOutput, parsePrintedJson } from "../helpers/output.js";

const { daemonCallMock } = vi.hoisted(() => ({
  daemonCallMock: vi.fn(),
}));

vi.mock("../../src/daemon-client.js", () => ({
  daemonCall: daemonCallMock,
}));

const originalNoColor = process.env.NO_COLOR;
const originalTerm = process.env.TERM;
const originalIsTTY = process.stdout.isTTY;
const originalColumns = process.stdout.columns;

const setStdoutTty = (value: boolean | undefined): void => {
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

const useHumanTerminal = (): void => {
  setStdoutTty(true);
  setStdoutColumns(72);
  delete process.env.NO_COLOR;
  process.env.TERM = "xterm-256color";
};

const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");
const collapsePanelText = (value: string): string =>
  value.replace(/[│╭╮╰╯─]/gu, " ").replace(/\s+/g, " ").trim();

afterEach(() => {
  daemonCallMock.mockReset();

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

  setStdoutTty(originalIsTTY);
  setStdoutColumns(originalColumns);
});

describe("techtree watch and opportunity presenters", () => {
  it("renders watched nodes as a compact table for human terminals", async () => {
    useHumanTerminal();
    daemonCallMock.mockResolvedValue({
      data: [
        {
          id: 1,
          node_id: 42,
          watcher_type: "agent",
          watcher_ref: 7,
          inserted_at: "2026-06-19T00:00:00.000Z",
        },
      ],
    });

    const output = await captureOutput(() =>
      runTechtreeWatchList(parseCliArgs(["techtree", "watch", "list"])),
    );

    const text = collapsePanelText(stripAnsi(output.stdout));
    expect(output.stderr).toBe("");
    expect(text).toContain("WATCHED NODES");
    expect(text).toContain("42");
    expect(text).toContain("agent:7");
  });

  it("renders inbox and opportunity results as compact human tables", async () => {
    useHumanTerminal();
    daemonCallMock
      .mockResolvedValueOnce({
        events: [
          {
            id: 10,
            subject_node_id: 42,
            actor_type: "agent",
            actor_ref: 7,
            event_type: "comment",
            stream: "agent_inbox",
            payload: {},
            inserted_at: "2026-06-19T00:00:00.000Z",
          },
        ],
        next_cursor: 11,
      })
      .mockResolvedValueOnce({
        opportunities: [
          {
            node_id: 42,
            title: "Long but useful node title",
            seed: "ml",
            kind: "hypothesis",
            opportunity_type: "review",
            activity_score: "1.0",
          },
        ],
      });

    const inbox = await captureOutput(() =>
      runTechtreeInbox(["techtree", "inbox", "--limit", "1"]),
    );
    const opportunities = await captureOutput(() =>
      runTechtreeOpportunities(["techtree", "opportunities", "--kind", "review"]),
    );

    expect(collapsePanelText(stripAnsi(inbox.stdout))).toContain("TECHTREE INBOX");
    expect(collapsePanelText(stripAnsi(inbox.stdout))).toContain("regents techtree inbox --cursor 11");
    expect(collapsePanelText(stripAnsi(opportunities.stdout))).toContain("TECHTREE OPPORTUNITIES");
    expect(collapsePanelText(stripAnsi(opportunities.stdout))).toContain("Long but useful node title");
  });

  it("keeps JSON output machine-safe when --json is passed", async () => {
    useHumanTerminal();
    const response = {
      events: [],
      next_cursor: null,
    };
    daemonCallMock.mockResolvedValue(response);

    const output = await captureOutput(() =>
      runTechtreeInbox(["techtree", "inbox", "--json"]),
    );

    expect(parsePrintedJson(output.stdout)).toEqual(response);
    expect(output.stdout).not.toContain("TECHTREE INBOX");
  });
});
