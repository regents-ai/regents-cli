import fs from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import {
  checkCliHttpRouteBindings,
  formatCliHttpRouteIssue,
} from "./cli-http-route-check.mjs";
import { checkCliCommandMetadata } from "./generate-cli-command-metadata.mjs";
import { loadYaml } from "./dependency-preflight.mjs";
import {
  cliCommandContractFiles,
  cliCommandOpenApiFiles,
  moneyMovementRows,
  readWorkspaceManifest,
} from "../packages/regents-cli/src/workspace/manifest.js";

const root = resolve(import.meta.dirname, "..");
const YAML = await loadYaml(root);
const manifest = readWorkspaceManifest(root, YAML);
const openApiFiles = cliCommandOpenApiFiles(manifest, root);
const cliContractFiles = cliCommandContractFiles(manifest, root);

const ownershipPath = resolve(root, "packages/regents-cli/src/contracts/api-ownership.ts");
const cliRoutesDir = resolve(root, "packages/regents-cli/src/routes");
const commandMetadataPath = resolve(root, "packages/regents-cli/src/generated/cli-command-metadata.ts");

const parseYaml = (file) => YAML.parse(fs.readFileSync(file, "utf8"));

const readPaths = (file) => new Set(Object.keys(parseYaml(file).paths ?? {}));

const httpMethods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

const readOperations = (file) => {
  const document = parseYaml(file);
  const operations = new Map();

  for (const [path, methods] of Object.entries(document.paths ?? {})) {
    if (!methods || typeof methods !== "object") {
      continue;
    }

    for (const [method, operation] of Object.entries(methods)) {
      if (!httpMethods.has(method.toLowerCase())) {
        continue;
      }
      if (!operation || typeof operation !== "object" || typeof operation.operationId !== "string") {
        continue;
      }

      operations.set(operation.operationId, { method: method.toUpperCase(), path });
    }
  }

  return operations;
};

const extractStrings = (input) => Array.from(input.matchAll(/"([^"]+)"/g), (match) => match[1]);

const readCommandRegistry = (source) => {
  const registryStart = source.indexOf("export const CLI_COMMANDS = [");
  if (registryStart < 0) {
    throw new Error("Unable to find CLI_COMMANDS registry");
  }

  const registryEnd = source.indexOf("] as const", registryStart);
  if (registryEnd < 0) {
    throw new Error("Unable to parse CLI_COMMANDS registry");
  }

  return new Set(extractStrings(source.slice(registryStart, registryEnd)));
};

const extractOwnershipGroups = (source, exportName) => {
  const exportStart = source.indexOf(`export const ${exportName} = [`);
  if (exportStart < 0) {
    throw new Error(`Unable to find ${exportName}`);
  }

  const exportEnd = source.indexOf("] as const", exportStart);
  if (exportEnd < 0) {
    throw new Error(`Unable to parse ${exportName}`);
  }

  const body = source.slice(exportStart, exportEnd);
  const groups = [];
  const groupPattern = /commands:\s*\[([\s\S]*?)\],\s*owner:\s*"[^"]+",[\s\S]*?pathTemplates:\s*\[([\s\S]*?)\]/g;
  for (const match of body.matchAll(groupPattern)) {
    groups.push({
      commands: extractStrings(match[1]),
      pathTemplates: extractStrings(match[2]),
    });
  }

  return groups;
};

const normalizeCommandName = (command) => command.replace(/^regents?\s+/u, "");
const platformPublicCommand = (command) =>
  command.startsWith("platform ") ||
  command.startsWith("runtime ") ||
  command.startsWith("agentbook ") ||
  command.startsWith("service ") ||
  command.startsWith("work ") ||
  command === "agent connect hosted-hermes" ||
  command === "agent connect hermes" ||
  command === "agent connect openclaw" ||
  command === "agent chat" ||
  command === "agent link" ||
  command === "agent execution-pool" ||
  command === "bug" ||
  command === "security-report" ||
  command.startsWith("regent-staking ");

const bannedCommandVerbs = new Set(["show", "info"]);
const paginatedCommandWords = new Set([
  "activity",
  "history",
  "inbox",
  "list",
  "opportunities",
  "search",
]);
const dataCommandWords = new Set([
  "account",
  "activity",
  "admins",
  "balance",
  "capsules",
  "certificate",
  "children",
  "comments",
  "cross-chain-links",
  "doctor",
  "get",
  "graph",
  "health",
  "history",
  "inbox",
  "leaderboard",
  "lineage",
  "list",
  "lookup",
  "members",
  "opportunities",
  "permissions",
  "policy",
  "projection",
  "reliability",
  "scoreboard",
  "services",
  "status",
  "super-admins",
  "verify",
  "whoami",
  "work-packet",
]);
const jsonSupportValues = new Set(["supported", "required", "auto"]);
const paginationValues = new Set(["bounded", "cursor", "offset", "stream", "none", "not_applicable"]);

const commandWords = (command) =>
  command
    .split(/\s+/u)
    .filter((part) => part && !part.startsWith("<"));

const metadataValue = (metadata, key) =>
  metadata && typeof metadata === "object" && typeof metadata[key] === "string"
    ? metadata[key]
    : undefined;

const hasExamples = (metadata, group) =>
  (Array.isArray(metadata?.examples) && metadata.examples.length > 0) ||
  (Array.isArray(group?.examples) && group.examples.length > 0);

const isPaginationDeclared = (metadata) => {
  const pagination = metadataValue(metadata, "pagination");
  if (!pagination) {
    return false;
  }

  return paginationValues.has(pagination) || pagination.startsWith("bounded");
};

const declaresJsonSupport = (metadata) => {
  const jsonSupport = metadataValue(metadata, "json_support");
  return Boolean(jsonSupport && jsonSupportValues.has(jsonSupport));
};

const commandHasWord = (command, words) => commandWords(command).some((word) => words.has(word));

const agentMetadataForCommand = (contract, group, command) => {
  if (group?.agent_metadata && typeof group.agent_metadata === "object") {
    const commandMetadata = group.agent_metadata.commands?.[command];
    if (commandMetadata && typeof commandMetadata === "object") {
      const { commands: _commands, ...defaults } = group.agent_metadata;
      return { ...defaults, ...commandMetadata };
    }

    const { commands: _commands, ...defaults } = group.agent_metadata;
    return defaults;
  }

  if (contract?.["x-regent-agent-defaults"] && typeof contract["x-regent-agent-defaults"] === "object") {
    return contract["x-regent-agent-defaults"];
  }

  return undefined;
};

const iterContractCommandRecords = (owner, contract) => {
  if (contract?.openapi || Array.isArray(contract?.commands) || contract?.version !== 1) {
    fail(`CLI contract ${owner} must use the v1 command_groups schema`);
    return [];
  }

  return (contract.command_groups ?? []).flatMap((group) =>
    (group.commands ?? []).map((command) => ({
      owner,
      command: normalizeCommandName(command),
      group,
      metadata: agentMetadataForCommand(contract, group, normalizeCommandName(command)),
      examples: group.examples,
    })),
  );
};

const flattenContract = (contract, operationsById) => {
  if (contract?.openapi || Array.isArray(contract?.commands) || contract?.version !== 1) {
    fail("CLI contracts must use the v1 command_groups schema");
    return { commands: new Set(), paths: new Set(), rpcMethods: new Set(), operationIds: new Set() };
  }

  const groups = contract.command_groups ?? [];
  const commands = new Set();
  const paths = new Set();
  const rpcMethods = new Set();
  const operationIds = new Set();

  const addOperationId = (operationId) => {
    operationIds.add(operationId);
    const operation = operationsById.get(operationId);
    if (!operation) {
      fail(`CLI contract references unknown OpenAPI operationId: ${operationId}`);
      return;
    }
    paths.add(operation.path);
  };

  for (const group of groups) {
    for (const command of group.commands ?? []) {
      commands.add(command);
    }
    for (const operationId of group.operation_ids ?? []) {
      addOperationId(operationId);
    }
    for (const metadata of Object.values(group.agent_metadata?.commands ?? {})) {
      for (const operationId of metadata?.operation_ids ?? []) {
        addOperationId(operationId);
      }
    }
    for (const path of group.path_templates ?? []) {
      paths.add(path);
    }
    for (const method of group.rpc_methods ?? []) {
      rpcMethods.add(method);
    }
  }

  return { commands, paths, rpcMethods, operationIds };
};

const validateCommandOperationMappings = (records, operationsByOwner, openApiFilesByOwner) => {
  for (const record of records) {
    const operationIds = record.metadata?.operation_ids;
    if (!Array.isArray(operationIds) || operationIds.length === 0) {
      continue;
    }

    const operationsById = operationsByOwner[record.owner];
    const groupPaths = new Set(record.group?.path_templates ?? []);

    for (const operationId of operationIds) {
      if (typeof operationId !== "string" || operationId.length === 0) {
        fail(`CLI contract command ${record.owner} "${record.command}" has an invalid operation_id entry`);
        continue;
      }

      const operation = operationsById?.get(operationId);
      if (!operation) {
        fail(
          [
            `CLI contract command ${record.owner} "${record.command}" maps to missing OpenAPI operationId: ${operationId}`,
            `owner api-contract: ${openApiFilesByOwner[record.owner]}`,
          ].join("\n"),
        );
        continue;
      }

      if (!groupPaths.has(operation.path)) {
        fail(
          [
            `CLI contract command ${record.owner} "${record.command}" maps to OpenAPI operation outside its path_templates: ${operationId}`,
            `resolved operation: ${operation.method} ${operation.path}`,
            `owner api-contract: ${openApiFilesByOwner[record.owner]}`,
          ].join("\n"),
        );
      }
    }
  }
};

const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};

for (const owner of ["platform", "techtree", "autolaunch", "shared-services"]) {
  if (!openApiFiles[owner]) {
    fail(`Regent workspace manifest is missing ${owner} OpenAPI contract for CLI checks`);
  }
  if (!cliContractFiles[owner]) {
    fail(`Regent workspace manifest is missing ${owner} CLI contract for CLI checks`);
  }
}

const moneyPrepareOwners = new Set(
  moneyMovementRows(manifest)
    .filter((row) => row.routeClass.includes("prepare"))
    .map((row) => row.ownerProduct),
);

for (const owner of ["platform", "techtree", "autolaunch", "shared-services"]) {
  if (!moneyPrepareOwners.has(owner) && owner !== "techtree") {
    fail(`Regent workspace manifest is missing a money prepare row for ${owner}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

const ownershipSource = fs.readFileSync(ownershipPath, "utf8");
const expectedByOwner = {
  platform: extractOwnershipGroups(ownershipSource, "platformApiCommandGroups"),
  techtree: extractOwnershipGroups(ownershipSource, "techtreeApiCommandGroups"),
  autolaunch: extractOwnershipGroups(ownershipSource, "autolaunchApiCommandGroups"),
  "shared-services": extractOwnershipGroups(ownershipSource, "sharedServicesApiCommandGroups"),
};

const flattenOwnershipGroups = (groups) => ({
  commands: new Set(groups.flatMap((group) => group.commands)),
  paths: new Set(groups.flatMap((group) => group.pathTemplates)),
});

const ownershipByOwner = Object.fromEntries(
  Object.entries(expectedByOwner).map(([owner, groups]) => [owner, flattenOwnershipGroups(groups)]),
);

const contracts = Object.fromEntries(
  Object.entries(cliContractFiles).map(([owner, file]) => [owner, parseYaml(file)]),
);

const operationsByOwner = Object.fromEntries(
  Object.entries(openApiFiles).map(([owner, file]) => [owner, readOperations(file)]),
);

const flattenedContracts = Object.fromEntries(
  Object.entries(contracts).map(([owner, contract]) => [
    owner,
    flattenContract(contract, operationsByOwner[owner]),
  ]),
);

const contractCommandRecords = Object.entries(contracts).flatMap(([owner, contract]) =>
  iterContractCommandRecords(owner, contract).filter((record) =>
    owner === "platform" ? platformPublicCommand(record.command) : true,
  ),
);

validateCommandOperationMappings(contractCommandRecords, operationsByOwner, openApiFiles);

for (const record of contractCommandRecords) {
  const words = commandWords(record.command);
  const bannedVerb = words.find((word) => bannedCommandVerbs.has(word));
  if (bannedVerb) {
    fail(`CLI contract command uses banned verb "${bannedVerb}": ${record.command}`);
  }

  if (!record.metadata || typeof record.metadata !== "object") {
    fail(`CLI contract command is missing agent metadata: ${record.command}`);
    continue;
  }

  if (!hasExamples(record.metadata, record.group) && !(Array.isArray(record.examples) && record.examples.length > 0)) {
    fail(`CLI contract command is missing examples: ${record.command}`);
  }

  for (const key of [
    "category",
    "prompt_behavior",
    "json_support",
    "mutation_class",
    "retry_behavior",
    "pagination",
    "async_behavior",
    "input_mode",
  ]) {
    if (!metadataValue(record.metadata, key)) {
      fail(`CLI contract command metadata is missing ${key}: ${record.command}`);
    }
  }

  if (commandHasWord(record.command, paginatedCommandWords) && !isPaginationDeclared(record.metadata)) {
    fail(`CLI contract command needs pagination metadata: ${record.command}`);
  }

  if (commandHasWord(record.command, dataCommandWords) && !declaresJsonSupport(record.metadata)) {
    fail(`CLI contract data command must declare JSON support: ${record.command}`);
  }
}

const shippedPlatformCommands = Array.from(flattenedContracts.platform.commands).filter(
  (command) => platformPublicCommand(command),
);

const shippedContractCommands = new Set([
  ...flattenedContracts["shared-services"].commands,
  ...flattenedContracts.techtree.commands,
  ...flattenedContracts.autolaunch.commands,
  ...shippedPlatformCommands,
]);
const commandMetadataCheck = checkCliCommandMetadata();
if (!commandMetadataCheck.ok) {
  if (!commandMetadataCheck.metadataOk) {
    fail(`Generated CLI command metadata is out of date: ${commandMetadataCheck.outputPath}`);
  }
  if (!commandMetadataCheck.commandListOk) {
    fail(`Generated CLI command list is out of date: ${commandMetadataCheck.commandListPath}`);
  }
}

const registryCommands = readCommandRegistry(fs.readFileSync(commandMetadataPath, "utf8"));

const allowedPathsByOwner = {
  platform: new Set(readPaths(openApiFiles.platform)),
  techtree: new Set(readPaths(openApiFiles.techtree)),
  autolaunch: new Set(readPaths(openApiFiles.autolaunch)),
  "shared-services": new Set([
    ...readPaths(openApiFiles["shared-services"]),
    ...readPaths(openApiFiles.platform),
  ]),
};

for (const [owner, openApiPaths] of Object.entries(allowedPathsByOwner)) {
  for (const path of flattenedContracts[owner].paths) {
    if (!openApiPaths.has(path)) {
      fail(`CLI contract ${owner} references missing API path: ${path}`);
    }
  }
}

for (const [owner, groups] of Object.entries(expectedByOwner)) {
  for (const group of groups) {
    for (const command of group.commands) {
      if (!flattenedContracts[owner].commands.has(command)) {
        fail(`CLI contract ${owner} is missing shipped command: ${command}`);
      }
    }
    for (const path of group.pathTemplates) {
      if (!flattenedContracts[owner].paths.has(path)) {
        fail(`CLI contract ${owner} is missing shipped path binding: ${path}`);
      }
    }
  }
}

for (const command of flattenedContracts.techtree.commands) {
  if (!ownershipByOwner.techtree.commands.has(command)) {
    fail(`Techtree API ownership registry is missing CLI contract command: ${command}`);
  }
}
for (const path of flattenedContracts.techtree.paths) {
  if (!ownershipByOwner.techtree.paths.has(path)) {
    fail(`Techtree API ownership registry is missing CLI contract path binding: ${path}`);
  }
}

for (const owner of ["platform", "autolaunch"]) {
  for (const path of flattenedContracts[owner].paths) {
    if (!ownershipByOwner[owner].paths.has(path)) {
      fail(`${owner} API ownership registry is missing CLI contract path binding: ${path}`);
    }
  }
}

for (const command of shippedContractCommands) {
  if (!registryCommands.has(command)) {
    fail(`CLI command registry is missing contract command: ${command}`);
  }
}

for (const command of registryCommands) {
  if (!shippedContractCommands.has(command)) {
    fail(`CLI command registry contains command missing from shipped contracts: ${command}`);
  }
}

const readRouteSources = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        return readRouteSources(fullPath);
      }
      return entry.isFile() && entry.name.endsWith(".ts") ? [fs.readFileSync(fullPath, "utf8")] : [];
    })
    .join("\n");

const cliRoutesSource = readRouteSources(cliRoutesDir);
// Commands are registered as handler-registry entries keyed by command name and
// pointing at a `{ run: ... }` handler (quoted keys for multi-word commands,
// bare identifiers for single-word commands). The route table is generated from
// this registry, so the registry keys are the authoritative route command list.
const routeCommands = new Set(
  Array.from(
    cliRoutesSource.matchAll(/(?:"([^"]+)"|([A-Za-z][\w-]*))\s*:\s*\{\s*run\b/g),
    (match) => match[1] ?? match[2],
  ),
);

for (const command of registryCommands) {
  if (!routeCommands.has(command)) {
    fail(`CLI dispatcher is missing exact route for command: ${command}`);
  }
}

for (const command of routeCommands) {
  if (!registryCommands.has(command)) {
    fail(`CLI dispatcher contains route missing from shipped contracts: ${command}`);
  }
}

for (const issue of checkCliHttpRouteBindings({
  root,
  openApiFiles,
  shippedCommands: shippedContractCommands,
  YAML,
})) {
  fail(formatCliHttpRouteIssue(issue, openApiFiles));
}

const requiredChatCommands = [
  "techtree chat list",
  "techtree chat read <scope>",
  "techtree chat tail [scope...]",
  "techtree chat send <scope>",
  "techtree chat unread [scope...]",
  "techtree chat subscribe add <scope>",
  "techtree chat subscribe remove <scope>",
  "techtree chat subscribe list",
  "techtree dm <node-id|address>",
  "techtree dm list",
];
for (const command of requiredChatCommands) {
  if (!flattenedContracts.techtree.commands.has(command)) {
    fail(`Techtree CLI contract is missing runtime command: ${command}`);
  }
}

for (const command of requiredChatCommands) {
  if (!routeCommands.has(command)) {
    fail(`CLI dispatcher is missing required chat route: ${command}`);
  }
}

const requiredRpcMethods = [
  "techtree.chat.channels",
  "techtree.chat.history",
  "techtree.chat.post",
];
for (const method of requiredRpcMethods) {
  if (!flattenedContracts.techtree.rpcMethods.has(method)) {
    fail(`Techtree CLI contract is missing runtime RPC method: ${method}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("cli contract check passed");
