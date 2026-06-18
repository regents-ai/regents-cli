import fs from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { loadYaml } from "./dependency-preflight.mjs";
import {
  cliCommandOpenApiFiles,
  readWorkspaceManifest,
} from "../packages/regents-cli/src/workspace/manifest.js";

// The CLI-local MCP tool surface is contract-owned: the tool registry in
// src/mcp/tool-registry.ts and the x-regent-mcp-tools section of
// docs/shared-cli-contract.yaml must describe exactly the same tools, and no
// local tool name may collide with a tool the shared remote MCP endpoint
// publishes (documented under POST /api/shared/mcp in the Platform API contract).

const root = resolve(import.meta.dirname, "..");
const YAML = await loadYaml(root);
const manifest = readWorkspaceManifest(root, YAML);
const openApiFiles = cliCommandOpenApiFiles(manifest, root);

const sharedContractPath = resolve(root, "docs/shared-cli-contract.yaml");
const toolRegistryPath = resolve(root, "packages/regents-cli/src/mcp/tool-registry.ts");

const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};

// --- registry side -----------------------------------------------------------

const registrySource = fs.readFileSync(toolRegistryPath, "utf8");

const sliceExportedArray = (source, exportName) => {
  const start = source.indexOf(`export const ${exportName}`);
  if (start < 0) {
    throw new Error(`Unable to find ${exportName} in ${toolRegistryPath}`);
  }
  const assignment = source.indexOf("=", start);
  const openBracket = source.indexOf("[", assignment);
  const asConstEnd = source.indexOf("] as const", openBracket);
  const end = asConstEnd >= 0 ? asConstEnd : source.indexOf("];", openBracket);
  if (assignment < 0 || openBracket < 0 || end < 0) {
    throw new Error(`Unable to parse ${exportName} in ${toolRegistryPath}`);
  }
  return source.slice(openBracket + 1, end);
};

const toolEntryPattern =
  /\{\s*name:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*description:\s*"([^"]+)",\s*riskClass:\s*"([^"]+)",\s*owner:\s*"([^"]+)",\s*authMode:\s*"([^"]+)",\s*(?:rpcMethod:\s*"([^"]+)",\s*)?\}/g;

const definitionsBody = sliceExportedArray(registrySource, "REGENTS_MCP_TOOL_DEFINITIONS");
const registryTools = Array.from(definitionsBody.matchAll(toolEntryPattern), (match) => ({
  name: match[1],
  title: match[2],
  description: match[3],
  riskClass: match[4],
  owner: match[5],
  authMode: match[6],
  rpcMethod: match[7],
}));

const registryEntryCount = Array.from(definitionsBody.matchAll(/name:\s*"/g)).length;
if (registryTools.length !== registryEntryCount) {
  fail(
    `MCP tool registry parser matched ${registryTools.length} of ${registryEntryCount} entries in ${toolRegistryPath}; keep registry entries in the name/title/description/riskClass/owner/authMode/rpcMethod field order.`,
  );
}

const submitBody = sliceExportedArray(registrySource, "REGENTS_MCP_SUBMIT_TOOLS");
if (submitBody.trim() !== "") {
  fail("REGENTS_MCP_SUBMIT_TOOLS must stay empty until submit tools are contract-approved.");
}

// --- shared CLI contract side -------------------------------------------------

const sharedContract = YAML.parse(fs.readFileSync(sharedContractPath, "utf8"));
const mcpSection = sharedContract["x-regent-mcp-tools"];

if (!mcpSection || typeof mcpSection !== "object") {
  fail(`Shared CLI contract is missing x-regent-mcp-tools: ${sharedContractPath}`);
  process.exit(1);
}

if (mcpSection.submit_tools_enabled !== false) {
  fail("Shared CLI contract x-regent-mcp-tools.submit_tools_enabled must be false.");
}

const contractTools = Array.isArray(mcpSection.tools) ? mcpSection.tools : [];
const contractByName = new Map(contractTools.map((tool) => [tool.name, tool]));
const registryByName = new Map(registryTools.map((tool) => [tool.name, tool]));

if (contractByName.size !== contractTools.length) {
  fail("Shared CLI contract x-regent-mcp-tools.tools contains duplicate tool names.");
}

for (const tool of registryTools) {
  if (!contractByName.has(tool.name)) {
    fail(`Shared CLI contract is missing MCP tool from the registry: ${tool.name}`);
  }
}

for (const tool of contractTools) {
  if (!registryByName.has(tool.name)) {
    fail(`MCP tool registry is missing contract-declared tool: ${tool.name}`);
  }
}

for (const tool of contractTools) {
  const registryTool = registryByName.get(tool.name);
  if (!registryTool) {
    continue;
  }

  const expectations = [
    ["title", tool.title, registryTool.title],
    ["description", tool.description, registryTool.description],
    ["risk_class", tool.risk_class, registryTool.riskClass],
    ["owner", tool.owner, registryTool.owner],
    ["auth_mode", tool.auth_mode, registryTool.authMode],
    ["rpc_method", tool.rpc_method, registryTool.rpcMethod],
  ];

  for (const [field, contractValue, registryValue] of expectations) {
    if (contractValue !== registryValue) {
      fail(
        `MCP tool ${tool.name} ${field} drifted: contract=${JSON.stringify(contractValue)} registry=${JSON.stringify(registryValue)}`,
      );
    }
  }

  if (tool.dispatch === "runtime-rpc" && !tool.rpc_method) {
    fail(`MCP tool ${tool.name} declares runtime-rpc dispatch without an rpc_method.`);
  }
  if (tool.dispatch !== "runtime-rpc" && tool.rpc_method) {
    fail(`MCP tool ${tool.name} declares an rpc_method but is not runtime-rpc dispatch.`);
  }
  if (!["runtime-rpc", "cli-helper", "policy-text"].includes(tool.dispatch)) {
    fail(`MCP tool ${tool.name} has unknown dispatch kind: ${tool.dispatch}`);
  }

  if (tool.risk_class === "submit") {
    fail(`MCP tool ${tool.name} must not carry the submit risk class on the local server.`);
  }
}

// --- Platform remote MCP collision check ---------------------------------------

const platformContractPath = openApiFiles.platform;
if (!platformContractPath) {
  fail("Regent workspace manifest is missing the platform OpenAPI contract for MCP checks.");
  process.exit(1);
}

const platformContract = YAML.parse(fs.readFileSync(platformContractPath, "utf8"));
const platformMcpTools =
  platformContract?.paths?.["/api/shared/mcp"]?.post?.["x-regent-mcp-tools"];

if (!Array.isArray(platformMcpTools) || platformMcpTools.length === 0) {
  fail(
    `Platform API contract must document its remote MCP tool surface under POST /api/shared/mcp x-regent-mcp-tools: ${platformContractPath}`,
  );
} else {
  for (const tool of platformMcpTools) {
    if (typeof tool.name !== "string" || tool.name.trim() === "") {
      fail("Platform API contract x-regent-mcp-tools entries must carry a tool name.");
      continue;
    }

    if (registryByName.has(tool.name) || contractByName.has(tool.name)) {
      fail(
        `MCP tool name collision: ${tool.name} is published by both the Platform remote MCP and the CLI-local MCP server. Rename the CLI-local tool; Platform names are live.`,
      );
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("mcp tools check passed");
