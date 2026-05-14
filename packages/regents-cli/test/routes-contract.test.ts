import { describe, expect, it } from "vitest";

import { CLI_COMMANDS } from "../src/command-registry.js";
import { cliRoutes } from "../src/routes/index.js";
import { routeMatches, type CliRoute } from "../src/routes/shared.js";

const withoutPlaceholders = (command: string): string =>
  command
    .split(" ")
    .filter((part) => !(part.startsWith("<") && part.endsWith(">")))
    .join(" ");

const positionalsForRoute = (route: CliRoute): string[] =>
  route.pattern.map((part) => (part.startsWith("<") && part.endsWith(">") ? "sample-id" : part));

describe("contract command route matching", () => {
  it("has a route for every generated contract command", () => {
    for (const command of CLI_COMMANDS) {
      expect(
        cliRoutes.some(
          (route) => route.command === command || withoutPlaceholders(route.command) === command,
        ),
        command,
      ).toBe(true);
    }
  });

  it("keeps non-tail routes exact", () => {
    const nonTailRoutes = cliRoutes.filter((route) => !route.variadicTail);

    for (const route of nonTailRoutes) {
      expect(routeMatches(route, [...positionalsForRoute(route), "unexpected-tail"]), route.command).toBe(false);
    }
  });

  it("only variadic-tail routes accept extra positional words", () => {
    const variadicRoutes = cliRoutes.filter((route) => route.variadicTail);

    expect(variadicRoutes.map((route) => route.command).sort()).toEqual([
      "agentbook sessions watch",
      "autolaunch jobs watch",
      "autolaunch launch monitor",
      "doctor",
      "feynman",
      "regent-staking account",
      "runtime checkpoint",
      "runtime get",
      "runtime health",
      "runtime pause",
      "runtime restore",
      "runtime resume",
      "runtime services",
      "search",
      "techtree autoskill buy",
      "techtree autoskill init eval",
      "techtree autoskill init skill",
      "techtree autoskill notebook pair",
      "techtree autoskill publish eval",
      "techtree autoskill publish result",
      "techtree autoskill publish skill",
      "techtree autoskill pull",
      "techtree bbh capsules get",
      "techtree bbh draft apply",
      "techtree bbh draft create",
      "techtree bbh draft init",
      "techtree bbh draft propose",
      "techtree bbh draft pull",
      "techtree bbh draft ready",
      "techtree bbh fetch",
      "techtree bbh genome improve",
      "techtree bbh genome init",
      "techtree bbh genome propose",
      "techtree bbh genome score",
      "techtree bbh notebook pair",
      "techtree bbh run exec",
      "techtree bbh run solve",
      "techtree bbh verify",
      "techtree certificate verify",
      "techtree main artifact compile",
      "techtree main artifact init",
      "techtree main artifact pin",
      "techtree main artifact publish",
      "techtree main fetch",
      "techtree main review compile",
      "techtree main review init",
      "techtree main review pin",
      "techtree main review publish",
      "techtree main run compile",
      "techtree main run exec",
      "techtree main run init",
      "techtree main run pin",
      "techtree main run publish",
      "techtree main verify",
      "techtree node cross-chain-links clear",
      "techtree node cross-chain-links create",
      "techtree node cross-chain-links list",
      "techtree node lineage claim",
      "techtree node lineage list",
      "techtree node lineage withdraw",
      "techtree review claim",
      "techtree review pull",
      "techtree review submit",
      "techtree science-tasks get",
      "work get",
      "work run",
      "work watch",
      "x402 search",
      "xmtp group add-admin",
      "xmtp group add-member",
      "xmtp group add-super-admin",
      "xmtp group admins",
      "xmtp group create",
      "xmtp group members",
      "xmtp group permissions",
      "xmtp group remove-admin",
      "xmtp group remove-member",
      "xmtp group remove-super-admin",
      "xmtp group super-admins",
      "xmtp group update-permission",
    ]);

    for (const route of variadicRoutes) {
      expect(routeMatches(route, [...positionalsForRoute(route), "tail"]), route.command).toBe(true);
    }
  });

  it("does not let value slots consume known command words", () => {
    const autolaunchAgentRoute = cliRoutes.find((route) => route.command === "autolaunch agent <id>");
    const techtreeWatchRoute = cliRoutes.find((route) => route.command === "techtree watch <id>");

    expect(autolaunchAgentRoute).toBeDefined();
    expect(techtreeWatchRoute).toBeDefined();
    expect(routeMatches(autolaunchAgentRoute!, ["autolaunch", "agent", "readiness"])).toBe(false);
    expect(routeMatches(techtreeWatchRoute!, ["techtree", "watch", "tail"])).toBe(false);
  });
});
