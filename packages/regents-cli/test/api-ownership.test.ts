import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { CLI_COMMANDS } from "../src/command-registry.js";
import { apiCommandOwnership } from "../src/contracts/api-ownership.js";

const loadGeneratedPathSet = (relativePath: string): Set<string> => {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
  return new Set(Array.from(source.matchAll(/^    "([^"]+)": \{$/gmu), (match) => match[1]));
};

const pathsByOwner = {
  techtree: loadGeneratedPathSet("../src/generated/techtree-openapi.ts"),
  autolaunch: loadGeneratedPathSet("../src/generated/autolaunch-openapi.ts"),
  platform: loadGeneratedPathSet("../src/generated/platform-openapi.ts"),
  "shared-services": new Set([
    ...loadGeneratedPathSet("../src/generated/regent-services-openapi.ts"),
    ...loadGeneratedPathSet("../src/generated/platform-openapi.ts"),
  ]),
} as const;

describe("API command ownership registry", () => {
  it("keeps every registered command string unique and shipped locally", () => {
    const commands = apiCommandOwnership.flatMap((group) => group.commands);
    expect(new Set(commands).size).toBe(commands.length);
    expect(commands.filter((command) => !CLI_COMMANDS.includes(command))).toEqual([]);
  });

  it("uses only current status labels", () => {
    expect(new Set(apiCommandOwnership.map((group) => group.status))).toEqual(
      new Set(["current", "current-local-and-api"]),
    );
  });

  it("keeps declared paths aligned with repository-local copied API bindings", () => {
    const missingPaths = apiCommandOwnership.flatMap((group) =>
      group.pathTemplates
        .filter((pathTemplate) => !pathsByOwner[group.owner].has(pathTemplate))
        .map((pathTemplate) => ({ owner: group.owner, commands: group.commands, pathTemplate })),
    );
    expect(missingPaths).toEqual([]);
  });

  it("only leaves paths empty for documented local-and-API command groups", () => {
    expect(apiCommandOwnership.filter(
      (group) => group.pathTemplates.length === 0 && (group.status !== "current-local-and-api" || !group.note),
    )).toEqual([]);
  });

  it("registers the full science-task CLI surface against its copied binding", () => {
    const group = apiCommandOwnership.find((entry) => entry.commands.includes("techtree science-tasks list"));
    expect(group).toMatchObject({
      owner: "techtree",
      status: "current",
      commands: [
        "techtree science-tasks list", "techtree science-tasks get", "techtree science-tasks init",
        "techtree science-tasks checklist", "techtree science-tasks evidence", "techtree science-tasks export",
        "techtree science-tasks submit", "techtree science-tasks review-update", "techtree science-tasks review-loop",
      ],
    });
    for (const pathTemplate of group?.pathTemplates ?? []) expect(pathsByOwner.techtree.has(pathTemplate)).toBe(true);
  });

  it("registers the Terminal Science run lane against its copied binding", () => {
    const group = apiCommandOwnership.find((entry) => entry.commands.includes("techtree science run"));
    expect(group).toMatchObject({
      owner: "techtree",
      status: "current",
      commands: ["techtree science set-goal", "techtree science agent set <agent>", "techtree science run"],
    });
    for (const pathTemplate of group?.pathTemplates ?? []) expect(pathsByOwner.techtree.has(pathTemplate)).toBe(true);
  });
});
