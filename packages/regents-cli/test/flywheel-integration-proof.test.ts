import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { CLI_COMMANDS } from "../src/command-registry.js";
import { apiCommandOwnership } from "../src/contracts/api-ownership.js";
import {
  EXPECTED_PLATFORM_CONTRACT_DIGEST,
  SUPPORTED_PLATFORM_CONTRACT_MAJOR,
} from "../src/generated/platform-contract-digest.js";

type OpenApiDocument = {
  info?: { version?: string };
  paths?: Record<string, Record<string, { operationId?: string; security?: unknown; responses?: Record<string, unknown> }>>;
  components?: {
    securitySchemes?: Record<string, Record<string, unknown>>;
    schemas?: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
  };
};

type CliContractDocument = {
  commands?: Array<{
    name?: string;
    auth?: { mode?: string };
    flags?: Array<{ name?: string }>;
  }>;
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
  platformApi: path.join(regentRoot, "platform/contracts/platform/api-contract.openapiv3.yaml"),
  platformCli: path.join(regentRoot, "platform/contracts/platform/cli-contract.yaml"),
  techtreeApi: path.join(regentRoot, "platform/contracts/techtree/api-contract.openapiv3.yaml"),
  techtreeCli: path.join(regentRoot, "platform/contracts/techtree/cli-contract.yaml"),
  autolaunchApi: path.join(regentRoot, "platform/contracts/autolaunch/api-contract.openapiv3.yaml"),
  autolaunchCli: path.join(regentRoot, "platform/contracts/autolaunch/cli-contract.yaml"),
  iosApi: path.join(regentRoot, "ios/api-contract.openapiv3.yaml"),
  sharedApi: path.join(workspaceRoot, "docs/regent-services-contract.openapiv3.yaml"),
  sharedCli: path.join(workspaceRoot, "docs/shared-cli-contract.yaml"),
  workspaceManifest: path.join(workspaceRoot, "docs/regent-workspace.yaml"),
};

const loadYaml = <T>(file: string): T => parse(fs.readFileSync(file, "utf8")) as T;

const platformContractDigest = (): string => {
  const body = ["api-contract.openapiv3.yaml", "cli-contract.yaml"]
    .map((file) => `${file}\n${fs.readFileSync(path.join(regentRoot, "platform", file), "utf8")}`)
    .join("\n---\n");

  return `sha256:${crypto.createHash("sha256").update(body).digest("hex")}`;
};

const schema = (document: OpenApiDocument, name: string) => {
  const entry = document.components?.schemas?.[name];
  expect(entry, name).toBeDefined();
  return entry!;
};

const command = (document: CliContractDocument, name: string) => {
  const entry = document.commands?.find((candidate) => candidate.name === name);
  expect(entry, name).toBeDefined();
  return entry!;
};

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
    pathTemplate: "/api/platform/formation/doctor",
    method: "get",
    operationId: "agentPlatformFormationDoctor",
    command: "platform formation doctor",
  },
  {
    owner: "platform",
    contract: "platformApi",
    pathTemplate: "/api/platform/projection",
    method: "get",
    operationId: "agentPlatformProjection",
    command: "platform projection",
  },
  {
    owner: "techtree",
    contract: "techtreeApi",
    pathTemplate: "/api/techtree/v1/runtime/nodes/{id}",
    method: "get",
    operationId: "getRuntimeNode",
    command: "techtree main fetch",
    publicRead: true,
  },
  {
    owner: "autolaunch",
    contract: "autolaunchApi",
    pathTemplate: "/api/autolaunch/v1/agent/prelaunch/plans",
    method: "post",
    operationId: "agentCreatePrelaunchPlan",
    command: "autolaunch prelaunch wizard",
  },
  {
    owner: "autolaunch",
    contract: "autolaunchApi",
    pathTemplate: "/api/autolaunch/v1/agent/prelaunch/plans/{id}/launch",
    method: "post",
    operationId: "agentLaunchPrelaunchPlan",
    command: "autolaunch launch run",
  },
  {
    owner: "autolaunch",
    contract: "autolaunchApi",
    pathTemplate: "/api/autolaunch/v1/agent/launch/jobs/{id}",
    method: "get",
    operationId: "agentGetLaunchJob",
    command: "autolaunch jobs watch",
  },
  {
    owner: "autolaunch",
    contract: "autolaunchApi",
    pathTemplate: "/api/autolaunch/v1/agent/subjects/{id}",
    method: "get",
    operationId: "agentGetSubject",
    command: "autolaunch subjects get",
  },
  {
    owner: "platform",
    contract: "platformApi",
    pathTemplate: "/api/shared/regent/staking",
    method: "get",
    operationId: "getAgentRegentStakingOverview",
    command: "regent-staking get",
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
      "autolaunch subjects get",
      "regent-staking get",
    ],
  },
} as const;

describe("Regent flywheel integration proof", () => {
  it("loads the cross-repo contracts and checks needed for the loop", () => {
    const manifest = loadYaml<WorkspaceManifest>(files.workspaceManifest);
    const repos = manifest.repos ?? {};

    for (const owner of ["platform", "techtree", "autolaunch", "ios", "regents-cli"] as const) {
      expect(repos[owner], owner).toBeDefined();
      expect(repos[owner]?.required_for_public_beta, owner).toBe(true);
      expect(repos[owner]?.acceptance_commands?.length ?? 0, owner).toBeGreaterThan(0);
    }
    expect(repos["design-system"]?.required_for_public_beta).toBe(false);

    expect(repos.platform?.api_contracts?.map((contract) => contract.path)).toEqual([
      "contracts/platform/api-contract.openapiv3.yaml",
      "contracts/techtree/api-contract.openapiv3.yaml",
      "contracts/autolaunch/api-contract.openapiv3.yaml",
    ]);
    expect(repos.platform?.cli_contracts?.map((contract) => contract.path)).toEqual([
      "contracts/platform/cli-contract.yaml",
      "contracts/techtree/cli-contract.yaml",
      "contracts/autolaunch/cli-contract.yaml",
    ]);
    expect(repos["regents-cli"]?.api_contracts?.[0]).toEqual(
      expect.objectContaining({ path: "docs/regent-services-contract.openapiv3.yaml" }),
    );
    expect(repos["regents-cli"]?.cli_contracts?.[0]).toEqual(
      expect.objectContaining({ path: "docs/shared-cli-contract.yaml" }),
    );
  });

  it("keeps the shared security release shape aligned across Platform and CLI", () => {
    const platformApi = loadYaml<OpenApiDocument>(files.platformApi);
    const platformCli = loadYaml<CliContractDocument>(files.platformCli);
    const techtreeApi = loadYaml<OpenApiDocument>(files.techtreeApi);

    expect(EXPECTED_PLATFORM_CONTRACT_DIGEST).toBe(platformContractDigest());
    expect(SUPPORTED_PLATFORM_CONTRACT_MAJOR).toBe(platformApi.info?.version?.split(".")[0]);

    const login = command(platformCli, "regents platform auth login");
    expect(login.auth?.mode).toBe("privy-access-token");
    expect(login.flags?.map((flag) => flag.name)).toEqual(
      expect.arrayContaining(["--access-token", "--access-token-env"]),
    );
    expect(JSON.stringify(platformCli)).not.toContain("identity-token");

    expect(platformApi.components?.securitySchemes?.PrivyBearerToken).toEqual(
      expect.objectContaining({ type: "http", scheme: "bearer" }),
    );

    const paidPayload = operation(techtreeApi, "/api/techtree/v1/agent/tree/nodes/{id}/payload", "get");
    const paymentRequired = paidPayload.responses?.["402"] as {
      headers?: Record<string, { "x-regent-decoded-schema"?: { $ref?: string } }>;
    };
    expect(paymentRequired.headers?.["payment-required"]?.["x-regent-decoded-schema"]?.$ref).toBe(
      "#/components/schemas/X402PaymentRequired",
    );

    expect(schema(techtreeApi, "X402PaymentBindingV1").required).toEqual([
      "version",
      "resource_id",
      "buyer_agent_id",
      "seller_agent_id",
      "network",
      "asset",
      "amount_atomic",
      "pay_to",
      "expires_at",
      "nonce",
      "binding_hash",
    ]);
    expect(schema(techtreeApi, "X402PaymentRequirements").properties?.extra).toMatchObject({
      properties: {
        regentPaymentBindingV1: { $ref: "#/components/schemas/X402PaymentBindingV1" },
      },
    });

    expect(schema(techtreeApi, "AutoskillBundleManifest").required).toEqual([
      "schema_version",
      "bundle_hash",
      "total_size",
      "files",
    ]);
    expect(schema(techtreeApi, "AutoskillBundleManifestFile").required).toEqual(["path", "sha256", "size"]);
    expect(schema(techtreeApi, "AutoskillBundleAccessData").properties?.manifest).toEqual({
      $ref: "#/components/schemas/AutoskillBundleManifest",
    });
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
