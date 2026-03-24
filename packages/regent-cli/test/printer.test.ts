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
    expect(output).toContain("regent techtree bbh run exec [path] --lane climb|benchmark|challenge");
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
