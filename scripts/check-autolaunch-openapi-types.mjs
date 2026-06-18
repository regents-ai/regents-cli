import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const tempDir = mkdtempSync(join(tmpdir(), "autolaunch-openapi-"));
const tempFile = join(tempDir, "autolaunch-openapi.ts");

try {
  const generate = spawnSync(
    "pnpm",
    [
      "exec",
      "openapi-typescript",
      resolve(root, "../platform/contracts/autolaunch/api-contract.openapiv3.yaml"),
      "-o",
      tempFile,
    ],
    { cwd: root, stdio: "inherit" },
  );

  if (generate.status !== 0) {
    process.exit(generate.status ?? 1);
  }

  const diff = spawnSync(
    "diff",
    [
      "-u",
      resolve(root, "packages/regents-cli/src/generated/autolaunch-openapi.ts"),
      tempFile,
    ],
    { cwd: root, stdio: "inherit" },
  );

  process.exitCode = diff.status ?? 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
