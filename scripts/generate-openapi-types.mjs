import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const input = resolve(root, "docs/regent-services-contract.openapiv3.yaml");
const output = resolve(root, "packages/regents-cli/src/generated/regent-services-openapi.ts");
mkdirSync(dirname(output), { recursive: true });

const result = spawnSync("pnpm", ["exec", "openapi-typescript", input, "-o", output], {
  cwd: root,
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
