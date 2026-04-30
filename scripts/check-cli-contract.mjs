import fs from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
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

const readOperationPaths = (file) => {
  const document = parseYaml(file);
  const operationPaths = new Map();

  for (const [path, methods] of Object.entries(document.paths ?? {})) {
    if (!methods || typeof methods !== "object") {
      continue;
    }

    for (const operation of Object.values(methods)) {
      if (!operation || typeof operation !== "object" || typeof operation.operationId !== "string") {
        continue;
      }

      operationPaths.set(operation.operationId, path);
    }
  }

  return operationPaths;
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
const currentAvailabilityValues = new Set(["current", "beta_disabled"]);
const platformPublicCommand = (command) =>
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

const flattenContract = (contract, operationPaths) => {
  if (Array.isArray(contract.commands)) {
    const commands = new Set();
    const paths = new Set();
    const rpcMethods = new Set();
    const availabilityByCommand = new Map();

    for (const command of contract.commands) {
      if (!command || typeof command !== "object") {
        continue;
      }

      if (typeof command.name === "string") {
        const normalizedCommand = normalizeCommandName(command.name);
        commands.add(normalizedCommand);
        availabilityByCommand.set(
          normalizedCommand,
          typeof command.availability === "string" ? command.availability : "current",
        );
      }

      const transport = command.transport;
      if (!transport || typeof transport !== "object") {
        continue;
      }

      for (const operationId of transport.operationIds ?? []) {
        const path = operationPaths.get(operationId);
        if (!path) {
          fail(`CLI contract references unknown OpenAPI operationId: ${operationId}`);
          continue;
        }

        paths.add(path);
      }
    }

    return { commands, paths, rpcMethods, availabilityByCommand };
  }

  const groups = contract.command_groups ?? [];
  const commands = new Set();
  const paths = new Set();
  const rpcMethods = new Set();

  for (const group of groups) {
    for (const command of group.commands ?? []) {
      commands.add(command);
    }
    for (const path of group.path_templates ?? []) {
      paths.add(path);
    }
    for (const method of group.rpc_methods ?? []) {
      rpcMethods.add(method);
    }
  }

  return { commands, paths, rpcMethods, availabilityByCommand: new Map() };
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

const contracts = Object.fromEntries(
  Object.entries(cliContractFiles).map(([owner, file]) => [owner, parseYaml(file)]),
);

const operationPathsByOwner = Object.fromEntries(
  Object.entries(openApiFiles).map(([owner, file]) => [owner, readOperationPaths(file)]),
);

const flattenedContracts = Object.fromEntries(
  Object.entries(contracts).map(([owner, contract]) => [
    owner,
    flattenContract(contract, operationPathsByOwner[owner]),
  ]),
);

for (const [command, availability] of flattenedContracts.platform.availabilityByCommand) {
  if (platformPublicCommand(command) && !currentAvailabilityValues.has(availability)) {
    fail(
      `Platform CLI command ${command} has unsupported availability ${availability}; use current or beta_disabled`,
    );
  }
}

const shippedPlatformCommands = Array.from(flattenedContracts.platform.commands).filter(
  (command) =>
    platformPublicCommand(command) &&
    currentAvailabilityValues.has(flattenedContracts.platform.availabilityByCommand.get(command) ?? "current"),
);

const shippedContractCommands = new Set([
  ...flattenedContracts["shared-services"].commands,
  ...flattenedContracts.techtree.commands,
  ...flattenedContracts.autolaunch.commands,
  ...shippedPlatformCommands,
]);
const commandMetadataCheck = checkCliCommandMetadata();
if (!commandMetadataCheck.ok) {
  fail(`Generated CLI command metadata is out of date: ${commandMetadataCheck.outputPath}`);
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
const routeCommands = new Set(
  Array.from(cliRoutesSource.matchAll(/route\(\s*"([^"]+)"/g), (match) => match[1]),
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

const requiredChatboxCommands = ["chatbox history", "chatbox tail", "chatbox post"];
for (const command of requiredChatboxCommands) {
  if (!flattenedContracts.techtree.commands.has(command)) {
    fail(`Techtree CLI contract is missing runtime command: ${command}`);
  }
}

for (const snippet of ['route("chatbox history"', 'route("chatbox tail"', 'route("chatbox post"']) {
  if (!cliRoutesSource.includes(snippet)) {
    fail(`CLI dispatcher is missing required chatbox route: ${snippet}`);
  }
}

const requiredRpcMethods = ["techtree.chatbox.history", "techtree.chatbox.post"];
for (const method of requiredRpcMethods) {
  if (!flattenedContracts.techtree.rpcMethods.has(method)) {
    fail(`Techtree CLI contract is missing runtime RPC method: ${method}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("cli contract check passed");
