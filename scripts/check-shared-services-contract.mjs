import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadYaml } from "./dependency-preflight.mjs";
import {
  openApiGenerationTargets,
  readWorkspaceManifest,
  sharedContractPairs,
} from "../packages/regents-cli/src/workspace/manifest.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const YAML = await loadYaml(root);
const manifest = readWorkspaceManifest(root, YAML);
const sharedPair = sharedContractPairs(manifest, root).find((pair) => pair.id === "shared_services_contract");
if (!sharedPair) {
  console.error("Regent workspace manifest is missing shared_services_contract.");
  process.exit(1);
}
const sourceContractPath = sharedPair.source;
const servedContractPath = sharedPair.mirror;
const sharedTarget = openApiGenerationTargets(manifest, root).find((target) => target.input === sourceContractPath);
if (!sharedTarget) {
  console.error(`Regent workspace manifest is missing generated binding for ${sourceContractPath}.`);
  process.exit(1);
}
const generatedContractPath = sharedTarget.output;

const read = (path) => readFileSync(path);
const readText = (path) => readFileSync(path, "utf8");
const sameFile = (left, right) => read(left).equals(read(right));
const failures = [];
const requiredFiles = [
  ["source shared services contract", sourceContractPath],
  ["served SIWA shared services contract", servedContractPath],
  ["generated shared services OpenAPI types", generatedContractPath],
];

for (const [label, path] of requiredFiles) {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) {
      failures.push(`missing ${label}: ${path}`);
    }
  } catch {
    failures.push(`missing ${label}: ${path}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

const stable = (value) => {
  if (Array.isArray(value)) {
    return value.map(stable);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }

  return value;
};

const sameValue = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));

const sourceContract = YAML.parse(readText(sourceContractPath));
const servedContract = YAML.parse(readText(servedContractPath));
const sourcePaths = sourceContract.paths ?? {};
const servedPaths = servedContract.paths ?? {};

for (const [servedPath, servedMethods] of Object.entries(servedPaths)) {
  const sourceMethods = sourcePaths[servedPath];

  if (!sourceMethods) {
    failures.push(`SIWA serves ${servedPath}, but it is missing from ${sourceContractPath}`);
    continue;
  }

  if (!sameValue(servedMethods, sourceMethods)) {
    failures.push(
      [
        `SIWA served contract drifted for ${servedPath}`,
        `source: ${sourceContractPath}`,
        `served: ${servedContractPath}`,
      ].join("\n"),
    );
  }
}

const servedTagNames = new Set((servedContract.tags ?? []).map((tag) => tag?.name).filter(Boolean));
const sourceTagNames = new Set((sourceContract.tags ?? []).map((tag) => tag?.name).filter(Boolean));

for (const tag of servedTagNames) {
  if (!sourceTagNames.has(tag)) {
    failures.push(`SIWA served tag ${tag} is missing from ${sourceContractPath}`);
  }
}

const tempDir = mkdtempSync(join(tmpdir(), "regent-services-openapi-"));
const tempGeneratedPath = join(tempDir, "regent-services-openapi.ts");

try {
  const result = spawnSync(
    "pnpm",
    ["exec", "openapi-typescript", sourceContractPath, "-o", tempGeneratedPath],
    { cwd: root, encoding: "utf8" },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "shared services OpenAPI generation failed\n");
    process.exit(result.status ?? 1);
  }

  if (!sameFile(tempGeneratedPath, generatedContractPath)) {
    failures.push(
      [
        "generated shared services OpenAPI types drifted from the source contract",
        `source: ${sourceContractPath}`,
        `generated: ${generatedContractPath}`,
      ].join("\n"),
    );
  }
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log("shared services contract check passed");
