import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");

const targets = [
  {
    input: resolve(root, "../techtree/docs/api-contract.openapiv3.yaml"),
    output: resolve(root, "packages/regent-cli/src/generated/techtree-openapi.ts"),
  },
  {
    input: resolve(root, "../autolaunch/docs/api-contract.openapiv3.yaml"),
    output: resolve(root, "packages/regent-cli/src/generated/autolaunch-openapi.ts"),
  },
  {
    input: resolve(root, "docs/regent-services-contract.openapiv3.yaml"),
    output: resolve(root, "packages/regent-cli/src/generated/regent-services-openapi.ts"),
  },
];

for (const target of targets) {
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
