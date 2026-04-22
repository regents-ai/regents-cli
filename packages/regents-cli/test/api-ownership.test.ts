import fs from "node:fs";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { apiCommandOwnership } from "../src/contracts/api-ownership.js";

const loadContractPathSet = (relativePath: string): Set<string> => {
  const contractPath = new URL(relativePath, import.meta.url);
  const source = fs.readFileSync(contractPath, "utf8");
  const document = parse(source) as { paths?: Record<string, unknown> };

  return new Set(Object.keys(document.paths ?? {}));
};

const contractPathsByOwner = {
  techtree: loadContractPathSet("../../../../techtree/docs/api-contract.openapiv3.yaml"),
  autolaunch: loadContractPathSet("../../../../autolaunch/docs/api-contract.openapiv3.yaml"),
  platform: loadContractPathSet("../../../../platform/api-contract.openapiv3.yaml"),
  "shared-services": new Set([
    ...loadContractPathSet("../../../docs/regent-services-contract.openapiv3.yaml"),
    ...loadContractPathSet("../../../../platform/api-contract.openapiv3.yaml"),
  ]),
} as const;

describe("API command ownership registry", () => {
  it("keeps every registered command string unique", () => {
    const commands = apiCommandOwnership.flatMap((group) => group.commands);
    expect(new Set(commands).size).toBe(commands.length);
  });

  it("does not mark any wired API-backed command as stale by default", () => {
    const staleGroups = apiCommandOwnership.filter(
      (group) => group.status === "stale" || group.status === "remove-before-freeze",
    );

    expect(staleGroups).toEqual([]);
  });

  it("keeps every declared contract path aligned with the source contract files", () => {
    const missingPaths = apiCommandOwnership.flatMap((group) =>
      group.pathTemplates
        .filter((pathTemplate) => !contractPathsByOwner[group.owner].has(pathTemplate))
        .map((pathTemplate) => ({
          owner: group.owner,
          commands: group.commands,
          pathTemplate,
        })),
    );

    expect(missingPaths).toEqual([]);
  });

  it("only leaves path templates empty for explicitly hybrid command groups", () => {
    const invalidEmptyGroups = apiCommandOwnership.filter(
      (group) =>
        group.pathTemplates.length === 0 &&
        (group.status !== "current-hybrid" || !group.note),
    );

    expect(invalidEmptyGroups).toEqual([]);
  });
});
