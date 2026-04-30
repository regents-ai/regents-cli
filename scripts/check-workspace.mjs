import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { loadYaml } from "./dependency-preflight.mjs";
import {
  allContractEntries,
  defaultWorkspaceManifestPath,
  incidentClasses,
  knownReleaseGaps,
  moneyMovementRows,
  readWorkspaceManifest,
  repoEntries,
  requiredWorkspaceFiles,
  sharedContractPairs,
  walletActionSchemaPath,
} from "../packages/regents-cli/src/workspace/manifest.js";

const root = resolve(import.meta.dirname, "..");
const YAML = await loadYaml(root);
const manifestPath = defaultWorkspaceManifestPath(root);
const failures = [];

const fileExists = (path) => {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
};

const dirExists = (path) => {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const sameFile = (left, right) => readFileSync(left).equals(readFileSync(right));
const parseYamlFile = (path) => YAML.parse(readFileSync(path, "utf8"));
const fail = (message) => failures.push(message);

let manifest;
try {
  manifest = readWorkspaceManifest(root, YAML, manifestPath);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const repos = repoEntries(manifest, root);
const repoNames = new Set();
for (const repo of repos) {
  if (repoNames.has(repo.name)) {
    fail(`duplicate repo entry: ${repo.name}`);
  }
  repoNames.add(repo.name);

  if (repo.requiredForPublicBeta && !dirExists(repo.resolvedPath)) {
    fail(`missing required repo ${repo.name}: ${repo.resolvedPath}`);
  }

  if (repo.requiredForPublicBeta && repo.acceptanceCommands.length === 0) {
    fail(`required repo ${repo.name} has no acceptance commands`);
  }
}

for (const required of requiredWorkspaceFiles(manifest, root)) {
  const ok = required.kind === "dir" ? dirExists(required.path) : fileExists(required.path);
  if (!ok) {
    fail(`missing ${required.label}: ${required.path}`);
  }
}

for (const contract of allContractEntries(manifest, root)) {
  if (contract.requiredForPublicBeta && !["api", "cli", "shared"].includes(contract.kind)) {
    fail(`contract ${contract.id} has invalid kind ${contract.kind}`);
  }
  if (contract.kind === "api" && fileExists(contract.resolvedPath)) {
    const document = parseYamlFile(contract.resolvedPath);
    const capability = document?.["x-regent-capability"];
    if (!capability || typeof capability !== "object") {
      fail(`API contract ${contract.id} is missing x-regent-capability metadata`);
    } else {
      for (const field of ["status", "owner", "money_path", "cli_surface", "mobile_surface"]) {
        if (!(field in capability)) {
          fail(`API contract ${contract.id} is missing x-regent-capability.${field}`);
        }
      }
    }
  }
  for (const binding of contract.generatedBindings) {
    if (binding.generator !== "openapi-typescript") {
      fail(`contract ${contract.id} has unsupported generated binding generator ${binding.generator}`);
    }
  }
}

for (const pair of sharedContractPairs(manifest, root)) {
  if (!fileExists(pair.source)) {
    fail(`shared contract pair ${pair.id} is missing source: ${pair.source}`);
    continue;
  }
  if (!fileExists(pair.mirror)) {
    fail(`shared contract pair ${pair.id} is missing mirror: ${pair.mirror}`);
    continue;
  }
  if (!sameFile(pair.source, pair.mirror)) {
    fail(`shared contract pair ${pair.id} drifted: ${pair.source} != ${pair.mirror}`);
  }
}

const schemaPath = walletActionSchemaPath(manifest, root);
if (!fileExists(schemaPath)) {
  fail(`missing WalletAction schema: ${schemaPath}`);
}

const movementIds = new Set();
for (const row of moneyMovementRows(manifest)) {
  if (movementIds.has(row.id)) {
    fail(`duplicate money movement row: ${row.id}`);
  }
  movementIds.add(row.id);
}

const incidentIds = new Set();
for (const incident of incidentClasses(manifest)) {
  if (incidentIds.has(incident.id)) {
    fail(`duplicate incident class: ${incident.id}`);
  }
  incidentIds.add(incident.id);
  if (!repoNames.has(incident.ownerRepo) && !["shared-services"].includes(incident.ownerRepo)) {
    fail(`incident class ${incident.id} references unknown owner repo ${incident.ownerRepo}`);
  }
}

const releaseGapIds = new Set();
for (const gap of knownReleaseGaps(manifest)) {
  if (releaseGapIds.has(gap.id)) {
    fail(`duplicate known release gap: ${gap.id}`);
  }
  releaseGapIds.add(gap.id);

  if (!["open", "blocked", "done"].includes(gap.status)) {
    fail(`known release gap ${gap.id} has unsupported status ${gap.status}`);
  }

  if (!repoNames.has(gap.ownerRepo)) {
    fail(`known release gap ${gap.id} references unknown owner repo ${gap.ownerRepo}`);
  }

  for (const repo of gap.affectedRepos) {
    if (!repoNames.has(repo)) {
      fail(`known release gap ${gap.id} references unknown affected repo ${repo}`);
    }
  }

  if (gap.acceptance.length === 0) {
    fail(`known release gap ${gap.id} has no acceptance checks`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("workspace check passed");
