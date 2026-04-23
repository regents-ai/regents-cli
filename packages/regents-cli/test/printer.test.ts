import { afterEach, describe, expect, it } from "vitest";

import { captureOutput } from "../../../test-support/test-helpers.js";

import { printError, printJson, renderUsageScreen } from "../src/printer.js";

const originalNoColor = process.env.NO_COLOR;
const originalIsTTY = process.stdout.isTTY;

const setStdoutTty = (value: boolean): void => {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  });
};

afterEach(() => {
  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = originalNoColor;
  }

  setStdoutTty(Boolean(originalIsTTY));
});

describe("printer surface", () => {
  const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");

  it("renders a framed usage screen", () => {
    const output = renderUsageScreen("/tmp/regent.json");

    expect(output).toContain("R E G E N T   C L I");
    expect(output).toContain("START HERE");
    expect(output).toContain("IDENTITY + SETUP");
    expect(output).toContain("TECHTREE");
    expect(output).toContain("BBH LOOP");
    expect(output).toContain("MESSAGING + ADJACENT WORK");
    expect(output).toContain("start with the guided path");
    expect(output).toContain("use regents.sh/services for guided setup, billing, claimed names, and company launch");
    expect(output).toContain("use regents techtree start for most Techtree setups");
    expect(output).toContain("it checks local config, the runtime, identity, Techtree readiness, and BBH readiness");
    expect(output).toContain("if this is not the page you expected, check the command spelling or run `regents --help`");
    expect(output).toContain("regents techtree start");
    expect(output).toContain("regents techtree node lineage list <id>");
    expect(output).toContain("regents techtree node cross-chain-links create <id> --input @file.json");
    expect(output).toContain("regents techtree node lineage withdraw <id> --claim-id <claim-id>");
    expect(output).toContain("regents techtree node cross-chain-links clear <id>");
    expect(output).toContain("regents techtree node create ... [--cross-chain-link @file.json] [--paid-payload @file.json]");
    expect(output).toContain("regents techtree comment add --node-id <id> --body-markdown ...");
    expect(output).toContain("regents techtree science-tasks list [--limit 20] [--stage draft]");
    expect(output).toContain("regents techtree science-tasks get <id>");
    expect(output).toContain("regents techtree science-tasks init --workspace-path ... --title ...");
    expect(output).toContain("regents techtree science-tasks checklist --workspace-path ...");
    expect(output).toContain("regents techtree science-tasks evidence --workspace-path ...");
    expect(output).toContain("regents techtree science-tasks export --workspace-path ... [--output-path ...]");
    expect(output).toContain("regents techtree science-tasks submit --workspace-path ... --pr-url ...");
    expect(output).toContain("regents techtree science-tasks review-update --workspace-path ... --pr-url ...");
    expect(output).toContain("regents techtree science-tasks review-loop --workspace-path ... --pr-url ...");
    expect(output).toContain("regents techtree autoskill notebook pair [path]");
    expect(output).toContain("regents techtree autoskill buy <node-id>");
    expect(output).toContain("regents chatbox tail --webapp|--agent");
    expect(output).toContain("regents autolaunch trust x-link --agent <id>");
    expect(output).toContain("regents bug --summary");
    expect(output).toContain("regents security-report --summary");
    expect(output).toContain("regents xmtp group permissions <conversation-id>");
    expect(output).toContain("regents xmtp group update-permission <conversation-id> --type add-member --policy admin");
    expect(output).toContain("regents xmtp group add-admin <conversation-id> --address <wallet>");
    expect(output).toContain("regents techtree bbh capsules list [--lane climb|benchmark|challenge]");
    expect(output).toContain("regents techtree bbh capsules get <capsule-id>");
    expect(output).toContain("regents techtree bbh run exec [path] --capsule <capsule-id> [--lane climb|benchmark|challenge]");
    expect(output).toContain("regents techtree bbh notebook pair [path]");
    expect(output).toContain("regents techtree bbh run solve [path] --solver hermes|openclaw|skydiscover");
    expect(output).toContain("◆ BBH AFTER SETUP");
    expect(output).toContain("run exec creates the BBH run folder");
    expect(output).toContain("SkyDiscover adds the search pass inside the run folder");
    expect(output).toContain("Hypotest scores the run and checks replay during validation");
    expect(output).toContain("regents techtree bbh genome init [path] [--lane climb|benchmark|challenge] [--sample-size 3] [--budget 6]");
    expect(output).toContain("regents techtree bbh genome improve [path]");
  });

  it("renders a receipt-style summary for setup records", async () => {
    setStdoutTty(true);
    delete process.env.NO_COLOR;

    const output = await captureOutput(async () => {
      printJson({
        ok: true,
        configPath: "/tmp/regent.json",
        configCreated: true,
        stateDir: "/tmp/state",
        socketPath: "/tmp/run/regent.sock",
      });
    });

    expect(output.stdout).toContain("REGENT SUMMARY");
    expect(output.stdout).toContain("config created");
    expect(output.stdout).toContain("state dir");
    expect(output.stdout).toContain("/tmp/regent.json");
    expect(output.stdout).toContain("REGENT OUTPUT DECK");
  });

  it("renders framed JSON output for human terminals", async () => {
    setStdoutTty(true);
    delete process.env.NO_COLOR;

    const output = await captureOutput(async () => {
      printJson({
        data: {
          lane: "benchmark",
          entries: [],
        },
      });
    });

    expect(output.stdout).toContain("REGENT DATA DECK");
    expect(output.stdout).toContain("lane");
    expect(output.stdout).toContain("benchmark");
    expect(output.stdout).toContain("╭");
  });

  it("renders a framed error for human terminals", async () => {
    setStdoutTty(true);
    delete process.env.NO_COLOR;

    const output = await captureOutput(async () => {
      printError(new Error("operator shell failed"));
    });

    expect(output.stderr).toContain("REGENT ERROR");
    expect(output.stderr).toContain("operator shell failed");
    expect(output.stderr).toContain("╭");
  });

  it("escapes terminal control characters in human summaries", async () => {
    setStdoutTty(true);
    delete process.env.NO_COLOR;

    const output = await captureOutput(async () => {
      printJson({
        ok: true,
        configPath: "/tmp/\x1b[31mred.json",
      });
    });

    const visible = stripAnsi(output.stdout);

    expect(visible).toContain("/tmp/\\u001b[31mred.json");
    expect(visible).not.toContain("/tmp/\x1b[31mred.json");
  });

  it("keeps plain JSON output for non-human terminals", async () => {
    setStdoutTty(false);
    delete process.env.NO_COLOR;

    const payload = {
      ok: true,
      configPath: "/tmp/regent.json",
    };
    const output = await captureOutput(async () => {
      printJson(payload);
    });

    expect(output.stdout).toBe(`${JSON.stringify(payload, null, 2)}\n`);
  });
});
