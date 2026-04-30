import fs from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { CLI_COMMANDS } from "../src/command-registry.js";
import { apiCommandOwnership } from "../src/contracts/api-ownership.js";

type OpenApiDocument = {
  paths?: Record<string, Record<string, { operationId?: string; security?: unknown }>>;
};

type WorkspaceManifest = {
  repos?: Record<
    string,
    {
      path?: string;
      required_for_public_beta?: boolean;
      api_contracts?: Array<{ path?: string }>;
      cli_contracts?: Array<{ path?: string }>;
      acceptance_commands?: Array<{ cwd?: string; command?: string }>;
    }
  >;
};

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const regentRoot = path.resolve(workspaceRoot, "..");

const files = {
  platformApi: path.join(regentRoot, "platform/api-contract.openapiv3.yaml"),
  platformCli: path.join(regentRoot, "platform/cli-contract.yaml"),
  techtreeApi: path.join(regentRoot, "techtree/docs/api-contract.openapiv3.yaml"),
  techtreeCli: path.join(regentRoot, "techtree/docs/cli-contract.yaml"),
  autolaunchApi: path.join(regentRoot, "autolaunch/docs/api-contract.openapiv3.yaml"),
  autolaunchCli: path.join(regentRoot, "autolaunch/docs/cli-contract.yaml"),
  iosApi: path.join(regentRoot, "ios/api-contract.openapiv3.yaml"),
  sharedApi: path.join(workspaceRoot, "docs/regent-services-contract.openapiv3.yaml"),
  sharedCli: path.join(workspaceRoot, "docs/shared-cli-contract.yaml"),
  workspaceManifest: path.join(workspaceRoot, "docs/regent-workspace.yaml"),
};

const loadYaml = <T>(file: string): T => parse(fs.readFileSync(file, "utf8")) as T;

const operation = (document: OpenApiDocument, pathTemplate: string, method: string) => {
  const methods = document.paths?.[pathTemplate];
  expect(methods, pathTemplate).toBeDefined();

  const entry = methods?.[method];
  expect(entry, `${method.toUpperCase()} ${pathTemplate}`).toBeDefined();

  return entry!;
};

const ownerForCommand = (command: string) => {
  const group = apiCommandOwnership.find((entry) => entry.commands.includes(command));
  expect(group, command).toBeDefined();
  return group!;
};

const expectCommand = (command: string, owner: string, pathTemplate?: string) => {
  expect(CLI_COMMANDS).toContain(command);
  const group = ownerForCommand(command);
  expect(group.owner).toBe(owner);
  if (pathTemplate) {
    expect(group.pathTemplates).toContain(pathTemplate);
  }
};

const expectedLoop = [
  {
    owner: "platform",
    contract: "platformApi",
    pathTemplate: "/api/agent-platform/formation/doctor",
    method: "get",
    operationId: "agentPlatformFormationDoctor",
    command: "platform formation doctor",
  },
  {
    owner: "platform",
    contract: "platformApi",
    pathTemplate: "/api/agent-platform/projection",
    method: "get",
    operationId: "agentPlatformProjection",
    command: "platform projection",
  },
  {
    owner: "techtree",
    contract: "techtreeApi",
    pathTemplate: "/v1/agent/runtime/publish/submit",
    method: "post",
    operationId: "publishRuntimeWorkspace",
    command: "techtree main artifact publish",
  },
  {
    owner: "techtree",
    contract: "techtreeApi",
    pathTemplate: "/v1/runtime/nodes/{id}",
    method: "get",
    operationId: "getRuntimeNode",
    command: "techtree main fetch",
    publicRead: true,
  },
  {
    owner: "autolaunch",
    contract: "autolaunchApi",
    pathTemplate: "/v1/agent/prelaunch/plans",
    method: "post",
    operationId: "agentCreatePrelaunchPlan",
    command: "autolaunch prelaunch wizard",
  },
  {
    owner: "autolaunch",
    contract: "autolaunchApi",
    pathTemplate: "/v1/agent/launch/jobs",
    method: "post",
    operationId: "agentCreateLaunchJob",
    command: "autolaunch launch create",
  },
  {
    owner: "autolaunch",
    contract: "autolaunchApi",
    pathTemplate: "/v1/agent/launch/jobs/{id}",
    method: "get",
    operationId: "agentGetLaunchJob",
    command: "autolaunch launch run",
  },
  {
    owner: "autolaunch",
    contract: "autolaunchApi",
    pathTemplate: "/v1/agent/subjects/{id}",
    method: "get",
    operationId: "agentGetSubject",
    command: "autolaunch subjects show",
  },
  {
    owner: "platform",
    contract: "platformApi",
    pathTemplate: "/v1/agent/regent/staking",
    method: "get",
    operationId: "getAgentRegentStakingOverview",
    command: "regent-staking show",
  },
] as const;

const samplePayloads = {
  formationDoctor: {
    ok: true,
    doctor: {
      status: "ready",
      next_action: "Open the company dashboard.",
      checks: [
        {
          key: "billing",
          status: "passed",
          label: "Billing",
          next_action: null,
        },
      ],
    },
  },
  platformProjection: {
    ok: true,
    projection: {
      agent_id: "agent_flywheel_001",
      display_name: "Flywheel Regent",
      companies: [
        {
          id: "company_flywheel_001",
          slug: "flywheel-regent",
          formation_status: "complete",
          runtime_status: "ready",
        },
      ],
    },
  },
  techtreePublish: {
    ok: true,
    node_id: "node_flywheel_001",
    tree: "main",
    linked_agent_id: "agent_flywheel_001",
  },
  autolaunchPlan: {
    name: "Flywheel Regent",
    symbol: "FLY",
    agent_id: "agent_flywheel_001",
    metadata: {
      techtree_node_id: "node_flywheel_001",
      public_url: "https://techtree.local/nodes/node_flywheel_001",
    },
  },
  launchVisibility: {
    ok: true,
    subject: {
      id: "subject_flywheel_001",
      agent_id: "agent_flywheel_001",
      techtree_node_id: "node_flywheel_001",
      revenue_status: "visible",
      claimable_usdc: "0",
      staked_amount: "0",
    },
  },
  mobileRegent: {
    regents: [
      {
        id: "agent_flywheel_001",
        name: "Flywheel Regent",
        formation_status: "complete",
        runtime_status: "ready",
        launch_status: "live",
      },
    ],
  },
  cliOperatorVisibility: {
    commands: [
      "doctor contracts",
      "platform formation doctor",
      "platform projection",
      "techtree main fetch",
      "autolaunch subjects show",
      "regent-staking show",
    ],
  },
} as const;

describe("Regent flywheel integration proof", () => {
  it("loads the cross-repo contracts and checks needed for the loop", () => {
    const manifest = loadYaml<WorkspaceManifest>(files.workspaceManifest);
    const repos = manifest.repos ?? {};

    for (const owner of ["platform", "techtree", "autolaunch", "ios", "regents-cli", "design-system"] as const) {
      expect(repos[owner], owner).toBeDefined();
      expect(repos[owner]?.required_for_public_beta, owner).toBe(true);
      expect(repos[owner]?.acceptance_commands?.length ?? 0, owner).toBeGreaterThan(0);
    }

    expect(repos.platform?.api_contracts?.[0]).toEqual(expect.objectContaining({ path: "api-contract.openapiv3.yaml" }));
    expect(repos.platform?.cli_contracts?.[0]).toEqual(expect.objectContaining({ path: "cli-contract.yaml" }));
    expect(repos.techtree?.api_contracts?.[0]).toEqual(expect.objectContaining({ path: "docs/api-contract.openapiv3.yaml" }));
    expect(repos.autolaunch?.api_contracts?.[0]).toEqual(expect.objectContaining({ path: "docs/api-contract.openapiv3.yaml" }));
    expect(repos["regents-cli"]?.api_contracts?.[0]).toEqual(
      expect.objectContaining({ path: "docs/regent-services-contract.openapiv3.yaml" }),
    );
    expect(repos["regents-cli"]?.cli_contracts?.[0]).toEqual(
      expect.objectContaining({ path: "docs/shared-cli-contract.yaml" }),
    );
  });

  it("keeps every product-loop route under its owning contract and CLI command", () => {
    const contracts = {
      platformApi: loadYaml<OpenApiDocument>(files.platformApi),
      techtreeApi: loadYaml<OpenApiDocument>(files.techtreeApi),
      autolaunchApi: loadYaml<OpenApiDocument>(files.autolaunchApi),
    };

    for (const step of expectedLoop) {
      const route = operation(contracts[step.contract], step.pathTemplate, step.method);
      expect(route.operationId).toBe(step.operationId);
      if (!("publicRead" in step)) {
        expect(route.security, step.operationId).toBeDefined();
      }
      expectCommand(step.command, step.owner, step.pathTemplate);
    }
  });

  it("keeps the mobile read path contracted for Platform-backed Regent state", () => {
    const iosContract = loadYaml<OpenApiDocument>(files.iosApi);

    expect(operation(iosContract, "/mobile/regents", "get").security).toBeDefined();
    expect(operation(iosContract, "/mobile/regents/{id}", "get").security).toBeDefined();
    expect(operation(iosContract, "/mobile/regents/{id}/manager", "get").security).toBeDefined();
    expect(operation(iosContract, "/mobile/regents/{id}/base-snapshot", "get").security).toBeDefined();
  });

  it("uses one representative product-loop payload shape across Platform, Techtree, Autolaunch, mobile, and CLI", () => {
    const agentId = samplePayloads.platformProjection.projection.agent_id;
    const nodeId = samplePayloads.techtreePublish.node_id;

    expect(samplePayloads.formationDoctor.doctor.status).toBe("ready");
    expect(samplePayloads.platformProjection.projection.companies[0]?.formation_status).toBe("complete");
    expect(samplePayloads.techtreePublish.linked_agent_id).toBe(agentId);
    expect(samplePayloads.autolaunchPlan.agent_id).toBe(agentId);
    expect(samplePayloads.autolaunchPlan.metadata.techtree_node_id).toBe(nodeId);
    expect(samplePayloads.launchVisibility.subject.agent_id).toBe(agentId);
    expect(samplePayloads.launchVisibility.subject.techtree_node_id).toBe(nodeId);
    expect(samplePayloads.mobileRegent.regents[0]?.id).toBe(agentId);

    for (const command of samplePayloads.cliOperatorVisibility.commands) {
      expect(CLI_COMMANDS).toContain(command);
    }
  });
});
