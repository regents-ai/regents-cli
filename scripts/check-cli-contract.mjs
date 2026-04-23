import fs from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import YAML from "yaml";

const root = resolve(import.meta.dirname, "..");

const openApiFiles = {
  platform: resolve(root, "../platform/api-contract.openapiv3.yaml"),
  techtree: resolve(root, "../techtree/docs/api-contract.openapiv3.yaml"),
  autolaunch: resolve(root, "../autolaunch/docs/api-contract.openapiv3.yaml"),
  "shared-services": resolve(root, "docs/regent-services-contract.openapiv3.yaml"),
};

const cliContractFiles = {
  platform: resolve(root, "../platform/cli-contract.yaml"),
  techtree: resolve(root, "../techtree/docs/cli-contract.yaml"),
  autolaunch: resolve(root, "../autolaunch/docs/cli-contract.yaml"),
  "shared-services": resolve(root, "docs/shared-cli-contract.yaml"),
};

const ownershipPath = resolve(root, "packages/regents-cli/src/contracts/api-ownership.ts");
const cliRoutesDir = resolve(root, "packages/regents-cli/src/routes");
const commandRegistryPath = resolve(root, "packages/regents-cli/src/command-registry.ts");

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

const flattenContract = (contract, operationPaths) => {
  if (Array.isArray(contract.commands)) {
    const commands = new Set();
    const paths = new Set();
    const rpcMethods = new Set();

    for (const command of contract.commands) {
      if (!command || typeof command !== "object") {
        continue;
      }

      if (typeof command.name === "string") {
        commands.add(normalizeCommandName(command.name));
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

    return { commands, paths, rpcMethods };
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

  return { commands, paths, rpcMethods };
};

const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};

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

const shippedContractCommands = new Set([
  ...flattenedContracts["shared-services"].commands,
  ...flattenedContracts.techtree.commands,
  ...flattenedContracts.autolaunch.commands,
  ...Array.from(flattenedContracts.platform.commands).filter((command) =>
    command.startsWith("agentbook "),
  ),
]);
const registryCommands = readCommandRegistry(fs.readFileSync(commandRegistryPath, "utf8"));

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
