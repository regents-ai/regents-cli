import fs from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import YAML from "yaml";

const root = resolve(import.meta.dirname, "..");

const openApiFiles = {
  techtree: resolve(root, "../techtree/docs/api-contract.openapiv3.yaml"),
  autolaunch: resolve(root, "../autolaunch/docs/api-contract.openapiv3.yaml"),
  "shared-services": resolve(root, "docs/regent-services-contract.openapiv3.yaml"),
};

const cliContractFiles = {
  techtree: resolve(root, "../techtree/docs/cli-contract.yaml"),
  autolaunch: resolve(root, "../autolaunch/docs/cli-contract.yaml"),
  "shared-services": resolve(root, "docs/shared-cli-contract.yaml"),
};

const ownershipPath = resolve(root, "packages/regent-cli/src/contracts/api-ownership.ts");
const cliIndexPath = resolve(root, "packages/regent-cli/src/index.ts");

const parseYaml = (file) => YAML.parse(fs.readFileSync(file, "utf8"));

const readPaths = (file) => new Set(Object.keys(parseYaml(file).paths ?? {}));

const extractStrings = (input) => Array.from(input.matchAll(/"([^"]+)"/g), (match) => match[1]);

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

const flattenContract = (contract) => {
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
  techtree: extractOwnershipGroups(ownershipSource, "techtreeApiCommandGroups"),
  autolaunch: extractOwnershipGroups(ownershipSource, "autolaunchApiCommandGroups"),
  "shared-services": extractOwnershipGroups(ownershipSource, "sharedServicesApiCommandGroups"),
};

const contracts = Object.fromEntries(
  Object.entries(cliContractFiles).map(([owner, file]) => [owner, parseYaml(file)]),
);

const flattenedContracts = Object.fromEntries(
  Object.entries(contracts).map(([owner, contract]) => [owner, flattenContract(contract)]),
);

for (const [owner, apiFile] of Object.entries(openApiFiles)) {
  const openApiPaths = readPaths(apiFile);
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

const cliIndex = fs.readFileSync(cliIndexPath, "utf8");
const requiredChatboxCommands = ["chatbox history", "chatbox tail", "chatbox post"];
for (const command of requiredChatboxCommands) {
  if (!flattenedContracts.techtree.commands.has(command)) {
    fail(`Techtree CLI contract is missing runtime command: ${command}`);
  }
}

for (const snippet of ['namespace === "chatbox" && subcommand === "history"', 'namespace === "chatbox" && subcommand === "tail"', 'namespace === "chatbox" && subcommand === "post"']) {
  if (!cliIndex.includes(snippet)) {
    fail(`CLI dispatcher is missing required chatbox branch: ${snippet}`);
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
