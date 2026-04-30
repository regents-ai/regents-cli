import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { loadYaml } from "./dependency-preflight.mjs";
import {
  readWorkspaceManifest,
  requiredWorkspaceFiles,
} from "../packages/regents-cli/src/workspace/manifest.js";

const root = resolve(import.meta.dirname, "..");
const YAML = await loadYaml(root);
const manifest = readWorkspaceManifest(root, YAML);

const requiredFiles = requiredWorkspaceFiles(manifest, root);

const missingFiles = requiredFiles.filter(({ path, kind }) => {
  try {
    if (!existsSync(path)) {
      return true;
    }
    const stats = statSync(path);
    return kind === "dir" ? !stats.isDirectory() : !stats.isFile();
  } catch {
    return true;
  }
});

if (missingFiles.length > 0) {
  console.error("Contract checks need these files before they can run:");
  for (const file of missingFiles) {
    console.error(`- ${file.label}: ${file.path}`);
  }
  console.error("");
  console.error("Check out the sibling contract repositories, then rerun the check.");
  process.exit(1);
}

console.log("contract input check passed");
