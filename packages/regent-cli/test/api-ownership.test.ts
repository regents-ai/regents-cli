import { describe, expect, it } from "vitest";

import { apiCommandOwnership } from "../src/contracts/api-ownership.js";

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
});
