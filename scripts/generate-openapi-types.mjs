import { existsSync, mkdirSync, statSync } from "node:fs";
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
