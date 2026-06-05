import fs from "node:fs";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { apiCommandOwnership } from "../src/contracts/api-ownership.js";

interface OpenApiOperation {
  operationId?: string;
}

interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

interface CliCommand {
  name?: string;
  availability?: string;
  transport?: {
    kind?: string;
    operationIds?: string[];
  };
}

interface CliCommandGroup {
  interface?: string;
  path_templates?: string[];
}

interface CliContract {
  commands?: CliCommand[];
  command_groups?: CliCommandGroup[];
}

const loadYamlDocument = <T>(relativePath: string): T => {
  const contractPath = new URL(relativePath, import.meta.url);
  const source = fs.readFileSync(contractPath, "utf8");
  return parse(source) as T;
};

const loadContractPathSet = (relativePath: string): Set<string> => {
  const document = loadYamlDocument<{ paths?: Record<string, unknown> }>(relativePath);

  return new Set(Object.keys(document.paths ?? {}));
};

const loadOperationPathMap = (relativePath: string): Map<string, string> => {
  const document = loadYamlDocument<OpenApiDocument>(relativePath);
  const operationPaths = new Map<string, string>();

  for (const [pathTemplate, methods] of Object.entries(document.paths ?? {})) {
    for (const operation of Object.values(methods ?? {})) {
      if (typeof operation.operationId === "string") {
        operationPaths.set(operation.operationId, pathTemplate);
      }
    }
  }

  return operationPaths;
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

const ownershipCommandsByOwner = (owner: (typeof apiCommandOwnership)[number]["owner"]): Set<string> =>
  new Set(apiCommandOwnership.filter((group) => group.owner === owner).flatMap((group) => group.commands));

const ownershipPathsByOwner = (owner: (typeof apiCommandOwnership)[number]["owner"]): Set<string> =>
  new Set(apiCommandOwnership.filter((group) => group.owner === owner).flatMap((group) => group.pathTemplates));

const normalizeCommandName = (command: string): string => command.replace(/^regents?\s+/u, "");
const currentAvailabilityValues = new Set(["current"]);
const platformPublicCommand = (command: string): boolean =>
  command.startsWith("platform ") ||
  command.startsWith("runtime ") ||
  command.startsWith("agentbook ") ||
  command.startsWith("work ") ||
  command === "agent connect hermes" ||
  command === "agent connect openclaw" ||
  command === "agent link" ||
  command === "agent execution-pool" ||
  command === "bug" ||
  command === "security-report" ||
  command.startsWith("regent-staking ");

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

  it("registers every current Platform API-backed CLI command", () => {
    const platformCliContract = loadYamlDocument<CliContract>("../../../../platform/cli-contract.yaml");
    const platformOwnership = ownershipCommandsByOwner("platform");
    const missingCommands = (platformCliContract.commands ?? [])
      .filter((command) => {
        const commandName = typeof command.name === "string" ? normalizeCommandName(command.name) : "";
        const availability = command.availability ?? "current";

        return (
          platformPublicCommand(commandName) &&
          currentAvailabilityValues.has(availability) &&
          command.transport?.kind !== "beta-disabled" &&
          Array.isArray(command.transport?.operationIds) &&
          command.transport.operationIds.length > 0
        );
      })
      .map((command) => normalizeCommandName(command.name ?? ""))
      .filter((command) => !platformOwnership.has(command));

    expect(missingCommands).toEqual([]);
  });

  it("registers every Platform and Autolaunch CLI contract API path", () => {
    const platformCliContract = loadYamlDocument<CliContract>("../../../../platform/cli-contract.yaml");
    const platformOperationPaths = loadOperationPathMap("../../../../platform/api-contract.openapiv3.yaml");
    const platformContractPaths = new Set(
      (platformCliContract.commands ?? []).flatMap((command) =>
        (command.transport?.operationIds ?? []).flatMap((operationId) => {
          const pathTemplate = platformOperationPaths.get(operationId);
          return pathTemplate ? [pathTemplate] : [];
        }),
      ),
    );

    const autolaunchCliContract = loadYamlDocument<CliContract>("../../../../autolaunch/docs/cli-contract.yaml");
    const autolaunchContractPaths = new Set(
      (autolaunchCliContract.command_groups ?? [])
        .filter((group) => group.interface !== "local" && group.interface !== "onchain")
        .flatMap((group) => group.path_templates ?? []),
    );

    const missingPaths = [
      ...Array.from(platformContractPaths)
        .filter((pathTemplate) => !ownershipPathsByOwner("platform").has(pathTemplate))
        .map((pathTemplate) => ({ owner: "platform", pathTemplate })),
      ...Array.from(autolaunchContractPaths)
        .filter((pathTemplate) => !ownershipPathsByOwner("autolaunch").has(pathTemplate))
        .map((pathTemplate) => ({ owner: "autolaunch", pathTemplate })),
    ];

    expect(missingPaths).toEqual([]);
  });

  it("registers the full science-task CLI surface against the Techtree contract", () => {
    const scienceTaskGroup = apiCommandOwnership.find((group) =>
      group.commands.includes("techtree science-tasks list"),
    );

    expect(scienceTaskGroup).toMatchObject({
      owner: "techtree",
      status: "current",
      commands: [
        "techtree science-tasks list",
        "techtree science-tasks get",
        "techtree science-tasks init",
        "techtree science-tasks checklist",
        "techtree science-tasks evidence",
        "techtree science-tasks export",
        "techtree science-tasks submit",
        "techtree science-tasks review-update",
        "techtree science-tasks review-loop",
      ],
      pathTemplates: [
        "/v1/science-tasks",
        "/v1/science-tasks/{id}",
        "/v1/agent/science-tasks",
        "/v1/agent/science-tasks/{id}/checklist",
        "/v1/agent/science-tasks/{id}/evidence",
        "/v1/agent/science-tasks/{id}/submit",
        "/v1/agent/science-tasks/{id}/review-update",
      ],
    });
  });

  it("registers the Terminal Science run lane against the Techtree contract", () => {
    const scienceGroup = apiCommandOwnership.find((group) =>
      group.commands.includes("techtree science run"),
    );

    expect(scienceGroup).toMatchObject({
      owner: "techtree",
      status: "current",
      commands: [
        "techtree science set-goal",
        "techtree science agent set <agent>",
        "techtree science run",
      ],
      pathTemplates: [
        "/v1/science/goals",
        "/v1/science/goals/{goal_id}",
        "/v1/science/goals/active",
        "/v1/science/runs",
        "/v1/science/runs/{run_id}",
        "/v1/science/runs/{run_id}/artifacts",
        "/v1/science/runs/{run_id}/publish",
        "/v1/science/tasks/resolve",
      ],
    });
  });
});
