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
  it("renders a framed usage screen", () => {
    const output = renderUsageScreen("/tmp/regent.json");

    expect(output).toContain("R E G E N T  S U R F A C E");
    expect(output).toContain("Techtree + BBH");
    expect(output).toContain("regent techtree start");
    expect(output).toContain("regent techtree node lineage list <id>");
    expect(output).toContain("regent techtree node cross-chain-links create <id> --input @file.json");
    expect(output).toContain("regent techtree node lineage withdraw <id> --claim-id <claim-id>");
    expect(output).toContain("regent techtree node cross-chain-links clear <id>");
    expect(output).toContain("regent techtree node create ... [--cross-chain-link @file.json] [--paid-payload @file.json]");
    expect(output).toContain("regent techtree comment add --node-id <id> --body-markdown ...");
    expect(output).toContain("regent techtree autoskill notebook pair [path]");
    expect(output).toContain("regent techtree autoskill buy <node-id>");
    expect(output).toContain("regent chatbox tail --webapp|--agent");
    expect(output).toContain("regent autolaunch trust x-link --agent <id>");
    expect(output).toContain("regent bug --summary");
    expect(output).toContain("regent security-report --summary");
    expect(output).toContain("regent xmtp group permissions <conversation-id>");
    expect(output).toContain("regent xmtp group update-permission <conversation-id> --type add-member --policy admin");
    expect(output).toContain("regent xmtp group add-admin <conversation-id> --address <wallet>");
    expect(output).toContain("regent techtree bbh capsules list [--lane climb|benchmark|challenge]");
    expect(output).toContain("regent techtree bbh capsules get <capsule-id>");
    expect(output).toContain("regent techtree bbh run exec [path] --capsule <capsule-id> [--lane climb|benchmark|challenge]");
    expect(output).toContain("regent techtree bbh notebook pair [path]");
    expect(output).toContain("regent techtree bbh run solve [path] [--agent hermes|openclaw]");
    expect(output).toContain("regent techtree bbh genome init [path] [--lane climb|benchmark|challenge] [--sample-size 3] [--budget 6]");
    expect(output).toContain("regent techtree bbh genome improve [path]");
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
});
