import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";
import { loadYaml } from "./dependency-preflight.mjs";
import { checkMetaRender } from "./render-meta.mjs";
import {
  allContractEntries,
  chainContractManifestEntries,
  defaultWorkspaceManifestPath,
  generatedViewEntries,
  incidentClasses,
  knownReleaseGaps,
  moneyMovementRows,
  readWorkspaceManifest,
  repoEntries,
  repoManifestEntries,
  requiredWorkspaceFiles,
  runtimeContractEntries,
  schemaEntries,
  sharedContractPairs,
  walletActionSchemaPath,
  workspaceRootFromCliRoot,
} from "../packages/regents-cli/src/workspace/manifest.js";

const root = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(root, "..");
const syncContractArtifactsScriptPath = resolve(workspaceRoot, "scripts/sync-contract-artifacts.sh");
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
const pairKey = (source, mirror) => `${source}|${mirror}`;
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const asArray = (value) => Array.isArray(value) ? value : [];

const findFilesNamed = (startPath, filename) => {
  const ignoredDirs = new Set([".git", "node_modules", "deps", "_build", ".beads", ".pnpm-store", "dist", "out"]);
  const found = [];
  const visit = (currentPath) => {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          visit(resolve(currentPath, entry.name));
        }
        continue;
      }
      if (entry.isFile() && entry.name === filename) {
        found.push(resolve(currentPath, entry.name));
      }
    }
  };
  visit(startPath);
  return found;
};

const validateCliContractV1 = (contract, contractPath) => {
  if (!isRecord(contract)) {
    fail(`CLI contract is not a YAML object: ${contractPath}`);
    return;
  }
  if ("openapi" in contract || (Array.isArray(contract.commands) && !Array.isArray(contract.command_groups))) {
    fail(`CLI contract uses retired pre-v1 shape: ${contractPath}`);
  }
  if (contract.version !== 1) {
    fail(`CLI contract must set version: 1: ${contractPath}`);
  }
  if (typeof contract.product !== "string" || contract.product.trim() === "") {
    fail(`CLI contract must set product: ${contractPath}`);
  }
  if (!Array.isArray(contract.command_groups) || contract.command_groups.length === 0) {
    fail(`CLI contract must define command_groups: ${contractPath}`);
    return;
  }
  for (const [index, group] of contract.command_groups.entries()) {
    if (!isRecord(group)) {
      fail(`CLI contract ${contractPath} has invalid command_groups[${index}]`);
      continue;
    }
    for (const field of ["name", "interface", "auth_mode"]) {
      if (typeof group[field] !== "string" || group[field].trim() === "") {
        fail(`CLI contract ${contractPath} command_groups[${index}] is missing ${field}`);
      }
    }
    if (!Array.isArray(group.commands) || group.commands.length === 0) {
      fail(`CLI contract ${contractPath} command_groups[${index}] has no commands`);
    }
  }
};

const readRuntimeRegistryMethods = (registryPath) => {
  const source = readFileSync(registryPath, "utf8");
  return Array.from(source.matchAll(/:\s*"([^"]+)"/g), (match) => match[1]);
};

const renderJsonRpcMethodsMarkdown = (contract) => {
  const titles = new Map([
    ["runtime", "Runtime"],
    ["agent", "Agent"],
    ["doctor", "Doctor"],
    ["auth", "Auth"],
    ["techtree", "Techtree"],
    ["x402", "X402"],
    ["transports", "Transports"],
  ]);
  const lines = [
    "# JSON-RPC Methods",
    "",
    "`regents-cli` uses JSON-RPC 2.0 over a Unix domain socket. Each request and response is one JSON line.",
    "",
    "This file is generated from the current runtime method registry.",
    "",
  ];
  for (const group of contract.method_groups ?? []) {
    if (!isRecord(group) || !Array.isArray(group.methods) || group.methods.length === 0) {
      continue;
    }
    lines.push(`## ${titles.get(group.name) ?? group.name}`, "");
    for (const method of group.methods) {
      lines.push(`- \`${method}\``);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
};

const validateRuntimeContract = (runtime) => {
  if (!fileExists(runtime.resolvedPath)) {
    fail(`missing runtime contract ${runtime.id}: ${runtime.resolvedPath}`);
    return;
  }
  const contract = parseYamlFile(runtime.resolvedPath);
  const yamlMethods = asArray(contract.methods).map((method) => isRecord(method) ? method.name : undefined);
  const registryMethods = readRuntimeRegistryMethods(runtime.resolvedRegistry);
  const yamlSet = new Set(yamlMethods);
  const registrySet = new Set(registryMethods);
  for (const method of registryMethods) {
    if (!yamlSet.has(method)) {
      fail(`JSON-RPC contract ${runtime.id} is missing runtime registry method: ${method}`);
    }
  }
  for (const method of yamlMethods) {
    if (!registrySet.has(method)) {
      fail(`JSON-RPC contract ${runtime.id} names extra method not in runtime registry: ${method}`);
    }
  }
  const rendered = renderJsonRpcMethodsMarkdown(contract);
  if (!fileExists(runtime.resolvedGeneratedMarkdown)) {
    fail(`JSON-RPC generated markdown is missing: ${runtime.resolvedGeneratedMarkdown}`);
  } else if (readFileSync(runtime.resolvedGeneratedMarkdown, "utf8") !== rendered) {
    fail(`JSON-RPC generated markdown drifted: ${runtime.resolvedGeneratedMarkdown}`);
  }
};

const getByPath = (value, dottedPath) =>
  dottedPath.split(".").reduce((current, part) => current?.[part], value);

const CHAIN_TARGETS = new Set(["base-mainnet", "base-sepolia"]);
const SIGNER_CLASSES = new Set([
  "auction_tokens_recipient",
  "authorized_creator",
  "funds_recipient_strategy",
  "launch_strategy",
  "staker_wallet",
  "strategy_operator",
  "subject_manager",
  "subject_manager_or_authorized_registrar",
]);
const BENEFICIARY_CLASSES = new Set([
  "auction_tokens_recipient",
  "launch_market",
  "launch_pool_and_position_recipient",
  "launch_wallet",
  "staking_contract",
  "staker_wallet",
  "strategy",
  "subject_identity",
  "subject_owner",
  "subject_splitter",
  "vesting_wallet",
]);
const ROOT_CHAIN_MANIFEST_FIELDS = new Set(["version", "product", "contracts"]);
const CONTRACT_FIELDS = new Set(["id", "artifact", "abi_path", "chain_target", "prepared_actions", "validation_command"]);
const PREPARED_ACTION_FIELDS = new Set(["id", "function", "signer_class", "beneficiary_class"]);
const CONTRACT_REQUIRED_FIELDS = ["id", "artifact", "abi_path", "chain_target", "prepared_actions", "validation_command"];
const PREPARED_ACTION_REQUIRED_FIELDS = ["id", "function", "signer_class", "beneficiary_class"];
const SNAKE_ID_PATTERN = /^[a-z][a-z0-9_]*$/u;
const SOLIDITY_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const ABI_PATH_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/u;
const ARTIFACT_PATH_PATTERN = /^out\/[A-Za-z0-9_$.-]+\.sol\/[A-Za-z0-9_$.-]+\.json$/u;
const VALIDATION_COMMAND_PATTERN = /^forge test --offline --match-contract [A-Za-z_][A-Za-z0-9_]*Test$/u;
const CHAIN_MANIFEST_NEGATIVE_FIXTURES = [
  {
    name: "malformed artifact path",
    path: "meta/fixtures/chain-contracts/invalid-artifact-path.yaml",
    expected: "artifact must match",
  },
  {
    name: "bad chain target",
    path: "meta/fixtures/chain-contracts/invalid-chain-target.yaml",
    expected: "chain_target must be one of",
  },
  {
    name: "bad signer class",
    path: "meta/fixtures/chain-contracts/invalid-signer-class.yaml",
    expected: "signer_class must be one of",
  },
  {
    name: "bad beneficiary class",
    path: "meta/fixtures/chain-contracts/invalid-beneficiary-class.yaml",
    expected: "beneficiary_class must be one of",
  },
  {
    name: "missing validation command",
    path: "meta/fixtures/chain-contracts/missing-validation-command.yaml",
    expected: "is missing validation_command",
  },
];

const hasOwn = (object, field) => Object.prototype.hasOwnProperty.call(object, field);
const enumList = (values) => Array.from(values).sort().join(", ");

const optionValue = (flag) => {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${flag} requires a path`);
    process.exit(1);
  }
  return resolve(process.cwd(), value);
};

const rejectUnknownFields = (value, allowedFields, label, localFailures) => {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      localFailures.push(`${label} has unknown field ${field}`);
    }
  }
};

const rejectMissingFields = (value, requiredFields, label, localFailures) => {
  for (const field of requiredFields) {
    if (!hasOwn(value, field)) {
      localFailures.push(`${label} is missing ${field}`);
    }
  }
};

const validString = (value, label, localFailures, options = {}) => {
  if (typeof value !== "string" || value.trim() === "") {
    localFailures.push(`${label} must be a non-empty string`);
    return undefined;
  }
  const trimmed = value.trim();
  if (options.pattern && !options.pattern.test(trimmed)) {
    localFailures.push(`${label} ${options.patternMessage ?? "has invalid shape"}`);
    return undefined;
  }
  if (options.allowedValues && !options.allowedValues.has(trimmed)) {
    localFailures.push(`${label} must be one of ${enumList(options.allowedValues)}`);
    return undefined;
  }
  return trimmed;
};

const collectChainManifestFailures = (manifestEntry) => {
  const localFailures = [];
  const manifestPath = manifestEntry.documentPath ?? manifestEntry.resolvedPath;
  const artifactBasePath = manifestEntry.artifactBasePath ?? dirname(manifestEntry.resolvedPath);

  if (!fileExists(manifestPath)) {
    localFailures.push(`missing chain contract manifest ${manifestEntry.id}: ${manifestPath}`);
    return localFailures;
  }

  let document;
  try {
    document = parseYamlFile(manifestPath);
  } catch (error) {
    localFailures.push(`chain contract manifest ${manifestEntry.id} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
    return localFailures;
  }

  if (!isRecord(document)) {
    localFailures.push(`chain contract manifest ${manifestEntry.id} must be a YAML object`);
    return localFailures;
  }

  rejectUnknownFields(document, ROOT_CHAIN_MANIFEST_FIELDS, `chain contract manifest ${manifestEntry.id}`, localFailures);

  if (document.version !== 1) {
    localFailures.push(`chain contract manifest ${manifestEntry.id} must set version: 1`);
  }
  validString(document.product, `chain contract manifest ${manifestEntry.id}.product`, localFailures, {
    pattern: /^[a-z][a-z0-9_-]*$/u,
    patternMessage: "must start with a lowercase letter and use only lowercase letters, numbers, underscores, or hyphens",
  });
  if (!Array.isArray(document.contracts) || document.contracts.length === 0) {
    localFailures.push(`chain contract manifest ${manifestEntry.id} must define at least one contract`);
    return localFailures;
  }

  for (const [index, contract] of document.contracts.entries()) {
    if (!isRecord(contract)) {
      localFailures.push(`chain contract manifest ${manifestEntry.id} has invalid contracts[${index}]`);
      continue;
    }

    const contractLabelId = typeof contract.id === "string" && contract.id.trim() !== "" ? contract.id.trim() : String(index);
    const contractLabel = `chain contract ${manifestEntry.id}/${contractLabelId}`;
    rejectUnknownFields(contract, CONTRACT_FIELDS, contractLabel, localFailures);
    rejectMissingFields(contract, CONTRACT_REQUIRED_FIELDS, contractLabel, localFailures);

    validString(contract.id, `${contractLabel}.id`, localFailures, {
      pattern: SNAKE_ID_PATTERN,
      patternMessage: "must be lower_snake_case",
    });
    const artifact = validString(contract.artifact, `${contractLabel}.artifact`, localFailures, {
      pattern: ARTIFACT_PATH_PATTERN,
      patternMessage: "must match out/<Contract>.sol/<Contract>.json",
    });
    const abiPath = validString(contract.abi_path, `${contractLabel}.abi_path`, localFailures, {
      pattern: ABI_PATH_PATTERN,
      patternMessage: "must be a dotted ABI field path",
    });
    validString(contract.chain_target, `${contractLabel}.chain_target`, localFailures, {
      allowedValues: CHAIN_TARGETS,
    });
    validString(contract.validation_command, `${contractLabel}.validation_command`, localFailures, {
      pattern: VALIDATION_COMMAND_PATTERN,
      patternMessage: "must match forge test --offline --match-contract <TestName>Test",
    });

    const actions = [];
    if (!Array.isArray(contract.prepared_actions) || contract.prepared_actions.length === 0) {
      localFailures.push(`${contractLabel}.prepared_actions must be a non-empty array`);
    } else {
      for (const [actionIndex, action] of contract.prepared_actions.entries()) {
        if (!isRecord(action)) {
          localFailures.push(`${contractLabel}.prepared_actions[${actionIndex}] must be an object`);
          continue;
        }

        const actionLabelId = typeof action.id === "string" && action.id.trim() !== "" ? action.id.trim() : String(actionIndex);
        const actionLabel = `${contractLabel} action ${actionLabelId}`;
        rejectUnknownFields(action, PREPARED_ACTION_FIELDS, actionLabel, localFailures);
        rejectMissingFields(action, PREPARED_ACTION_REQUIRED_FIELDS, actionLabel, localFailures);

        validString(action.id, `${actionLabel}.id`, localFailures, {
          pattern: SNAKE_ID_PATTERN,
          patternMessage: "must be lower_snake_case",
        });
        const functionName = validString(action.function, `${actionLabel}.function`, localFailures, {
          pattern: SOLIDITY_IDENTIFIER_PATTERN,
          patternMessage: "must be a Solidity function name",
        });
        validString(action.signer_class, `${actionLabel}.signer_class`, localFailures, {
          allowedValues: SIGNER_CLASSES,
        });
        validString(action.beneficiary_class, `${actionLabel}.beneficiary_class`, localFailures, {
          allowedValues: BENEFICIARY_CLASSES,
        });

        if (functionName) {
          actions.push({ label: actionLabel, functionName });
        }
      }
    }

    if (!artifact || !abiPath) {
      continue;
    }

    const artifactPath = resolve(artifactBasePath, artifact);
    if (!fileExists(artifactPath)) {
      localFailures.push(`${contractLabel} is missing artifact: ${artifactPath}`);
      continue;
    }

    let artifactDocument;
    try {
      artifactDocument = JSON.parse(readFileSync(artifactPath, "utf8"));
    } catch (error) {
      localFailures.push(`${contractLabel} artifact is not valid JSON: ${artifactPath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const abi = getByPath(artifactDocument, abiPath);
    if (!Array.isArray(abi)) {
      localFailures.push(`${contractLabel} has no ABI at ${abiPath}`);
      continue;
    }

    const functions = new Set(abi.filter((entry) => entry?.type === "function").map((entry) => entry.name));
    for (const action of actions) {
      if (!functions.has(action.functionName)) {
        localFailures.push(`${action.label} references missing ABI function ${action.functionName}`);
      }
    }
  }

  return localFailures;
};

const validateChainManifest = (manifestEntry) => {
  for (const message of collectChainManifestFailures(manifestEntry)) {
    fail(message);
  }
};

const checkNegativeChainManifestFixtures = (manifestEntry) => {
  for (const fixture of CHAIN_MANIFEST_NEGATIVE_FIXTURES) {
    const fixturePath = resolve(workspaceRoot, fixture.path);
    const fixtureFailures = collectChainManifestFailures({
      ...manifestEntry,
      id: `${manifestEntry.id} negative fixture ${fixture.name}`,
      documentPath: fixturePath,
      artifactBasePath: dirname(manifestEntry.resolvedPath),
    });
    if (fixtureFailures.length === 0) {
      fail(`negative chain contract manifest fixture unexpectedly passed: ${relative(workspaceRoot, fixturePath)}`);
      continue;
    }
    if (!fixtureFailures.some((message) => message.includes(fixture.expected))) {
      fail(`negative chain contract manifest fixture failed for the wrong reason: ${relative(workspaceRoot, fixturePath)}; expected "${fixture.expected}", got "${fixtureFailures.join("; ")}"`);
    }
  }
};

const checkNoLegacyBeadsCliGuidance = () => {
  const ignoredDirs = new Set([".git", "node_modules", "deps", "_build", ".beads", ".pnpm-store", "dist", "out"]);
  const textExtensions = new Set([".md", ".txt", ".yaml", ".yml", ".json", ".toml"]);
  const legacyPatterns = [
    /`beads(?:\s|`)/iu,
    /\bbeads\s+(?:ready|show|update|close|create|status|prime|where|init|link|dep|note|comment)\b/iu,
  ];
  const visit = (currentPath) => {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      const fullPath = resolve(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          visit(fullPath);
        }
        continue;
      }
      if (!entry.isFile() || !textExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
        continue;
      }
      const relativePath = relative(workspaceRoot, fullPath);
      const text = readFileSync(fullPath, "utf8");
      for (const pattern of legacyPatterns) {
        if (pattern.test(text)) {
          fail(`legacy Beads CLI guidance still says to run beads instead of bd: ${relativePath}`);
          break;
        }
      }
    }
  };
  visit(workspaceRoot);
};

const syncContractArtifactPairs = () => {
  if (!fileExists(syncContractArtifactsScriptPath)) {
    fail(`missing contract artifact sync script: ${syncContractArtifactsScriptPath}`);
    return new Set();
  }

  const script = readFileSync(syncContractArtifactsScriptPath, "utf8");
  return new Set(
    Array.from(script.matchAll(/^\s*"([^"|]+)\|([^"]+)"\s*$/gmu)).map((match) =>
      pairKey(resolve(workspaceRoot, match[1]), resolve(workspaceRoot, match[2])),
    ),
  );
};

let manifest;
try {
  manifest = readWorkspaceManifest(root, YAML, manifestPath);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const chainManifestEntries = chainContractManifestEntries(manifest, root);
const chainManifestFixturePath = optionValue("--chain-manifest-fixture");
if (chainManifestFixturePath) {
  if (chainManifestEntries.length === 0) {
    fail("Regent workspace manifest has no chain contract manifests to validate against");
  } else {
    const manifestEntry = chainManifestEntries[0];
    validateChainManifest({
      ...manifestEntry,
      id: `${manifestEntry.id} fixture`,
      documentPath: chainManifestFixturePath,
      artifactBasePath: dirname(manifestEntry.resolvedPath),
    });
  }

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }

  console.log("chain contract manifest fixture passed");
  process.exit(0);
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

  if (repo.active && !fileExists(resolve(repo.resolvedPath, "repo.yaml"))) {
    fail(`active repo ${repo.name} is missing repo.yaml`);
  }

  if (repo.requiredForPublicBeta && repo.acceptanceCommands.length === 0) {
    fail(`required repo ${repo.name} has no acceptance commands`);
  }
}

if (manifest?.control_plane?.stack_contract !== "meta/stack.yaml") {
  fail("meta/stack.yaml must identify itself as control_plane.stack_contract");
}
if (manifest?.beads?.command !== "bd" || manifest?.beads?.role !== "execution_graph_only") {
  fail("meta/stack.yaml must define bd as execution_graph_only");
}

for (const schema of schemaEntries(manifest, root)) {
  if (!fileExists(schema.resolvedPath)) {
    fail(`missing schema ${schema.id}: ${schema.resolvedPath}`);
  }
}

for (const repoManifest of repoManifestEntries(manifest, root)) {
  if (!fileExists(repoManifest.resolvedPath)) {
    fail(`missing repo manifest for ${repoManifest.repo}: ${repoManifest.resolvedPath}`);
    continue;
  }
  const nestedRepoManifests = findFilesNamed(dirname(repoManifest.resolvedPath), "repo.yaml");
  if (nestedRepoManifests.length !== 1) {
    fail(`active repo ${repoManifest.repo} must have exactly one repo.yaml; found ${nestedRepoManifests.length}`);
  }
  const repoDocument = parseYamlFile(repoManifest.resolvedPath);
  if (repoDocument?.version !== 1 || repoDocument?.repo !== repoManifest.repo) {
    fail(`repo.yaml for ${repoManifest.repo} must set version: 1 and repo: ${repoManifest.repo}`);
  }
  if (typeof repoDocument?.source_of_truth?.repo_contract !== "string") {
    fail(`repo.yaml for ${repoManifest.repo} must define source_of_truth.repo_contract`);
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
  if (contract.kind === "cli" && fileExists(contract.resolvedPath)) {
    validateCliContractV1(parseYamlFile(contract.resolvedPath), contract.resolvedPath);
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

const manifestContractPairKeys = new Set(sharedContractPairs(manifest, root).map((pair) => pairKey(pair.source, pair.mirror)));
const syncScriptContractPairKeys = syncContractArtifactPairs();
for (const pair of syncScriptContractPairKeys) {
  if (!manifestContractPairKeys.has(pair)) {
    fail(`sync script contract artifact pair is missing from meta/stack.yaml: ${pair}`);
  }
}
for (const pair of manifestContractPairKeys) {
  if (!syncScriptContractPairKeys.has(pair)) {
    fail(`meta/stack.yaml shared contract pair is missing from scripts/sync-contract-artifacts.sh: ${pair}`);
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

for (const runtime of runtimeContractEntries(manifest, root)) {
  validateRuntimeContract(runtime);
}

for (const manifestEntry of chainManifestEntries) {
  validateChainManifest(manifestEntry);
}
if (chainManifestEntries.length > 0) {
  checkNegativeChainManifestFixtures(chainManifestEntries[0]);
}

for (const generatedView of generatedViewEntries(manifest, root)) {
  if (generatedView.resolvedPath && !fileExists(generatedView.resolvedPath)) {
    fail(`generated view ${generatedView.id} is missing: ${generatedView.resolvedPath}`);
  }
}

const renderCheck = checkMetaRender({ workspaceRoot, YAML });
for (const message of renderCheck.failures) {
  fail(message);
}

checkNoLegacyBeadsCliGuidance();

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("meta check passed");
