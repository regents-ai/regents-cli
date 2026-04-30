import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

const failures = [];

const sameFile = (left, right) => readFileSync(left).equals(readFileSync(right));

for (const target of targets) {
  for (const [kind, path] of [
    ["contract input", target.input],
    ["generated output", target.output],
  ]) {
    try {
      if (!existsSync(path) || !statSync(path).isFile()) {
        failures.push(`${target.label} missing ${kind}: ${path}`);
      }
    } catch {
      failures.push(`${target.label} missing ${kind}: ${path}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), "regent-openapi-types-"));

try {
  for (const target of targets) {
    const tempOutput = join(tempDir, `${target.label.toLowerCase().replaceAll(" ", "-")}.ts`);
    const result = spawnSync(
      "pnpm",
      ["exec", "openapi-typescript", target.input, "-o", tempOutput],
      { cwd: root, encoding: "utf8" },
    );

    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout || `${target.label} OpenAPI generation failed\n`);
      process.exit(result.status ?? 1);
    }

    if (!sameFile(tempOutput, target.output)) {
      failures.push(
        [
          `${target.label} generated OpenAPI types drifted from the current contract`,
          `source: ${target.input}`,
          `generated: ${target.output}`,
        ].join("\n"),
      );
    }
  }
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log("OpenAPI generated types check passed");
