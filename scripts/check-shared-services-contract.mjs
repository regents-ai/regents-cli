import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const sourceContractPath = resolve(root, "docs/regent-services-contract.openapiv3.yaml");
const servedContractPath = resolve(
  root,
  "../siwa-server/priv/static/regent-services-contract.openapiv3.yaml",
);
const generatedContractPath = resolve(
  root,
  "packages/regents-cli/src/generated/regent-services-openapi.ts",
);

const read = (path) => readFileSync(path);
const sameFile = (left, right) => read(left).equals(read(right));
const failures = [];

if (!sameFile(sourceContractPath, servedContractPath)) {
  failures.push(
    [
      "siwa-server served shared services contract drifted from the source contract",
      `source: ${sourceContractPath}`,
      `served: ${servedContractPath}`,
    ].join("\n"),
  );
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
