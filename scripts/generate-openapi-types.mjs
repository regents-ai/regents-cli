import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadYaml } from "./dependency-preflight.mjs";
import {
  openApiGenerationTargets,
  readWorkspaceManifest,
} from "../packages/regents-cli/src/workspace/manifest.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const YAML = await loadYaml(root);
const manifest = readWorkspaceManifest(root, YAML);

const targets = openApiGenerationTargets(manifest, root);
const platformContractFiles = ["api-contract.openapiv3.yaml", "cli-contract.yaml"];

const platformContractPath = (filename) => resolve(root, "..", "platform", filename);

const platformContractContents = (filename) => {
  const path = platformContractPath(filename);
  if (!existsSync(path) || !statSync(path).isFile()) {
    console.error(`Missing Platform contract input: ${path}`);
    console.error("Check out the sibling platform repository, then rerun OpenAPI generation.");
    process.exit(1);
  }

  return readFileSync(path, "utf8");
};

const platformContractDigest = () => {
  const body = platformContractFiles
    .map((filename) => `${filename}\n${platformContractContents(filename)}`)
    .join("\n---\n");

  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
};

const platformContractMajor = () => {
  const match = platformContractContents("api-contract.openapiv3.yaml").match(
    /^\s*version:\s*([0-9]+(?:\.[0-9]+){0,2})\s*$/m,
  );
  return (match?.[1] ?? "0.0.0").split(".", 1)[0] ?? "0";
};

const writePlatformContractDigest = () => {
  const output = resolve(root, "packages/regents-cli/src/generated/platform-contract-digest.ts");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    [
      "// Generated from platform/contracts/platform/api-contract.openapiv3.yaml.",
      "// Keep this in sync with Platform when the contract changes.",
      "",
      `export const SUPPORTED_PLATFORM_CONTRACT_MAJOR = "${platformContractMajor()}";`,
      "export const EXPECTED_PLATFORM_CONTRACT_DIGEST =",
      `  "${platformContractDigest()}";`,
      "",
    ].join("\n"),
    "utf8",
  );
};

for (const target of targets) {
  if (!existsSync(target.input) || !statSync(target.input).isFile()) {
    console.error(`Missing OpenAPI contract input: ${target.input}`);
    console.error("Check out the sibling contract repositories, then rerun OpenAPI generation.");
    process.exit(1);
  }

  mkdirSync(dirname(target.output), { recursive: true });
  const result = spawnSync(
    "pnpm",
    ["exec", "openapi-typescript", target.input, "-o", target.output],
    { cwd: root, stdio: "inherit" },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

writePlatformContractDigest();
