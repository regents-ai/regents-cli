import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const input = resolve(root, "docs/regent-services-contract.openapiv3.yaml");
const output = resolve(root, "packages/regents-cli/src/generated/regent-services-openapi.ts");
const tempDir = mkdtempSync(join(tmpdir(), "regent-services-openapi-"));
const generated = join(tempDir, "regent-services-openapi.ts");

try {
  const result = spawnSync("pnpm", ["exec", "openapi-typescript", input, "-o", generated], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "OpenAPI generation failed\n");
    process.exit(result.status ?? 1);
  }
  if (!readFileSync(generated).equals(readFileSync(output))) {
    console.error("Shared services generated OpenAPI types drifted from docs/regent-services-contract.openapiv3.yaml");
    process.exit(1);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("repository-local OpenAPI generated types check passed");
